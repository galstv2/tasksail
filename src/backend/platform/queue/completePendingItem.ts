import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readTextFile, writeTextFileAtomic, findRepoRoot } from '../core/index.js';
import { resolveQueuePaths } from './paths.js';
import { completeActiveItem, acquireDirLockOrThrow, activateNextPendingItemIfReady } from './operations.js';
import { assertPolicyPasses } from './policyValidation.js';
import { fileTaskArchive } from './archive.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/index.js';
import { syncRetrospectiveRequiredMetadata } from './retrospectiveFlag.js';
import { buildAdvisoryFindingSection, ADVISORY_FINDING_HEADING } from '../agent-runner/pipeline/remediation.js';
import { commitTaskSnapshot } from './errorItems.js';
import { transitionTask } from './taskRegistry.js';
import { finalizeTaskWorktrees } from '../core/worktreeFinalize.js';
import { verifyTaskBranches } from './branchVerification.js';
import { readTaskJson, resolveTaskJsonPath } from './taskJson.js';
import { getPlatformConfig } from '../platform-config/get.js';
import { stageAutoMergeCloseout, type AutoMergeResult, type AutoMergeBindingResult } from './autoMerge.js';
import { evictPolicyResultCache } from '../agent-runner/guardrails.js';

const execFile = promisify(execFileCb);

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
  writeFileSync(markerPath, JSON.stringify(payload, null, 2) + '\n');
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
  writeFileSync(sentinelPath, JSON.stringify({ ...current, ...patch }));
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
    console.warn(
      `[closeout] retrospective sync deferred (non-fatal — task ${options.taskId} finalized, ` +
      `will retry on next queue advance): ${reason}`,
    );
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

async function buildBranchHandoffsForArchive(options: {
  repoRoot: string;
  taskId: string;
  handoffsDir: string;
  autoMergeResult: AutoMergeResult;
}): Promise<void> {
  const sidecarPath = resolveTaskJsonPath(options.taskId, options.repoRoot);
  if (!existsSync(sidecarPath)) {
    return;
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
          target_branch: autoMerge?.targetBranch ?? null,
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
  writeFileSync(
    path.join(options.handoffsDir, 'branch-handoffs.json'),
    JSON.stringify(handoffs, null, 2) + '\n',
    'utf-8',
  );
}

function logAutoMergeResult(taskId: string, result: AutoMergeResult): void {
  if (!result.enabled) {
    console.info(`[closeout] auto_merge disabled for ${taskId}; source branches remain ready for operator review.`);
    return;
  }
  if (result.applied) {
    const repos = result.results
      .map((item) => `${item.repoLabel}:${item.sourceBranch}->${item.targetBranch ?? '(unknown)'}`)
      .join(', ');
    console.info(`[closeout] auto_merge applied for ${taskId}: ${repos}`);
    return;
  }
  const first = result.results[0];
  const detail = first ? `${first.status}: ${first.detail}` : 'no bindings';
  console.info(`[closeout] auto_merge skipped for ${taskId}; ${detail}`);
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
  const release = await acquireDirLockOrThrow(
    queuePaths.queueLockDir,
    'Completion',
  );

  try {
    // --- Step 0 (F38): idempotent pre-archival snapshot ---
    // Commits staged/unstaged changes in the per-task worktree to task/<taskId>.
    // 'nothing to commit' from git exits non-zero and is treated as success
    // (commitTaskSnapshot swallows it). Best-effort: non-fatal on failure.
    await commitTaskSnapshot(repoRoot, taskId, 'completed');

    // --- Step 0a (B5): verify task branches received commits ---
    // Safety net for B1 worktree-injection regressions: if any task/<id> branch
    // is missing or has zero commits beyond its baseCommitSha, this throws and
    // the caller routes the task into moveFailedItemToErrorItems → branch is
    // retained for operator post-mortem. NO try/catch — let it propagate.
    const verification = await verifyTaskBranches(repoRoot, taskId);
    if (!verification.ok) {
      const summary = verification.failures
        .map((f) => `${f.branch} @ ${f.originalRoot}: ${f.reason} (${f.detail})`)
        .join('; ');
      throw new Error(
        `Completion blocked: task branches contain no commits. ${summary}. ` +
        `This usually indicates a worktree CWD injection regression.`,
      );
    }

    let autoMergeResult: AutoMergeResult = { enabled: false, applied: false, results: [] };
    if (existsSync(resolveTaskJsonPath(taskId, repoRoot))) {
      const taskJson = readTaskJson(taskId, repoRoot);
      const platformConfig = await getPlatformConfig(repoRoot);
      autoMergeResult = await stageAutoMergeCloseout({
        enabled: platformConfig.auto_merge,
        bindings: taskJson.contextPackBinding.repoBindings,
      });
      logAutoMergeResult(taskId, autoMergeResult);
    }

    await buildBranchHandoffsForArchive({
      repoRoot,
      taskId,
      handoffsDir: queuePaths.taskHandoffs(taskId),
      autoMergeResult,
    });

    const activeItemsDir = queuePaths.activeItemsDir;
    const sentinelPath = path.join(activeItemsDir, `${taskId}.completing`);

    // --- Step 1: idempotent sentinel write ---
    // Use pre-check + writeFileSync (NOT exclusive-create mode) so crash-recovery re-drives
    // can observe the sentinel without EEXIST halting recovery.
    if (!existsSync(sentinelPath)) {
      writeFileSync(sentinelPath, JSON.stringify({ ts: Date.now() }));
    }

    // --- Step 2: archival ---
    let resolvedArchiveMdPath: string | null | undefined;
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

      const archiveResult = await fileTaskArchive({ contextPackDir, taskId, repoRoot });
      if (!archiveResult.passed) {
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
        console.warn(`[archive] ${archiveStderr}`);
      }
      const archivePath = typeof archiveResult.data?.record_md_path === 'string'
        ? archiveResult.data.record_md_path
        : null;
      resolvedArchiveMdPath = archivePath;
      mergeCompletingSentinelPayload(sentinelPath, {
        archiveSucceeded: true,
        archivePath,
        contextPackDir,
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
    } catch { /* best-effort */ }

    evictPolicyResultCache(repoRoot, taskId);

    // --- Step 5: unlink sentinel ---
    // Always attempt — even in the 'no-active-marker' branch (sentinel is present).
    try {
      unlinkSync(sentinelPath);
    } catch { /* sentinel may already be absent */ }

  } finally {
    await release();
  }

  // Queue advance runs AFTER lock release (§4.6 contract).
  await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
}
