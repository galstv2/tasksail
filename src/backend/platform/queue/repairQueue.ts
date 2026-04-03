import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, unlink, readdir } from 'node:fs/promises';
import { findRepoRoot } from '../core/index.js';
import { resolveQueuePaths, HANDOFF_FILES } from './paths.js';
import {
  handoffFileIsResetState,
  handoffWorkspaceIsReady,
  handoffPublishInProgress,
  resetHandoffArtifacts,
} from './lifecycle.js';

export interface RepairResult {
  issues: string[];
  fixed: string[];
}

export interface RepairQueueOptions {
  dryRun?: boolean;
  autoFix?: boolean;
  repoRoot?: string;
}

/**
 * Detect and optionally fix inconsistent queue state.
 *
 * Detectable conditions:
 *   1. .active-item references a missing pending file
 *   2. .active-item is missing but handoffs/ has active task content
 *   3. Queue lock directory present (advisory only — never auto-removed)
 *   4. .active-item present with blank handoffs workspace (crash during completion)
 *   5. Partial handoff publish interrupted mid-flight (.publish-in-progress marker)
 *
 * When autoFix is true, the caller MUST hold the queue lock. This ensures
 * repair cannot race with live queue operations.
 */
export async function repairQueue(
  options: RepairQueueOptions = {},
): Promise<RepairResult> {
  const { dryRun = false, autoFix = false, repoRoot: rawRepoRoot } = options;
  const repoRoot = rawRepoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);

  const issues: string[] = [];
  const fixed: string[] = [];

  // Read .active-item once for Checks 1 and 4
  let activeName: string | null = null;
  if (existsSync(queuePaths.activeItemLink)) {
    activeName = (
      await readFile(queuePaths.activeItemLink, 'utf-8')
    ).trim() || null;
  }

  // Check 1: .active-item references a missing pending file
  if (
    activeName &&
    !existsSync(path.join(queuePaths.pendingDir, activeName))
  ) {
    issues.push(
      `.active-item references '${activeName}' but the file does not exist in pendingitems/`,
    );

    if (!dryRun && autoFix) {
      await unlink(queuePaths.activeItemLink);
      activeName = null; // Claim removed — skip Check 4
      fixed.push('Removed stale .active-item');
    }
  }

  // Check 4: .active-item exists and references a valid pending file, but
  // handoffs/ is blank (reset state). This indicates a crash after
  // completeActiveItem reset handoffs but before clearing the claim.
  if (
    activeName &&
    existsSync(path.join(queuePaths.pendingDir, activeName))
  ) {
    const wsReady = await handoffWorkspaceIsReady(
      queuePaths.handoffsDir,
      queuePaths.templatesDir,
    );
    if (wsReady) {
      issues.push(
        `.active-item references '${activeName}' but handoffs/ is in reset state — likely a crash during completion`,
      );

      if (!dryRun && autoFix) {
        await unlink(queuePaths.activeItemLink);
        fixed.push(
          'Removed .active-item with blank workspace (pending item preserved for re-activation)',
        );
      }
    }
  }

  // Check 2: No .active-item but workspace has active task data
  if (!existsSync(queuePaths.activeItemLink)) {
    const professionalTask = path.join(
      queuePaths.handoffsDir,
      'professional-task.md',
    );
    let hasTaskData = false;

    if (existsSync(professionalTask)) {
      const isReset = await handoffFileIsResetState(professionalTask);
      hasTaskData = !isReset;
    }

    if (hasTaskData) {
      // Check for pending items
      let pendingCount = 0;
      if (existsSync(queuePaths.pendingDir)) {
        const entries = await readdir(queuePaths.pendingDir);
        pendingCount = entries.filter(
          (e) => !e.startsWith('.') && e.endsWith('.md'),
        ).length;
      }

      if (pendingCount > 0) {
        issues.push(
          `No .active-item but handoffs/ has task data and ${pendingCount} pending item(s) exist`,
        );
      } else {
        issues.push(
          'No .active-item, handoffs/ has task data, but no pending items in queue',
        );
      }

      // Auto-fix not applied for check 2 since it requires user choice
      // (reset handoffs vs recreate .active-item).
      // In autoFix mode, we do nothing here — the CLI layer can handle prompting.
    }
  }

  // Check 3: Queue lock directory present (advisory — never auto-removed).
  // When repair runs with --auto-fix it holds the lock itself, so the lock
  // dir will exist. When it runs without auto-fix, the lock may belong to a
  // live process. Either way, auto-removing it would break serialization.
  if (existsSync(queuePaths.queueLockDir) && !autoFix) {
    issues.push(
      'Queue lock directory found — another queue operation may be in progress, or a previous operation crashed without releasing the lock',
    );
  }

  // Check 5: Partial handoff publish (.publish-in-progress marker).
  // A crash during initializeTaskArtifacts can leave handoffs/ partially
  // populated. Reset the workspace so the claimed item can be re-activated.
  if (handoffPublishInProgress(queuePaths.handoffsDir)) {
    issues.push(
      'Partial handoff publish detected (.publish-in-progress marker present)',
    );

    if (!dryRun && autoFix) {
      // resetHandoffArtifacts removes known handoff files and the publish marker
      await resetHandoffArtifacts(queuePaths.handoffsDir, HANDOFF_FILES, {
      });
      // Remove the stale .active-item so the pending item can be re-activated
      if (existsSync(queuePaths.activeItemLink)) {
        await unlink(queuePaths.activeItemLink);
      }
      fixed.push(
        'Reset partially published handoffs and removed stale claim',
      );
    }
  }

  return { issues, fixed };
}
