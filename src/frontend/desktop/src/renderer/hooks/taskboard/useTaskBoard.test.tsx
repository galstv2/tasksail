// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskBoardReadBoardResponse } from '../../../shared/desktopContract';
import { ToastProvider } from '../../contexts/ToastContext';
import { createMockClient } from '../../../test';
import { useTaskBoard } from './useTaskBoard';

beforeEach(() => {
  vi.mocked(window.desktopShell.log.emit).mockClear();
});

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('useTaskBoard', () => {
  it('applies push updates when only completed items change', async () => {
    let pushBoardUpdate: ((response: TaskBoardReadBoardResponse) => void) | null = null;
    window.desktopShell.onTaskBoardUpdate = vi.fn((callback) => {
      pushBoardUpdate = callback;
      return vi.fn();
    });
    const client = createMockClient({
      readTaskBoard: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 0 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 1,
          dropboxItems: [],
          pendingItems: [],
          errorItems: [],
          completedItems: [],
        },
      }),
    });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(pushBoardUpdate).not.toBeNull());

    act(() => {
      pushBoardUpdate?.({
        action: 'taskBoard.readBoard',
        mode: 'read-only',
        message: '0 open, 0 pending, 0 failed, 1 completed.',
        boardSnapshotSequence: 2,
        dropboxItems: [],
        pendingItems: [],
        errorItems: [],
        completedItems: [
          {
            taskId: 'TASK-DONE',
            title: 'Completed task',
            summary: '',
            rootTaskId: 'TASK-DONE',
            qmdRecordId: 'task:pack:TASK-DONE',
            followupReason: '',
            year: '2026',
            archivePath: '/archive/TASK-DONE/archive.md',
            archivedAt: '2026-05-23T03:58:37Z',
            contextPackName: 'pack',
          },
        ],
      });
    });

    expect(result.current.board.completedItems.map((item) => item.taskId)).toEqual(['TASK-DONE']);
  });

  it('forwards the optional artifact path and maps found/not-found readTaskContent responses', async () => {
    const artifacts = [
      { relativePath: 'archive.md', label: 'archive.md', sizeBytes: 10 },
      { relativePath: 'handoffs/final-summary.md', label: 'handoffs/final-summary.md', sizeBytes: 20 },
    ];
    const readTaskContent = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'taskBoard.readTaskContent',
          mode: 'found',
          message: 'Read DONE-A.md.',
          content: '# Archive',
          fileName: 'DONE-A.md',
          artifactRelativePath: 'handoffs/final-summary.md',
          artifacts,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'taskBoard.readTaskContent',
          mode: 'not-found',
          message: 'DONE-A.md not found.',
          content: '',
          fileName: 'DONE-A.md',
        },
      });
    const client = createMockClient({ readTaskContent });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });

    const found = await result.current.readTaskContent('DONE-A.md', 'completed', 'handoffs/final-summary.md');
    expect(readTaskContent).toHaveBeenCalledWith('DONE-A.md', 'completed', 'handoffs/final-summary.md');
    expect(found).toEqual({ content: '# Archive', artifactRelativePath: 'handoffs/final-summary.md', artifacts });

    const missing = await result.current.readTaskContent('DONE-A.md', 'completed');
    expect(readTaskContent).toHaveBeenLastCalledWith('DONE-A.md', 'completed', undefined);
    expect(missing).toBeNull();
  });

  it('returns null and surfaces a toast when readTaskContent IPC rejects', async () => {
    const readTaskContent = vi.fn().mockRejectedValue(new Error('read IPC failed'));
    const client = createMockClient({ readTaskContent });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });

    let outcome: Awaited<ReturnType<typeof result.current.readTaskContent>> | undefined;
    await act(async () => {
      outcome = await result.current.readTaskContent('DONE-A.md', 'completed');
    });
    expect(outcome).toBeNull();
  });

  it('forwards readChildChainBranchInventory and returns the typed response', async () => {
    const loaded = {
      ok: true,
      response: {
        action: 'taskBoard.readChildChainBranchInventory',
        mode: 'loaded',
        message: 'Loaded.',
        inventory: {
          schemaVersion: 1,
          rootTaskId: 'ROOT-1',
          selectedTaskId: 'CHILD-1',
          currentTipTaskId: 'CHILD-1',
          taskCount: 1,
          rows: [],
          generatedAt: '2026-05-30T00:00:00.000Z',
        },
      },
    };
    const readChildChainBranchInventory = vi.fn().mockResolvedValue(loaded);
    const client = createMockClient({ readChildChainBranchInventory });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });

    const response = await result.current.readChildChainBranchInventory('CHILD-1', 'ROOT-1');
    expect(readChildChainBranchInventory).toHaveBeenCalledWith('CHILD-1', 'ROOT-1');
    expect(response).toEqual(loaded.response);
  });

  it('returns null and surfaces a toast when readChildChainBranchInventory IPC rejects', async () => {
    const readChildChainBranchInventory = vi.fn().mockRejectedValue(new Error('inventory IPC failed'));
    const client = createMockClient({ readChildChainBranchInventory });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });

    let outcome: Awaited<ReturnType<typeof result.current.readChildChainBranchInventory>> | undefined;
    await act(async () => {
      outcome = await result.current.readChildChainBranchInventory('CHILD-1', 'ROOT-1');
    });
    expect(outcome).toBeNull();
  });

  it('logs and returns false when delete task IPC rejects', async () => {
    const client = createMockClient({
      deleteTask: vi.fn().mockRejectedValue(new Error('Delete IPC failed.')),
    });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });

    await expect(result.current.deleteTask('task.md', 'open')).resolves.toBe(false);

    await waitFor(() => {
      expect(window.desktopShell.log.emit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'task-board.delete-task.failed',
        level: 'warn',
        extra: {
          fileName: 'task.md',
          column: 'open',
          reason: 'Delete IPC failed.',
        },
      }));
    });
  });

  it('logs task board refresh IPC rejections', async () => {
    const client = createMockClient({
      readTaskBoard: vi.fn().mockRejectedValue(new Error('Board read failed.')),
    });

    renderHook(() => useTaskBoard(client), { wrapper });

    await waitFor(() => {
      expect(window.desktopShell.log.emit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'task-board.refresh.failed',
        level: 'warn',
        extra: { reason: 'Board read failed.' },
      }));
    });
  });

  it('optimistically marks a killed row as stopping', async () => {
    const client = createMockClient({
      readTaskBoard: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 1 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 1,
          dropboxItems: [],
          pendingItems: [{ fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' }],
          errorItems: [],
          completedItems: [],
        },
      }),
      killTask: vi.fn(() => new Promise<never>(() => {})),
    });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(result.current.board.pendingItems[0]?.state).toBe('active'));

    act(() => {
      void result.current.killTask('ACTIVE.md', 'ACTIVE');
    });

    expect(result.current.board.pendingItems[0]).toMatchObject({
      taskId: 'ACTIVE',
      state: 'stopping',
      stopRequestedAt: expect.any(String),
    });
  });

  it('refreshes to roll back optimistic stopping when kill IPC throws', async () => {
    const readTaskBoard = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 1 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 1,
          dropboxItems: [],
          pendingItems: [{ fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' }],
          errorItems: [],
          completedItems: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 1 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 2,
          dropboxItems: [],
          pendingItems: [{ fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' }],
          errorItems: [],
          completedItems: [],
        },
      });
    const client = createMockClient({
      readTaskBoard,
      killTask: vi.fn().mockRejectedValue(new Error('Stop failed.')),
    });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(result.current.board.pendingItems[0]?.state).toBe('active'));

    await act(async () => {
      await result.current.killTask('ACTIVE.md', 'ACTIVE');
    });

    expect(readTaskBoard).toHaveBeenCalledTimes(2);
    expect(result.current.board.pendingItems[0]?.state).toBe('active');
  });

  it('refreshes to roll back optimistic stopping when kill IPC returns ok false', async () => {
    const readTaskBoard = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 1 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 1,
          dropboxItems: [],
          pendingItems: [{ fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' }],
          errorItems: [],
          completedItems: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 1 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 2,
          dropboxItems: [],
          pendingItems: [{ fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' }],
          errorItems: [],
          completedItems: [],
        },
      });
    const client = createMockClient({
      readTaskBoard,
      killTask: vi.fn().mockResolvedValue({
        ok: false,
        action: 'taskBoard.killTask',
        error: 'No longer active.',
      }),
    });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(result.current.board.pendingItems[0]?.state).toBe('active'));

    await act(async () => {
      await result.current.killTask('ACTIVE.md', 'ACTIVE');
    });

    expect(readTaskBoard).toHaveBeenCalledTimes(2);
    expect(result.current.board.pendingItems[0]?.state).toBe('active');
  });

  it('calls retry cleanup and refreshes when retry IPC fails', async () => {
    const readTaskBoard = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 1 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 1,
          dropboxItems: [],
          pendingItems: [{
            fileName: 'ACTIVE.md',
            taskId: 'ACTIVE',
            title: 'Active',
            state: 'stopping',
            stopCleanupStatus: 'failed',
            stopCleanupRetryable: true,
          }],
          errorItems: [],
          completedItems: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 1 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 2,
          dropboxItems: [],
          pendingItems: [],
          errorItems: [],
          completedItems: [],
        },
      });
    const client = createMockClient({
      readTaskBoard,
      retryKillCleanup: vi.fn().mockRejectedValue(new Error('Retry failed.')),
    });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(result.current.board.pendingItems[0]?.state).toBe('stopping'));

    await act(async () => {
      await result.current.retryKillCleanup('ACTIVE.md', 'ACTIVE');
    });

    expect(client.retryKillCleanup).toHaveBeenCalledWith('ACTIVE.md', 'ACTIVE');
    expect(readTaskBoard).toHaveBeenCalledTimes(2);
  });
});
