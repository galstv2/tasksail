import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TaskNotificationCenterButton } from './TaskNotificationCenterButton';

afterEach(() => {
  cleanup();
});

describe('TaskNotificationCenterButton', () => {
  it('renders a single notification button with bell icon and no badge at zero', () => {
    render(
      <TaskNotificationCenterButton
        unseenCount={0}
        countLabel="0"
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Notifications' });
    expect(button).toHaveClass('shell__notification-btn');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-controls', 'task-notifications-panel');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('svg')).toBeInTheDocument();
    expect(button.querySelector('.shell__notification-btn__badge')).not.toBeInTheDocument();
  });

  it('renders the active status-chip badge and toggles on click', () => {
    const onToggle = vi.fn();
    render(
      <TaskNotificationCenterButton
        unseenCount={101}
        countLabel="99+"
        isOpen
        onToggle={onToggle}
      />,
    );

    const button = screen.getByRole('button', { name: 'Notifications' });
    const badge = button.querySelector('.shell__notification-btn__badge');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(badge).toHaveClass('status-chip', 'status-chip--active', 'shell__notification-btn__badge');
    expect(badge).toHaveTextContent('99+');

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
