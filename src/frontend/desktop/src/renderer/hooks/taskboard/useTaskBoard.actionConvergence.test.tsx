// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TaskBoardReadBoardResponse } from '../../../shared/desktopContract';
import { ToastProvider } from '../../contexts/ToastContext';
import { createMockClient } from '../../../test';
import { useTaskBoard } from './useTaskBoard';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <ToastProvider>{children}</ToastProvider>;
}

function makeBoard(seq: number, dropboxFileNames: string[] = []): TaskBoardReadBoardResponse {
  return {
    action: 'taskBoard.readBoard',
    mode: 'read-only',
    message: `seq=${seq}`,
    boardSnapshotSequence: seq,
    dropboxItems: dropboxFileNames.map((f) => ({ fileName: f, taskId: f.replace('.md', ''), title: f })),
    pendingItems: [],
    errorItems: [],
    completedItems: [],
  };
}

describe('useTaskBoard action convergence', () => {
  it('deleteTask success calls readTaskBoard and updates board state without a push', async () => {
    // Initial board has one open task.
    const readTaskBoard = vi.fn()
      .mockResolvedValueOnce({ ok: true, response: makeBoard(1, ['TASK-A.md']) })
      // After delete, the task is gone.
      .mockResolvedValueOnce({ ok: true, response: makeBoard(2, []) });

    const deleteTask = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'taskBoard.deleteTask', mode: 'deleted', message: 'Deleted.' },
    });

    const client = createMockClient({ readTaskBoard, deleteTask });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    // Wait for initial load.
    await waitFor(() => expect(result.current.board.dropboxItems).toHaveLength(1));

    // Delete the task — no watcher push will arrive.
    await act(async () => {
      await result.current.deleteTask('TASK-A.md', 'open');
    });

    // readTaskBoard should have been called twice: initial load + post-delete refresh.
    expect(readTaskBoard).toHaveBeenCalledTimes(2);
    // Board state must reflect the refreshed empty board.
    expect(result.current.board.dropboxItems).toHaveLength(0);
  });

  it('moveToPending success calls readTaskBoard and updates board state without a push', async () => {
    const readTaskBoard = vi.fn()
      .mockResolvedValueOnce({ ok: true, response: makeBoard(1, ['TASK-A.md']) })
      .mockResolvedValueOnce({ ok: true, response: makeBoard(2, []) });

    const moveToPending = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'taskBoard.moveToPending', mode: 'moved', message: 'Moved.' },
    });

    const client = createMockClient({ readTaskBoard, moveToPending });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(result.current.board.dropboxItems).toHaveLength(1));

    await act(async () => {
      await result.current.moveToPending('TASK-A.md', 0);
    });

    expect(readTaskBoard).toHaveBeenCalledTimes(2);
    expect(result.current.board.dropboxItems).toHaveLength(0);
  });

  it('moveToOpen success calls readTaskBoard and updates board state without a push', async () => {
    const readTaskBoard = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          ...makeBoard(1, []),
          errorItems: [{ fileName: 'TASK-A.md', taskId: 'TASK-A', title: 'Task A' }],
        },
      })
      .mockResolvedValueOnce({ ok: true, response: makeBoard(2, ['TASK-A.md']) });

    const moveToOpen = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'taskBoard.moveToOpen', mode: 'moved', message: 'Moved.' },
    });

    const client = createMockClient({ readTaskBoard, moveToOpen });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(result.current.board.errorItems).toHaveLength(1));

    await act(async () => {
      await result.current.moveToOpen('TASK-A.md', 'error');
    });

    expect(readTaskBoard).toHaveBeenCalledTimes(2);
    // The error item is gone; board reflects the refreshed state.
    expect(result.current.board.errorItems).toHaveLength(0);
    expect(result.current.board.dropboxItems).toHaveLength(1);
  });

  it('deleteTask failure does not call readTaskBoard a second time', async () => {
    const readTaskBoard = vi.fn()
      .mockResolvedValue({ ok: true, response: makeBoard(1, ['TASK-A.md']) });

    const deleteTask = vi.fn().mockResolvedValue({
      ok: false,
      action: 'taskBoard.deleteTask',
      error: 'Not found.',
    });

    const client = createMockClient({ readTaskBoard, deleteTask });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(result.current.board.dropboxItems).toHaveLength(1));

    await act(async () => {
      await result.current.deleteTask('TASK-A.md', 'open');
    });

    // Only the initial load — no refresh on failure.
    expect(readTaskBoard).toHaveBeenCalledTimes(1);
  });

  it('refresh uses the applyBoardSnapshot path and a push with higher sequence wins over an older read', async () => {
    let resolveInitial!: (v: { ok: true; response: TaskBoardReadBoardResponse }) => void;
    const initialReadPromise = new Promise<{ ok: true; response: TaskBoardReadBoardResponse }>(
      (res) => { resolveInitial = res; },
    );

    let pushCallback: ((r: TaskBoardReadBoardResponse) => void) | null = null;
    window.desktopShell.onTaskBoardUpdate = vi.fn((cb) => {
      pushCallback = cb;
      return vi.fn();
    });

    const readTaskBoard = vi.fn().mockReturnValueOnce(initialReadPromise);
    const client = createMockClient({ readTaskBoard });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    // Wait for push subscription to be set up.
    await waitFor(() => expect(pushCallback).not.toBeNull());

    // Deliver a push with a higher sequence before the initial read settles.
    act(() => {
      pushCallback?.({
        ...makeBoard(10, ['FROM-PUSH.md']),
      });
    });

    // Now resolve the initial read with a lower sequence — it must be discarded.
    act(() => {
      resolveInitial({ ok: true, response: makeBoard(1, ['FROM-INITIAL-READ.md']) });
    });

    // The push (seq=10) must win over the older initial read (seq=1).
    await waitFor(() => {
      expect(
        result.current.board.dropboxItems.map((i) => i.fileName),
      ).toEqual(['FROM-PUSH.md']);
    });
  });
});
