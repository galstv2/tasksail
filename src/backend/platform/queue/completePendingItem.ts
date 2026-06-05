import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger, emitTaskProgressEvent, readTextFile, writeTextFileAtomic, writeTextFileAtomicSync, findRepoRoot, getErrorMessage } from '../core/index.js';
import { resolveQueuePaths } from './paths.js';
import { completeActiveItem, acquireDirLockOrThrow, activateNextPendingItemIfReady } from './operations.js';
import { assertPolicyPasses } from './policyValidation.js';
import { fileTaskArchive } from './archive.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/index.js';
import { syncRetrospectiveRequiredMetadata } from './retrospectiveFlag.js';
import { buildAdvisoryFindingSection, ADVISORY_FINDING_HEADING } from '../agent-runner/pipeline/remediation.js';
import { commitTaskSnapshot } from './errorItems.js';
import { closeoutQueueLockBudget } from './closeoutLockBudget.js';
import { transitionTask } from './taskRegistry.js';
import { finalizeTaskWorktrees } from '../core/worktreeFinalize.js';
import { verifyTaskBranches } from './branchVerification.js';
import { readTaskJson, resolveTaskJsonPath } from './taskJson.js';
import { getPlatformConfig } from '../platform-config/get.js';
import { stageAutoMergeCloseout, type AutoMergeResult, type AutoMergeBindingResult } from './autoMerge.js';
import {
  buildChildTaskChainCloseoutPolicy,
  verifyChildChainSourceBranchesExist,
} from './childTaskChainCloseoutValidation.js';
import { evictPolicyResultCache } from '../agent-runner/guardrails.js';
import { recordTaskCompletedNotification } from '../task-notifications/producer.js';
import {
  advanceCompletedChildTaskChain,
  attachCompletedBranchHandoffs,
  parseRecoveredChildTaskChainCloseout,
  prepareChildTaskChainCloseout,
  resolveArchiveArtifactDir,
  type PreparedChildTaskChainCloseout,
} from './childTaskChainCloseout.js';

const execFile = promisify(execFileCb);
const log = createLogger('platform/queue/completePendingItem');

export interface CompletePendingItemOptions {
  /** Required: the task ID to complete. */
  taskId: string;
  skipValidation?: boolean;
  skipArchive?: boolean;
  repoRoot?: string;
  contextPackDir?: string;
  recoveryArchivePath?: string | null;
  skipRetrospectiveSync?: boolean;
}

export interface CompletingSentinelPayload {
  ts: number;
  archiveSucceeded?: boolean;
  archivePath?: string | null;
  contextPackDir?: string;
  retrospectiveSynced?: boolean;
  retrospectiveSyncError?: string;
  childChainCloseout?: PreparedChildTaskChainCloseout;
  childChainAdvanced?: boolean;
}

export interface DeferredRetrospectiveMarker {
  taskId: string;
  contextPackDir: string;
  handoffsDir: string;
  deferredAt: string;
}

interface BranchHandoff {
  repo_root: string;
  repo_label: string;
  branch: string;
  base_commit_sha: string;
  head_commit_sha: string;
  commits_ahead: number;
  status: 'ready-for-operator-review' | 'auto-merged-to-target';
  auto_merge: {
    enabled: boolean;
    status: AutoMergeBindingResult['status'];
    target_branch: string | null;
    detail: string;
  };
}

export function deferredRetrospectiveMarkerPath(repoRoot: string, taskId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'tasks',
    taskId,
    'closeout-deferred-retro.json',
  );
}

export function writeDeferredRetrospectiveMarker(options: {
  repoRoot: string;
  taskId: string;
  contextPackDir: string;
  handoffsDir: string;
}): void {
  const markerPath = deferredRetrospectiveMarkerPath(options.repoRoot, options.taskId);
  mkdirSync(path.dirname(markerPath), { recursive: true });
  const payload: DeferredRetrospectiveMarker = {
    taskId: options.taskId,
    contextPackDir: options.contextPackDir,
    handoffsDir: options.handoffsDir,
    deferredAt: new Date().toISOString(),
  };
  writeTextFileAtomicSync(markerPath, JSON.stringify(payload, null, 2) + '\n');
}

function readCompletingSentinelPayload(sentinelPath: string): CompletingSentinelPayload {
  try {
    const parsed: unknown = JSON.parse(readFileSync(sentinelPath, 'utf8'));
    if (
      parsed
      && typeof parsed === 'object'
      && typeof (parsed as { ts?: unknown }).ts === 'number'
    ) {
      return parsed as CompletingSentinelPayload;
    }
  } catch {
    // Legacy or partially-written sentinels are treated as unknown progress.
  }
  return { ts: Date.now() };
}

export function mergeCompletingSentinelPayload(
  sentinelPath: string,
  patch: Partial<CompletingSentinelPayload>,
): void {
  const current = readCompletingSentinelPayload(sentinelPath);
  writeTextFileAtomicSync(sentinelPath, JSON.stringify({ ...current, ...patch }));
}

async function syncRetrospectiveWithDeferral(options: {
  retrospectiveOptions: Parameters<typeof syncRetrospectiveRequiredMetadata>[0] & { taskId: string };
  sentinelPath: string;
  repoRoot: string;
  taskId: string;
  contextPackDir: string;
  handoffsDir: string;
}): Promise<void> {
  try {
    await syncRetrospectiveRequiredMetadata(options.retrospectiveOptions);
    mergeCompletingSentinelPayload(options.sentinelPath, {
      retrospectiveSynced: true,
      retrospectiveSyncError: undefined,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn('retrospective_sync.deferred', { taskId: options.taskId, reason });
    mergeCompletingSentinelPayload(options.sentinelPath, {
      retrospectiveSynced: false,
      retrospectiveSyncError: reason,
    });
    writeDeferredRetrospectiveMarker({
      repoRoot: options.repoRoot,
      taskId: options.taskId,
      handoffsDir: options.handoffsDir,
      contextPackDir: options.contextPackDir,
    });
  }
}

/**
 * Best-effort resolution of the target repo's currently checked-out branch.
 * Used only to backfill auto_merge.target_branch for non-child-chain closeout
 * when auto-merge did not already capture it. Never blocks closeout: any git
 * failure, detached HEAD ("HEAD"), or empty result yields null.
 */
async function resolveTargetBranchForHandoff(originalRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['-C', originalRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

async function buildBranchHandoffsForArchive(options: {
  repoRoot: string;
  taskId: string;
  handoffsDir: string;
  autoMergeResult: AutoMergeResult;
  captureFallbackTargetBranch: boolean;
}): Promise<BranchHandoff[]> {
  const sidecarPath = resolveTaskJsonPath(options.taskId, options.repoRoot);
  if (!existsSync(sidecarPath)) {
    return [];
  }

  const taskJson = readTaskJson(options.taskId, options.repoRoot);
  const handoffs: BranchHandoff[] = [];
  for (const binding of taskJson.contextPackBinding.repoBindings) {
    const autoMerge = options.autoMergeResult.results.find((result) => (
      result.originalRoot === binding.originalRoot
      && result.sourceBranch === binding.worktreeBranch
    ));
    try {
      const [{ stdout: headStdout }, { stdout: countStdout }] = await Promise.all([
        execFile('git', ['-C', binding.originalRoot, 'rev-parse', binding.worktreeBranch]),
        execFile('git', [
          '-C', binding.originalRoot,
          'rev-list', '--count',
          `${binding.baseCommitSha}..${binding.worktreeBranch}`,
        ]),
      ]);
      const commitsAhead = Number(countStdout.trim());
      if (!Number.isInteger(commitsAhead) || commitsAhead < 0) {
        throw new Error(`invalid commits_ahead value "${countStdout.trim()}"`);
      }
      const targetBranch = autoMerge?.targetBranch
        ?? (options.captureFallbackTargetBranch ? await resolveTargetBranchForHandoff(binding.originalRoot) : null);
      handoffs.push({
        repo_root: binding.originalRoot,
        repo_label: path.basename(binding.originalRoot),
        branch: binding.worktreeBranch,
        base_commit_sha: binding.baseCommitSha,
        head_commit_sha: headStdout.trim(),
        commits_ahead: commitsAhead,
        status: autoMerge?.status === 'applied' ? 'auto-merged-to-target' : 'ready-for-operator-review',
        auto_merge: {
          enabled: options.autoMergeResult.enabled,
          status: autoMerge?.status ?? (options.autoMergeResult.enabled ? 'skipped-source-missing' : 'disabled'),
          target_branch: targetBranch,
          detail: autoMerge?.detail ?? (
            options.autoMergeResult.enabled
              ? 'Auto-merge result was unavailable for this binding.'
              : 'Auto-merge is disabled.'
          ),
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Completion blocked: failed to build branch handoff metadata for ${binding.worktreeBranch} ` +
        `in ${binding.originalRoot}: ${reason}`,
      );
    }
  }

  mkdirSync(options.handoffsDir, { recursive: true });
  writeTextFileAtomicSync(
    path.join(options.handoffsDir, 'branch-handoffs.json'),
    JSON.stringify(handoffs, null, 2) + '\n',
  );
  return handoffs;
}

async function logAutoMergeResult(repoRoot: string, taskId: string, result: AutoMergeResult): Promise<void> {
  if (!result.enabled) {
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'auto_merge.disabled' },
    });
    return;
  }
  if (result.applied) {
    const appliedParts: string[] = [];
    const skippedParts: string[] = [];
    for (const item of result.results) {
      const targetLabel = `${item.repoLabel}:${item.sourceBranch}->${item.targetBranch ?? '(unknown)'}`;
      if (item.status === 'applied') {
        appliedParts.push(targetLabel);
      } else {
        skippedParts.push(`${targetLabel} ${item.status}: ${item.detail.replace(/\.+$/u, '')}`);
      }
    }
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'auto_merge.applied', input: { repos: appliedParts.join(', ') } },
    });
    const skippedDetail = skippedParts.join('; ');
    if (skippedDetail) {
      await emitTaskProgressEvent({
        logger: log.child({ taskId }),
        repoRoot,
        taskId,
        event: { type: 'auto_merge.skipped', input: { detail: skippedDetail } },
      });
    }
    return;
  }
  const first = result.results[0];
  const detail = first ? `${first.status}: ${first.detail}` : 'no bindings';
  await emitTaskProgressEvent({
    logger: log.child({ taskId }),
    repoRoot,
    taskId,
    event: { type: 'auto_merge.skipped', input: { detail } },
  });
}

function targetBranchUpdateStatus(status: AutoMergeBindingResult['status']): 'applied' | 'disabled' | 'skipped' {
  if (status === 'applied') return 'applied';
  if (status === 'disabled') return 'disabled';
  return 'skipped';
}

async function emitTargetBranchUpdateEvents(repoRoot: string, taskId: string, result: AutoMergeResult): Promise<void> {
  for (const item of result.results) {
    const detail = item.detail.trim().replace(/\.+$/u, '');
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: {
        type: 'closeout.target_branch_update',
        input: {
          repoLabel: item.repoLabel,
          targetRepoRoot: item.originalRoot,
          sourceBranch: item.sourceBranch,
          targetBranch: item.targetBranch,
          status: targetBranchUpdateStatus(item.status),
          detail: detail ? `${detail}.` : 'No detail available.',
        },
      },
    });
  }
}

function withAutoMergeDetailOverride(result: AutoMergeResult, detail: string): AutoMergeResult {
  return {
    ...result,
    results: result.results.map((item) => ({ ...item, detail })),
  };
}

/**
 * Complete the specified pending task and advance the queue.
 *
 * Implements the §4.3 five-step sentinel sequence in order:
 *   Step 0 (F38): commitTaskSnapshot — idempotent pre-archival snapshot.
 *   1. Write .completing sentinel (idempotent pre-check, NOT wx).
 *   2. Archival (fileTaskArchive, final-summary advisory write).
 *   3. finalizeTaskWorktrees(taskId, 'completed', repoRoot).
 *   4. unlinkSync activeItemsDir/<taskId> marker.
 *   5. unlinkSync activeItemsDir/<taskId>.completing sentinel.
 * Lock is acquired FIRST (F8 fix) before any of the above.
 * Lock is released only after step 5.
 * activateNextPendingItemIfReady is called after lock release.
 */
export async function completePendingItem(
  options: CompletePendingItemOptions,
): Promise<void> {
  const { taskId } = options;
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);

  if (!options.skipValidation) {
    await assertPolicyPasses({
      mode: 'queue-advance',
      repoRoot,
      taskId,
      errorMessage: 'Completion blocked by queue-advance policy validation.',
    });
  }

  // F8 fix: acquire the queue lock FIRST — before any archival, retrospective
  // sync, snapshot, or sentinel writes. All five steps run inside this lock.
  // R1 fix: size the lock-acquisition wait to survive max_parallel_tasks
  // simultaneous closeouts rather than timing out under contention.
  // Fetch platform config once and reuse it for the auto-merge policy below
  // (getPlatformConfig is a cached singleton). The budget read must not throw
  // when config is unavailable (per R1), so fall back to a safe cap of 10.
  let closeoutPlatformConfig: Awaited<ReturnType<typeof getPlatformConfig>> | null = null;
  try {
    closeoutPlatformConfig = await getPlatformConfig(repoRoot);
  } catch {
    // Isolated test contexts may lack .platform-state/platform.json — use fallback.
  }
  const maxParallelTasks = closeoutPlatformConfig?.max_parallel_tasks ?? 10;
  const release = await acquireDirLockOrThrow(
    queuePaths.queueLockDir,
    'Completion',
    closeoutQueueLockBudget(maxParallelTasks),
  );
  let resolvedArchiveMdPath: string | null = null;

  try {
    const activeItemsDir = queuePaths.activeItemsDir;
    const sentinelPath = path.join(activeItemsDir, `${taskId}.completing`);
    let childChainCloseout: PreparedChildTaskChainCloseout | null = null;
    const sentinel = existsSync(sentinelPath) ? readCompletingSentinelPayload(sentinelPath) : null;
    if (options.skipArchive && sentinel?.childChainCloseout) {
      childChainCloseout = parseRecoveredChildTaskChainCloseout(sentinel.childChainCloseout);
    } else {
      const pendingPath = path.join(queuePaths.pendingDir, `${taskId}.md`);
      if (existsSync(pendingPath)) {
        childChainCloseout = await prepareChildTaskChainCloseout({
          repoRoot,
          taskId,
          content: readFileSync(pendingPath, 'utf-8'),
        });
      }
    }

    let autoMergeResult: AutoMergeResult = { enabled: false, applied: false, results: [] };
    const taskJsonPath = resolveTaskJsonPath(taskId, repoRoot);
    const taskJson = existsSync(taskJsonPath) ? readTaskJson(taskId, repoRoot) : null;
    if (
      childChainCloseout
      && childChainCloseout.source === 'fresh'
      && childChainCloseout.branchChain.repos.length > 0
    ) {
      if (!taskJson) {
        throw new Error(`child-task-chain-closeout-source-branch-mismatch for task "${taskId}": .task.json is missing`);
      }
      try {
        await verifyChildChainSourceBranchesExist({
          taskId,
          prepared: childChainCloseout,
          repoBindings: taskJson.contextPackBinding.repoBindings,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn('child-task-chain-closeout.source-branch-validation.failed', {
          taskId,
          repoRoots: childChainCloseout.branchChain.repos.map((repo) => repo.repoRoot),
          repoLabels: childChainCloseout.branchChain.repos.map((repo) => repo.repoLabel),
          branches: childChainCloseout.branchChain.repos.map((repo) => repo.chainSourceBranch),
          reason,
        });
        throw err;
      }
    }

    // --- Step 0 (F38): idempotent pre-archival snapshot ---
    // Commits staged/unstaged changes in the per-task worktree to task/<taskId>.
    // 'nothing to commit' from git exits non-zero and is treated as success
    // (commitTaskSnapshot swallows it). Best-effort: non-fatal on failure.
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'closeout.snapshot_committing' },
    });
    await commitTaskSnapshot(repoRoot, taskId, 'completed');
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'closeout.snapshot_committed' },
    });

    // --- Step 0a (B5): verify task branches received commits ---
    // Safety net for B1 worktree-injection regressions: if any task/<id> branch
    // is missing or has zero commits beyond its baseCommitSha, this throws and
    // the caller routes the task into moveFailedItemToErrorItems → branch is
    // retained for operator post-mortem. NO try/catch — let it propagate.
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'closeout.branch_verification.started' },
    });
    let verification: Awaited<ReturnType<typeof verifyTaskBranches>>;
    try {
      verification = await verifyTaskBranches(repoRoot, taskId);
    } catch (err) {
      await emitTaskProgressEvent({
        logger: log.child({ taskId }),
        repoRoot,
        taskId,
        event: { type: 'closeout.branch_verification.failed' },
      });
      throw err;
    }
    if (!verification.ok) {
      await emitTaskProgressEvent({
        logger: log.child({ taskId }),
        repoRoot,
        taskId,
        event: { type: 'closeout.branch_verification.failed' },
      });
      const summary = verification.failures
        .map((f) => `${f.branch} @ ${f.originalRoot}: ${f.reason} (${f.detail})`)
        .join('; ');
      throw new Error(
        `Completion blocked: task branches contain no commits. ${summary}. ` +
        `This usually indicates a worktree CWD injection regression.`,
      );
    }
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'closeout.branch_verification.completed' },
    });

    if (taskJson) {
      const platformConfig = closeoutPlatformConfig ?? await getPlatformConfig(repoRoot);
      const childChainPolicy = buildChildTaskChainCloseoutPolicy({
        childChainCloseout,
        platformAutoMergeEnabled: platformConfig.auto_merge,
      });
      autoMergeResult = await stageAutoMergeCloseout({
        enabled: childChainPolicy.effectiveAutoMergeEnabled,
        bindings: taskJson.contextPackBinding.repoBindings,
      });
      if (childChainPolicy.autoMergeDetailOverride) {
        autoMergeResult = withAutoMergeDetailOverride(autoMergeResult, childChainPolicy.autoMergeDetailOverride);
      }
      await emitTargetBranchUpdateEvents(repoRoot, taskId, autoMergeResult);
      if (childChainPolicy.emitChildChainAutoMergeSkip) {
        await emitTaskProgressEvent({
          logger: log.child({ taskId }),
          repoRoot,
          taskId,
          event: { type: 'auto_merge.skipped_child_chain' },
        });
      } else {
        await logAutoMergeResult(repoRoot, taskId, autoMergeResult);
      }
    }

    const branchHandoffs = await buildBranchHandoffsForArchive({
      repoRoot,
      taskId,
      handoffsDir: queuePaths.taskHandoffs(taskId),
      autoMergeResult,
      // Best-effort target-branch backfill is for standard closeout only. Child-chain
      // completedBranchHandoffs must keep their pre-feature targetBranch semantics.
      captureFallbackTargetBranch: !childChainCloseout,
    });
    if (childChainCloseout && childChainCloseout.source === 'fresh') {
      childChainCloseout = attachCompletedBranchHandoffs(childChainCloseout, branchHandoffs);
    }

    // --- Step 1: idempotent sentinel write ---
    // Use pre-check + writeFileSync (NOT exclusive-create mode) so crash-recovery re-drives
    // can observe the sentinel without EEXIST halting recovery.
    if (!existsSync(sentinelPath)) {
      writeTextFileAtomicSync(sentinelPath, JSON.stringify({ ts: Date.now() }));
    }

    // --- Step 2: archival ---
    if (!options.skipArchive) {
      const contextPackDir = options.contextPackDir
        ?? await requireAuthorizedActiveContextPack({ repoRoot, taskId });

      // Write advisory findings section to final-summary.md atomically.
      const handoffsDir = queuePaths.taskHandoffs(taskId);
      const advisorySection = await buildAdvisoryFindingSection(handoffsDir);
      if (advisorySection) {
        const finalSummaryPath = path.join(handoffsDir, 'final-summary.md');
        const currentContent = await readTextFile(finalSummaryPath);
        if (currentContent && !currentContent.includes(ADVISORY_FINDING_HEADING)) {
          await writeTextFileAtomic(finalSummaryPath, currentContent.trimEnd() + '\n\n' + advisorySection + '\n');
        }
      }

      const archiveLog = log.child({ taskId });
      await emitTaskProgressEvent({
        logger: archiveLog,
        repoRoot,
        taskId,
        event: { type: 'archive.started' },
      });
      const terminalEventsSnapshotExisted = existsSync(path.join(
        repoRoot,
        '.platform-state',
        'runtime',
        'tasks',
        taskId,
        'terminal-events.json',
      ));
      let archiveResult: Awaited<ReturnType<typeof fileTaskArchive>>;
      try {
        archiveResult = await fileTaskArchive({ contextPackDir, taskId, repoRoot });
      } catch (err) {
        if (terminalEventsSnapshotExisted) {
          await emitTaskProgressEvent({
            logger: archiveLog,
            repoRoot,
            taskId,
            event: { type: 'archive.terminal_events_snapshot_failed' },
          });
        }
        await emitTaskProgressEvent({
          logger: archiveLog,
          repoRoot,
          taskId,
          event: { type: 'archive.failed' },
        });
        throw err;
      }
      if (!archiveResult.passed) {
        if (terminalEventsSnapshotExisted) {
          await emitTaskProgressEvent({
            logger: archiveLog,
            repoRoot,
            taskId,
            event: { type: 'archive.terminal_events_snapshot_failed' },
          });
        }
        await emitTaskProgressEvent({
          logger: archiveLog,
          repoRoot,
          taskId,
          event: { type: 'archive.failed' },
        });
        const details = [archiveResult.stdout, archiveResult.stderr]
          .filter(Boolean)
          .join('\n')
          .trim();
        const suffix = details ? `\n${details}` : '';
        throw new Error(
          `Completion blocked: task archival failed (exit ${archiveResult.exitCode}).${suffix}`,
        );
      }
      const archiveStderr = (archiveResult.stderr ?? '').trim();
      if (archiveStderr) {
        log.warn('archive.stderr', { taskId, stderr: archiveStderr });
      }
      const archivePath = typeof archiveResult.data?.record_md_path === 'string'
        ? archiveResult.data.record_md_path
        : null;
      resolvedArchiveMdPath = archivePath;
      if (childChainCloseout) {
        childChainCloseout = {
          ...childChainCloseout,
          archivePath,
          archiveArtifactDir: resolveArchiveArtifactDir(archivePath),
        };
      }
      await emitTaskProgressEvent({
        logger: archiveLog,
        repoRoot,
        taskId,
        event: { type: terminalEventsSnapshotExisted
          ? 'archive.terminal_events_snapshot_copied'
          : 'archive.terminal_events_snapshot_missing' },
      });
      await emitTaskProgressEvent({
        logger: archiveLog,
        repoRoot,
        taskId,
        event: { type: 'archive.completed' },
      });
      mergeCompletingSentinelPayload(sentinelPath, {
        archiveSucceeded: true,
        archivePath,
        contextPackDir,
        ...(childChainCloseout ? { childChainCloseout } : {}),
      });

      // Sync retrospective metadata inside the lock window. On failure, demote
      // to a deferred marker so finalize/unlinks still complete.
      await syncRetrospectiveWithDeferral({
        retrospectiveOptions: {
          repoRoot,
          handoffsDir: queuePaths.taskHandoffs(taskId),
          contextPackDir,
          taskId,
        } as Parameters<typeof syncRetrospectiveRequiredMetadata>[0] & { taskId: string },
        sentinelPath,
        repoRoot,
        taskId,
        contextPackDir,
        handoffsDir: queuePaths.taskHandoffs(taskId),
      });
    } else if (
      options.recoveryArchivePath !== undefined
      || options.skipRetrospectiveSync !== undefined
    ) {
      resolvedArchiveMdPath = options.recoveryArchivePath ?? null;
      if (childChainCloseout) {
        childChainCloseout = {
          ...childChainCloseout,
          archivePath: resolvedArchiveMdPath,
          archiveArtifactDir: resolveArchiveArtifactDir(resolvedArchiveMdPath),
        };
        mergeCompletingSentinelPayload(sentinelPath, {
          childChainCloseout,
        });
      }

      if (options.skipRetrospectiveSync === false) {
        const contextPackDir = options.contextPackDir
          ?? await requireAuthorizedActiveContextPack({ repoRoot, taskId });
        await syncRetrospectiveWithDeferral({
          retrospectiveOptions: {
            repoRoot,
            handoffsDir: queuePaths.taskHandoffs(taskId),
            contextPackDir,
            taskId,
          } as Parameters<typeof syncRetrospectiveRequiredMetadata>[0] & { taskId: string },
          sentinelPath,
          repoRoot,
          taskId,
          contextPackDir,
          handoffsDir: queuePaths.taskHandoffs(taskId),
        });
      }
    }

    // Update queue-order manifest and reset handoff artifacts via completeActiveItem.
    // Passes per-task paths per §4.3 requirement.
    const completeResult = await completeActiveItem({
      pendingDir: queuePaths.pendingDir,
      taskId,
      handoffsDir: queuePaths.taskHandoffs(taskId),
      templatesDir: queuePaths.templatesDir,
      skipValidation: options.skipValidation,
      implementationStepsDir: queuePaths.taskImplementationSteps(taskId),
    });

    // --- Step 3: finalizeTaskWorktrees ---
    // Only re-drive finalize when completeActiveItem confirmed the marker existed
    // (i.e., we are not in the sentinel-without-marker recovery branch).
    if (completeResult.status !== 'no-active-marker') {
      await emitTaskProgressEvent({
        logger: log.child({ taskId }),
        repoRoot,
        taskId,
        event: { type: 'closeout.finalizing_worktrees' },
      });
      await finalizeTaskWorktrees(taskId, 'completed', repoRoot);
    }

    // --- Step 4: unlink per-task active marker ---
    // Already absent when completeResult.status === 'no-active-marker' — skip.
    if (completeResult.status !== 'no-active-marker') {
      try {
        unlinkSync(path.join(activeItemsDir, taskId));
      } catch { /* marker may already be absent if step 4 crashed and re-drove */ }
    }

    // Update task registry: active → completed only after the active marker is
    // gone, so the UI never sees a completed task still occupying capacity.
    try {
      await transitionTask(repoRoot, taskId, 'active', 'completed', {
        completedAt: new Date().toISOString(),
        archivePath: resolvedArchiveMdPath ?? null,
      });
    } catch (err) {
      if (!childChainCloseout) {
        // Preserve legacy best-effort registry transition behavior.
      } else {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`child-task-chain-closeout-registry-transition-failed for task "${taskId}": ${reason}`);
      }
    }

    evictPolicyResultCache(repoRoot, taskId);

    if (childChainCloseout) {
      try {
        await emitTaskProgressEvent({
          logger: log.child({ taskId }),
          repoRoot,
          taskId,
          event: { type: 'closeout.child_chain_advancing' },
        });
        await advanceCompletedChildTaskChain(repoRoot, childChainCloseout);
        mergeCompletingSentinelPayload(sentinelPath, { childChainAdvanced: true });
        await emitTaskProgressEvent({
          logger: log.child({ taskId }),
          repoRoot,
          taskId,
          event: { type: 'closeout.child_chain_advanced' },
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`child-task-chain-closeout-advance-failed for task "${taskId}": ${reason}`);
      }
    }

    // --- Step 5: unlink sentinel ---
    // Always attempt — even in the 'no-active-marker' branch (sentinel is present).
    try {
      unlinkSync(sentinelPath);
    } catch { /* sentinel may already be absent */ }

  } finally {
    await release();
  }

  try {
    await recordTaskCompletedNotification({
      repoRoot,
      taskId,
      archivePath: resolvedArchiveMdPath ?? null,
    });
  } catch (err) {
    log.warn('task_notifications.record.failed', {
      taskId,
      notificationType: 'task-completed',
      lifecycle: 'completed',
      reason: getErrorMessage(err),
    });
  }

  const finalizeLog = log.child({ taskId });
  await emitTaskProgressEvent({
    logger: finalizeLog,
    repoRoot,
    taskId,
    event: { type: 'pipeline.completed' },
  });
  await emitTaskProgressEvent({
    logger: finalizeLog,
    repoRoot,
    taskId,
    event: { type: 'queue.task.completed' },
  });
  await emitTaskProgressEvent({
    logger: finalizeLog,
    repoRoot,
    taskId,
    event: { type: 'closeout.finalized' },
  });

  // Queue advance runs AFTER lock release (§4.6 contract).
  await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
}
