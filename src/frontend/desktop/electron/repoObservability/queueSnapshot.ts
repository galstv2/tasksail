import { loadTaskRegistry } from '../../../../backend/platform/queue/taskRegistry.js';
import type { PendingQueueItem, QueueStatusResponse } from '../../src/shared/desktopContract';
import { pathExists, repoFs, type ReadOnlyRepoFs } from '../utils';
import {
  filterActiveTaskIdsForScope,
  getCurrentActiveContextPackTaskScope,
  isCurrentActiveContextPackTaskScopeInitialized,
  readVisibleTaskMarkdownItems,
  resolveActiveContextPackTaskScope,
  type ContextPackLister,
} from '../main.contextPackTaskVisibility';
import { REPO_ROOT } from '../paths';
import { inferOperatorStatus } from './lifecycle';
import {
  ACTIVE_ITEMS_DIR,
  DROPBOX_DIR,
  ERROR_ITEMS_DIR,
  PENDING_DIR,
  countMarkdownFiles,
  extractHeading,
  extractMetadataValue,
  readDirIfPresent,
  readMarkdownFileIfPresent,
} from './shared';
import { join } from 'node:path';

export async function readActiveTaskIds(fsAdapter: ReadOnlyRepoFs): Promise<string[]> {
  if (!(await pathExists(ACTIVE_ITEMS_DIR, fsAdapter))) {
    return [];
  }
  try {
    const entries = await fsAdapter.readdir(ACTIVE_ITEMS_DIR);
    return entries.filter((f) => !f.endsWith('.completing') && !f.startsWith('.'));
  } catch {
    return [];
  }
}

export async function readPendingQueueItems(
  visiblePendingItems: Awaited<ReturnType<typeof readVisibleTaskMarkdownItems>>,
  activeTaskIds: Set<string>,
): Promise<PendingQueueItem[]> {
  const items: PendingQueueItem[] = [];
  for (const item of visiblePendingItems) {
    const taskId = item.taskId;
    const isActive = taskId ? activeTaskIds.has(taskId) : false;
    const state: PendingQueueItem['state'] = isActive ? 'active' : 'pending';
    items.push({
      queueName: item.fileName,
      taskId,
      title: extractMetadataValue(item.content, 'Task Title') || item.title,
      state,
      canDelete: state === 'pending',
    });
  }

  return items;
}

export async function readUnscopedPendingQueueItems(
  fsAdapter: ReadOnlyRepoFs,
  activeTaskIds: Set<string>,
): Promise<PendingQueueItem[]> {
  const entries = (await readDirIfPresent(PENDING_DIR, fsAdapter))
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('.'))
    .sort();

  const items: PendingQueueItem[] = [];
  for (const queueName of entries) {
    const content = await readMarkdownFileIfPresent(join(PENDING_DIR, queueName), fsAdapter);
    const taskId = extractMetadataValue(content, 'Task ID');
    const isActive = taskId ? activeTaskIds.has(taskId) : false;
    const state: PendingQueueItem['state'] = isActive ? 'active' : 'pending';
    items.push({
      queueName,
      taskId,
      title: extractMetadataValue(content, 'Task Title') || extractHeading(content),
      state,
      canDelete: state === 'pending',
    });
  }

  return items;
}

export async function readQueueStatusSnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
  listContextPacks?: ContextPackLister,
): Promise<QueueStatusResponse> {
  const scope = listContextPacks
    ? await resolveActiveContextPackTaskScope(listContextPacks)
    : getCurrentActiveContextPackTaskScope();
  const scopedRead = Boolean(listContextPacks) || isCurrentActiveContextPackTaskScopeInitialized();
  if (scopedRead && !scope) {
    return {
      action: 'queue.readStatus',
      mode: 'observed',
      queueDepth: 0,
      pendingReviewCount: 0,
      activeTaskId: null,
      operatorStatus: inferOperatorStatus({
        activeTaskIds: [],
        agentTerminalSessions: [],
      }),
      message: 'Observed repo queue state: 0 queued, 0 pending. Active tasks: 0.',
    };
  }

  const rawActiveTaskIds = await readActiveTaskIds(fsAdapter);
  let dropboxCount: number;
  let pendingCount: number;
  let errorItemsCount: number;
  let activeTaskIds: string[];
  if (scope) {
    const registry = await loadTaskRegistry(REPO_ROOT);
    const [dropboxItems, pendingItems, errorItems] = await Promise.all([
      readVisibleTaskMarkdownItems(DROPBOX_DIR, scope, fsAdapter),
      readVisibleTaskMarkdownItems(PENDING_DIR, scope, fsAdapter),
      readVisibleTaskMarkdownItems(ERROR_ITEMS_DIR, scope, fsAdapter),
    ]);
    activeTaskIds = await filterActiveTaskIdsForScope(rawActiveTaskIds, {
      registry,
      scope,
      pendingDir: PENDING_DIR,
      fsAdapter,
    });
    dropboxCount = dropboxItems.length;
    pendingCount = pendingItems.length;
    errorItemsCount = errorItems.length;
  } else {
    [dropboxCount, pendingCount, errorItemsCount] = await Promise.all([
      countMarkdownFiles(DROPBOX_DIR, fsAdapter),
      countMarkdownFiles(PENDING_DIR, fsAdapter),
      countMarkdownFiles(ERROR_ITEMS_DIR, fsAdapter),
    ]);
    activeTaskIds = rawActiveTaskIds;
  }

  // Derive activeTaskId for backward-compat scalar from the first active marker (F39).
  const activeTaskId = activeTaskIds[0] ?? null;

  const operatorStatus = inferOperatorStatus({
    activeTaskIds,
    agentTerminalSessions: [],
  });
  return {
    action: 'queue.readStatus',
    mode: 'observed',
    queueDepth: dropboxCount,
    pendingReviewCount: pendingCount,
    activeTaskId,
    operatorStatus,
    errorItemsCount: errorItemsCount > 0 ? errorItemsCount : undefined,
    message: `Observed repo queue state: ${dropboxCount} queued, ${pendingCount} pending. Active tasks: ${activeTaskIds.length}.`,
  };
}
