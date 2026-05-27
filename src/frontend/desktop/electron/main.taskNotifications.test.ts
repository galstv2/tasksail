// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskNotificationRecord } from '../../../backend/platform/task-notifications/types.js';

const state = vi.hoisted(() => ({
  repoRoot: '',
  send: vi.fn(),
  getAllWindows: vi.fn(),
  setBadgeCount: vi.fn(() => true),
  notificationSupported: true,
  notificationShow: vi.fn(),
  notificationConstructor: vi.fn(function NotificationMock(this: { show: () => void }) {
    this.show = state.notificationShow;
  }),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('electron', () => {
  (state.notificationConstructor as typeof state.notificationConstructor & { isSupported: () => boolean }).isSupported =
    vi.fn(() => state.notificationSupported);
  return {
    app: { setBadgeCount: state.setBadgeCount },
    BrowserWindow: { getAllWindows: state.getAllWindows },
    Notification: state.notificationConstructor,
  };
});

vi.mock('./paths', () => ({
  get REPO_ROOT() {
    return state.repoRoot;
  },
  get DESKTOP_ROOT() {
    return `${state.repoRoot}/src/frontend/desktop`;
  },
}));

vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({
    warn: state.logWarn,
    info: state.logInfo,
    error: state.logError,
    debug: vi.fn(),
    child: vi.fn(() => ({
      warn: state.logWarn,
      info: state.logInfo,
      error: state.logError,
      debug: vi.fn(),
    })),
  })),
  installProcessHandlers: vi.fn(() => vi.fn()),
}));

describe('main task notifications', () => {
  const stops: Array<() => void> = [];

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('node:fs');
    vi.useRealTimers();
    state.repoRoot = mkdtempSync(path.join(tmpdir(), 'tasksail-main-notifications-'));
    state.send.mockReset();
    state.getAllWindows.mockReturnValue([{
      isDestroyed: () => false,
      webContents: { send: state.send },
    }]);
    state.setBadgeCount.mockReset();
    state.setBadgeCount.mockReturnValue(true);
    state.notificationSupported = true;
    state.notificationShow.mockReset();
    state.notificationConstructor.mockClear();
    state.logWarn.mockReset();
    state.logInfo.mockReset();
    state.logError.mockReset();
    stops.length = 0;
  });

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.useRealTimers();
    rmSync(state.repoRoot, { recursive: true, force: true });
  });

  it('taskNotifications.read returns a snapshot from the backend store', async () => {
    await createNotification('task-1');
    const { readTaskNotifications } = await import('./main.taskNotifications');

    const result = await readTaskNotifications();

    expect(result).toMatchObject({
      ok: true,
      response: {
        action: 'taskNotifications.read',
        unseenCount: 1,
      },
    });
  });

  it('markSeen, dismiss, and dismissAll return updated snapshots and broadcast them', async () => {
    const first = await createNotification('task-1');
    const second = await createNotification('task-2');
    const mod = await import('./main.taskNotifications');

    const seen = await mod.markTaskNotificationsSeen({ allVisible: true });
    const dismissed = await mod.dismissTaskNotification({ notificationId: first.notificationId });
    const dismissedAll = await mod.dismissAllTaskNotifications();

    expect(seen).toMatchObject({ ok: true, response: { unseenCount: 0 } });
    expect(dismissed).toMatchObject({ ok: true, response: { notifications: [expect.objectContaining({ notificationId: second.notificationId })] } });
    expect(dismissedAll).toMatchObject({ ok: true, response: { notifications: [] } });
    expect(state.send).toHaveBeenCalledTimes(3);
    expect(state.setBadgeCount).toHaveBeenLastCalledWith(0);
    expect(state.notificationConstructor).not.toHaveBeenCalled();
  });

  it('startup broadcasts the initial snapshot, updates the badge, and does not show native notifications', async () => {
    await createNotification('task-1');
    const { startTaskNotificationRuntime } = await import('./main.taskNotifications');

    stops.push(startTaskNotificationRuntime());
    await waitFor(() => state.send.mock.calls.length === 1);

    expect(state.send.mock.calls[0]?.[1]).toMatchObject({
      type: 'snapshot',
      snapshot: { unseenCount: 1 },
    });
    expect(state.setBadgeCount).toHaveBeenCalledWith(1);
    expect(state.notificationConstructor).not.toHaveBeenCalled();
  });

  it('broadcasts the startup snapshot again after runtime restart', async () => {
    await createNotification('task-1');
    const { startTaskNotificationRuntime } = await import('./main.taskNotifications');

    const firstStop = startTaskNotificationRuntime();
    await waitFor(() => state.send.mock.calls.length === 1);
    firstStop();
    state.send.mockClear();
    state.notificationConstructor.mockClear();

    stops.push(startTaskNotificationRuntime());
    await waitFor(() => state.send.mock.calls.length === 1);

    expect(state.send.mock.calls[0]?.[1]).toMatchObject({
      type: 'snapshot',
      snapshot: { unseenCount: 1 },
    });
    expect(state.notificationConstructor).not.toHaveBeenCalled();
  });

  it('deduplicates an in-process created event against the store watcher and shows one generic native notification', async () => {
    const { startTaskNotificationRuntime } = await import('./main.taskNotifications');
    stops.push(startTaskNotificationRuntime());
    await waitFor(() => state.send.mock.calls.length === 1);
    state.send.mockClear();

    const producer = await import('../../../backend/platform/task-notifications/producer.js');
    await producer.recordTaskCompletedNotification({
      repoRoot: state.repoRoot,
      taskId: 'task-1',
    });

    await waitFor(() => state.send.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.notificationConstructor).toHaveBeenCalledTimes(1);
    expect(state.notificationConstructor).toHaveBeenCalledWith({
      title: 'TaskSail',
      body: 'New notification available',
    });
    expect(state.notificationShow).toHaveBeenCalledTimes(1);
    expect(state.setBadgeCount).toHaveBeenLastCalledWith(1);
  });

  it('store watcher observes cross-process-style writes and signals only newly observed ids', async () => {
    await createNotification('task-1');
    const { startTaskNotificationRuntime } = await import('./main.taskNotifications');
    stops.push(startTaskNotificationRuntime());
    await waitFor(() => state.send.mock.calls.length === 1);
    state.send.mockClear();
    state.notificationConstructor.mockClear();

    await createNotification('task-2');

    await waitFor(() => state.send.mock.calls.length === 1);
    expect(state.send.mock.calls[0]?.[1]).toMatchObject({
      type: 'snapshot',
      snapshot: { unseenCount: 2 },
    });
    expect(state.notificationConstructor).toHaveBeenCalledTimes(1);
    expect(state.setBadgeCount).toHaveBeenLastCalledWith(2);
  });

  it('logs native and badge display failures without rejecting producer or IPC paths', async () => {
    state.setBadgeCount.mockImplementation(() => {
      throw new Error('badge failed');
    });
    state.notificationConstructor.mockImplementation(function NotificationMock(this: { show: () => void }) {
      this.show = () => {
        throw new Error('native failed');
      };
    });
    const { startTaskNotificationRuntime, markTaskNotificationsSeen } = await import('./main.taskNotifications');
    stops.push(startTaskNotificationRuntime());
    await waitFor(() => state.logWarn.mock.calls.some(([event]) => event === 'task_notifications.badge.update_failed'));

    const producer = await import('../../../backend/platform/task-notifications/producer.js');
    await expect(producer.recordTaskCompletedNotification({ repoRoot: state.repoRoot, taskId: 'task-1' })).resolves.toBeTruthy();
    await waitFor(() => state.logWarn.mock.calls.some(([event]) => event === 'task_notifications.native.display_failed'));
    await expect(markTaskNotificationsSeen({ allVisible: true })).resolves.toMatchObject({ ok: true });
  });

  it('retries watcher attach once after logging errno and code only', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const on = vi.fn();
    const watchMock = vi.fn()
      .mockImplementationOnce(() => {
        const error = new Error('missing') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        error.errno = -2;
        throw error;
      })
      .mockReturnValue({ close, on });
    vi.doMock('node:fs', async (importOriginal) => ({
      ...await importOriginal<typeof import('node:fs')>(),
      watch: watchMock,
    }));

    const { startTaskNotificationRuntime } = await import('./main.taskNotifications');
    const stop = startTaskNotificationRuntime();
    stops.push(stop);
    await vi.waitFor(() => {
      expect(watchMock).toHaveBeenCalledTimes(1);
    });

    expect(state.logWarn).toHaveBeenCalledWith('task_notifications.store.watcher_failed', {
      code: 'ENOENT',
      errno: -2,
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(watchMock).toHaveBeenCalledTimes(2);
    stop();
    expect(close).toHaveBeenCalled();
  });

  it('registers default handlers and routes the four notification actions', async () => {
    const handlers = await import('./main.desktopActionHandlers');
    const router = await import('./main.desktopActionRouter');
    const defaults = handlers.createDefaultDesktopActionHandlers();

    expect(defaults.readTaskNotifications).toEqual(expect.any(Function));
    expect(defaults.markTaskNotificationsSeen).toEqual(expect.any(Function));
    expect(defaults.dismissTaskNotification).toEqual(expect.any(Function));
    expect(defaults.dismissAllTaskNotifications).toEqual(expect.any(Function));

    const readTaskNotifications = vi.fn(async () => ({ ok: true, response: { action: 'taskNotifications.read' } }) as never);
    const markTaskNotificationsSeen = vi.fn(async () => ({ ok: true, response: { action: 'taskNotifications.read' } }) as never);
    const dismissTaskNotification = vi.fn(async () => ({ ok: true, response: { action: 'taskNotifications.read' } }) as never);
    const dismissAllTaskNotifications = vi.fn(async () => ({ ok: true, response: { action: 'taskNotifications.read' } }) as never);

    await router.handleDesktopAction({ action: 'taskNotifications.read' }, { readTaskNotifications });
    await router.handleDesktopAction(
      { action: 'taskNotifications.markSeen', payload: { notificationIds: ['n1'], allVisible: false } },
      { markTaskNotificationsSeen },
    );
    await router.handleDesktopAction(
      { action: 'taskNotifications.dismiss', payload: { notificationId: 'n1' } },
      { dismissTaskNotification },
    );
    await router.handleDesktopAction({ action: 'taskNotifications.dismissAll' }, { dismissAllTaskNotifications });

    expect(readTaskNotifications).toHaveBeenCalledTimes(1);
    expect(markTaskNotificationsSeen).toHaveBeenCalledWith({ notificationIds: ['n1'], allVisible: false });
    expect(dismissTaskNotification).toHaveBeenCalledWith({ notificationId: 'n1' });
    expect(dismissAllTaskNotifications).toHaveBeenCalledTimes(1);
  });
});

async function createNotification(taskId: string): Promise<TaskNotificationRecord> {
  const store = await import('../../../backend/platform/task-notifications/store.js');
  const record = await store.recordTaskNotification({
    repoRoot: state.repoRoot,
    record: {
      dedupeKey: `task:${taskId}:completed`,
      type: 'task-completed',
      severity: 'success',
      taskId,
      taskGuid: null,
      taskTitle: `Task ${taskId}`,
      taskFileName: `${taskId}.md`,
      contextPackId: null,
      contextPackDir: null,
      contextPackLabel: null,
      archivePath: null,
      errorItemPath: null,
      message: 'Task notification pending.',
    },
  });
  if (!record) throw new Error(`Duplicate test record: ${taskId}`);
  return record;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1200): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
