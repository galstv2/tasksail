import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArchivedTaskEntry } from '../../../shared/desktopContract';
import { formatLocalTimestamp } from '../../utils/localTimestamp';
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

  it('renders completed tasks newest first with local 24-hour timestamps', () => {
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
    expect(screen.getByText(formatLocalTimestamp(newer.archivedAt!)!)).toBeInTheDocument();
  });
});
