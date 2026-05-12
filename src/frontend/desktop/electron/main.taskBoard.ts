/**
 * Task Board handlers — reads dropbox, pending, error, and completed task items
 * for the Kanban board UI, and delegates reorder/requeue to backend queue modules.
 */
import { watch, type FSWatcher } from 'node:fs';
import { open as fsOpen, readdir as fsReadDir, readFile as fsReadFile, unlink as fsUnlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BrowserWindow } from 'electron';

import {
  DESKTOP_SHELL_TASK_BOARD_CHANNEL,
} from '../src/shared/desktopContract';
import type {
  ArchivedTaskEntry,
  DesktopInvokeResult,
  TaskBoardContentColumn,
  TaskBoardDeleteTaskRequest,
  TaskBoardMoveToOpenRequest,
  TaskBoardMoveToPendingRequest,
  TaskBoardItem,
  TaskBoardReadBoardResponse,
  TaskBoardReadTaskContentRequest,
  TaskBoardReorderPendingRequest,
  TaskBoardRequeueErrorItemRequest,
} from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';
import { pathExists, repoFs, type ReadOnlyRepoFs } from './utils';
import {
  readQueueOrderManifest,
  writeQueueOrderManifest,
  resolveQueuePaths,
  withDirLock,
  requeueErrorItem as requeueErrorItemImpl,
  deletePendingItem,
  deleteDropboxItem,
  deleteErrorItem,
  moveDropboxItemToPending,
  moveErrorItemToDropbox,
} from '../../../backend/platform/queue';
import { listArchivedTasksAction } from './main.archivedTasks';
import {
  loadTaskRegistry,
  getAllTasks,
  getTasksForContextPack,
  getRegistryPath,
  type TaskRegistryEntry,
} from '../../../backend/platform/queue/taskRegistry.js';

const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
const PENDING_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems');
const ERROR_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'error-items');
const ACTIVE_ITEMS_DIR = join(PENDING_DIR, '.active-items');

const HEAD_BYTES = 1024;

async function readFileHead(filePath: string): Promise<string> {
  const handle = await fsOpen(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

function extractHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function extractTaskId(content: string): string | null {
  const match = content.match(/^- Task ID:\s*(.+?)$/m);
  return match?.[1]?.trim() || null;
}

async function readBoardItems(dir: string): Promise<TaskBoardItem[]> {
  if (!(await pathExists(dir, repoFs))) return [];
  const entries = await fsReadDir(dir);
  const mdFiles = entries.filter(
    (f) => f.endsWith('.md') && !f.startsWith('.'),
  );
  const items: TaskBoardItem[] = [];
  for (const fileName of mdFiles) {
    try {
      const head = await readFileHead(join(dir, fileName));
      items.push({
        fileName,
        taskId: extractTaskId(head),
        title: extractHeading(head),
      });
    } catch {
      items.push({ fileName, taskId: null, title: null });
    }
  }
  return items;
}

function registryEntryToItem(entry: TaskRegistryEntry): TaskBoardItem {
  return {
    fileName: entry.fileName,
    taskId: entry.taskId,
    title: entry.title,
  };
}

function registryEntryToPendingItem(
  entry: TaskRegistryEntry,
): TaskBoardItem & { state: 'active' | 'pending' } {
  return {
    fileName: entry.fileName,
    taskId: entry.taskId,
    title: entry.title,
    state: entry.state === 'active' ? 'active' : 'pending',
  };
}

export async function readTaskBoard(
  listContextPacks?: () => Promise<import('../src/shared/desktopContract').ContextPackListResponse>,
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<DesktopInvokeResult> {
  try {
    const registry = await loadTaskRegistry(REPO_ROOT);
    const hasRegistryData = Object.keys(registry.tasks).length > 0;

    // QMD is the system of record for completed tasks. The registry's
    // `completed[]` is wiped by repairTaskRegistry on Electron startup
    // (it scans dropbox/pendingitems/error-items but not QMD), so reading
    // completed entries from the registry causes the UI to flap — archived
    // .md files appear when the registry is empty (legacy fallback path)
    // and disappear after repair clears the registry's completed[]. Always
    // resolve completed from the QMD scan, regardless of which path handles
    // the other columns.
    let completedItems: ArchivedTaskEntry[] = [];
    if (listContextPacks) {
      const archivedResult = await listArchivedTasksAction(listContextPacks);
      if (archivedResult.ok && 'tasks' in archivedResult.response) {
        completedItems = (archivedResult.response as { tasks: ArchivedTaskEntry[] }).tasks
          .slice(-10);
      }
    }

    if (hasRegistryData) {
      // Registry-first path: read from the centralized JSON index.
      // Determine active context pack to scope the board.
      let activePackId: string | null = null;
      if (listContextPacks) {
        const catalog = await listContextPacks();
        const activeEntry = catalog.contextPacks.find((e) => e.isActive);
        activePackId = activeEntry?.contextPackId ?? null;
      }

      // When scoped to a context pack, also include _unbound tasks so legacy
      // tasks (created before registry) are always visible.
      let tasks;
      if (activePackId) {
        const packTasks = getTasksForContextPack(registry, activePackId);
        const unboundTasks = getTasksForContextPack(registry, '_unbound');
        tasks = {
          open: [...packTasks.open, ...unboundTasks.open],
          pending: [...packTasks.pending, ...unboundTasks.pending],
          active: [...packTasks.active, ...unboundTasks.active],
          failed: [...packTasks.failed, ...unboundTasks.failed],
          completed: [...packTasks.completed, ...unboundTasks.completed],
        };
      } else {
        tasks = getAllTasks(registry);
      }

      const dropboxItems = tasks.open.map(registryEntryToItem);
      const pendingItems = [
        ...tasks.active.map(registryEntryToPendingItem),
        ...tasks.pending.map(registryEntryToPendingItem),
      ];
      const errorItems = tasks.failed.map(registryEntryToItem);

      const response: TaskBoardReadBoardResponse = {
        action: 'taskBoard.readBoard',
        mode: 'read-only',
        message: `${dropboxItems.length} open, ${pendingItems.length} pending, ${errorItems.length} failed, ${completedItems.length} completed.`,
        dropboxItems,
        pendingItems,
        errorItems,
        completedItems,
      };
      return { ok: true, response };
    }

    // Fallback: scan directories (legacy path when registry is empty).
    const dropboxItems = await readBoardItems(DROPBOX_DIR);
    const pendingRaw = await readBoardItems(PENDING_DIR);

    // §5.3: Read active task from .active-items/ directory (per-task markers).
    let activeFileName: string | null = null;
    if (await pathExists(ACTIVE_ITEMS_DIR, fsAdapter)) {
      try {
        const entries = await fsAdapter.readdir(ACTIVE_ITEMS_DIR);
        const firstMarker = entries.find((f) => !f.startsWith('.') && !f.endsWith('.completing'));
        if (firstMarker) {
          activeFileName = `${firstMarker}.md`;
        }
      } catch {
        // Absent or unreadable — no active item.
      }
    }

    const QUEUE_ORDER_PATH = join(REPO_ROOT, '.platform-state', 'queue', 'queue-order.json');
    const orderManifest = await readQueueOrderManifest(QUEUE_ORDER_PATH);
    const orderMap = new Map(orderManifest.map((name, i) => [name, i]));
    const sortedPending = [...pendingRaw].sort((a, b) => {
      const ai = orderMap.get(a.fileName) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderMap.get(b.fileName) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.fileName.localeCompare(b.fileName);
    });

    const pendingItems = sortedPending.map((item) => ({
      ...item,
      state: (item.fileName === activeFileName ? 'active' : 'pending') as 'active' | 'pending',
    }));

    const errorItems = await readBoardItems(ERROR_ITEMS_DIR);

    const response: TaskBoardReadBoardResponse = {
      action: 'taskBoard.readBoard',
      mode: 'read-only',
      message: `${dropboxItems.length} open, ${pendingItems.length} pending, ${errorItems.length} failed, ${completedItems.length} completed.`,
      dropboxItems,
      pendingItems,
      errorItems,
      completedItems,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.readBoard',
      error: error instanceof Error ? error.message : 'Failed to read task board.',
    };
  }
}

const COLUMN_DIR_MAP: Record<Exclude<TaskBoardContentColumn, 'completed'>, string> = {
  open: DROPBOX_DIR,
  pending: PENDING_DIR,
  error: ERROR_ITEMS_DIR,
};

function notFoundResult(fileName: string): { ok: true; response: import('../src/shared/desktopContract').TaskBoardReadTaskContentResponse } {
  return {
    ok: true,
    response: {
      action: 'taskBoard.readTaskContent' as const,
      mode: 'not-found' as const,
      message: `${fileName} not found.`,
      content: '',
      fileName,
    },
  };
}

export function formatCompletedBranchHandoffText(task: ArchivedTaskEntry): string {
  const handoffs = task.branchHandoffs;
  if (!handoffs || handoffs.length === 0) {
    return '';
  }
  const lines = ['## Operator Branch Handoff', ''];
  for (const handoff of handoffs) {
    if (handoff.autoMerge?.status === 'applied') {
      lines.push(
        `- Completed. Source branch \`${handoff.branch}\` in \`${handoff.repoLabel}\` ` +
        `has been auto-merged into \`${handoff.autoMerge.targetBranch ?? 'the target branch'}\` ` +
        'with `--no-commit --no-ff`; changes are staged for operator review.',
      );
    } else {
      lines.push(
        `- Completed. Review source branch \`${handoff.branch}\` in \`${handoff.repoLabel}\` ` +
        'and merge manually if approved.',
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

export async function readTaskContent(
  payload: TaskBoardReadTaskContentRequest['payload'],
  listContextPacks?: () => Promise<import('../src/shared/desktopContract').ContextPackListResponse>,
): Promise<DesktopInvokeResult> {
  try {
    const { fileName, column } = payload;
    const base = basename(fileName);
    if (!base.endsWith('.md') || base.startsWith('.')) {
      return {
        ok: false,
        action: 'taskBoard.readTaskContent',
        error: 'Invalid file name.',
      };
    }

    let filePath: string;
    let archivedTask: ArchivedTaskEntry | null = null;
    if (column === 'completed') {
      const taskId = base.replace(/\.md$/, '');
      let archivePath: string | null = null;
      if (listContextPacks) {
        const archivedResult = await listArchivedTasksAction(listContextPacks);
        if (archivedResult.ok && 'tasks' in archivedResult.response) {
          const tasks = (archivedResult.response as { tasks: ArchivedTaskEntry[] }).tasks;
          const match = tasks.find((t) => t.taskId === taskId);
          if (match?.archivePath) {
            archivePath = match.archivePath;
            archivedTask = match;
          }
        }
      }

      // Registry completed entries are not durable, but older in-session
      // records may still be the only source of an archive path.
      if (!archivePath) {
        const registry = await loadTaskRegistry(REPO_ROOT);
        for (const taskSet of Object.values(registry.tasks)) {
          const match = taskSet.completed.find((e) => e.taskId === taskId);
          if (match?.archivePath) {
            archivePath = match.archivePath;
            break;
          }
        }
      }

      if (!archivePath) {
        return notFoundResult(base);
      }
      filePath = archivePath;
    } else {
      filePath = join(COLUMN_DIR_MAP[column], base);
    }

    let content: string;
    try {
      content = await fsReadFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return notFoundResult(base);
      }
      throw err;
    }
    const handoffText = archivedTask ? formatCompletedBranchHandoffText(archivedTask) : '';
    if (
      handoffText
      && !content.includes('## Source Branches for Operator Review')
      && !content.includes(handoffText.trim())
    ) {
      content = `${handoffText}\n${content}`;
    }

    return {
      ok: true,
      response: {
        action: 'taskBoard.readTaskContent' as const,
        mode: 'found' as const,
        message: `Read ${base}.`,
        content,
        fileName: base,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.readTaskContent',
      error: error instanceof Error ? error.message : 'Failed to read task content.',
    };
  }
}

export async function reorderPending(
  payload: TaskBoardReorderPendingRequest['payload'],
): Promise<DesktopInvokeResult> {
  try {
    const queuePaths = resolveQueuePaths(REPO_ROOT);
    await withDirLock(queuePaths.queueLockDir, 'Reorder pending', async () => {
      if (payload.order.length > 0) {
        await writeQueueOrderManifest(queuePaths.queueOrderPath, payload.order);
      } else {
        try { await fsUnlink(queuePaths.queueOrderPath); } catch { /* absent */ }
      }
    });
    return {
      ok: true,
      response: {
        action: 'taskBoard.reorderPending' as const,
        mode: 'reordered' as const,
        message: `Pending queue reordered (${payload.order.length} item(s)).`,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.reorderPending',
      error: error instanceof Error ? error.message : 'Failed to reorder pending items.',
    };
  }
}

export async function requeueErrorItem(
  payload: TaskBoardRequeueErrorItemRequest['payload'],
): Promise<DesktopInvokeResult> {
  try {
    const result = await requeueErrorItemImpl({
      fileName: payload.fileName,
      insertAtIndex: payload.insertAtIndex,
      repoRoot: REPO_ROOT,
    });
    return {
      ok: true,
      response: {
        action: 'taskBoard.requeueErrorItem' as const,
        mode: 'requeued' as const,
        message: `Error item ${payload.fileName} requeued at position ${payload.insertAtIndex}.`,
        requeuedItem: result.requeuedItem,
        activatedItem: result.activatedItem,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.requeueErrorItem',
      error: error instanceof Error ? error.message : 'Failed to requeue error item.',
    };
  }
}

export async function deleteTask(
  payload: TaskBoardDeleteTaskRequest['payload'],
): Promise<DesktopInvokeResult> {
  try {
    const queueName = payload.fileName;
    switch (payload.column) {
      case 'open':
        await deleteDropboxItem({ queueName, repoRoot: REPO_ROOT });
        break;
      case 'pending':
        await deletePendingItem({ queueName, repoRoot: REPO_ROOT });
        break;
      case 'error':
        await deleteErrorItem({ queueName, repoRoot: REPO_ROOT });
        break;
    }
    return {
      ok: true,
      response: {
        action: 'taskBoard.deleteTask' as const,
        mode: 'deleted' as const,
        message: `Deleted ${payload.fileName} from ${payload.column}.`,
        fileName: payload.fileName,
        column: payload.column,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.deleteTask',
      error: error instanceof Error ? error.message : 'Failed to delete task.',
    };
  }
}

export async function moveToPending(
  payload: TaskBoardMoveToPendingRequest['payload'],
): Promise<DesktopInvokeResult> {
  try {
    const result = await moveDropboxItemToPending({
      fileName: payload.fileName,
      insertAtIndex: payload.insertAtIndex,
      repoRoot: REPO_ROOT,
    });
    return {
      ok: true,
      response: {
        action: 'taskBoard.moveToPending' as const,
        mode: 'moved' as const,
        message: `Moved ${payload.fileName} to pending as ${result.movedItem}.`,
        movedItem: result.movedItem,
        activatedItem: result.activatedItem,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.moveToPending',
      error: error instanceof Error ? error.message : 'Failed to move task to pending.',
    };
  }
}

export async function moveToOpen(
  payload: TaskBoardMoveToOpenRequest['payload'],
): Promise<DesktopInvokeResult> {
  try {
    const result = await moveErrorItemToDropbox({
      fileName: payload.fileName,
      repoRoot: REPO_ROOT,
    });
    return {
      ok: true,
      response: {
        action: 'taskBoard.moveToOpen' as const,
        mode: 'moved' as const,
        message: `Moved ${payload.fileName} to open.`,
        movedItem: result.movedItem,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.moveToOpen',
      error: error instanceof Error ? error.message : 'Failed to move task to open.',
    };
  }
}

/**
 * Watch the three task directories and broadcast board updates to all
 * renderer windows when files change. Uses a 150ms debounce to coalesce
 * rapid filesystem events into a single board read.
 *
 * Returns a cleanup function that stops all watchers.
 */
export function startTaskBoardWatcher(
  listContextPacks: () => Promise<import('../src/shared/desktopContract').ContextPackListResponse>,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];

  const broadcastUpdate = async (): Promise<void> => {
    try {
      const result = await readTaskBoard(listContextPacks);
      if (!result.ok) return;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(DESKTOP_SHELL_TASK_BOARD_CHANNEL, result.response);
        }
      }
    } catch {
      // Filesystem may be in a transient state — next event will retry
    }
  };

  const onFsChange = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void broadcastUpdate(), 150);
  };

  // Watch the registry file and the three queue directories.
  // The registry is the primary source; directories are watched as a safety net
  // for manual file placement and legacy flows.
  const registryFile = getRegistryPath(REPO_ROOT);
  for (const target of [registryFile, DROPBOX_DIR, PENDING_DIR, ERROR_ITEMS_DIR]) {
    try {
      watchers.push(watch(target, { persistent: false }, onFsChange));
    } catch {
      // File or directory may not exist yet — acceptable
    }
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const w of watchers) w.close();
  };
}
