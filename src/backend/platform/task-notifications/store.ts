import { createHash } from 'node:crypto';
import { rename } from 'node:fs/promises';
import path from 'node:path';

import { createLogger, ensureDir, findRepoRoot, getErrorMessage, isMissingPathError, isRecord, readTextFile, writeTextFileAtomic } from '../core/index.js';
import { withDirLock } from '../queue/dirLock.js';
import type { TaskNotificationRecord, TaskNotificationSnapshot, TaskNotificationStore } from './types.js';

const STORE_SCHEMA_VERSION = 1;
const MAX_VISIBLE_NOTIFICATIONS = 200;
const MAX_PERSISTED_NOTIFICATIONS = 500;
const SNAPSHOT_MESSAGE = 'Task notifications loaded.';
const log = createLogger('platform/task-notifications/store');

export async function readTaskNotificationSnapshot(
  repoRoot?: string,
): Promise<TaskNotificationSnapshot> {
  const effectiveRepoRoot = repoRoot ?? findRepoRoot();
  const store = await readStoreForSnapshot(effectiveRepoRoot);
  return buildSnapshot(store.notifications);
}

export async function recordTaskNotification(args: {
  repoRoot: string;
  record: Omit<TaskNotificationRecord, 'notificationId' | 'createdAt' | 'seenAt' | 'dismissedAt'>;
  now?: Date;
}): Promise<TaskNotificationRecord | null> {
  return withNotificationStoreLock(args.repoRoot, 'recordTaskNotification', async () => {
    const store = await readStoreForMutation(args.repoRoot);
    const dedupeKey = canonicalDedupeKey(args.record.type, args.record.taskId);
    const dedupeKeys = new Set(store.notifications.map((record) => record.dedupeKey));
    if (dedupeKeys.has(dedupeKey)) {
      log.debug('task_notifications.record.duplicate_ignored', { taskId: args.record.taskId, notificationType: args.record.type });
      return null;
    }

    const contextPackLabel = canonicalContextPackLabel(args.record);
    const record: TaskNotificationRecord = {
      notificationId: notificationIdForDedupeKey(dedupeKey),
      dedupeKey,
      type: args.record.type,
      severity: severityForType(args.record.type),
      taskId: args.record.taskId,
      taskGuid: args.record.taskGuid,
      taskTitle: args.record.taskTitle,
      taskFileName: args.record.taskFileName,
      contextPackId: args.record.contextPackId,
      contextPackDir: args.record.contextPackDir,
      contextPackLabel,
      archivePath: args.record.archivePath,
      errorItemPath: args.record.errorItemPath,
      createdAt: isoNow(args.now),
      seenAt: null,
      dismissedAt: null,
      message: messageForRecord(args.record.type, args.record.taskTitle ?? args.record.taskId, contextPackLabel),
    };

    await writeStore(args.repoRoot, {
      schemaVersion: STORE_SCHEMA_VERSION,
      notifications: applyRetention([...store.notifications, record]),
    });
    log.info('task_notifications.record.created', { taskId: record.taskId, notificationType: record.type });
    return record;
  });
}

export async function markTaskNotificationsSeen(args: {
  repoRoot: string;
  notificationIds?: string[];
  allVisible?: boolean;
  now?: Date;
}): Promise<TaskNotificationSnapshot> {
  return mutateNotifications(args.repoRoot, 'markTaskNotificationsSeen', (store) => {
    const targetIds = args.allVisible
      ? new Set(visibleNotifications(store.notifications).map((record) => record.notificationId))
      : new Set(args.notificationIds ?? []);
    if (targetIds.size === 0) return null;

    const seenAt = isoNow(args.now);
    return store.notifications.map((record) => {
      if (record.dismissedAt !== null || record.seenAt !== null || !targetIds.has(record.notificationId)) {
        return record;
      }
      return { ...record, seenAt };
    });
  });
}

export async function dismissTaskNotification(args: {
  repoRoot: string;
  notificationId: string;
  now?: Date;
}): Promise<TaskNotificationSnapshot> {
  return mutateNotifications(args.repoRoot, 'dismissTaskNotification', (store) => {
    const dismissedAt = isoNow(args.now);
    return store.notifications.map((record) => {
      if (record.notificationId !== args.notificationId || record.dismissedAt !== null) {
        return record;
      }
      return { ...record, dismissedAt };
    });
  });
}

export async function dismissAllTaskNotifications(args: {
  repoRoot: string;
  now?: Date;
}): Promise<TaskNotificationSnapshot> {
  return mutateNotifications(args.repoRoot, 'dismissAllTaskNotifications', (store) => {
    const dismissedAt = isoNow(args.now);
    return store.notifications.map((record) => (
      record.dismissedAt === null ? { ...record, dismissedAt } : record
    ));
  });
}

type StoreUpdate = (store: TaskNotificationStore) => TaskNotificationRecord[] | null;

async function mutateNotifications(
  repoRoot: string,
  operationName: string,
  update: StoreUpdate,
): Promise<TaskNotificationSnapshot> {
  return withNotificationStoreLock(repoRoot, operationName, async () => {
    const store = await readStoreForMutation(repoRoot);
    const notifications = update(store);
    if (notifications === null || notifications.every((record, index) => record === store.notifications[index])) {
      return buildSnapshot(store.notifications);
    }
    const retained = applyRetention(notifications);
    await writeStore(repoRoot, { schemaVersion: STORE_SCHEMA_VERSION, notifications: retained });
    return buildSnapshot(retained);
  });
}

export const resolveTaskNotificationStorePath = (repoRoot: string): string =>
  path.join(resolveTaskNotificationStoreDir(repoRoot), 'notifications.json');

export const resolveTaskNotificationLockDir = (repoRoot: string): string =>
  path.join(resolveTaskNotificationStoreDir(repoRoot), '.lock');

export const resolveTaskNotificationStoreDir = (repoRoot: string): string =>
  path.join(repoRoot, '.platform-state', 'runtime', 'task-notifications');

async function withNotificationStoreLock<T>(
  repoRoot: string,
  operationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  await ensureDir(resolveTaskNotificationStoreDir(repoRoot));
  return withDirLock(resolveTaskNotificationLockDir(repoRoot), operationName, fn);
}

async function readStoreForSnapshot(repoRoot: string): Promise<TaskNotificationStore> {
  try {
    return await readStore(repoRoot, { throwOnQuarantineFailure: false });
  } catch (err) {
    log.warn('task_notifications.store.read_failed', { repoRootHash: hashForLog(repoRoot), reason: getErrorMessage(err) });
    return emptyStore();
  }
}

const readStoreForMutation = (repoRoot: string): Promise<TaskNotificationStore> =>
  readStore(repoRoot, { throwOnQuarantineFailure: true });

async function readStore(
  repoRoot: string,
  options: { throwOnQuarantineFailure: boolean },
): Promise<TaskNotificationStore> {
  const storePath = resolveTaskNotificationStorePath(repoRoot);
  const raw = await readTextFile(storePath);
  if (raw === undefined) return emptyStore();

  try {
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    await quarantineCorruptStore(repoRoot, err, options);
    return emptyStore();
  }
}

async function quarantineCorruptStore(
  repoRoot: string,
  cause: unknown,
  options: { throwOnQuarantineFailure: boolean },
): Promise<void> {
  const storePath = resolveTaskNotificationStorePath(repoRoot);
  const corruptPath = `${storePath}.corrupt.${Date.now()}`;
  try {
    await rename(storePath, corruptPath);
    log.warn('task_notifications.store.corrupt_quarantined', { repoRootHash: hashForLog(repoRoot), corruptPath: path.basename(corruptPath), reason: getErrorMessage(cause) });
  } catch (err) {
    log.warn('task_notifications.store.read_failed', { repoRootHash: hashForLog(repoRoot), corruptPath: path.basename(storePath), reason: getErrorMessage(err) });
    if (options.throwOnQuarantineFailure && !isMissingPathError(err)) throw err;
  }
}

async function writeStore(repoRoot: string, store: TaskNotificationStore): Promise<void> {
  await writeTextFileAtomic(
    resolveTaskNotificationStorePath(repoRoot),
    `${JSON.stringify(normalizeStore(store), null, 2)}\n`,
  );
}

const emptyStore = (): TaskNotificationStore => ({ schemaVersion: STORE_SCHEMA_VERSION, notifications: [] });

function buildSnapshot(notifications: TaskNotificationRecord[]): TaskNotificationSnapshot {
  const visible = visibleNotifications(notifications);
  return {
    action: 'taskNotifications.read',
    mode: 'read-only',
    unseenCount: visible.filter((record) => record.seenAt === null).length,
    notifications: visible,
    generatedAt: new Date().toISOString(),
    message: SNAPSHOT_MESSAGE,
  };
}

const visibleNotifications = (notifications: TaskNotificationRecord[]): TaskNotificationRecord[] =>
  notifications.filter((record) => record.dismissedAt === null).sort(compareNotificationsNewestFirst);

function applyRetention(notifications: TaskNotificationRecord[]): TaskNotificationRecord[] {
  const sorted = [...notifications].sort(compareNotificationsNewestFirst);
  const visiblePool: TaskNotificationRecord[] = [];
  const dismissedPool: TaskNotificationRecord[] = [];
  for (const record of sorted) {
    if (record.dismissedAt === null) {
      visiblePool.push(record);
    } else {
      dismissedPool.push(record);
    }
  }
  const visible = visiblePool.slice(0, MAX_VISIBLE_NOTIFICATIONS);
  const visibleIds = new Set(visible.map((record) => record.notificationId));
  const dismissed = dismissedPool
    .filter((record) => !visibleIds.has(record.notificationId))
    .slice(0, Math.max(0, MAX_PERSISTED_NOTIFICATIONS - visible.length));

  return [...visible, ...dismissed].sort(compareNotificationsNewestFirst);
}

function compareNotificationsNewestFirst(
  left: TaskNotificationRecord,
  right: TaskNotificationRecord,
): number {
  const createdAtCompare = right.createdAt.localeCompare(left.createdAt);
  if (createdAtCompare !== 0) return createdAtCompare;
  return left.notificationId.localeCompare(right.notificationId);
}

function normalizeStore(value: unknown): TaskNotificationStore {
  if (
    !isRecord(value)
    || value.schemaVersion !== STORE_SCHEMA_VERSION
    || !Array.isArray(value.notifications)
  ) {
    return emptyStore();
  }
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    notifications: value.notifications.flatMap((record) => {
      const normalized = normalizeRecord(record);
      return normalized ? [normalized] : [];
    }),
  };
}

function normalizeRecord(value: unknown): TaskNotificationRecord | null {
  if (!isRecord(value)) return null;

  const type = readNotificationType(value.type);
  const severity = readNotificationSeverity(value.severity);
  const notificationId = stringOrNull(value.notificationId);
  const dedupeKey = stringOrNull(value.dedupeKey);
  const taskId = stringOrNull(value.taskId);
  const createdAt = stringOrNull(value.createdAt);
  const message = stringOrNull(value.message);
  if (!type || !severity || !notificationId || !dedupeKey || !taskId || !createdAt || !message) {
    return null;
  }

  return {
    type,
    severity,
    notificationId,
    dedupeKey,
    taskId,
    taskGuid: nullableString(value.taskGuid),
    taskTitle: nullableString(value.taskTitle),
    taskFileName: nullableString(value.taskFileName),
    contextPackId: nullableString(value.contextPackId),
    contextPackDir: nullableString(value.contextPackDir),
    contextPackLabel: nullableString(value.contextPackLabel),
    archivePath: nullableString(value.archivePath),
    errorItemPath: nullableString(value.errorItemPath),
    createdAt,
    seenAt: nullableString(value.seenAt),
    dismissedAt: nullableString(value.dismissedAt),
    message,
  };
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const nullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const readNotificationType = (value: unknown): TaskNotificationRecord['type'] | null =>
  value === 'task-completed' || value === 'task-failed' ? value : null;

const readNotificationSeverity = (value: unknown): TaskNotificationRecord['severity'] | null =>
  value === 'success' || value === 'error' ? value : null;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function notificationIdForDedupeKey(dedupeKey: string): string {
  return sha256Hex(dedupeKey);
}

function canonicalDedupeKey(type: TaskNotificationRecord['type'], taskId: string): string {
  return `task:${taskId}:${type === 'task-completed' ? 'completed' : 'failed'}`;
}

function canonicalContextPackLabel(record: Pick<TaskNotificationRecord, 'contextPackId' | 'contextPackDir'>): string | null {
  return record.contextPackId ?? (record.contextPackDir ? path.basename(record.contextPackDir) : null);
}

function severityForType(type: TaskNotificationRecord['type']): TaskNotificationRecord['severity'] {
  return type === 'task-completed' ? 'success' : 'error';
}

function messageForRecord(
  type: TaskNotificationRecord['type'],
  taskLabel: string,
  contextPackLabel: string | null,
): string {
  const action = type === 'task-completed' ? 'completed' : 'failed';
  const context = contextPackLabel ? ` in ${contextPackLabel}` : '';
  return `Task ${taskLabel} ${action}${context}.`;
}

function hashForLog(value: string): string {
  return sha256Hex(value).slice(0, 12);
}

const isoNow = (now: Date | undefined): string => (now ?? new Date()).toISOString();
