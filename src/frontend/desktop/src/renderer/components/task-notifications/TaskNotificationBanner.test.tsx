import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskNotificationRecord } from '../../../shared/desktopContract';
import { TaskNotificationBanner } from './TaskNotificationBanner';

afterEach(() => {
  cleanup();
});

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
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    seenAt: null,
    dismissedAt: null,
    message: 'Task completed.',
    ...overrides,
  };
}

describe('TaskNotificationBanner', () => {
  it('renders completed notifications with CheckIcon, context pack, timestamp, and unseen class', () => {
    render(<TaskNotificationBanner notification={notification()} onDismiss={vi.fn()} />);

    const banner = screen.getByText('Ship notification center').closest('article');
    expect(banner).toHaveClass(
      'task-notifications__banner',
      'task-notifications__banner--severity-success',
      'task-notifications__banner--unseen',
    );
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    expect(screen.getByText('Orders Estate')).toHaveClass('task-notifications__pack');
    expect(screen.getByText(/ago|now/i)).toHaveClass('task-notifications__timestamp');
    expect(banner?.querySelector('.task-notifications__severity-tile svg path')).toHaveAttribute(
      'd',
      'M3.5 8.4l2.8 2.8 6.2-6.4',
    );
  });

  it('renders failed notifications with AlertIcon and only falls back when contextPackLabel is null', () => {
    render(
      <TaskNotificationBanner
        notification={notification({
          type: 'task-failed',
          severity: 'error',
          taskTitle: null,
          contextPackId: 'orders-estate',
          contextPackDir: '/packs/orders',
          contextPackLabel: null,
          seenAt: '2026-05-25T10:00:00.000Z',
        })}
        onDismiss={vi.fn()}
      />,
    );

    const banner = screen.getByText('TASK-1').closest('article');
    expect(banner).toHaveClass('task-notifications__banner--severity-error');
    expect(banner).not.toHaveClass('task-notifications__banner--unseen');
    expect(screen.getByText('Task failed')).toBeInTheDocument();
    expect(screen.getByText('Unknown context pack')).toBeInTheDocument();
    expect(banner?.querySelector('.task-notifications__severity-tile svg path')).toHaveAttribute(
      'd',
      'M8 2.4l6 10.4H2L8 2.4z',
    );
  });

  it('uses CloseIcon for per-banner dismiss', () => {
    const onDismiss = vi.fn();
    render(<TaskNotificationBanner notification={notification()} onDismiss={onDismiss} />);

    const button = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(button.children).toHaveLength(1);
    expect(button.querySelector('svg path')).toHaveAttribute('d', 'M4 4l8 8M12 4l-8 8');

    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledWith('n-1');
  });
});
