import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArchivedTaskChildParentBlockedTip, ArchivedTaskEntry } from '../../../shared/desktopContract';
import ParentTaskPicker from './ParentTaskPicker';
import { formatParentArchiveTimestamp } from './parentArchiveTimestamp';

afterEach(() => cleanup());

function task(overrides: Partial<ArchivedTaskEntry>): ArchivedTaskEntry {
  return {
    taskId: 'task-1',
    title: 'Task One',
    summary: '',
    rootTaskId: 'task-1',
    qmdRecordId: '',
    followupReason: '',
    year: '2026',
    archivePath: '/tmp/archive.md',
    archivedAt: null,
    contextPackName: 'test',
    ...overrides,
  };
}

function blockedTip(overrides: Partial<ArchivedTaskChildParentBlockedTip> = {}): ArchivedTaskChildParentBlockedTip {
  return {
    rootTaskId: 'root',
    blockedParentTaskId: 'root',
    currentTipTaskId: 'child',
    chainState: 'planned',
    boardState: 'open',
    title: 'Reserved Child',
    fileName: 'child.md',
    message: 'This chain already has a child task in progress or needing attention.',
    ...overrides,
  };
}

describe('ParentTaskPicker', () => {
  it('sorts by timestamp descending and preserves null ordering', () => {
    render(
      <ParentTaskPicker
        selectedTask={null}
        totalCount={3}
        onSelectTask={vi.fn()}
        tasks={[
          task({ taskId: 'old', title: 'Old', archivedAt: '2026-05-01T00:00:00Z' }),
          task({ taskId: 'none', title: 'No Timestamp', archivedAt: null }),
          task({ taskId: 'new', title: 'New', archivedAt: '2026-05-17T08:42:11Z' }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-activedescendant', 'parent-task-picker-option-new');
    const rows = screen.getAllByRole('option');
    expect(rows.map((row) => row.textContent)).toEqual([
      `New${formatParentArchiveTimestamp('2026-05-17T08:42:11Z')}`,
      `Old${formatParentArchiveTimestamp('2026-05-01T00:00:00Z')}`,
      'No Timestamp2026',
    ]);
  });

  it('selects by keyboard and keeps title/time in separate row spans', () => {
    const onSelectTask = vi.fn();
    render(
      <ParentTaskPicker
        selectedTask={null}
        totalCount={1}
        onSelectTask={onSelectTask}
        tasks={[task({ taskId: 'task-1', title: 'A very long parent task title', archivedAt: null })]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    const row = screen.getByRole('option');
    expect(within(row).getByText('A very long parent task title')).toHaveClass('planner-picker-row__title');
    expect(within(row).getByText('2026')).toHaveClass('planner-picker-row__time');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onSelectTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1' }));
  });

  it('shows loading and empty states in the trigger', () => {
    const { rerender } = render(
      <ParentTaskPicker selectedTask={null} tasks={[]} totalCount={0} loadingArchivedTasks={true} onSelectTask={vi.fn()} />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Loading archived tasks...');
    rerender(<ParentTaskPicker selectedTask={null} tasks={[]} totalCount={2} onSelectTask={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('2 archived tasks found, but none have a saved planner focus');
  });

  it('opens when only blocked tips exist and cannot select them by mouse or keyboard', () => {
    const onSelectTask = vi.fn();
    render(
      <ParentTaskPicker
        selectedTask={null}
        tasks={[]}
        blockedTips={[blockedTip()]}
        totalCount={0}
        onSelectTask={onSelectTask}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /child task already reserved/i }));
    const row = screen.getByRole('option', {
      name: 'Reserved Child, Reserved · Open. This chain already has a child task in progress or needing attention.',
    });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveTextContent('Reserved Child');
    expect(row).toHaveTextContent('Reserved');
    expect(row).toHaveTextContent('Reserved · Open');

    fireEvent.click(row);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('renders selectable parent rows before disabled blocked rows', () => {
    render(
      <ParentTaskPicker
        selectedTask={null}
        totalCount={1}
        onSelectTask={vi.fn()}
        tasks={[task({ taskId: 'parent', title: 'Selectable Parent', archivedAt: null })]}
        blockedTips={[blockedTip({ title: null, currentTipTaskId: 'child-tip', boardState: 'failed' })]}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([
      'Selectable Parent2026',
      'Reservedchild-tipReserved · Needs attention',
    ]);
  });
});
