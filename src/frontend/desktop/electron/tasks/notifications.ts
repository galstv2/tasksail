import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { basename } from 'node:path';
import { app, BrowserWindow, Notification } from 'electron';

import {
  DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL,
  type DesktopInvokeResult,
  type TaskNotificationMutationResponse,
} from '../../src/shared/desktopContract';
import { createLogger } from '../log/logger';
import { REPO_ROOT } from '../paths';
import { ensureDir, getErrorMessage } from '../../../../backend/platform/core';
import {
  dismissAllTaskNotifications as dismissAllTaskNotificationsInStore,
  dismissTaskNotification as dismissTaskNotificationInStore,
  markTaskNotificationsSeen as markTaskNotificationsSeenInStore,
  readTaskNotificationSnapshot,
  resolveTaskNotificationStoreDir,
} from '../../../../backend/platform/task-notifications/store.js';
import { subscribeTaskNotificationCreated } from '../../../../backend/platform/task-notifications/producer.js';
import type { TaskNotificationSnapshot as BackendTaskNotificationSnapshot } from '../../../../backend/platform/task-notifications/types.js';

type MarkSeenPayload = { notificationIds?: string[]; allVisible?: boolean };
type DismissPayload = { notificationId: string };

const log = createLogger('electron/main.taskNotifications');
const STORE_FILE_BASENAME = 'notifications.json';
const WATCH_DEBOUNCE_MS = 80;
const WATCH_RETRY_MS = 1000;

let lastBroadcastSignature: string | undefined;
let lastBroadcastIds = new Set<string>();
let badgeFailureModes = new Set<string>();
let watcherFailureCodes = new Set<string>();

export async function readTaskNotifications(): Promise<DesktopInvokeResult> {
  return ok(await readTaskNotificationSnapshot(REPO_ROOT));
}

export async function markTaskNotificationsSeen(
  payload: MarkSeenPayload = {},
): Promise<DesktopInvokeResult> {
  try {
    const snapshot = await markTaskNotificationsSeenInStore({
      repoRoot: REPO_ROOT,
      notificationIds: payload.notificationIds,
      allVisible: payload.allVisible,
    });
    broadcastSnapshot(snapshot);
    updateBadgeFromUnseenCount(snapshot.unseenCount);
    return mutationOk('taskNotifications.markSeen', snapshot);
  } catch (error) {
    return mutationError('taskNotifications.markSeen', error);
  }
}

export async function dismissTaskNotification(
  payload: DismissPayload,
): Promise<DesktopInvokeResult> {
  try {
    const snapshot = await dismissTaskNotificationInStore({
      repoRoot: REPO_ROOT,
      notificationId: payload.notificationId,
    });
    broadcastSnapshot(snapshot);
    updateBadgeFromUnseenCount(snapshot.unseenCount);
    return mutationOk('taskNotifications.dismiss', snapshot);
  } catch (error) {
    return mutationError('taskNotifications.dismiss', error);
  }
}

export async function dismissAllTaskNotifications(): Promise<DesktopInvokeResult> {
  try {
    const snapshot = await dismissAllTaskNotificationsInStore({ repoRoot: REPO_ROOT });
    broadcastSnapshot(snapshot);
    updateBadgeFromUnseenCount(snapshot.unseenCount);
    return mutationOk('taskNotifications.dismissAll', snapshot);
  } catch (error) {
    return mutationError('taskNotifications.dismissAll', error);
  }
}

export function sendTaskNotificationSnapshotToWindows(
  snapshot: BackendTaskNotificationSnapshot,
): void {
  const event = { type: 'snapshot' as const, snapshot };
  for (const win of BrowserWindow.getAllWindows()) {
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) continue;
    win.webContents.send(DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL, event);
  }
}

export function startTaskNotificationRuntime(): () => void {
  lastBroadcastSignature = undefined;
  lastBroadcastIds = new Set<string>();
  badgeFailureModes = new Set<string>();
  watcherFailureCodes = new Set<string>();

  let stopped = false;
  let watcher: fs.FSWatcher | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryScheduled = false;

  const clearDebounce = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = undefined;
  };

  const handleSnapshot = async (displayNativeForNewIds: boolean): Promise<boolean> => {
    const snapshot = await readTaskNotificationSnapshot(REPO_ROOT);
    const previousIds = new Set(lastBroadcastIds);
    const sent = broadcastSnapshot(snapshot);
    updateBadgeFromUnseenCount(snapshot.unseenCount);
    if (!displayNativeForNewIds || !sent) return sent;
    for (const record of snapshot.notifications) {
      if (!previousIds.has(record.notificationId)) {
        displayNativeAttentionSignal();
      }
    }
    return sent;
  };

  const attachWatcher = (): void => {
    if (stopped || watcher) return;
    try {
      watcher = fs.watch(resolveTaskNotificationStoreDir(REPO_ROOT), { persistent: false }, (_event, fileName) => {
        if (basename(String(fileName ?? '')) !== STORE_FILE_BASENAME) return;
        clearDebounce();
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          void handleSnapshot(true).catch((error: unknown) => {
            log.warn('task_notifications.store.watcher_snapshot_failed', { reason: getErrorMessage(error) });
          });
        }, WATCH_DEBOUNCE_MS);
      });
      watcher.on('error', (error) => {
        watcher = undefined;
        logWatcherFailure(error);
        scheduleRetry();
      });
    } catch (error) {
      watcher = undefined;
      logWatcherFailure(error);
      scheduleRetry();
    }
  };

  const scheduleRetry = (): void => {
    if (stopped || retryScheduled) return;
    retryScheduled = true;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      retryScheduled = false;
      attachWatcher();
    }, WATCH_RETRY_MS);
  };

  void (async () => {
    await ensureDir(resolveTaskNotificationStoreDir(REPO_ROOT));
    if (stopped) return;
    const snapshot = await readTaskNotificationSnapshot(REPO_ROOT);
    updateBadgeFromUnseenCount(snapshot.unseenCount);
    seedObservedIds(snapshot);
    broadcastSnapshot(snapshot);
    attachWatcher();
  })().catch((error: unknown) => {
    log.warn('task_notifications.runtime.start_failed', { reason: getErrorMessage(error) });
  });

  const unsubscribe = subscribeTaskNotificationCreated((event) => {
    const wasAlreadyObserved = lastBroadcastIds.has(event.record.notificationId);
    void handleSnapshot(false)
      .then((sent) => {
        if (sent && !wasAlreadyObserved && lastBroadcastIds.has(event.record.notificationId)) {
          displayNativeAttentionSignal();
        }
      })
      .catch((error: unknown) => {
        log.warn('task_notifications.created_snapshot_failed', { reason: getErrorMessage(error) });
      });
  });

  return () => {
    stopped = true;
    unsubscribe();
    clearDebounce();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    watcher?.close();
    watcher = undefined;
  };
}

function broadcastSnapshot(snapshot: BackendTaskNotificationSnapshot): boolean {
  const signature = snapshotSignature(snapshot);
  if (signature === lastBroadcastSignature) {
    return false;
  }
  lastBroadcastSignature = signature;
  lastBroadcastIds = idsForSnapshot(snapshot);
  sendTaskNotificationSnapshotToWindows(snapshot);
  return true;
}

function snapshotSignature(snapshot: BackendTaskNotificationSnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify({
      unseenCount: snapshot.unseenCount,
      items: snapshot.notifications.map((record) => ({
        id: record.notificationId,
        seenAt: record.seenAt,
        dismissedAt: record.dismissedAt,
      })),
    }))
    .digest('hex');
}

function seedObservedIds(snapshot: BackendTaskNotificationSnapshot): void {
  lastBroadcastIds = idsForSnapshot(snapshot);
}

function idsForSnapshot(snapshot: BackendTaskNotificationSnapshot): Set<string> {
  return new Set(snapshot.notifications.map((record) => record.notificationId));
}

function updateBadgeFromUnseenCount(unseenCount: number): void {
  const setBadgeCount = app.setBadgeCount;
  if (typeof setBadgeCount !== 'function') {
    logBadgeFailure('unsupported');
    return;
  }
  try {
    if (setBadgeCount.call(app, unseenCount) === false) {
      logBadgeFailure('returned-false');
    }
  } catch {
    logBadgeFailure('threw');
  }
}

function logBadgeFailure(mode: string): void {
  if (badgeFailureModes.has(mode)) return;
  badgeFailureModes.add(mode);
  log.warn('task_notifications.badge.update_failed', { mode });
}

function displayNativeAttentionSignal(): void {
  try {
    if (typeof Notification.isSupported !== 'function' || !Notification.isSupported()) return;
    new Notification({
      title: 'TaskSail',
      body: 'New notification available',
    }).show();
  } catch (error) {
    log.warn('task_notifications.native.display_failed', { reason: getErrorMessage(error) });
  }
}

function logWatcherFailure(error: unknown): void {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? 'unknown')
    : 'unknown';
  const errno = typeof error === 'object' && error !== null && 'errno' in error
    ? Number((error as { errno?: unknown }).errno)
    : null;
  const key = `${code}:${errno ?? ''}`;
  if (watcherFailureCodes.has(key)) return;
  watcherFailureCodes.add(key);
  log.warn('task_notifications.store.watcher_failed', { code, errno });
}

function ok(snapshot: BackendTaskNotificationSnapshot): DesktopInvokeResult {
  return { ok: true, response: snapshot as never };
}

function mutationOk(
  action: TaskNotificationMutationResponse['action'],
  snapshot: BackendTaskNotificationSnapshot,
): DesktopInvokeResult {
  return { ok: true, response: { ...snapshot, action, mode: 'updated' } };
}

function mutationError(action: string, error: unknown): DesktopInvokeResult {
  return { ok: false, action, error: getErrorMessage(error) };
}
