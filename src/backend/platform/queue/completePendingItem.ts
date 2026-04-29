import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
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

function mergeCompletingSentinelPayload(
  sentinelPath: string,
  patch: Partial<CompletingSentinelPayload>,
): void {
  const current = readCompletingSentinelPayload(sentinelPath);
  writeFileSync(sentinelPath, JSON.stringify({ ...current, ...patch }));
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
      const archivePath = typeof archiveResult.data?.record_md_path === 'string'
        ? archiveResult.data.record_md_path
        : null;
      resolvedArchiveMdPath = archivePath;
      mergeCompletingSentinelPayload(sentinelPath, {
        archiveSucceeded: true,
        archivePath,
        contextPackDir,
      });

      // Sync retrospective metadata inside the lock window.
      const retrospectiveOptions = {
        repoRoot,
        handoffsDir: queuePaths.taskHandoffs(taskId),
        contextPackDir,
        taskId,
      } as Parameters<typeof syncRetrospectiveRequiredMetadata>[0] & { taskId: string };
      await syncRetrospectiveRequiredMetadata(retrospectiveOptions);
      mergeCompletingSentinelPayload(sentinelPath, { retrospectiveSynced: true });
    } else if (
      options.recoveryArchivePath !== undefined
      || options.skipRetrospectiveSync !== undefined
    ) {
      resolvedArchiveMdPath = options.recoveryArchivePath ?? null;

      if (options.skipRetrospectiveSync === false) {
        const contextPackDir = options.contextPackDir
          ?? await requireAuthorizedActiveContextPack({ repoRoot, taskId });
        const retrospectiveOptions = {
          repoRoot,
          handoffsDir: queuePaths.taskHandoffs(taskId),
          contextPackDir,
          taskId,
        } as Parameters<typeof syncRetrospectiveRequiredMetadata>[0] & { taskId: string };
        await syncRetrospectiveRequiredMetadata(retrospectiveOptions);
        mergeCompletingSentinelPayload(sentinelPath, { retrospectiveSynced: true });
      }
    }

    // Update task registry: active → completed.
    try {
      await transitionTask(repoRoot, taskId, 'active', 'completed', {
        completedAt: new Date().toISOString(),
        archivePath: resolvedArchiveMdPath ?? null,
      });
    } catch { /* best-effort */ }

    // Update queue-order manifest and reset handoff artifacts via completeActiveItem.
    // Passes per-task paths (not singleton) per §4.3 requirement.
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
