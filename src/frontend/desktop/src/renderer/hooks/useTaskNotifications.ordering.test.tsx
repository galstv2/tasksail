// Deterministic ordering guard tests for useTaskNotifications (Track G / R19).
// Each test forces explicit interleaving; no OS races are involved.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type {
  TaskNotificationMutationResponse,
  TaskNotificationRecord,
  TaskNotificationSnapshot,
} from '../../shared/desktopContract';
import { ToastProvider } from '../contexts/ToastContext';
import { createMockClient } from '../../test';
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
    // Scenario: refresh A is started, then refresh B is started; B resolves first with
    // 2 notifications; A resolves later with 1 older notification. A must be discarded.
    let resolveRefreshA!: (v: unknown) => void;
    const refreshAPromise = new Promise((resolve) => { resolveRefreshA = resolve; });

    const twoRecords = [
      makeRecord({ notificationId: 'n-B-1', seenAt: null }),
      makeRecord({ notificationId: 'n-B-2', seenAt: null }),
    ];
    const oneRecord = makeRecord({ notificationId: 'n-A-old', seenAt: null });

    const client = createMockClient({
      readTaskNotifications: vi.fn()
        // Initial mount refresh — resolves immediately with 0 items.
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot([]) })
        // Refresh A — deferred.
        .mockReturnValueOnce(refreshAPromise)
        // Refresh B — resolves immediately with 2 items.
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot(twoRecords, 2) }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(0));

    // Start refresh A (stays pending).
    let refreshADone = false;
    act(() => {
      void result.current.refresh().then(() => { refreshADone = true; });
    });

    // Start refresh B and resolve it immediately with 2 notifications.
    await act(async () => {
      await result.current.refresh();
    });

    // Refresh B has landed.
    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unseenCount).toBe(2);

    // Now resolve refresh A with 1 stale notification.
    await act(async () => {
      resolveRefreshA({ ok: true, response: makeSnapshot([oneRecord], 1) });
    });
    await waitFor(() => expect(refreshADone).toBe(true));

    // Refresh B's state must survive — refresh A (older seq) must have been discarded.
    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unseenCount).toBe(2);
    expect(result.current.notifications.map((n) => n.notificationId)).toContain('n-B-1');
    expect(result.current.notifications.map((n) => n.notificationId)).not.toContain('n-A-old');
  });

  it('older refresh does not overwrite a newer push snapshot', async () => {
    // The push snapshot has 3 unseen notifications. The stale refresh has 1.
    // The push must win.

    let resolveStaleRefresh!: (v: unknown) => void;
    const staleRefreshPromise = new Promise((resolve) => {
      resolveStaleRefresh = resolve;
    });

    let pushListener: Parameters<
      NonNullable<ReturnType<typeof createMockClient>['onTaskNotificationsUpdate']>
    >[0] | null = null;

    const client = createMockClient({
      readTaskNotifications: vi.fn()
        // Initial mount refresh resolves immediately with 0 items.
        .mockResolvedValueOnce({ ok: true, response: makeSnapshot([]) })
        // Second explicit refresh is deferred — will resolve after push.
        .mockReturnValueOnce(staleRefreshPromise),
      onTaskNotificationsUpdate: vi.fn((callback) => {
        pushListener = callback;
        return vi.fn();
      }),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    // Wait for initial load.
    await waitFor(() => expect(result.current.unseenCount).toBe(0));

    // Kick off a stale refresh (will stay pending until we resolve it below).
    let refreshDone = false;
    act(() => {
      void result.current.refresh().then(() => { refreshDone = true; });
    });

    // Deliver a push snapshot with 3 unseen while the refresh is still in flight.
    const pushRecords = [
      makeRecord({ notificationId: 'n-push-1', seenAt: null }),
      makeRecord({ notificationId: 'n-push-2', seenAt: null }),
      makeRecord({ notificationId: 'n-push-3', seenAt: null }),
    ];
    act(() => {
      pushListener?.({ type: 'snapshot', snapshot: makeSnapshot(pushRecords, 3) });
    });

    // Verify push landed.
    expect(result.current.unseenCount).toBe(3);
    expect(result.current.notifications).toHaveLength(3);

    // Now resolve the stale refresh with 1 older notification.
    const staleRecord = makeRecord({ notificationId: 'n-old-1', seenAt: null });
    await act(async () => {
      resolveStaleRefresh({ ok: true, response: makeSnapshot([staleRecord], 1) });
    });
    await waitFor(() => expect(refreshDone).toBe(true));

    // The push must not have been overwritten — 3 items remain.
    expect(result.current.unseenCount).toBe(3);
    expect(result.current.notifications).toHaveLength(3);
    expect(result.current.notifications.map((n) => n.notificationId)).toContain('n-push-1');
  });

  it('older refresh does not overwrite a newer mutation result', async () => {
    // The mutation dismisses all (0 unseen). The stale refresh sees 2 unseen.
    // The mutation must win.

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
        // Deferred refresh started just before the dismiss mutation.
        .mockReturnValueOnce(staleRefreshPromise),
      dismissAllTaskNotifications: vi.fn().mockResolvedValue({
        ok: true,
        response: makeMutation('taskNotifications.dismissAll', [], 0),
      }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(2));

    // Start the stale refresh (pending).
    let refreshDone = false;
    act(() => {
      void result.current.refresh().then(() => { refreshDone = true; });
    });

    // Run the dismiss-all mutation while refresh is in flight.
    await act(async () => {
      await result.current.dismissAll();
    });

    // Mutation has landed: 0 unseen.
    expect(result.current.unseenCount).toBe(0);
    expect(result.current.notifications).toHaveLength(0);

    // Resolve the stale refresh with the old 2-item snapshot.
    await act(async () => {
      resolveStaleRefresh({ ok: true, response: makeSnapshot(initialRecords, 2) });
    });
    await waitFor(() => expect(refreshDone).toBe(true));

    // Mutation result must survive — 0 unseen still.
    expect(result.current.unseenCount).toBe(0);
    expect(result.current.notifications).toHaveLength(0);
  });

  it('a push arriving after a refresh still applies correctly', async () => {
    // Normal ordering: refresh lands first, then a push arrives with newer data.
    // Both must apply in order.

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

    // Deliver a push with 2 records.
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
    // No push interference: two sequential refreshes both apply their results.
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
