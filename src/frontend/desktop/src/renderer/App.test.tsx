import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { installAppTestHarness } from './App.test-setup';
import type { TaskNotificationRecord } from '../shared/desktopContract';

installAppTestHarness();

async function renderApp() {
  const { default: App } = await import('./App');
  return render(<App />);
}

function notification(overrides: Partial<TaskNotificationRecord> = {}): TaskNotificationRecord {
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
    ...overrides,
  };
}

function installNotificationMethods(
  notifications: TaskNotificationRecord[] = [notification()],
  unseenCount = notifications.filter((record) => record.seenAt === null).length,
): void {
  window.desktopShell.readTaskNotifications = async () => ({
    ok: true,
    response: {
      action: 'taskNotifications.read',
      mode: 'read-only',
      unseenCount,
      notifications,
      generatedAt: new Date().toISOString(),
      message: 'Loaded task notifications.',
    },
  });
  window.desktopShell.markTaskNotificationsSeen = async () => ({
    ok: true,
    response: {
      action: 'taskNotifications.markSeen',
      mode: 'updated',
      unseenCount: 0,
      notifications: notifications.map((record) => ({
        ...record,
        seenAt: record.seenAt ?? new Date().toISOString(),
      })),
      generatedAt: new Date().toISOString(),
      message: 'Marked task notifications seen.',
    },
  });
  window.desktopShell.dismissTaskNotification = async () => ({
    ok: true,
    response: {
      action: 'taskNotifications.dismiss',
      mode: 'updated',
      unseenCount: 0,
      notifications: [],
      generatedAt: new Date().toISOString(),
      message: 'Dismissed task notification.',
    },
  });
  window.desktopShell.dismissAllTaskNotifications = async () => ({
    ok: true,
    response: {
      action: 'taskNotifications.dismissAll',
      mode: 'updated',
      unseenCount: 0,
      notifications: [],
      generatedAt: new Date().toISOString(),
      message: 'Dismissed task notifications.',
    },
  });
  window.desktopShell.onTaskNotificationsUpdate = () => () => undefined;
}

describe("App", () => {
  it('renders the persistent left sidebar with context-pack list and active state', async () => {
    await renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Context pack sidebar' }),
      ).toBeInTheDocument();
    });

    const packTrigger = screen.getByLabelText('Select context pack');
    expect(packTrigger).toBeInTheDocument();
    expect(packTrigger).toHaveTextContent('Orders Estate');
    expect(screen.getByTestId('context-pack-active-state')).toHaveTextContent(
      'Orders Estate is active',
    );
    expect(
      screen.getByRole('checkbox', { name: /Orders API/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Orders Web/i }),
    ).not.toBeChecked();
  });

  it('renders compact header title without old eyebrow or badge', async () => {
    await renderApp();

    await waitFor(() => {
      expect(screen.getByText('TaskSail')).toBeInTheDocument();
    });

    expect(screen.queryByText('Capstone safe operator controls')).not.toBeInTheDocument();
    expect(screen.queryByText('Automated context-pack workspace control')).not.toBeInTheDocument();
  });

  it('renders sidebar and main agent workspace regions', async () => {
    await renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Context pack sidebar' }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole('region', { name: 'Agent workspace' }),
    ).toBeInTheDocument();
  });

  it('renders the FAB planner button', async () => {
    await renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Plan Task' }),
      ).toBeInTheDocument();
    });
  });

  it('renders notification center button instead of active task and context pack chips', async () => {
    installNotificationMethods([notification()], 1);

    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    });

    expect(screen.getByText('1')).toHaveClass('shell__notification-btn__badge');
    expect(screen.queryByText('Observe queue artifacts')).not.toBeInTheDocument();
    expect(screen.queryByText('Orders Estate Context Pack')).not.toBeInTheDocument();
  });

  it('opens the notification panel through a body-mounted portal', async () => {
    installNotificationMethods([notification()], 1);

    await renderApp();

    const button = await screen.findByRole('button', { name: 'Notifications' });
    fireEvent.click(button);

    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(panel.parentElement).toBe(document.body);
    expect(panel).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByText('Ship notification center')).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveAttribute('data-closing', 'true');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(button);
  });

  it('renders the terminal feed in the main workspace', async () => {
    await renderApp();

    await waitFor(() => {
      expect(screen.getByLabelText('Terminal feed')).toBeInTheDocument();
    });
  });

  it('renders the planner modal when FAB is clicked', async () => {
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Plan Task' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('dialog', { name: 'Planning agent' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Plan Task' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Planning agent' })).toBeInTheDocument();
    });
  });

  it('auto-collapses the context pack sidebar when the window becomes narrow', async () => {
    await renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Context pack sidebar' }),
      ).toBeInTheDocument();
    });

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1000,
    });
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => {
      expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Select context pack')).not.toBeInTheDocument();
  });
});
