/**
 * TaskBoard lifecycle reconciliation tests (Track C).
 *
 * Covers:
 * - reconcileSelectedTaskFromBoard: rebind/close when board snapshot changes
 * - chainInventoryRequestRef: stale View Chain responses are discarded after close or task switch
 * - Artifact read failure behavior: same-task keeps prior content; task switch clears on failure
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ArchivedTaskEntry,
  TaskBoardReadChildChainBranchInventoryResponse,
} from '../../../shared/desktopContract';
import type { TaskBoardState } from '../../hooks/useTaskBoard';
import TaskBoard from './TaskBoard';

// --- helpers ---

function archivedTask(
  taskId: string,
  title: string,
  archivedAt: string | null = '2026-05-23T03:58:37Z',
): ArchivedTaskEntry {
  return {
    taskId,
    title,
    summary: '',
    rootTaskId: taskId,
    qmdRecordId: `task:pack:${taskId}`,
    followupReason: '',
    year: '2026',
    archivePath: `/archive/${taskId}/archive.md`,
    archivedAt,
    contextPackName: 'pack',
  };
}

function emptyBoard(): TaskBoardState {
  return { dropboxItems: [], pendingItems: [], errorItems: [], completedItems: [] };
}

function boardWithPending(
  fileName: string,
  taskId: string,
  title: string,
  state: 'pending' | 'active' | 'activating' | 'stopping' = 'pending',
): TaskBoardState {
  return {
    dropboxItems: [],
    pendingItems: [{ fileName, taskId, title, state }],
    errorItems: [],
    completedItems: [],
  };
}

function boardWithError(fileName: string, taskId: string, title: string): TaskBoardState {
  return {
    dropboxItems: [],
    pendingItems: [],
    errorItems: [{ fileName, taskId, title }],
    completedItems: [],
  };
}

function boardWithCompleted(entry: ArchivedTaskEntry): TaskBoardState {
  return {
    dropboxItems: [],
    pendingItems: [],
    errorItems: [],
    completedItems: [entry],
  };
}

function childChainMeta(taskId: string, rootTaskId: string): NonNullable<ArchivedTaskEntry['childChain']> {
  return {
    rootTaskId,
    parentTaskId: taskId === rootTaskId ? null : rootTaskId,
    previousTaskId: taskId === rootTaskId ? null : rootTaskId,
    depth: taskId === rootTaskId ? 0 : 1,
    state: 'completed',
    currentTipTaskId: taskId,
    isCurrentTip: true,
    archivePath: `/archive/${taskId}/archive.md`,
    archiveArtifactDir: `/archive/${taskId}`,
    parentArchivePath: null,
    parentArchiveArtifactDir: null,
  };
}

const LOADED_CHAIN: TaskBoardReadChildChainBranchInventoryResponse = {
  action: 'taskBoard.readChildChainBranchInventory',
  mode: 'loaded',
  message: 'Loaded.',
  inventory: {
    schemaVersion: 1,
    rootTaskId: 'ROOT-1',
    selectedTaskId: 'CHILD-1',
    currentTipTaskId: 'CHILD-1',
    taskCount: 2,
    rows: [
      {
        repoRoot: '/repos/app',
        repoLabel: 'app-label',
        chainSourceBranch: 'feature/app',
        sourceKind: 'parent-handoff',
        introducedAtTaskId: 'ROOT-1',
        introducedAtDepth: 0,
        targetBranch: 'main',
      },
    ],
    generatedAt: '2026-05-30T00:00:00.000Z',
  },
};

// --- tests: reconcileSelectedTaskFromBoard ---

describe('reconcileSelectedTaskFromBoard: task lifecycle transitions', () => {
  afterEach(() => cleanup());

  it('rebinds selectedTask when a pending task becomes active on the next board snapshot', async () => {
    const readTaskContent = vi.fn(async () => ({ content: 'PENDING_BODY' }));

    const initialBoard = boardWithPending('TASK-A.md', 'TASK-A', 'Task A', 'pending');
    const { rerender, container } = render(
      <TaskBoard
        board={initialBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    // Open the pending modal.
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="TASK-A.md"]')!);
    expect(await screen.findByText('PENDING_BODY')).toBeInTheDocument();

    // Board snapshot changes: task moves to active state.
    const activeBoard = boardWithPending('TASK-A.md', 'TASK-A', 'Task A', 'active');
    await act(async () => {
      rerender(
        <TaskBoard
          board={activeBoard}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={readTaskContent}
        />,
      );
    });

    // Modal must still be visible (rebind, not close).
    expect(screen.getByText('PENDING_BODY')).toBeInTheDocument();
  });

  it('rebinds selectedTask when a pending task moves to stopping state', async () => {
    const readTaskContent = vi.fn(async () => ({ content: 'TASK_BODY' }));

    const initialBoard = boardWithPending('TASK-A.md', 'TASK-A', 'Task A', 'active');
    const { rerender, container } = render(
      <TaskBoard
        board={initialBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="TASK-A.md"]')!);
    expect(await screen.findByText('TASK_BODY')).toBeInTheDocument();

    // Board snapshot changes: task becomes stopping.
    const stoppingBoard = boardWithPending('TASK-A.md', 'TASK-A', 'Task A', 'stopping');
    await act(async () => {
      rerender(
        <TaskBoard
          board={stoppingBoard}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={readTaskContent}
        />,
      );
    });

    // Modal still open (rebind).
    expect(screen.getByText('TASK_BODY')).toBeInTheDocument();
  });

  it('rebinds to completed column by taskId when pending fileName differs from taskId', async () => {
    // This test covers the P3 fix: handleCardClick now passes item.taskId for pending/error/open
    // rows so reconcileSelectedTaskFromBoard can match by taskId into the completed column even
    // when the pending fileName (renamed-task.md) differs from the synthetic completed filename
    // (TASK-A.md).
    const readTaskContent = vi.fn(async (_f: string, col: string) => {
      if (col === 'completed') return { content: 'COMPLETED_CONTENT_A', artifactRelativePath: 'archive.md', artifacts: [] };
      return { content: 'PENDING_CONTENT_A' };
    });

    // Initial board: task is in pending with a non-matching fileName.
    const initialBoard = boardWithPending('renamed-task.md', 'TASK-A', 'Task A', 'pending');
    const { rerender, container } = render(
      <TaskBoard
        board={initialBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    // Open the detail modal for the pending row.
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="renamed-task.md"]')!);
    expect(await screen.findByText('PENDING_CONTENT_A')).toBeInTheDocument();

    // Now rerender: task gone from pending, present in completed with same taskId 'TASK-A'.
    const completedEntry = archivedTask('TASK-A', 'Task A');
    const completedBoard = boardWithCompleted(completedEntry);
    await act(async () => {
      rerender(
        <TaskBoard
          board={completedBoard}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={readTaskContent}
        />,
      );
    });

    // Modal must have REBOUND to the completed column (not closed).
    // The completed column badge must appear (data-column="completed").
    await vi.waitFor(() => {
      const badge = container.querySelector('[data-column="completed"]');
      expect(badge).toBeInTheDocument();
    });

    // The completed content should now be rendered (readTaskContent called with 'completed').
    await vi.waitFor(() => {
      expect(readTaskContent).toHaveBeenCalledWith('TASK-A.md', 'completed', undefined);
    });

    // Pending content must no longer be shown (the modal rebound, not stayed on pending).
    expect(screen.queryByText('PENDING_CONTENT_A')).not.toBeInTheDocument();
  });

  it('closes selectedTask when the task is removed from the board snapshot', async () => {
    const readTaskContent = vi.fn(async () => ({ content: 'TASK_BODY' }));

    const initialBoard = boardWithPending('TASK-A.md', 'TASK-A', 'Task A', 'pending');
    const { rerender, container } = render(
      <TaskBoard
        board={initialBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="TASK-A.md"]')!);
    expect(await screen.findByText('TASK_BODY')).toBeInTheDocument();

    // Board snapshot with task removed.
    await act(async () => {
      rerender(
        <TaskBoard
          board={emptyBoard()}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={readTaskContent}
        />,
      );
    });

    // Modal must be closed.
    expect(screen.queryByText('TASK_BODY')).not.toBeInTheDocument();
  });

  it('rebinds selectedTask when task moves from pending to error column', async () => {
    const readTaskContent = vi.fn(async () => ({ content: 'TASK_BODY' }));

    const initialBoard = boardWithPending('TASK-A.md', 'TASK-A', 'Task A', 'active');
    const { rerender, container } = render(
      <TaskBoard
        board={initialBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="TASK-A.md"]')!);
    expect(await screen.findByText('TASK_BODY')).toBeInTheDocument();

    // Task moved to error column.
    const errorBoard = boardWithError('TASK-A.md', 'TASK-A', 'Task A');
    await act(async () => {
      rerender(
        <TaskBoard
          board={errorBoard}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={readTaskContent}
        />,
      );
    });

    // Task is still in the board (error column) — reconciliation should rebind, not close.
    // Verify readTaskContent was called for the error column on rebind.
    await vi.waitFor(() => {
      expect(readTaskContent).toHaveBeenCalledWith('TASK-A.md', 'error', undefined);
    });
  });

  it('closes selectedTask and resets chain/branch state when task disappears from the board', async () => {
    const readTaskContent = vi.fn(async () => ({ content: 'CHILD_BODY' }));
    const entry = archivedTask('CHILD-1', 'Child One');
    entry.childChain = childChainMeta('CHILD-1', 'ROOT-1');

    let resolveInv!: (v: TaskBoardReadChildChainBranchInventoryResponse | null) => void;
    const pendingInv = new Promise<TaskBoardReadChildChainBranchInventoryResponse | null>((res) => {
      resolveInv = res;
    });
    const readChildChainBranchInventory = vi.fn(() => pendingInv);

    const initialBoard = boardWithCompleted(entry);
    const { rerender, container } = render(
      <TaskBoard
        board={initialBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
        readChildChainBranchInventory={readChildChainBranchInventory}
      />,
    );

    // Open the completed task modal.
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="CHILD-1.md"]')!);
    expect(await screen.findByText('CHILD_BODY')).toBeInTheDocument();

    // Board snapshot removes the task.
    await act(async () => {
      rerender(
        <TaskBoard
          board={emptyBoard()}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={readTaskContent}
          readChildChainBranchInventory={readChildChainBranchInventory}
        />,
      );
    });

    // Modal must be closed.
    expect(screen.queryByText('CHILD_BODY')).not.toBeInTheDocument();

    // Now resolve the pending chain inventory — no chain modal should appear.
    await act(async () => {
      resolveInv(LOADED_CHAIN);
    });
    expect(screen.queryByText('Child Chain Branches')).not.toBeInTheDocument();
  });

  it('does not close a just-opened modal when board does not change', async () => {
    const readTaskContent = vi.fn(async () => ({ content: 'TASK_BODY' }));
    const initialBoard = boardWithPending('TASK-A.md', 'TASK-A', 'Task A', 'pending');

    const { container } = render(
      <TaskBoard
        board={initialBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    // Click card — board doesn't change.
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="TASK-A.md"]')!);
    expect(await screen.findByText('TASK_BODY')).toBeInTheDocument();

    // Modal stays open — the reconciliation effect only fires on board changes,
    // not when selectedTask changes.
    expect(screen.getByText('TASK_BODY')).toBeInTheDocument();
  });
});

// --- tests: chainInventoryRequestRef (View Chain identity) ---

describe('chainInventoryRequestRef: stale View Chain responses are discarded', () => {
  afterEach(() => cleanup());

  const VIEW_CHAIN_LABEL = 'View child chain repos and branches';

  it('discards a View Chain response that arrived after modal was closed', async () => {
    let resolveInv!: (v: TaskBoardReadChildChainBranchInventoryResponse | null) => void;
    const pendingInv = new Promise<TaskBoardReadChildChainBranchInventoryResponse | null>((res) => {
      resolveInv = res;
    });
    const readChildChainBranchInventory = vi.fn(() => pendingInv);
    const readTaskContent = vi.fn(async () => ({ content: 'CHILD_BODY' }));

    const entry = archivedTask('CHILD-1', 'Child One');
    entry.childChain = childChainMeta('CHILD-1', 'ROOT-1');

    const { container } = render(
      <TaskBoard
        board={boardWithCompleted(entry)}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
        readChildChainBranchInventory={readChildChainBranchInventory}
      />,
    );

    // Open modal and click View Chain.
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="CHILD-1.md"]')!);
    await screen.findByText('CHILD_BODY');
    fireEvent.click(screen.getByRole('button', { name: VIEW_CHAIN_LABEL }));
    expect(readChildChainBranchInventory).toHaveBeenCalledWith('CHILD-1', 'ROOT-1');

    // Close the modal before inventory resolves.
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText('CHILD_BODY')).not.toBeInTheDocument();

    // Now resolve the inventory — no chain modal should appear.
    await act(async () => {
      resolveInv(LOADED_CHAIN);
    });
    expect(screen.queryByText('Child Chain Branches')).not.toBeInTheDocument();
  });

  it('discards a View Chain response for task A after closing its modal and opening task B', async () => {
    let resolveA!: (v: TaskBoardReadChildChainBranchInventoryResponse | null) => void;
    const pendingA = new Promise<TaskBoardReadChildChainBranchInventoryResponse | null>((res) => {
      resolveA = res;
    });

    const entryA = archivedTask('CHILD-1', 'Child One');
    entryA.childChain = childChainMeta('CHILD-1', 'ROOT-1');

    // entryB has no childChain, so no View Chain button.
    const entryB = archivedTask('CHILD-2', 'Child Two');

    const readTaskContent = vi.fn(async () => ({ content: 'TASK_BODY' }));
    const readChildChainBranchInventory = vi.fn((_taskId: string) => {
      if (_taskId === 'CHILD-1') return pendingA;
      return Promise.resolve(null);
    });

    const { container } = render(
      <TaskBoard
        board={{ ...emptyBoard(), completedItems: [entryA, entryB] }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
        readChildChainBranchInventory={readChildChainBranchInventory}
      />,
    );

    // Open modal for task A and click View Chain.
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="CHILD-1.md"]')!);
    await screen.findByText('TASK_BODY');
    fireEvent.click(screen.getByRole('button', { name: VIEW_CHAIN_LABEL }));

    // Close the modal (switches away from task A).
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    // Open modal for task B (no View Chain button).
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="CHILD-2.md"]')!);
    await screen.findByText('TASK_BODY');

    // Now resolve task A's inventory — must not show chain modal.
    await act(async () => {
      resolveA(LOADED_CHAIN);
    });
    expect(screen.queryByText('Child Chain Branches')).not.toBeInTheDocument();
  });
});

// --- tests: artifact read failure behavior ---

describe('Artifact read failure: same-task vs task-switch', () => {
  afterEach(() => cleanup());

  const MULTI_ARTIFACTS = [
    { relativePath: 'archive.md', label: 'archive.md', sizeBytes: 12 },
    { relativePath: 'handoffs/final-summary.md', label: 'handoffs/final-summary.md', sizeBytes: 24 },
  ];

  it('keeps previous content when a same-task artifact re-read fails', async () => {
    const entry = archivedTask('DONE-A', 'Done A');
    const readTaskContent = vi.fn(async (_f: string, _c: string, rel?: string) => {
      if (rel === 'handoffs/final-summary.md') return null;
      return { content: 'ARCHIVE_BODY', artifactRelativePath: 'archive.md', artifacts: MULTI_ARTIFACTS };
    });

    const { container } = render(
      <TaskBoard
        board={boardWithCompleted(entry)}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="DONE-A.md"]')!);
    await screen.findByText('ARCHIVE_BODY');

    // Switch artifact — the read will fail.
    fireEvent.click(await screen.findByRole('button', { name: 'Artifact Explorer' }));
    fireEvent.click(screen.getByRole('option', { name: 'handoffs/final-summary.md' }));

    // Prior content must remain (same-task failed read keeps prior content).
    expect(await screen.findByText('ARCHIVE_BODY')).toBeInTheDocument();
  });

  it('clears old content when switching tasks and the new task initial read fails', async () => {
    const entryA = archivedTask('DONE-A', 'Done A');
    const entryB = archivedTask('DONE-B', 'Done B');

    const readTaskContent = vi.fn(async (_f: string, _c: string) => {
      if (_f === 'DONE-B.md') return null;
      return { content: 'A_BODY', artifactRelativePath: 'archive.md', artifacts: MULTI_ARTIFACTS };
    });

    const { container } = render(
      <TaskBoard
        board={{ ...emptyBoard(), completedItems: [entryA, entryB] }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    // Open task A.
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="DONE-A.md"]')!);
    await screen.findByText('A_BODY');

    // Close modal for task A.
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText('A_BODY')).not.toBeInTheDocument();

    // Open task B — its read will return null, so no modal content is shown.
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="DONE-B.md"]')!);
    // Wait for the read to be called.
    await vi.waitFor(() => {
      expect(readTaskContent).toHaveBeenCalledWith('DONE-B.md', 'completed', undefined);
    });
    // No stale A_BODY content should be visible.
    expect(screen.queryByText('A_BODY')).not.toBeInTheDocument();
  });
});
