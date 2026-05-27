import { createLogger } from '../core/index.js';
import { getAllTasks, loadTaskRegistry, type TaskRegistryEntry } from '../queue/taskRegistry.js';
import { recordTaskNotification } from './store.js';
import type { TaskNotificationRecord } from './types.js';

const log = createLogger('platform/task-notifications/producer');

export type TaskNotificationCreatedEvent = {
  type: 'created';
  record: TaskNotificationRecord;
};

type TaskNotificationCreatedListener = (event: TaskNotificationCreatedEvent) => void;

const createdListeners = new Set<TaskNotificationCreatedListener>();

export async function recordTaskCompletedNotification(args: {
  repoRoot: string;
  taskId: string;
  entry?: TaskRegistryEntry | null;
  archivePath?: string | null;
  now?: Date;
}): Promise<TaskNotificationRecord | null> {
  const entry = await resolveRegistryEntry(args.repoRoot, args.taskId, args.entry);
  const record = await recordTaskNotification({
    repoRoot: args.repoRoot,
    record: {
      ...metadataForEntry(args.taskId, entry),
      dedupeKey: `task:${args.taskId}:completed`,
      type: 'task-completed',
      severity: 'success',
      archivePath: args.archivePath ?? null,
      errorItemPath: null,
      message: 'Task notification pending.',
    },
    now: args.now,
  });
  emitCreated(record);
  return record;
}

export async function recordTaskFailedNotification(args: {
  repoRoot: string;
  taskId: string;
  entry?: TaskRegistryEntry | null;
  errorItemPath?: string | null;
  now?: Date;
}): Promise<TaskNotificationRecord | null> {
  const entry = await resolveRegistryEntry(args.repoRoot, args.taskId, args.entry);
  const record = await recordTaskNotification({
    repoRoot: args.repoRoot,
    record: {
      ...metadataForEntry(args.taskId, entry),
      dedupeKey: `task:${args.taskId}:failed`,
      type: 'task-failed',
      severity: 'error',
      archivePath: null,
      errorItemPath: args.errorItemPath ?? null,
      message: 'Task notification pending.',
    },
    now: args.now,
  });
  emitCreated(record);
  return record;
}

export function subscribeTaskNotificationCreated(
  listener: TaskNotificationCreatedListener,
): () => void {
  createdListeners.add(listener);
  return () => {
    createdListeners.delete(listener);
  };
}

async function resolveRegistryEntry(
  repoRoot: string,
  taskId: string,
  entry: TaskRegistryEntry | null | undefined,
): Promise<TaskRegistryEntry | null> {
  if (entry?.taskId === taskId) {
    return entry;
  }

  try {
    const allTasks = getAllTasks(await loadTaskRegistry(repoRoot));
    for (const state of ['completed', 'failed', 'active', 'pending', 'open'] as const) {
      const found = allTasks[state].find((candidate) => candidate.taskId === taskId);
      if (found) return found;
    }
  } catch (err) {
    log.warn('task_notifications.registry_metadata.resolve_failed', {
      taskId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

function metadataForEntry(
  taskId: string,
  entry: TaskRegistryEntry | null,
): Pick<
  TaskNotificationRecord,
  'taskId' | 'taskGuid' | 'taskTitle' | 'taskFileName' | 'contextPackId' | 'contextPackDir' | 'contextPackLabel'
> {
  return {
    taskId,
    taskGuid: entry?.taskGuid ?? null,
    taskTitle: entry?.title ?? null,
    taskFileName: entry?.fileName ?? null,
    contextPackId: entry?.contextPackId ?? null,
    contextPackDir: entry?.contextPackDir ?? null,
    contextPackLabel: null,
  };
}

function emitCreated(record: TaskNotificationRecord | null): void {
  if (record === null) return;

  const event: TaskNotificationCreatedEvent = { type: 'created', record };
  for (const listener of createdListeners) {
    try {
      listener(event);
    } catch (err) {
      log.warn('task_notifications.created_listener.failed', {
        taskId: record.taskId,
        notificationType: record.type,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
