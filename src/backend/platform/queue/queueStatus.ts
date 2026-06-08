import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createLogger, getErrorMessage } from '../core/index.js';
import { resolveQueuePaths } from './paths.js';
import { handoffWorkspaceIsReady } from './lifecycle.js';
import { readActivationProgressRecords, type ActivationProgressRecord } from './activationProgress.js';

const log = createLogger('platform/queue/queueStatus');

export interface ActiveTaskEntry {
  taskId: string;
  state: 'active';
  handoffsDir: string;
}

export interface QueueStatusResult {
  dropboxItems: string[];
  pendingItems: string[];
  /** Per-task active entries. */
  activeTasks: ActiveTaskEntry[];
  /**
   * @deprecated Use activeTasks[0] ?? null. Kept for CLI back-compat.
   * Returns the filename of the first active task's pending-item file, or null.
   */
  activeItem: string | null;
  workspaceReady: boolean;
  /** True when active markers exist but handoffs/ is blank — crash-recovery state. */
  activeTaskWithBlankWorkspace: boolean;
  /** Task IDs whose `.completing` sentinel coexists with an active marker. */
  stuckMidCompletion: string[];
  /** True when a .publish-in-progress marker exists — handoffs partially initialized. */
  partialPublish: boolean;
  /** Count of failed task files moved out of the queue. */
  errorItemsCount: number;
  /** Informational activation-progress markers. Not lifecycle authority. */
  activatingTasks: ActivationProgressRecord[];
}

/**
 * Report the current queue state: dropbox items, pending items,
 * active items, and workspace readiness.
 */
export async function getQueueStatus(
  repoRoot?: string,
): Promise<QueueStatusResult> {
  const queuePaths = resolveQueuePaths(repoRoot);

  // Dropbox items
  let dropboxItems: string[] = [];
  if (existsSync(queuePaths.dropboxDir)) {
    const entries = await readdir(queuePaths.dropboxDir);
    dropboxItems = entries
      .filter((e) => !e.startsWith('.') && e.endsWith('.md'))
      .sort();
  }

  // Pending items
  let pendingItems: string[] = [];
  if (existsSync(queuePaths.pendingDir)) {
    const entries = await readdir(queuePaths.pendingDir);
    pendingItems = entries
      .filter((e) => !e.startsWith('.') && e.endsWith('.md'))
      .sort();
  }

  // Active tasks — iterate .active-items/ directory, filter .completing sentinels
  const activeTasks: ActiveTaskEntry[] = [];
  let stuckMidCompletion: string[] = [];
  if (existsSync(queuePaths.activeItemsDir)) {
    try {
      const entries = await readdir(queuePaths.activeItemsDir);
      const markers = entries.filter((f) => !f.endsWith('.completing'));
      const markerSet = new Set(markers.map((f) => f.replace(/\.md$/, '')));
      stuckMidCompletion = entries
        .filter((f) => f.endsWith('.completing'))
        .map((f) => f.slice(0, -'.completing'.length))
        .filter((taskId) => markerSet.has(taskId))
        .sort();
      for (const marker of markers) {
        const taskId = marker.replace(/\.md$/, '');
        activeTasks.push({
          taskId,
          state: 'active',
          handoffsDir: queuePaths.taskHandoffs(taskId),
        });
      }
    } catch (err: unknown) {
      log.warn('active_items.read.failed', { error: getErrorMessage(err) });
    }
  }

  // Deprecated back-compat getter: returns first active task's marker filename.
  // Derive the task dir with path.dirname/path.basename so the separator-aware
  // logic works on Windows (a POSIX "/handoffs" string strip silently no-ops
  // against native "\handoffs" segments).
  const activeItem: string | null = activeTasks.length > 0
    ? path.basename(path.dirname(queuePaths.taskHandoffs(activeTasks[0]!.taskId))) + '.md'
    : null;

  // Workspace readiness: under per-task workbench there is no singleton
  // handoffs directory. Report ready=true when no active tasks exist (fresh
  // idle state), or when the first active task's handoffs dir is in reset state.
  let workspaceReady = true;
  if (activeTasks.length > 0) {
    workspaceReady = await handoffWorkspaceIsReady(
      queuePaths.taskHandoffs(activeTasks[0]!.taskId),
      queuePaths.templatesDir,
    );
  }

  // Detect crash-recovery state: active markers present but workspace is blank
  const activeTaskWithBlankWorkspace = activeTasks.length > 0 && workspaceReady;

  // Per-task handoff publish is checked by repairQueue (check 5), not here.
  const partialPublish = false;

  // Count error items
  let errorItemsCount = 0;
  if (existsSync(queuePaths.errorItemsDir)) {
    const errorEntries = await readdir(queuePaths.errorItemsDir);
    errorItemsCount = errorEntries.filter(
      (e) => !e.startsWith('.') && e.endsWith('.md'),
    ).length;
  }
  const activatingTasks = await readActivationProgressRecords(queuePaths);

  return {
    dropboxItems,
    pendingItems,
    activeTasks,
    activeItem,
    workspaceReady,
    activeTaskWithBlankWorkspace,
    stuckMidCompletion,
    partialPublish,
    errorItemsCount,
    activatingTasks,
  };
}
