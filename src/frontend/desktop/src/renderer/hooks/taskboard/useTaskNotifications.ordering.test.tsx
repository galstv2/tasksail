// Deterministic ordering guard tests for useTaskNotifications.
// Each test forces explicit interleaving; no OS races are involved.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type {
  TaskNotificationMutationResponse,
  TaskNotificationRecord,
  TaskNotificationSnapshot,
} from '../../../shared/desktopContract';
import { ToastProvider } from '../../contexts/ToastContext';
import { createMockClient } from '../../../test';
import { useTaskNotifications } from './useTaskNotifications';

afterEach(() => {
  cleanup();
});

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <ToastProvider>{children}</ToastProvider>;
}

function makeRecord(overrides: Partial<TaskNotificationRecord> = {}): TaskNotificationRecord {
  return {
    notificationId: 'n-1',
    dedupeKey: 'task-completed:TASK-1',
    type: 'task-completed',
    severity: 'success',
    taskId: 'TASK-1',
    taskGuid: 'guid-1',
    taskTitle: 'Ship ordering guard',
    taskFileName: 'task.md',
    contextPackId: 'orders-estate',
    contextPackDir: '/packs/orders',
    contextPackLabel: 'Orders Estate',
    archivePath: '/archive/task.md',
    errorItemPath: null,
    createdAt: '2026-05-25T10:00:00.000Z',
    seenAt: null,
    dismissedAt: null,
    message: 'Task completed.',
    ...overrides,
  };
}

function makeSnapshot(
  notifications: TaskNotificationRecord[],
  unseenCount?: number,
): TaskNotificationSnapshot {
  return {
    action: 'taskNotifications.read',
    mode: 'read-only',
    unseenCount: unseenCount ?? notifications.filter((n) => n.seenAt === null).length,
    notifications,
    generatedAt: '2026-05-25T10:01:00.000Z',
    message: 'Loaded notifications.',
  };
}

function makeMutation(
  action: TaskNotificationMutationResponse['action'],
  notifications: TaskNotificationRecord[],
  unseenCount?: number,
): TaskNotificationMutationResponse {
  return {
    action,
    mode: 'updated',
    unseenCount: unseenCount ?? notifications.filter((n) => n.seenAt === null).length,
    notifications,
    generatedAt: '2026-05-25T10:02:00.000Z',
    message: 'Updated notifications.',
  };
}

describe('useTaskNotifications ordering guard (R19)', () => {
  it('refresh A (older) does not overwrite refresh B (newer) that resolved first', async () => {
    // Explicitly interleave A and B so the older completion cannot win.
    let resolveRefreshA!: (v: unknown) => void;
    const refreshAPromise = new Promise((resolve) => { resolveRefreshA = resolve; });

    const twoRecords = [
      makeRecord({ notificationId: 'n-B-1', seenAt: null }),
      makeRecord({ notificationId: 'n-B-2', seenAt: null }),
    ];
    const oneRecord = makeRecord({ notificationId: 'n-A-old', seenAt: null });

    const client = createMockClient({
      readTaskNotifications: vi.fn()
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot([]) })
        .mockReturnValueOnce(refreshAPromise)
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot(twoRecords, 2) }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(0));

    let refreshADone = false;
    act(() => {
      void result.current.refresh().then(() => { refreshADone = true; });
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unseenCount).toBe(2);

    await act(async () => {
      resolveRefreshA({ ok: true, response: makeSnapshot([oneRecord], 1) });
    });
    await waitFor(() => expect(refreshADone).toBe(true));

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unseenCount).toBe(2);
    expect(result.current.notifications.map((n) => n.notificationId)).toContain('n-B-1');
    expect(result.current.notifications.map((n) => n.notificationId)).not.toContain('n-A-old');
  });

  it('older refresh does not overwrite a newer push snapshot', async () => {
    let resolveStaleRefresh!: (v: unknown) => void;
    const staleRefreshPromise = new Promise((resolve) => {
      resolveStaleRefresh = resolve;
    });

    let pushListener: Parameters<
      NonNullable<ReturnType<typeof createMockClient>['onTaskNotificationsUpdate']>
    >[0] | null = null;

    const client = createMockClient({
      readTaskNotifications: vi.fn()
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot([]) })
        .mockReturnValueOnce(staleRefreshPromise),
      onTaskNotificationsUpdate: vi.fn((callback) => {
        pushListener = callback;
        return vi.fn();
      }),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(0));

    let refreshDone = false;
    act(() => {
      void result.current.refresh().then(() => { refreshDone = true; });
    });

    const pushRecords = [
      makeRecord({ notificationId: 'n-push-1', seenAt: null }),
      makeRecord({ notificationId: 'n-push-2', seenAt: null }),
      makeRecord({ notificationId: 'n-push-3', seenAt: null }),
    ];
    act(() => {
      pushListener?.({ type: 'snapshot', snapshot: makeSnapshot(pushRecords, 3) });
    });

    expect(result.current.unseenCount).toBe(3);
    expect(result.current.notifications).toHaveLength(3);

    const staleRecord = makeRecord({ notificationId: 'n-old-1', seenAt: null });
    await act(async () => {
      resolveStaleRefresh({ ok: true, response: makeSnapshot([staleRecord], 1) });
    });
    await waitFor(() => expect(refreshDone).toBe(true));

    expect(result.current.unseenCount).toBe(3);
    expect(result.current.notifications).toHaveLength(3);
    expect(result.current.notifications.map((n) => n.notificationId)).toContain('n-push-1');
  });

  it('older refresh does not overwrite a newer mutation result', async () => {
    let resolveStaleRefresh!: (v: unknown) => void;
    const staleRefreshPromise = new Promise((resolve) => {
      resolveStaleRefresh = resolve;
    });

    const initialRecords = [
      makeRecord({ notificationId: 'n-1', seenAt: null }),
      makeRecord({ notificationId: 'n-2', seenAt: null }),
    ];

    const client = createMockClient({
      readTaskNotifications: vi.fn()
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot(initialRecords, 2) })
        .mockReturnValueOnce(staleRefreshPromise),
      dismissAllTaskNotifications: vi.fn().mockResolvedValue({
        ok: true,
        response: makeMutation('taskNotifications.dismissAll', [], 0),
      }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(2));

    let refreshDone = false;
    act(() => {
      void result.current.refresh().then(() => { refreshDone = true; });
    });

    await act(async () => {
      await result.current.dismissAll();
    });

    expect(result.current.unseenCount).toBe(0);
    expect(result.current.notifications).toHaveLength(0);

    await act(async () => {
      resolveStaleRefresh({ ok: true, response: makeSnapshot(initialRecords, 2) });
    });
    await waitFor(() => expect(refreshDone).toBe(true));

    expect(result.current.unseenCount).toBe(0);
    expect(result.current.notifications).toHaveLength(0);
  });

  it('a push arriving after a refresh still applies correctly', async () => {
    let pushListener: Parameters<
      NonNullable<ReturnType<typeof createMockClient>['onTaskNotificationsUpdate']>
    >[0] | null = null;

    const client = createMockClient({
      readTaskNotifications: vi.fn()
        .mockResolvedValue({ ok: true, response: makeSnapshot([makeRecord()], 1) }),
      onTaskNotificationsUpdate: vi.fn((callback) => {
        pushListener = callback;
        return vi.fn();
      }),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(1));

    const pushRecords = [
      makeRecord({ notificationId: 'n-push-1', seenAt: null }),
      makeRecord({ notificationId: 'n-push-2', seenAt: null }),
    ];
    act(() => {
      pushListener?.({ type: 'snapshot', snapshot: makeSnapshot(pushRecords, 2) });
    });

    expect(result.current.unseenCount).toBe(2);
    expect(result.current.notifications).toHaveLength(2);
  });

  it('multiple in-order refreshes without interleaved pushes all apply', async () => {
    const client = createMockClient({
      readTaskNotifications: vi.fn()
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot([], 0) })
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot([makeRecord()], 1) })
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot([makeRecord(), makeRecord({ notificationId: 'n-2' })], 2) }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(0));

    await act(async () => { await result.current.refresh(); });
    expect(result.current.unseenCount).toBe(1);

    await act(async () => { await result.current.refresh(); });
    expect(result.current.unseenCount).toBe(2);
  });
});
