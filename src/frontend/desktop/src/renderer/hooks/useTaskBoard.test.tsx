// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskBoardReadBoardResponse } from '../../shared/desktopContract';
import { ToastProvider } from '../contexts/ToastContext';
import { createMockClient } from '../../test';
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
});
