/**
 * TaskBoard 10-task deterministic harness (Track H).
 *
 * Covers: 10-task board render/update sequence across all lifecycle columns
 * and modal lifecycle changes, with named React Profiler thresholds.
 *
 * No real agents, sockets, containers, or spawns.
 * Every interleaving is forced deterministically via prop changes.
 */

// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback, act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ArchivedTaskEntry,
  TaskBoardPendingItem,
} from '../../../shared/desktopContract';
import type { TaskBoardState } from '../../hooks/useTaskBoard';
import TaskBoard from './TaskBoard';

// --- Profiler budget constants ---
// Generous thresholds to avoid CI flakiness while catching 5× regressions.
const MAX_COMMIT_COUNT = 40;
const MAX_DURATION_MS = 3000;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- fixtures ---

function makePending(
  fileName: string,
  taskId: string,
  title: string,
  state: TaskBoardPendingItem['state'] = 'pending',
): TaskBoardPendingItem {
  return { fileName, taskId, title, state };
}

function makeCompleted(taskId: string, title: string): ArchivedTaskEntry {
  return {
    taskId,
    title,
    summary: `Summary for ${title}`,
    rootTaskId: taskId,
    qmdRecordId: `task:pack:${taskId}`,
    followupReason: '',
    year: '2026',
    archivePath: `/archive/${taskId}/archive.md`,
    archivedAt: '2026-05-29T10:00:00Z',
    contextPackName: 'pack',
  };
}

function makeChildChainCompleted(
  taskId: string,
  rootTaskId: string,
  title: string,
): ArchivedTaskEntry {
  const entry = makeCompleted(taskId, title);
  entry.childChain = {
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
  return entry;
}

/** Build a 10-task board covering all lifecycle columns. */
function makeTenTaskBoard(): TaskBoardState {
  return {
    dropboxItems: [
      { fileName: 'dropbox-task-01.md', taskId: 'DROP-01', title: 'Dropbox task 1' },
    ],
    pendingItems: [
      makePending('task-02.md', 'TASK-02', 'Open task', 'pending'),
      makePending('task-03.md', 'TASK-03', 'Activating task', 'activating'),
      makePending('task-04.md', 'TASK-04', 'Active task', 'active'),
      makePending('task-05.md', 'TASK-05', 'Stopping task', 'stopping'),
    ],
    errorItems: [
      { fileName: 'task-06.md', taskId: 'TASK-06', title: 'Failed task 1' },
      { fileName: 'task-07.md', taskId: 'TASK-07', title: 'Failed task 2' },
    ],
    completedItems: [
      makeCompleted('TASK-08', 'Regular completed'),
      makeChildChainCompleted('TASK-09', 'TASK-09', 'Chain root completed'),
      makeChildChainCompleted('TASK-10', 'TASK-09', 'Chain child completed'),
    ],
  };
}

interface ProfileResult {
  commitCount: number;
  totalActualDuration: number;
}

function profileBoardRender(
  initialBoard: TaskBoardState,
  updater?: (board: TaskBoardState) => TaskBoardState,
): ProfileResult {
  const commits: Array<{ actualDuration: number }> = [];

  const onRender: ProfilerOnRenderCallback = (
    _id,
    _phase,
    actualDuration,
  ) => {
    commits.push({ actualDuration });
  };

  let currentBoard = initialBoard;
  let rerender: ReturnType<typeof render>['rerender'];

  act(() => {
    const result = render(
      <Profiler id="TaskBoard" onRender={onRender}>
        <TaskBoard
          board={currentBoard}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
        />
      </Profiler>,
    );
    rerender = result.rerender;
  });

  if (updater) {
    act(() => {
      currentBoard = updater(currentBoard);
      rerender(
        <Profiler id="TaskBoard" onRender={onRender}>
          <TaskBoard
            board={currentBoard}
            onReorderPending={vi.fn()}
            onRequeueErrorItem={vi.fn()}
          />
        </Profiler>,
      );
    });
  }

  return {
    commitCount: commits.length,
    totalActualDuration: commits.reduce((sum, c) => sum + c.actualDuration, 0),
  };
}

// --- tests ---

describe('TaskBoard 10-task deterministic harness', () => {
  it('renders all 10 tasks across all lifecycle columns', () => {
    render(
      <TaskBoard
        board={makeTenTaskBoard()}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
      />,
    );

    // All lifecycle states visible
    expect(screen.getByText('Dropbox task 1')).toBeInTheDocument();
    expect(screen.getByText('Open task')).toBeInTheDocument();
    expect(screen.getByText('Activating task')).toBeInTheDocument();
    expect(screen.getByText('Active task')).toBeInTheDocument();
    expect(screen.getByText('Stopping task')).toBeInTheDocument();
    expect(screen.getByText('Failed task 1')).toBeInTheDocument();
    expect(screen.getByText('Failed task 2')).toBeInTheDocument();
    expect(screen.getByText('Regular completed')).toBeInTheDocument();
    expect(screen.getByText('Chain root completed')).toBeInTheDocument();
    expect(screen.getByText('Chain child completed')).toBeInTheDocument();
  });

  it('initial 10-task board render stays within Profiler budget', () => {
    const result = profileBoardRender(makeTenTaskBoard());

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('10-task board update (column transitions) stays within Profiler budget', () => {
    const board = makeTenTaskBoard();
    const result = profileBoardRender(board, (prev) => {
      // Move the activating task to active state
      return {
        ...prev,
        pendingItems: prev.pendingItems.map((item) =>
          item.taskId === 'TASK-03'
            ? { ...item, state: 'active' as const }
            : item,
        ),
      };
    });

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('task removed from board while modal could be open: board update stays within budget', () => {
    const board = makeTenTaskBoard();
    const result = profileBoardRender(board, (prev) => {
      // Remove TASK-04 (active task) — simulates task completing/disappearing
      return {
        ...prev,
        pendingItems: prev.pendingItems.filter((item) => item.taskId !== 'TASK-04'),
      };
    });

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('completed task added to 10-task board stays within Profiler budget', () => {
    const board = makeTenTaskBoard();
    const result = profileBoardRender(board, (prev) => ({
      ...prev,
      completedItems: [
        ...prev.completedItems,
        makeCompleted('TASK-11', 'Newly completed task'),
      ],
    }));

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('modal open and close cycle: open pending task modal then close via board removal', async () => {
    const readTaskContent = vi.fn(async () => ({ content: 'TASK_CONTENT_BODY' }));

    const initialBoard: TaskBoardState = {
      dropboxItems: [],
      pendingItems: [makePending('task-02.md', 'TASK-02', 'Open task', 'pending')],
      errorItems: [],
      completedItems: [],
    };

    const { rerender, container } = render(
      <TaskBoard
        board={initialBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    // Open modal
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="task-02.md"]')!);
    expect(await screen.findByText('TASK_CONTENT_BODY')).toBeInTheDocument();

    // Board update: task disappears (completed or removed)
    await act(async () => {
      rerender(
        <TaskBoard
          board={{ dropboxItems: [], pendingItems: [], errorItems: [], completedItems: [] }}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={readTaskContent}
        />,
      );
    });

    // Modal must close when task disappears
    expect(screen.queryByText('TASK_CONTENT_BODY')).not.toBeInTheDocument();
  });

  it('modal rebinds when pending task transitions to active state', async () => {
    const readTaskContent = vi.fn(async () => ({ content: 'TASK_BODY' }));

    const pendingBoard: TaskBoardState = {
      dropboxItems: [],
      pendingItems: [makePending('task-02.md', 'TASK-02', 'Open task', 'pending')],
      errorItems: [],
      completedItems: [],
    };

    const { rerender, container } = render(
      <TaskBoard
        board={pendingBoard}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="task-02.md"]')!);
    expect(await screen.findByText('TASK_BODY')).toBeInTheDocument();

    // Task transitions to active — modal must remain open (rebind)
    const activeBoard: TaskBoardState = {
      dropboxItems: [],
      pendingItems: [makePending('task-02.md', 'TASK-02', 'Open task', 'active')],
      errorItems: [],
      completedItems: [],
    };

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

    // Modal must still be open with content (rebind, not close)
    expect(screen.getByText('TASK_BODY')).toBeInTheDocument();
  });
});
