import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArchivedTaskEntry } from '../../../shared/desktopContract';
import { formatLocalTimeShort, formatRelativeDay } from '../../utils/localTimestamp';
import type { TaskBoardState } from '../../hooks/useTaskBoard';
import TaskBoard from './TaskBoard';

function archivedTask(taskId: string, title: string, archivedAt: string | null): ArchivedTaskEntry {
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

function board(completedItems: ArchivedTaskEntry[]): TaskBoardState {
  return {
    dropboxItems: [],
    pendingItems: [],
    errorItems: [],
    completedItems,
  };
}

describe('TaskBoard completed cards', () => {
  afterEach(() => cleanup());

  it('renders completed tasks newest first with local HH:MM and a relative day label', () => {
    const older = archivedTask('old', 'Older task', '2026-05-21T13:04:05Z');
    const newer = archivedTask('new', 'Newer task', '2026-05-23T03:58:37Z');

    const { container } = render(
      <TaskBoard
        board={board([older, newer])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
      />,
    );

    const completedTitles = Array.from(
      container.querySelectorAll('[data-column="completed"] .task-board-card__title'),
    ).map((node) => node.textContent);
    expect(completedTitles).toEqual(['Newer task', 'Older task']);
    const expectedMeta = `${formatLocalTimeShort(newer.archivedAt!)} · ${formatRelativeDay(newer.archivedAt!)}`;
    expect(screen.getByText(expectedMeta)).toBeInTheDocument();
  });
});

describe('TaskBoard activation progress cards', () => {
  afterEach(() => cleanup());

  it('renders the compact activation phase label', () => {
    render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [{
            fileName: 'TASK-A.md',
            taskId: 'TASK-A',
            title: 'Task A',
            state: 'activating',
            activationPhase: 'materializing-worktree',
            activationStartedAt: '2026-05-23T10:00:00Z',
            activationUpdatedAt: '2026-05-23T10:00:05Z',
          }],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
      />,
    );

    // Phase label is now embedded in the meta line alongside the state word
    // and the activation start time.
    expect(screen.getByText(/Activating · Copying workspace files/)).toBeInTheDocument();
  });

  it('keeps activating cards non-draggable and non-deletable but clickable', () => {
    const readTaskContent = vi.fn(async () => '# Task A');
    const onDeleteTask = vi.fn(async () => true);
    const { container } = render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [{
            fileName: 'TASK-A.md',
            taskId: 'TASK-A',
            title: 'Task A',
            state: 'activating',
            activationPhase: 'claimed',
          }],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        onDeleteTask={onDeleteTask}
        readTaskContent={readTaskContent}
      />,
    );

    const card = container.querySelector<HTMLElement>('[data-filename="TASK-A.md"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('draggable')).toBe('false');
    expect(screen.queryByRole('button', { name: /delete task a/i })).not.toBeInTheDocument();
    fireEvent.click(card!);
    expect(readTaskContent).toHaveBeenCalledWith('TASK-A.md', 'pending');
  });

  it('pins active and activating cards above plain pending cards', () => {
    const { container } = render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [
            { fileName: 'PENDING.md', taskId: 'PENDING', title: 'Pending', state: 'pending' },
            { fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' },
            { fileName: 'ACTIVATING.md', taskId: 'ACTIVATING', title: 'Activating', state: 'activating' },
          ],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
      />,
    );

    const pendingTitles = Array.from(
      container.querySelectorAll('[data-column="pending"] .task-board-card__title'),
    ).map((node) => node.textContent);
    expect(pendingTitles).toEqual(['Active', 'Activating', 'Pending']);
  });

  it('closes the stop confirmation before kill task settles', async () => {
    let resolveStop!: () => void;
    const onKillTask = vi.fn(() => new Promise<void>((resolve) => {
      resolveStop = resolve;
    }));
    render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [
            { fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' },
          ],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        onKillTask={onKillTask}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /stop task active/i }));
    expect(screen.getByText('Stop this task?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop task' }));

    expect(onKillTask).toHaveBeenCalledWith('ACTIVE.md', 'ACTIVE');
    expect(screen.queryByText('Stop this task?')).not.toBeInTheDocument();
    resolveStop?.();
  });

  it('renders stopping cards as pinned, fixed, clickable status cards with no stop button', () => {
    const readTaskContent = vi.fn(async () => '# Task');
    const onDeleteTask = vi.fn(async () => true);
    const { container } = render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [
            { fileName: 'PENDING.md', taskId: 'PENDING', title: 'Pending', state: 'pending' },
            {
              fileName: 'STOPPING.md',
              taskId: 'STOPPING',
              title: 'Stopping',
              state: 'stopping',
              stopRequestedAt: '2026-05-23T10:00:00Z',
            },
          ],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        onDeleteTask={onDeleteTask}
        onKillTask={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    const pendingTitles = Array.from(
      container.querySelectorAll('[data-column="pending"] .task-board-card__title'),
    ).map((node) => node.textContent);
    expect(pendingTitles).toEqual(['Stopping', 'Pending']);
    const card = container.querySelector<HTMLElement>('[data-filename="STOPPING.md"]');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('task-board-card--stopping')).toBe(true);
    expect(card?.getAttribute('draggable')).toBe('false');
    expect(screen.queryByRole('button', { name: /stop task stopping/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete stopping/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Stopping · Requested/)).toHaveAttribute('role', 'status');
    fireEvent.click(card!);
    expect(readTaskContent).toHaveBeenCalledWith('STOPPING.md', 'pending');
  });

  it('renders failed cleanup stopping cards with a single retry cleanup control', () => {
    const readTaskContent = vi.fn(async () => '# Task');
    const onRetryKillCleanup = vi.fn(async () => undefined);
    const { container } = render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [
            { fileName: 'PENDING.md', taskId: 'PENDING', title: 'Pending', state: 'pending' },
            {
              fileName: 'STOPPING.md',
              taskId: 'STOPPING',
              title: 'Stopping',
              state: 'stopping',
              stopRequestedAt: '2026-05-23T10:00:00Z',
              stopCleanupStatus: 'failed',
              stopCleanupRetryable: true,
              stopCleanupErrorCode: 'failed-item-cleanup-failed',
            },
          ],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        onDeleteTask={vi.fn()}
        onKillTask={vi.fn()}
        onRetryKillCleanup={onRetryKillCleanup}
        readTaskContent={readTaskContent}
      />,
    );

    const card = container.querySelector<HTMLElement>('[data-filename="STOPPING.md"]');
    expect(card?.classList.contains('task-board-card--stopping')).toBe(true);
    expect(card?.classList.contains('task-board-card--cleanup-attention')).toBe(true);
    expect(card?.getAttribute('draggable')).toBe('false');
    expect(screen.getByText('Stopping · Cleanup needs attention')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: /stop task stopping/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete stopping/i })).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry cleanup for stopping/i });
    fireEvent.click(retry);
    expect(onRetryKillCleanup).toHaveBeenCalledWith('STOPPING.md', 'STOPPING');
  });
});
