import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskNotificationRecord } from '../../../shared/desktopContract';
import { TaskNotificationPanel } from './TaskNotificationPanel';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function notification(): TaskNotificationRecord {
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
    createdAt: new Date().toISOString(),
    seenAt: null,
    dismissedAt: null,
    message: 'Task completed.',
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof TaskNotificationPanel>> = {}) {
  const button = document.createElement('button');
  document.body.appendChild(button);
  const returnFocusRef = { current: button };
  const props = {
    notifications: [notification()],
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onDismiss: vi.fn(),
    onDismissAll: vi.fn(),
    returnFocusRef,
    ...overrides,
  };
  return { ...render(<TaskNotificationPanel {...props} />), props, button };
}

describe('TaskNotificationPanel', () => {
  it('renders a portal dialog without modal-shell classes or overlay', () => {
    renderPanel();

    const panel = screen.getByRole('dialog', { name: 'Notifications' });
    expect(panel).toHaveAttribute('id', 'task-notifications-panel');
    expect(panel).toHaveAttribute('aria-modal', 'false');
    expect(panel).toHaveClass('task-notifications__panel');
    expect(panel).not.toHaveAttribute('data-closing');
    expect(panel.parentElement).toBe(document.body);
    expect(document.querySelector('.modal-shell__overlay')).not.toBeInTheDocument();
    expect(document.querySelector('[class*="modal-shell"]')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(panel);
  });

  it('marks the panel closing state for the close animation', () => {
    renderPanel({ isClosing: true });

    expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveAttribute(
      'data-closing',
      'true',
    );
  });

  it('renders header actions in order and disables Dismiss all when empty', () => {
    renderPanel({ notifications: [] });

    const buttons = [...document.querySelectorAll<HTMLButtonElement>(
      '.task-notifications__panel-actions button',
    )];
    expect(buttons.map((button) => button.textContent)).toEqual(['Refresh', 'Dismiss all']);
    expect(buttons[0]).toHaveClass('action-button', 'action-button--secondary', 'action-button--compact');
    expect(buttons[1]).toHaveClass('action-button', 'action-button--secondary', 'action-button--compact');
    expect(buttons[1]).toBeDisabled();
    expect(document.querySelector('.task-notifications__empty')).toHaveTextContent('No notifications');
  });

  it('closes on Escape and outside pointerdown and returns focus on unmount', () => {
    const { props, unmount, button } = renderPanel();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(2);

    unmount();
    expect(document.activeElement).toBe(button);
  });

  it('wires refresh, dismiss all, and per-row dismiss controls', () => {
    const { props } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onDismissAll).toHaveBeenCalledTimes(1);
    expect(props.onDismiss).toHaveBeenCalledWith('n-1');
  });
});
