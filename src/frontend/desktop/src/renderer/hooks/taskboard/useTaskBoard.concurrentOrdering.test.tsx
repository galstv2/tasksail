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

function makeBoard(seq: number, taskTitles: string[] = []): TaskBoardReadBoardResponse {
  return {
    action: 'taskBoard.readBoard',
    mode: 'read-only',
    message: `seq=${seq}`,
    boardSnapshotSequence: seq,
    dropboxItems: taskTitles.map((title, i) => ({ fileName: `task-${i}.md`, taskId: `task-${i}`, title })),
    pendingItems: [],
    errorItems: [],
    completedItems: [],
  };
}

describe('useTaskBoard concurrent ordering', () => {
  it('does not regress board when older read resolves after newer push', async () => {
    // Deferred promise: we control when the initial read resolves.
    let resolveRead!: (value: { ok: true; response: TaskBoardReadBoardResponse }) => void;
    const deferredRead = new Promise<{ ok: true; response: TaskBoardReadBoardResponse }>((resolve) => {
      resolveRead = resolve;
    });

    let pushBoardUpdate: ((response: TaskBoardReadBoardResponse) => void) | null = null;
    window.desktopShell.onTaskBoardUpdate = vi.fn((callback) => {
      pushBoardUpdate = callback;
      return vi.fn();
    });

    const client = createMockClient({
      readTaskBoard: vi.fn().mockReturnValueOnce(deferredRead),
    });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(pushBoardUpdate).not.toBeNull());

    // Deliver a newer push (seq=5) while the initial read (seq=1) is still in flight.
    act(() => {
      pushBoardUpdate?.(makeBoard(5, ['Newer push task']));
    });

    // Verify newer push was applied.
    await waitFor(() => expect(result.current.board.dropboxItems[0]?.title).toBe('Newer push task'));

    // Now resolve the older read with seq=1. It must be ignored.
    act(() => {
      resolveRead({ ok: true, response: makeBoard(1, ['Stale read task']) });
    });

    // Board must remain at the newer state from the push.
    await waitFor(() => expect(result.current.board.dropboxItems[0]?.title).toBe('Newer push task'));
  });

  it('applies only the highest sequence when overlapping refreshes arrive out of order', async () => {
    // Two deferred reads with different sequences.
    let resolveFirst!: (value: { ok: true; response: TaskBoardReadBoardResponse }) => void;
    let resolveSecond!: (value: { ok: true; response: TaskBoardReadBoardResponse }) => void;
    const firstRead = new Promise<{ ok: true; response: TaskBoardReadBoardResponse }>((resolve) => { resolveFirst = resolve; });
    const secondRead = new Promise<{ ok: true; response: TaskBoardReadBoardResponse }>((resolve) => { resolveSecond = resolve; });

    let callCount = 0;
    const client = createMockClient({
      readTaskBoard: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? firstRead : secondRead;
      }),
    });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });

    // Initial render triggers first read. Trigger a second manual refresh.
    await act(async () => {
      void result.current.refresh();
    });

    // Second read (higher seq) resolves first.
    act(() => {
      resolveSecond({ ok: true, response: makeBoard(2, ['Second read']) });
    });
    await waitFor(() => expect(result.current.board.dropboxItems[0]?.title).toBe('Second read'));

    // First read (lower seq) resolves later. Must be ignored.
    act(() => {
      resolveFirst({ ok: true, response: makeBoard(1, ['First read']) });
    });

    // Board must still show the second read.
    await waitFor(() => expect(result.current.board.dropboxItems[0]?.title).toBe('Second read'));
  });

  it('applies a push with higher sequence over a subsequent stale read', async () => {
    let pushBoardUpdate: ((response: TaskBoardReadBoardResponse) => void) | null = null;
    window.desktopShell.onTaskBoardUpdate = vi.fn((callback) => {
      pushBoardUpdate = callback;
      return vi.fn();
    });

    const client = createMockClient({
      readTaskBoard: vi.fn().mockResolvedValue({
        ok: true,
        response: makeBoard(1),
      }),
    });

    const { result } = renderHook(() => useTaskBoard(client), { wrapper });
    await waitFor(() => expect(pushBoardUpdate).not.toBeNull());

    // Initial read (seq=1) applied.
    await waitFor(() => expect(result.current.board.dropboxItems).toHaveLength(0));

    // Push with seq=10 (much newer).
    act(() => {
      pushBoardUpdate?.(makeBoard(10, ['Pushed task']));
    });
    await waitFor(() => expect(result.current.board.dropboxItems[0]?.title).toBe('Pushed task'));

    // A refresh returning seq=3 (older than push) must not overwrite the board.
    (client.readTaskBoard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      response: makeBoard(3, ['Stale refresh task']),
    });
    await act(async () => {
      await result.current.refresh();
    });

    // Board should still show the push result (seq=10 wins over seq=3).
    expect(result.current.board.dropboxItems[0]?.title).toBe('Pushed task');
  });
});
