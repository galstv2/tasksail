import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type {
  TaskNotificationMutationResponse,
  TaskNotificationRecord,
  TaskNotificationSnapshot,
} from '../../shared/desktopContract';
import { ToastProvider } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { createMockClient } from '../../test';
import { useTaskNotifications } from './useTaskNotifications';

afterEach(() => {
  cleanup();
});

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <ToastProvider>{children}</ToastProvider>;
}

function notification(
  overrides: Partial<TaskNotificationRecord> = {},
): TaskNotificationRecord {
  return {
    notificationId: 'n-1',
    dedupeKey: 'task-completed:TASK-1',
    type: 'task-completed',
    severity: 'success',
    taskId: 'TASK-1',
    taskGuid: 'guid-1',
    taskTitle: 'Ship notification center',
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

function snapshot(
  notifications: TaskNotificationRecord[],
  unseenCount = notifications.filter((record) => record.seenAt === null).length,
): TaskNotificationSnapshot {
  return {
    action: 'taskNotifications.read',
    mode: 'read-only',
    unseenCount,
    notifications,
    generatedAt: '2026-05-25T10:01:00.000Z',
    message: 'Loaded task notifications.',
  };
}

function mutation(
  action: TaskNotificationMutationResponse['action'],
  notifications: TaskNotificationRecord[],
  unseenCount = notifications.filter((record) => record.seenAt === null).length,
): TaskNotificationMutationResponse {
  return {
    action,
    mode: 'updated',
    unseenCount,
    notifications,
    generatedAt: '2026-05-25T10:02:00.000Z',
    message: 'Updated task notifications.',
  };
}

describe('useTaskNotifications', () => {
  it('loads the initial snapshot and computes the 99+ count label', async () => {
    const client = createMockClient({
      readTaskNotifications: vi.fn().mockResolvedValue({
        ok: true,
        response: snapshot([notification()], 120),
      }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });

    await waitFor(() => {
      expect(result.current.unseenCount).toBe(120);
    });
    expect(result.current.countLabel).toBe('99+');
    expect(result.current.notifications).toHaveLength(1);
  });

  it('subscribes to push snapshots and updates rows across context packs', async () => {
    let listener: Parameters<NonNullable<DesktopShellClient['onTaskNotificationsUpdate']>>[0] | null = null;
    const client = createMockClient({
      readTaskNotifications: vi.fn().mockResolvedValue({
        ok: true,
        response: snapshot([]),
      }),
      onTaskNotificationsUpdate: vi.fn((callback) => {
        listener = callback;
        return vi.fn();
      }),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(0));

    act(() => {
      listener?.({
        type: 'snapshot',
        snapshot: snapshot([
          notification({ notificationId: 'n-1', contextPackLabel: 'Orders Estate' }),
          notification({ notificationId: 'n-2', contextPackLabel: 'Billing Estate' }),
        ], 2),
      });
    });

    expect(result.current.unseenCount).toBe(2);
    expect(result.current.notifications.map((record) => record.contextPackLabel)).toEqual([
      'Orders Estate',
      'Billing Estate',
    ]);
  });

  it('opens the panel and marks visible notifications seen', async () => {
    const seen = notification({ seenAt: '2026-05-25T10:03:00.000Z' });
    const client = createMockClient({
      readTaskNotifications: vi.fn().mockResolvedValue({
        ok: true,
        response: snapshot([notification()], 1),
      }),
      markTaskNotificationsSeen: vi.fn().mockResolvedValue({
        ok: true,
        response: mutation('taskNotifications.markSeen', [seen], 0),
      }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(1));

    await act(async () => {
      await result.current.openPanel();
    });

    expect(result.current.isOpen).toBe(true);
    expect(client.markTaskNotificationsSeen).toHaveBeenCalledWith({ allVisible: true });
    expect(result.current.unseenCount).toBe(0);
    expect(result.current.notifications[0].seenAt).toBe('2026-05-25T10:03:00.000Z');
  });

  it('shows an error toast and refreshes when mark-seen fails', async () => {
    const client = createMockClient({
      readTaskNotifications: vi.fn()
        .mockResolvedValueOnce({ ok: true, response: snapshot([notification()], 1) })
        .mockResolvedValueOnce({ ok: true, response: snapshot([notification()], 1) })
        .mockResolvedValueOnce({ ok: true, response: snapshot([notification()], 1) }),
      markTaskNotificationsSeen: vi.fn().mockResolvedValue({
        ok: false,
        error: 'IPC failed.',
      }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.unseenCount).toBe(1));

    await act(async () => {
      await result.current.openPanel();
    });

    await waitFor(() => {
      expect(document.body).toHaveTextContent('IPC failed.');
    });
    expect(client.readTaskNotifications).toHaveBeenCalledTimes(3);
  });

  it('dismisses one row, dismisses all rows, and refreshes snapshots', async () => {
    const second = notification({ notificationId: 'n-2', taskId: 'TASK-2' });
    const client = createMockClient({
      readTaskNotifications: vi.fn().mockResolvedValue({
        ok: true,
        response: snapshot([notification(), second], 2),
      }),
      dismissTaskNotification: vi.fn().mockResolvedValue({
        ok: true,
        response: mutation('taskNotifications.dismiss', [second], 1),
      }),
      dismissAllTaskNotifications: vi.fn().mockResolvedValue({
        ok: true,
        response: mutation('taskNotifications.dismissAll', [], 0),
      }),
      onTaskNotificationsUpdate: vi.fn().mockReturnValue(vi.fn()),
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    await act(async () => {
      await result.current.dismiss('n-1');
    });
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unseenCount).toBe(1);

    await act(async () => {
      await result.current.dismissAll();
    });
    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unseenCount).toBe(0);
  });

  it('handles older mocks without notification methods or task-board lifecycle calls', async () => {
    const client = createMockClient({
      readTaskNotifications: undefined,
      markTaskNotificationsSeen: undefined,
      dismissTaskNotification: undefined,
      dismissAllTaskNotifications: undefined,
      onTaskNotificationsUpdate: undefined,
    });

    const { result } = renderHook(() => useTaskNotifications(client), { wrapper });

    await waitFor(() => {
      expect(document.body.textContent).toContain('Task notifications are unavailable');
    });

    await act(async () => {
      await result.current.openPanel();
      await result.current.dismiss('n-1');
      await result.current.dismissAll();
    });

    expect(client.readTaskBoard).not.toHaveBeenCalled();
    expect(client.moveToPending).not.toHaveBeenCalled();
    expect(client.moveToOpen).not.toHaveBeenCalled();
    expect(client.killTask).not.toHaveBeenCalled();
  });
});
