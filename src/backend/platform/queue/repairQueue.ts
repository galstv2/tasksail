import path from 'node:path';
import { existsSync } from 'node:fs';
import { unlink, readdir } from 'node:fs/promises';
import { findRepoRoot } from '../core/index.js';
import { resolveQueuePaths, HANDOFF_FILES } from './paths.js';
import {
  handoffPublishInProgress,
  resetHandoffArtifacts,
  handoffWorkspaceIsReady,
  handoffFileIsResetState,
} from './lifecycle.js';
import type { QueueRepairIssue } from './repairQueueIssues.js';
import {
  listActivationProgressMarkerFileNames,
  readActivationProgressRecords,
  sweepActivationProgressMarkers,
} from './activationProgress.js';

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
 *   1. A marker in .active-items/ references a task with neither a pending file
 *      nor a .task.json sidecar (stranded marker).
 *   2. A tasks/<taskId>/handoffs/ dir has non-reset content but no active marker
 *      and no .task.json sidecar (orphan-task-handoffs-dir).
 *   3. Queue lock directory present (advisory only — never auto-removed).
 *   4. A marker in .active-items/ has a .task.json sidecar but its per-task
 *      handoffs dir is in reset/blank state (crash during completion).
 *   5. Per active marker, the per-task handoffs dir has a .publish-in-progress
 *      marker (partial-publish-in-progress). Resets only that task's handoffs
 *      and removes only that task's marker.
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
  const structuredIssues: QueueRepairIssue[] = [];

  // Enumerate active markers from .active-items/ directory
  let allActiveEntries: string[] = [];
  let activeMarkers: string[] = [];
  if (existsSync(queuePaths.activeItemsDir)) {
    try {
      allActiveEntries = (await readdir(queuePaths.activeItemsDir)).sort();
      activeMarkers = allActiveEntries.filter((f) => !f.endsWith('.completing'));
    } catch { /* skip */ }
  }

  const activeMarkerTaskIds = new Set(
    activeMarkers.map((markerName) => markerName.replace(/\.md$/, '')),
  );
  const stuckMidCompletionTaskIds = new Set<string>();

  const activationMarkers = await readActivationProgressRecords(queuePaths);
  for (const marker of activationMarkers) {
    issues.push(
      `.activating-items/${marker.taskId}.json is a stale activation progress marker`,
    );
    structuredIssues.push({
      kind: 'stale-activating-marker',
      taskId: marker.taskId,
      detail: `marker: ${marker.taskId}.json; phase: ${marker.phase}`,
    });
  }
  const activatingEntries = await listActivationProgressMarkerFileNames(queuePaths);
  const validMarkerNames = new Set(activationMarkers.map((marker) => `${marker.taskId}.json`));
  for (const entry of activatingEntries) {
    if (validMarkerNames.has(entry)) continue;
    const taskId = entry.replace(/\.json$/, '');
    issues.push(`.activating-items/${entry} is malformed or unreadable`);
    structuredIssues.push({
      kind: 'stale-activating-marker',
      taskId,
      detail: `marker: ${entry}; malformed or unreadable`,
    });
  }
  if (!dryRun && autoFix && activatingEntries.length > 0) {
    const sweep = await sweepActivationProgressMarkers({
      paths: queuePaths,
      repoRoot,
      reason: 'repair-auto-fix',
    });
    fixed.push(...sweep.removed.map((taskId) => (
      `Removed stale .activating-items/${taskId.endsWith('.json') ? taskId : `${taskId}.json`}`
    )));
  }

  for (const sentinelName of allActiveEntries.filter((f) => f.endsWith('.completing'))) {
    const taskId = sentinelName.slice(0, -'.completing'.length);
    if (!activeMarkerTaskIds.has(taskId)) continue;

    issues.push(
      `Task '${taskId}' is stuck mid-completion: .completing sentinel and active marker both present. Run: pnpm run repair -- --auto-fix`,
    );
    structuredIssues.push({
      kind: 'sentinel-without-completed-marker',
      taskId,
      detail: `sentinel: ${taskId}.completing; marker present; recovery must run outside repair lock`,
    });
    stuckMidCompletionTaskIds.add(taskId);
  }

  // Check 1: a marker is stranded iff BOTH the pending file AND the per-task
  // .task.json sidecar are missing. Under the per-task parallel model
  // (§4.1B), the pending file is deleted immediately after activation
  // (operations.ts:704) while the marker persists for the active lifetime,
  // so "no pending file" alone is the legitimate steady state — not a
  // corruption signal. The .task.json sidecar (operations.ts:671) is the
  // authoritative proof that a marker corresponds to a materialized task.
  for (const markerName of activeMarkers) {
    const taskId = markerName.replace(/\.md$/, '');
    const pendingFile = path.join(queuePaths.pendingDir, `${markerName.endsWith('.md') ? markerName : `${markerName}.md`}`);
    const pendingFileExact = path.join(queuePaths.pendingDir, markerName);
    const pendingExists = existsSync(pendingFile) || existsSync(pendingFileExact);
    const taskSidecarPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json');
    const taskSidecarExists = existsSync(taskSidecarPath);

    if (!pendingExists && !taskSidecarExists) {
      issues.push(
        `.active-items/${markerName} references a pending file that does not exist in pendingitems/ and has no .task.json sidecar`,
      );
      structuredIssues.push({
        kind: 'marker-without-pending',
        taskId,
        detail: `marker: ${markerName}`,
      });

      if (!dryRun && autoFix && !stuckMidCompletionTaskIds.has(taskId)) {
        await unlink(path.join(queuePaths.activeItemsDir, markerName));
        fixed.push(`Removed stale .active-items/${markerName}`);
      }
    }
  }

  // Check 4: for each active marker with a .task.json sidecar, verify the
  // per-task handoffs dir is not in reset state (crash during completion).
  for (const markerName of activeMarkers) {
    const taskId = markerName.replace(/\.md$/, '');
    const taskSidecarPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json');
    const hasSidecar = existsSync(taskSidecarPath);

    if (hasSidecar) {
      const wsReady = await handoffWorkspaceIsReady(
        queuePaths.taskHandoffs(taskId),
        queuePaths.templatesDir,
      );
      if (wsReady) {
        issues.push(
          `.active-items/${markerName} references '${taskId}' but its handoffs dir is in reset state — likely a crash during completion`,
        );
        structuredIssues.push({
          kind: 'marker-without-worktree',
          taskId,
          detail: `per-task handoffs workspace (tasks/${taskId}/handoffs) is in reset/blank state`,
        });

        if (!dryRun && autoFix && !stuckMidCompletionTaskIds.has(taskId)) {
          await unlink(path.join(queuePaths.activeItemsDir, markerName));
          fixed.push(
            `Removed .active-items/${markerName} with blank per-task workspace (task sidecar preserved for investigation)`,
          );
        }
      }
    }
  }

  // Check 2: detect orphaned task handoffs dirs — non-reset content but no
  // active marker and no .task.json sidecar.
  const tasksDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks');
  let taskDirEntries: string[] = [];
  try {
    taskDirEntries = await readdir(tasksDir);
  } catch { /* tasksDir absent or unreadable — skip */ }

  const activeMarkerSet = new Set(
    activeMarkers.map((m) => m.replace(/\.md$/, '')),
  );

  for (const entry of taskDirEntries) {
    const taskHandoffsPath = path.join(tasksDir, entry, 'handoffs');
    const taskSidecarPath = path.join(tasksDir, entry, '.task.json');
    if (!existsSync(taskHandoffsPath)) continue;

    const hasMarker = activeMarkerSet.has(entry);
    const hasSidecar = existsSync(taskSidecarPath);
    if (hasMarker || hasSidecar) continue;

    const professionalTaskPath = path.join(taskHandoffsPath, 'professional-task.md');
    if (!existsSync(professionalTaskPath)) continue;

    const isReset = await handoffFileIsResetState(professionalTaskPath);
    if (!isReset) {
      issues.push(
        `tasks/${entry}/handoffs/ has task content but no active marker and no .task.json sidecar`,
      );
      structuredIssues.push({
        kind: 'orphan-task-handoffs-dir',
        taskId: entry,
        detail: `tasks/${entry}/handoffs has task data but no active marker or .task.json sidecar`,
      });
    }
  }

  // Check 3: Queue lock directory present (advisory — never auto-removed).
  if (existsSync(queuePaths.queueLockDir) && !autoFix) {
    issues.push(
      'Queue lock directory found — another queue operation may be in progress, or a previous operation crashed without releasing the lock',
    );
  }

  // Check 5: detect partial handoff publish per active task.
  // When found, reset only that task's handoffs and remove only that task's marker.
  for (const markerName of activeMarkers) {
    const taskId = markerName.replace(/\.md$/, '');
    const taskHandoffsPath = queuePaths.taskHandoffs(taskId);
    if (handoffPublishInProgress(taskHandoffsPath)) {
      issues.push(
        `Partial handoff publish detected for task '${taskId}' (.publish-in-progress marker present in tasks/${taskId}/handoffs/)`,
      );
      structuredIssues.push({
        kind: 'partial-publish-in-progress',
        taskId,
        detail: `.publish-in-progress marker found in tasks/${taskId}/handoffs/`,
      });

      if (!dryRun && autoFix && !stuckMidCompletionTaskIds.has(taskId)) {
        await resetHandoffArtifacts(taskHandoffsPath, HANDOFF_FILES, {
          implementationStepsDir: queuePaths.taskImplementationSteps(taskId),
        });
        try {
          await unlink(path.join(queuePaths.activeItemsDir, markerName));
        } catch { /* already removed */ }
        fixed.push(
          `Reset partially published handoffs for task '${taskId}' and removed its active marker`,
        );
      }
    }
  }

  return { issues, fixed, structuredIssues };
}
