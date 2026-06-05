/**
 * Task Board handlers — reads dropbox, pending, error, and completed task items
 * for the Kanban board UI, and delegates reorder/requeue to backend queue modules.
 */
import { watch, type FSWatcher } from 'node:fs';
import { readFile as fsReadFile, readdir, unlink as fsUnlink, lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
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
  TaskBoardKillTaskRequest,
  TaskBoardRetryKillCleanupRequest,
  TaskBoardItem,
  TaskBoardMarkdownArtifact,
  TaskBoardPendingItem,
  TaskBoardReadBoardResponse,
  TaskBoardReadTaskContentRequest,
  TaskBoardReorderPendingRequest,
  TaskBoardRequeueErrorItemRequest,
} from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';
import { pathExists, repoFs, type ReadOnlyRepoFs } from './utils';
import {
  filterActiveTaskIdsForScope,
  filterRegistryTaskSetsForScope,
  isRegistryEntryVisibleForScope,
  readVisibleTaskMarkdownItems,
  resolveActiveContextPackTaskScope,
  type ActiveContextPackTaskScope,
  type ContextPackLister,
} from './main.contextPackTaskVisibility';
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
  movePendingItemToDropbox,
  executeRequestedTaskKill,
  observeKillRequest,
  requestTaskKill,
  readActivationProgressRecords,
} from '../../../backend/platform/queue';
import { createLogger, getErrorMessage } from '../../../backend/platform/core';
import { listArchivedTasksAction } from './main.archivedTasks';
import {
  loadTaskRegistry,
  getRegistryPath,
  type TaskRegistry,
  type TaskRegistryEntry,
} from '../../../backend/platform/queue/taskRegistry.js';
import { listActivePipelines } from '../../../backend/platform/agent-runner/pipelineSupervisor.js';

const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
const PENDING_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems');
const ERROR_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'error-items');
const ACTIVE_ITEMS_DIR = join(PENDING_DIR, '.active-items');
const COMPLETED_TASK_BOARD_LIMIT = 50;
const log = createLogger('desktop/main.taskBoard');
const scheduledKillCleanups = new Set<string>();
type TaskBoardArtifactContentType = NonNullable<TaskBoardMarkdownArtifact['contentType']>;

/** Monotonically increasing counter. Incremented before each board read begins. */
let nextBoardSnapshotSequence = 1;

function registryEntryToItem(entry: TaskRegistryEntry): TaskBoardItem {
  return {
    fileName: entry.fileName,
    taskId: entry.taskId,
    title: entry.title,
  };
}

function boardItemsFromVisibleMarkdownItems(
  items: Awaited<ReturnType<typeof readVisibleTaskMarkdownItems>>,
): TaskBoardItem[] {
  return items.map((item) => ({
    fileName: item.fileName,
    taskId: item.taskId,
    title: item.title,
  }));
}

function isPendingBoardEntry(entry: TaskRegistryEntry): boolean {
  return entry.state === 'pending' || entry.state === 'active';
}

function isCompletedBoardEntry(entry: TaskRegistryEntry): boolean {
  return entry.state === 'completed';
}

function visibleTaskMutationError(
  action:
    | 'taskBoard.reorderPending'
    | 'taskBoard.requeueErrorItem'
    | 'taskBoard.deleteTask'
    | 'taskBoard.moveToPending'
    | 'taskBoard.moveToOpen'
    | 'taskBoard.killTask'
    | 'taskBoard.retryKillCleanup',
  fileName: string,
): DesktopInvokeResult {
  return {
    ok: false,
    action,
    error: `${fileName} is not visible in the active context pack.`,
  };
}

function findVisibleRegistryEntryForColumn(
  column: TaskBoardContentColumn,
  fileName: string,
  scope: ActiveContextPackTaskScope | null,
  registry: Awaited<ReturnType<typeof loadTaskRegistry>>,
): TaskRegistryEntry | null {
  for (const taskSet of Object.values(registry.tasks)) {
    const candidates =
      column === 'open'
        ? taskSet.open
        : column === 'pending'
          ? [...taskSet.pending, ...taskSet.active]
          : column === 'error'
            ? taskSet.failed
            : taskSet.completed;
    const match = candidates.find((entry) => (
      entry.fileName === fileName
      && (
        column === 'pending'
          ? isPendingBoardEntry(entry)
          : column === 'completed'
            ? isCompletedBoardEntry(entry)
            : true
      )
      && isRegistryEntryVisibleForScope(entry, scope)
    ));
    if (match) {
      return match;
    }
  }
  return null;
}

async function isFileVisibleForScope(options: {
  fileName: string;
  dir: string;
  column: Exclude<TaskBoardContentColumn, 'completed'>;
  scope: ActiveContextPackTaskScope;
  registry: TaskRegistry;
  fsAdapter?: ReadOnlyRepoFs;
}): Promise<boolean> {
  if (findVisibleRegistryEntryForColumn(options.column, options.fileName, options.scope, options.registry)) {
    return true;
  }

  const visibleItems = await readVisibleTaskMarkdownItems(
    options.dir,
    options.scope,
    options.fsAdapter ?? repoFs,
  );
  return visibleItems.some((item) => item.fileName === options.fileName);
}

async function resolveVisibleMutationContext(
  listContextPacks?: ContextPackLister,
): Promise<{ scope: ActiveContextPackTaskScope; registry: TaskRegistry } | null> {
  if (!listContextPacks) {
    return null;
  }
  const scope = await resolveActiveContextPackTaskScope(listContextPacks);
  if (!scope) {
    return null;
  }
  const registry = await loadTaskRegistry(REPO_ROOT);
  return { scope, registry };
}

function registryEntryToPendingItem(
  entry: TaskRegistryEntry,
): TaskBoardPendingItem {
  return {
    fileName: entry.fileName,
    taskId: entry.taskId,
    title: entry.title,
    state: entry.state === 'active' ? 'active' : 'pending',
  };
}

type ActivationProgressForBoard = Awaited<ReturnType<typeof readActivationProgressRecords>>[number];
type KillRequestForBoard = NonNullable<Awaited<ReturnType<typeof observeKillRequest>>>;

function overlayActivationProgress(
  item: TaskBoardPendingItem,
  progress: Map<string, ActivationProgressForBoard>,
): TaskBoardPendingItem {
  if (!item.taskId) return item;
  const marker = progress.get(item.taskId);
  if (!marker) return item;
  return {
    ...item,
    state: 'activating',
    activationPhase: marker.phase,
    activationStartedAt: marker.startedAt,
    activationUpdatedAt: marker.updatedAt,
  };
}

// Active items lose their activation-progress marker once the pipeline starts,
// so activationStartedAt is unset by overlayActivationProgress. The in-process
// pipeline supervisor still has the spawn timestamp — surface it here so the
// UI can render "Active · Started HH:MM".
function overlayActivePipelineStartedAt(
  item: TaskBoardPendingItem,
  pipelineStartedAt: Map<string, string>,
): TaskBoardPendingItem {
  if (item.state !== 'active' || !item.taskId || item.activationStartedAt) return item;
  const startedAt = pipelineStartedAt.get(item.taskId);
  return startedAt ? { ...item, activationStartedAt: startedAt } : item;
}

async function readValidKillRequestsForBoard(queuePaths: ReturnType<typeof resolveQueuePaths>): Promise<KillRequestForBoard[]> {
  let entries: string[];
  try {
    entries = (await readdir(queuePaths.killRequestsDir))
      .filter((entry) => entry.endsWith('.json') && !entry.startsWith('.'))
      .sort();
  } catch {
    return [];
  }
  const records = await Promise.all(entries.map(async (entry) => {
    const taskId = entry.replace(/\.json$/, '');
    return observeKillRequest({ killRequestsDir: queuePaths.killRequestsDir, taskId });
  }));
  return records.filter((record): record is KillRequestForBoard => record !== null);
}

function overlayStoppingFromKillRequests(
  item: TaskBoardPendingItem,
  killRequests: Map<string, KillRequestForBoard>,
): TaskBoardPendingItem {
  if (!item.taskId || item.state === 'pending') return item;
  const marker = killRequests.get(item.taskId);
  if (!marker) return item;
  return {
    ...item,
    state: 'stopping',
    stopRequestedAt: marker.requestedAt,
    ...(marker.cleanupStatus === 'failed'
      ? {
          stopCleanupStatus: 'failed' as const,
          stopCleanupFailedAt: marker.cleanupLastFailedAt,
          stopCleanupErrorCode: marker.cleanupLastErrorCode,
          stopCleanupMessage: marker.cleanupLastErrorMessage,
          stopCleanupRetryable: true,
        }
      : {}),
  };
}

function applyPendingItemOverlays(
  pendingItems: TaskBoardPendingItem[],
  activationProgress: Map<string, ActivationProgressForBoard> | null,
  killRequests: Map<string, KillRequestForBoard> | null,
): TaskBoardPendingItem[] {
  const pipelineStartedAt = new Map(
    listActivePipelines().map((entry) => [entry.taskId, entry.startedAt]),
  );
  const withActivation = activationProgress
    ? pendingItems.map((item) => overlayActivationProgress(item, activationProgress))
    : pendingItems;
  return withActivation.map((item) =>
    overlayActivePipelineStartedAt(item, pipelineStartedAt),
  ).map((item) =>
    killRequests ? overlayStoppingFromKillRequests(item, killRequests) : item,
  );
}

function sendBoardResponseToWindows(response: TaskBoardReadBoardResponse): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(DESKTOP_SHELL_TASK_BOARD_CHANNEL, response);
    }
  }
}

// Coalescing state for broadcastTaskBoardUpdate.
let broadcastInFlight = false;
let broadcastHasPending = false;
let broadcastPendingLister: ContextPackLister | undefined = undefined;

/** Reset coalescing state — for testing only. */
export function resetBroadcastState(): void {
  broadcastInFlight = false;
  broadcastHasPending = false;
  broadcastPendingLister = undefined;
}

export async function broadcastTaskBoardUpdate(listContextPacks?: ContextPackLister): Promise<void> {
  if (broadcastInFlight) {
    // A newer trigger arrived while a read is in flight. Record it so we
    // emit a follow-up read when the current one finishes.
    broadcastHasPending = true;
    broadcastPendingLister = listContextPacks;
    return;
  }
  broadcastInFlight = true;
  broadcastHasPending = false;
  broadcastPendingLister = undefined;
  try {
    // Assign sequence before the read begins so that a concurrent explicit
    // refresh cannot resolve after this broadcast and appear newer.
    const seq = nextBoardSnapshotSequence++;
    const result = await readTaskBoard(listContextPacks, undefined, seq);
    if (!result.ok) return;
    sendBoardResponseToWindows(result.response as TaskBoardReadBoardResponse);
  } catch {
    // Filesystem may be in a transient state — next event will retry.
  } finally {
    broadcastInFlight = false;
    if (broadcastHasPending) {
      const pending = broadcastPendingLister;
      broadcastHasPending = false;
      broadcastPendingLister = undefined;
      void broadcastTaskBoardUpdate(pending);
    }
  }
}

function scheduleRequestedTaskKillCleanup(taskId: string, listContextPacks?: ContextPackLister): void {
  if (scheduledKillCleanups.has(taskId)) return;
  scheduledKillCleanups.add(taskId);
  void executeRequestedTaskKill({ repoRoot: REPO_ROOT, taskId })
    .catch((error: unknown) => {
      log.error('task_kill.background_cleanup_failed', error instanceof Error ? error : new Error(getErrorMessage(error)), { taskId });
    })
    .finally(() => {
      scheduledKillCleanups.delete(taskId);
      void broadcastTaskBoardUpdate(listContextPacks);
    });
}

function archivedAtMs(task: ArchivedTaskEntry): number | null {
  if (!task.archivedAt) return null;
  const ms = new Date(task.archivedAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function newestArchivedTasks(tasks: ArchivedTaskEntry[], limit: number): ArchivedTaskEntry[] {
  return tasks
    .map((task, index) => ({ task, index, ms: archivedAtMs(task) }))
    .sort((left, right) => {
      if (left.ms !== null && right.ms !== null && left.ms !== right.ms) return right.ms - left.ms;
      if (left.ms !== null && right.ms === null) return -1;
      if (left.ms === null && right.ms !== null) return 1;
      return left.index - right.index;
    })
    .slice(0, limit)
    .map((entry) => entry.task);
}

export async function readTaskBoard(
  listContextPacks?: ContextPackLister,
  fsAdapter: ReadOnlyRepoFs = repoFs,
  boardSnapshotSequence?: number,
): Promise<DesktopInvokeResult> {
  // Assign sequence here if not provided (direct IPC handler path).
  const seq = boardSnapshotSequence ?? nextBoardSnapshotSequence++;
  try {
    const registry = await loadTaskRegistry(REPO_ROOT);
    const hasRegistryData = Object.keys(registry.tasks).length > 0;
    const scope = listContextPacks
      ? await resolveActiveContextPackTaskScope(listContextPacks)
      : null;
    const queuePaths = resolveQueuePaths(REPO_ROOT);
    const [activationProgressRecords, killRequestRecords] = await Promise.all([
      readActivationProgressRecords(queuePaths),
      readValidKillRequestsForBoard(queuePaths),
    ]);
    const activationProgress = activationProgressRecords.length > 0
      ? new Map(activationProgressRecords.map((record) => [record.taskId, record]))
      : null;
    const killRequests = killRequestRecords.length > 0
      ? new Map(killRequestRecords.map((record) => [record.taskId, record]))
      : null;

    // QMD is the system of record for completed tasks. The registry's
    // `completed[]` is wiped by repairTaskRegistry on Electron startup
    // (it scans dropbox/pendingitems/error-items but not QMD), so reading
    // completed entries from the registry causes the UI to flap — archived
    // .md files appear when the registry is empty (legacy fallback path)
    // and disappear after repair clears the registry's completed[]. Always
    // resolve completed from the QMD scan, regardless of which path handles
    // the other columns.
    let completedItems: ArchivedTaskEntry[] = [];
    if (listContextPacks && scope) {
      const archivedResult = await listArchivedTasksAction(listContextPacks, { scope });
      if (archivedResult.ok && 'tasks' in archivedResult.response) {
        completedItems = newestArchivedTasks(
          (archivedResult.response as { tasks: ArchivedTaskEntry[] }).tasks,
          COMPLETED_TASK_BOARD_LIMIT,
        );
      }
    }

    if (!scope) {
      const response: TaskBoardReadBoardResponse = {
        action: 'taskBoard.readBoard',
        mode: 'read-only',
        message: '0 open, 0 pending, 0 failed, 0 completed.',
        boardSnapshotSequence: seq,
        dropboxItems: [],
        pendingItems: [],
        errorItems: [],
        completedItems,
      };
      return { ok: true, response };
    }

    if (hasRegistryData) {
      const tasks = filterRegistryTaskSetsForScope(registry, scope);

      const dropboxItems = tasks.open.map(registryEntryToItem);
      const pendingItems = [
        ...tasks.active.map(registryEntryToPendingItem),
        ...tasks.pending.map(registryEntryToPendingItem),
      ];
      const displayPendingItems = applyPendingItemOverlays(pendingItems, activationProgress, killRequests);
      const errorItems = tasks.failed.map(registryEntryToItem);

      const response: TaskBoardReadBoardResponse = {
        action: 'taskBoard.readBoard',
        mode: 'read-only',
        message: `${dropboxItems.length} open, ${displayPendingItems.length} pending, ${errorItems.length} failed, ${completedItems.length} completed.`,
        boardSnapshotSequence: seq,
        dropboxItems,
        pendingItems: displayPendingItems,
        errorItems,
        completedItems,
      };
      return { ok: true, response };
    }

    // Fallback: scan directories (legacy path when registry is empty).
    const [dropboxRaw, pendingRaw, errorRaw, activeTaskIds] = await Promise.all([
      readVisibleTaskMarkdownItems(DROPBOX_DIR, scope, fsAdapter),
      readVisibleTaskMarkdownItems(PENDING_DIR, scope, fsAdapter),
      readVisibleTaskMarkdownItems(ERROR_ITEMS_DIR, scope, fsAdapter),
      filterActiveTaskIdsForScope(
        await (async () => {
          if (!(await pathExists(ACTIVE_ITEMS_DIR, fsAdapter))) {
            return [];
          }
          try {
            return (await fsAdapter.readdir(ACTIVE_ITEMS_DIR))
              .filter((entry) => !entry.startsWith('.') && !entry.endsWith('.completing'))
              .sort();
          } catch {
            return [];
          }
        })(),
        {
          registry,
          scope,
          pendingDir: PENDING_DIR,
          fsAdapter,
        },
      ),
    ]);
    const dropboxItems = boardItemsFromVisibleMarkdownItems(dropboxRaw);

    const activeTaskIdSet = new Set(activeTaskIds);

    const orderManifest = await readQueueOrderManifest(resolveQueuePaths(REPO_ROOT).queueOrderPath);
    const orderMap = new Map(orderManifest.map((name, i) => [name, i]));
    const sortedPending = [...boardItemsFromVisibleMarkdownItems(pendingRaw)].sort((a, b) => {
      const ai = orderMap.get(a.fileName) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderMap.get(b.fileName) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.fileName.localeCompare(b.fileName);
    });

    const pendingItems = sortedPending.map((item): TaskBoardPendingItem => ({
      ...item,
      state: (item.taskId && activeTaskIdSet.has(item.taskId) ? 'active' : 'pending') as 'active' | 'pending',
    }));
    const displayPendingItems = applyPendingItemOverlays(pendingItems, activationProgress, killRequests);

    const errorItems = boardItemsFromVisibleMarkdownItems(errorRaw);

    const response: TaskBoardReadBoardResponse = {
      action: 'taskBoard.readBoard',
      mode: 'read-only',
      message: `${dropboxItems.length} open, ${displayPendingItems.length} pending, ${errorItems.length} failed, ${completedItems.length} completed.`,
      boardSnapshotSequence: seq,
      dropboxItems,
      pendingItems: displayPendingItems,
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

// Internal artifact shape — carries the resolved absolute path that the public
// TaskBoardMarkdownArtifact deliberately omits from the renderer contract.
type CompletedArtifact = {
  relativePath: string;
  label: string;
  sizeBytes: number;
  absolutePath: string;
  contentType: TaskBoardArtifactContentType;
};

const ARCHIVE_MD = 'archive.md';

function toPublicArtifact(artifact: CompletedArtifact): TaskBoardMarkdownArtifact {
  return {
    relativePath: artifact.relativePath,
    label: artifact.label,
    sizeBytes: artifact.sizeBytes,
    contentType: artifact.contentType,
  };
}

// Resolve the directory to enumerate for a nested archive, or null when the task
// must be treated as a flat legacy archive backed directly by archivePath.
function resolveCompletedArtifactRoot(task: ArchivedTaskEntry): string | null {
  if (task.archiveArtifactDir) {
    return task.archiveArtifactDir;
  }
  if (basename(task.archivePath) === ARCHIVE_MD) {
    return dirname(task.archivePath);
  }
  return null;
}

// Recursively enumerate regular, non-symlink markdown/XML files under the archive
// root. Skips dot-files/dot-directories, symlinks, and unsupported files.
// Returns artifacts sorted archive.md-first, then case-insensitively by path.
async function listCompletedArtifacts(root: string): Promise<CompletedArtifact[]> {
  const collected: CompletedArtifact[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
        continue;
      }
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const contentType = artifactContentTypeForFileName(entry.name);
      if (!entry.isFile() || !contentType) {
        continue;
      }
      let stat;
      try {
        stat = await lstat(absolutePath);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        continue;
      }
      const relativePath = relative(root, absolutePath).replace(/\\/g, '/');
      collected.push({ relativePath, label: relativePath, sizeBytes: stat.size, absolutePath, contentType });
    }
  }

  await walk(root);
  return collected.sort((a, b) => {
    if (a.relativePath === ARCHIVE_MD) return b.relativePath === ARCHIVE_MD ? 0 : -1;
    if (b.relativePath === ARCHIVE_MD) return 1;
    return a.relativePath.toLowerCase().localeCompare(b.relativePath.toLowerCase());
  });
}

function artifactContentTypeForFileName(fileName: string): TaskBoardArtifactContentType | null {
  if (fileName.endsWith('.xml')) return 'xml';
  if (fileName.endsWith('.md')) return 'markdown';
  return null;
}

// Normalize a renderer-supplied artifact path to a safe POSIX relative path, or
// null if it is empty, absolute, or contains a traversal segment. Membership in
// the enumerated artifact set is enforced separately by the caller.
function normalizeRequestedArtifactPath(value: string): string | null {
  const posix = value.replace(/\\/g, '/').trim();
  if (posix.length === 0 || posix.startsWith('/') || isAbsolute(value) || isAbsolute(posix)) {
    return null;
  }
  const segments = posix.split('/');
  if (segments.some((segment) => segment === '..' || segment.length === 0)) {
    return null;
  }
  return segments.join('/');
}

// Artifact selection lookup: defaults to archive.md when no path was requested,
// otherwise returns the enumerated artifact whose path matches the normalized
// request, or null when the request is invalid or unknown.
function selectArtifact(
  artifacts: CompletedArtifact[],
  requested: string | undefined,
): CompletedArtifact | null {
  if (requested === undefined) {
    return artifacts.find((artifact) => artifact.relativePath === ARCHIVE_MD) ?? null;
  }
  const normalized = normalizeRequestedArtifactPath(requested);
  if (normalized === null) {
    return null;
  }
  return artifacts.find((artifact) => artifact.relativePath === normalized) ?? null;
}

// A requested path that, once normalized, is not archive.md cannot be served by
// a flat/unreadable archive that only exposes archive.md.
function requestedNestedArtifact(requested: string | undefined): boolean {
  return requested !== undefined && normalizeRequestedArtifactPath(requested) !== ARCHIVE_MD;
}

async function makeFlatArchiveArtifact(archivePath: string): Promise<CompletedArtifact> {
  let sizeBytes = 0;
  try {
    const stat = await lstat(archivePath);
    if (stat.isFile()) {
      sizeBytes = stat.size;
    }
  } catch {
    // Size is best-effort metadata; the actual read enforces existence.
  }
  return {
    relativePath: ARCHIVE_MD,
    label: ARCHIVE_MD,
    sizeBytes,
    absolutePath: archivePath,
    contentType: 'markdown',
  };
}

async function readCompletedTaskContent(
  base: string,
  artifactRelativePath: string | undefined,
  listContextPacks: ContextPackLister,
): Promise<DesktopInvokeResult> {
  const taskId = base.replace(/\.md$/, '');
  const archivedResult = await listArchivedTasksAction(listContextPacks);
  if (!(archivedResult.ok && 'tasks' in archivedResult.response)) {
    return notFoundResult(base);
  }
  const tasks = (archivedResult.response as { tasks: ArchivedTaskEntry[] }).tasks;
  const match = tasks.find((t) => t.taskId === taskId);

  let artifacts: CompletedArtifact[];
  let archivedTask: ArchivedTaskEntry | null = null;

  if (match?.archivePath) {
    archivedTask = match;
    const root = resolveCompletedArtifactRoot(match);
    let listed: CompletedArtifact[] | null = null;
    if (root) {
      try {
        listed = await listCompletedArtifacts(root);
      } catch {
        // Archive root unreadable — fall back to the flat archive.md below.
        listed = null;
      }
    }
    if (listed && listed.length > 0) {
      artifacts = listed;
    } else {
      if (requestedNestedArtifact(artifactRelativePath)) {
        return notFoundResult(base);
      }
      artifacts = [await makeFlatArchiveArtifact(match.archivePath)];
    }
  } else {
    // Scoped registry fallback: a legacy single-artifact archive. archiveArtifactDir
    // is structurally unavailable here (the registry match yields only archivePath),
    // so this is always a flat archive.md and carries no branch-handoff source.
    const scope = await resolveActiveContextPackTaskScope(listContextPacks);
    if (!scope) {
      return notFoundResult(base);
    }
    const registry = await loadTaskRegistry(REPO_ROOT);
    const registryMatch = filterRegistryTaskSetsForScope(registry, scope)
      .completed
      .find((entry) => entry.taskId === taskId && entry.archivePath);
    if (!registryMatch?.archivePath) {
      return notFoundResult(base);
    }
    if (requestedNestedArtifact(artifactRelativePath)) {
      return notFoundResult(base);
    }
    artifacts = [await makeFlatArchiveArtifact(registryMatch.archivePath)];
  }

  const selected = selectArtifact(artifacts, artifactRelativePath);
  if (!selected) {
    return notFoundResult(base);
  }
  const selectedRelativePath = selected.relativePath;

  let content: string;
  try {
    content = await fsReadFile(selected.absolutePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return notFoundResult(base);
    }
    throw err;
  }

  // Branch-handoff text belongs only on archive.md; nested artifacts render verbatim.
  if (selectedRelativePath === 'archive.md' && archivedTask) {
    const handoffText = formatCompletedBranchHandoffText(archivedTask);
    if (
      handoffText
      && !content.includes('## Source Branches for Operator Review')
      && !content.includes(handoffText.trim())
    ) {
      content = `${handoffText}\n${content}`;
    }
  }

  return {
    ok: true,
    response: {
      action: 'taskBoard.readTaskContent' as const,
      mode: 'found' as const,
      message: `Read ${base}.`,
      content,
      fileName: base,
      artifactRelativePath: selectedRelativePath,
      contentType: selected.contentType,
      artifacts: artifacts.map(toPublicArtifact),
    },
  };
}

export async function readTaskContent(
  payload: TaskBoardReadTaskContentRequest['payload'],
  listContextPacks?: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const { fileName, column, artifactRelativePath } = payload;
    const base = basename(fileName);
    if (!base.endsWith('.md') || base.startsWith('.')) {
      return {
        ok: false,
        action: 'taskBoard.readTaskContent',
        error: 'Invalid file name.',
      };
    }

    if (column === 'completed') {
      if (!listContextPacks) {
        return notFoundResult(base);
      }
      return readCompletedTaskContent(base, artifactRelativePath, listContextPacks);
    }

    // Open, pending, and failed reads ignore artifactRelativePath and preserve
    // existing visibility checks and not-found behavior.
    const mutationContext = await resolveVisibleMutationContext(listContextPacks);
    const isVisible = mutationContext
      ? await isFileVisibleForScope({
          fileName: base,
          dir: COLUMN_DIR_MAP[column],
          column,
          scope: mutationContext.scope,
          registry: mutationContext.registry,
        })
      : false;
    if (!isVisible) {
      return notFoundResult(base);
    }
    const filePath = join(COLUMN_DIR_MAP[column], base);

    let content: string;
    try {
      content = await fsReadFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return notFoundResult(base);
      }
      throw err;
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
  listContextPacks?: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const mutationContext = await resolveVisibleMutationContext(listContextPacks);
    if (!mutationContext) {
      return visibleTaskMutationError('taskBoard.reorderPending', 'Pending queue');
    }
    const { scope, registry } = mutationContext;
    const scopedTasks = filterRegistryTaskSetsForScope(registry, scope);
    const registryPendingFileNames = [
      ...scopedTasks.active,
      ...scopedTasks.pending,
    ]
      .filter(isPendingBoardEntry)
      .map((entry) => entry.fileName);
    const visiblePendingItems = await readVisibleTaskMarkdownItems(PENDING_DIR, scope, repoFs);
    const visiblePendingFileNames = [
      ...new Set([
        ...registryPendingFileNames,
        ...visiblePendingItems.map((item) => item.fileName),
      ]),
    ];
    const visiblePendingFileNameSet = new Set(visiblePendingFileNames);
    const hiddenFile = payload.order.find((fileName) => !visiblePendingFileNameSet.has(fileName));
    if (hiddenFile) {
      return visibleTaskMutationError('taskBoard.reorderPending', hiddenFile);
    }

    const queuePaths = resolveQueuePaths(REPO_ROOT);
    await withDirLock(queuePaths.queueLockDir, 'Reorder pending', async () => {
      const currentPendingEntries = await repoFs.readdir(PENDING_DIR);
      const currentPendingFileNames = currentPendingEntries
        .filter((entry) => entry.endsWith('.md') && !entry.startsWith('.'))
        .sort();
      const currentPendingSet = new Set(currentPendingFileNames);
      const existingManifest = await readQueueOrderManifest(queuePaths.queueOrderPath);
      const manifestPendingOrder = existingManifest.filter((fileName) => currentPendingSet.has(fileName));
      const manifestPendingSet = new Set(manifestPendingOrder);
      const fullPendingOrder = [
        ...manifestPendingOrder,
        ...currentPendingFileNames.filter((fileName) => !manifestPendingSet.has(fileName)),
      ];
      const nextVisibleOrder = [...payload.order];
      const emitted = new Set<string>();
      const mergedManifest: string[] = [];

      for (const fileName of fullPendingOrder) {
        if (!visiblePendingFileNameSet.has(fileName)) {
          mergedManifest.push(fileName);
          emitted.add(fileName);
          continue;
        }

        const nextVisibleFileName = nextVisibleOrder.shift();
        if (nextVisibleFileName && !emitted.has(nextVisibleFileName)) {
          mergedManifest.push(nextVisibleFileName);
          emitted.add(nextVisibleFileName);
        } else if (!emitted.has(fileName)) {
          mergedManifest.push(fileName);
          emitted.add(fileName);
        }
      }

      for (const fileName of nextVisibleOrder) {
        if (!emitted.has(fileName)) {
          mergedManifest.push(fileName);
          emitted.add(fileName);
        }
      }

      if (mergedManifest.length > 0) {
        await writeQueueOrderManifest(queuePaths.queueOrderPath, mergedManifest);
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
  listContextPacks?: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const mutationContext = await resolveVisibleMutationContext(listContextPacks);
    if (!mutationContext || !(await isFileVisibleForScope({
      fileName: payload.fileName,
      dir: ERROR_ITEMS_DIR,
      column: 'error',
      scope: mutationContext.scope,
      registry: mutationContext.registry,
    }))) {
      return visibleTaskMutationError('taskBoard.requeueErrorItem', payload.fileName);
    }
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
  listContextPacks?: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const queueName = payload.fileName;
    const mutationContext = await resolveVisibleMutationContext(listContextPacks);
    if (!mutationContext || !(await isFileVisibleForScope({
      fileName: queueName,
      dir: COLUMN_DIR_MAP[payload.column],
      column: payload.column,
      scope: mutationContext.scope,
      registry: mutationContext.registry,
    }))) {
      return visibleTaskMutationError('taskBoard.deleteTask', queueName);
    }
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
  listContextPacks?: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const mutationContext = await resolveVisibleMutationContext(listContextPacks);
    if (!mutationContext || !(await isFileVisibleForScope({
      fileName: payload.fileName,
      dir: DROPBOX_DIR,
      column: 'open',
      scope: mutationContext.scope,
      registry: mutationContext.registry,
    }))) {
      return visibleTaskMutationError('taskBoard.moveToPending', payload.fileName);
    }
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
  listContextPacks?: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const sourceColumn = payload.sourceColumn ?? 'error';
    const mutationContext = await resolveVisibleMutationContext(listContextPacks);
    const column = sourceColumn === 'pending' ? 'pending' : 'error';
    const dir = sourceColumn === 'pending' ? PENDING_DIR : ERROR_ITEMS_DIR;
    if (!mutationContext || !(await isFileVisibleForScope({
      fileName: payload.fileName,
      dir,
      column,
      scope: mutationContext.scope,
      registry: mutationContext.registry,
    }))) {
      return visibleTaskMutationError('taskBoard.moveToOpen', payload.fileName);
    }
    if (sourceColumn === 'pending') {
      const visibleEntry = findVisibleRegistryEntryForColumn('pending', payload.fileName, mutationContext.scope, mutationContext.registry);
      if (visibleEntry?.state === 'active') {
        return { ok: false, action: 'taskBoard.moveToOpen', error: 'Active tasks cannot be returned to open.' };
      }
    }
    const result = sourceColumn === 'pending'
      ? await movePendingItemToDropbox({
          fileName: payload.fileName,
          repoRoot: REPO_ROOT,
          reason: 'operator-drag-return-open',
        })
      : await moveErrorItemToDropbox({
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

export async function killTask(
  payload: TaskBoardKillTaskRequest['payload'],
  listContextPacks?: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const board = await readTaskBoard(listContextPacks);
    const pendingItems = board.ok && 'pendingItems' in board.response
      ? board.response.pendingItems
      : [];
    const visiblePending = pendingItems.find((item) => item.fileName === payload.fileName && item.taskId === payload.taskId);
    if (!visiblePending) {
      return visibleTaskMutationError('taskBoard.killTask', payload.fileName);
    }
    if (visiblePending.state !== 'active' && visiblePending.state !== 'activating') {
      return {
        ok: false,
        action: 'taskBoard.killTask',
        error: 'Only active or activating pending tasks can be stopped.',
      };
    }
    const result = await requestTaskKill({ repoRoot: REPO_ROOT, taskId: payload.taskId });
    await broadcastTaskBoardUpdate(listContextPacks);
    scheduleRequestedTaskKillCleanup(payload.taskId, listContextPacks);
    return {
      ok: true,
      response: {
        action: 'taskBoard.killTask' as const,
        mode: 'kill-requested' as const,
        message: result.message,
        taskId: result.taskId,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.killTask',
      error: error instanceof Error ? error.message : 'Failed to stop task.',
    };
  }
}

export async function retryKillCleanup(
  payload: TaskBoardRetryKillCleanupRequest['payload'],
  listContextPacks?: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const board = await readTaskBoard(listContextPacks);
    const pendingItems = board.ok && 'pendingItems' in board.response
      ? board.response.pendingItems
      : [];
    const visiblePending = pendingItems.find((item) => item.fileName === payload.fileName && item.taskId === payload.taskId);
    if (!visiblePending) {
      return visibleTaskMutationError('taskBoard.retryKillCleanup', payload.fileName);
    }
    if (
      visiblePending.state !== 'stopping'
      || visiblePending.stopCleanupStatus !== 'failed'
      || visiblePending.stopCleanupRetryable !== true
    ) {
      return {
        ok: false,
        action: 'taskBoard.retryKillCleanup',
        error: 'Only failed cleanup Stopping tasks can retry cleanup.',
      };
    }
    const queuePaths = resolveQueuePaths(REPO_ROOT);
    const marker = await observeKillRequest({ killRequestsDir: queuePaths.killRequestsDir, taskId: payload.taskId });
    if (!marker || marker.cleanupStatus !== 'failed') {
      return {
        ok: false,
        action: 'taskBoard.retryKillCleanup',
        error: 'Stop cleanup marker is no longer retryable.',
      };
    }
    const alreadyScheduled = scheduledKillCleanups.has(payload.taskId);
    scheduleRequestedTaskKillCleanup(payload.taskId, listContextPacks);
    log.info('task_kill.retry_cleanup_scheduled', {
      taskId: payload.taskId,
      cleanupAttemptCount: marker.cleanupAttemptCount,
      cleanupLastErrorCode: marker.cleanupLastErrorCode,
      coalesced: alreadyScheduled,
    });
    if (board.ok && board.response.action === 'taskBoard.readBoard') {
      sendBoardResponseToWindows(board.response as TaskBoardReadBoardResponse);
    }
    return {
      ok: true,
      response: {
        action: 'taskBoard.retryKillCleanup' as const,
        mode: 'cleanup-retry-scheduled' as const,
        message: `Retry cleanup scheduled for task: ${payload.taskId}.`,
        taskId: payload.taskId,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'taskBoard.retryKillCleanup',
      error: error instanceof Error ? error.message : 'Failed to retry cleanup.',
    };
  }
}

const WATCH_DEBOUNCE_MS = 150;
const WATCH_RETRY_MS = 1000;

/**
 * Watch the three task directories and broadcast board updates to all
 * renderer windows when files change. Uses a 150ms debounce to coalesce
 * rapid filesystem events into a single board read.
 *
 * Missing targets are retried every WATCH_RETRY_MS (mirroring the
 * notification watcher retry pattern) so that targets that appear after
 * startup (repaired or cold workspace dirs) resume board broadcasts.
 *
 * Returns a cleanup function that stops all watchers.
 */
export function startTaskBoardWatcher(
  listContextPacks: () => Promise<import('../src/shared/desktopContract').ContextPackListResponse>,
): () => void {
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryScheduled = false;
  const watchersByTarget = new Map<string, FSWatcher>();

  const triggerBoardBroadcast = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void broadcastTaskBoardUpdate(listContextPacks), WATCH_DEBOUNCE_MS);
  };

  const scheduleRetry = (): void => {
    if (stopped || retryScheduled) return;
    retryScheduled = true;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      retryScheduled = false;
      attachWatchers();
    }, WATCH_RETRY_MS);
  };

  const queuePaths = resolveQueuePaths(REPO_ROOT);
  const registryFile = getRegistryPath(REPO_ROOT);
  const allTargets = [
    registryFile,
    DROPBOX_DIR,
    PENDING_DIR,
    ERROR_ITEMS_DIR,
    queuePaths.killRequestsDir,
    queuePaths.activeItemsDir,
    queuePaths.activatingItemsDir,
  ];

  const attachWatchers = (): void => {
    if (stopped) return;
    let anyMissing = false;
    for (const target of allTargets) {
      if (watchersByTarget.has(target)) continue;
      try {
        const w = watch(target, { persistent: false }, triggerBoardBroadcast);
        w.on('error', () => {
          watchersByTarget.delete(target);
          scheduleRetry();
        });
        watchersByTarget.set(target, w);
        // A newly attached target may mean the workspace just appeared — broadcast.
        void broadcastTaskBoardUpdate(listContextPacks);
      } catch {
        // Target does not exist yet — will retry.
        anyMissing = true;
      }
    }
    if (anyMissing) scheduleRetry();
  };

  attachWatchers();

  return () => {
    stopped = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
    debounceTimer = undefined;
    retryTimer = undefined;
    for (const w of watchersByTarget.values()) w.close();
    watchersByTarget.clear();
  };
}
