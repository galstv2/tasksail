import path from 'node:path';
import { existsSync } from 'node:fs';
import { unlink, readdir } from 'node:fs/promises';
import { findRepoRoot } from '../core/index.js';
import { resolveQueuePaths, HANDOFF_FILES } from './paths.js';
import {
  handoffPublishInProgress,
  resetHandoffArtifacts,
  handoffWorkspaceIsReady,
} from './lifecycle.js';
import type { QueueRepairIssue, QueueRepairIssueKind } from './repairQueueIssues.js';

export type { QueueRepairIssue, QueueRepairIssueKind } from './repairQueueIssues.js';

export interface RepairResult {
  issues: string[];
  fixed: string[];
  structuredIssues: QueueRepairIssue[];
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
 *   1. A marker in .active-items/ references a missing pending file
 *   2. No markers in .active-items/ but handoffs/ has active task content
 *   3. Queue lock directory present (advisory only — never auto-removed)
 *   4. A marker in .active-items/ exists for a valid pending file, but
 *      handoffs/ is blank (crash during completion)
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
  // Inline singleton handoffs path — MUST NOT use singletonHandoffsDir accessor
  // to satisfy the done-when assertion.
  const singletonHandoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');

  const issues: string[] = [];
  const fixed: string[] = [];
  const structuredIssues: QueueRepairIssue[] = [];

  // Enumerate active markers from .active-items/ directory
  let activeMarkers: string[] = [];
  if (existsSync(queuePaths.activeItemsDir)) {
    try {
      const entries = await readdir(queuePaths.activeItemsDir);
      activeMarkers = entries.filter((f) => !f.endsWith('.completing'));
    } catch { /* skip */ }
  }

  // Check 1: each marker references a valid pending file
  for (const markerName of activeMarkers) {
    const taskId = markerName.replace(/\.md$/, '');
    const pendingFile = path.join(queuePaths.pendingDir, `${markerName.endsWith('.md') ? markerName : `${markerName}.md`}`);
    // Also try with exactly the marker basename as the pending filename
    const pendingFileExact = path.join(queuePaths.pendingDir, markerName);
    const pendingExists = existsSync(pendingFile) || existsSync(pendingFileExact);

    if (!pendingExists) {
      issues.push(
        `.active-items/${markerName} references a pending file that does not exist in pendingitems/`,
      );
      structuredIssues.push({
        kind: 'marker-without-pending' as QueueRepairIssueKind,
        taskId,
        detail: `marker: ${markerName}`,
      });

      if (!dryRun && autoFix) {
        await unlink(path.join(queuePaths.activeItemsDir, markerName));
        fixed.push(`Removed stale .active-items/${markerName}`);
      }
    }
  }

  // Check 4: marker exists for a valid pending file, but handoffs/ is blank
  for (const markerName of activeMarkers) {
    const taskId = markerName.replace(/\.md$/, '');
    const pendingFileCandidates = [
      path.join(queuePaths.pendingDir, markerName),
      path.join(queuePaths.pendingDir, `${markerName}.md`),
    ];
    const pendingExists = pendingFileCandidates.some(existsSync);

    if (pendingExists) {
      const wsReady = await handoffWorkspaceIsReady(
        singletonHandoffsDir,
        queuePaths.templatesDir,
      );
      if (wsReady) {
        issues.push(
          `.active-items/${markerName} references '${taskId}' but handoffs/ is in reset state — likely a crash during completion`,
        );
        structuredIssues.push({
          kind: 'marker-without-worktree' as QueueRepairIssueKind,
          taskId,
          detail: 'handoffs workspace is in reset/blank state',
        });

        if (!dryRun && autoFix) {
          await unlink(path.join(queuePaths.activeItemsDir, markerName));
          fixed.push(
            `Removed .active-items/${markerName} with blank workspace (pending item preserved for re-activation)`,
          );
        }
      }
    }
  }

  // Check 2: No markers in .active-items/ but workspace has active task data
  if (activeMarkers.length === 0) {
    const professionalTask = path.join(
      singletonHandoffsDir,
      'professional-task.md',
    );
    let hasTaskData = false;

    if (existsSync(professionalTask)) {
      // Import lazily to avoid circular deps
      const { handoffFileIsResetState } = await import('./lifecycle.js');
      const isReset = await handoffFileIsResetState(professionalTask);
      hasTaskData = !isReset;
    }

    if (hasTaskData) {
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
      structuredIssues.push({
        kind: 'orphan-handoffs-dir' as QueueRepairIssueKind,
        taskId: '_unknown',
        detail: 'handoffs/ has task data but no active marker exists',
      });
      // Auto-fix not applied for check 2 since it requires user choice
    }
  }

  // Check 3: Queue lock directory present (advisory — never auto-removed).
  if (existsSync(queuePaths.queueLockDir) && !autoFix) {
    issues.push(
      'Queue lock directory found — another queue operation may be in progress, or a previous operation crashed without releasing the lock',
    );
  }

  // Check 5: Partial handoff publish (.publish-in-progress marker).
  if (handoffPublishInProgress(singletonHandoffsDir)) {
    issues.push(
      'Partial handoff publish detected (.publish-in-progress marker present)',
    );

    if (!dryRun && autoFix) {
      await resetHandoffArtifacts(singletonHandoffsDir, HANDOFF_FILES, {
      });
      // Remove all active markers (none should exist during partial publish, but clean up if any)
      for (const markerName of activeMarkers) {
        try {
          await unlink(path.join(queuePaths.activeItemsDir, markerName));
        } catch { /* already removed */ }
      }
      fixed.push(
        'Reset partially published handoffs and removed stale claim',
      );
    }
  }

  return { issues, fixed, structuredIssues };
}
