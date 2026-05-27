import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  DesktopInvokeResult,
  TaskNotificationMutationResponse,
  TaskNotificationRecord,
  TaskNotificationSnapshot,
} from '../../shared/desktopContract';
import {
  isTaskNotificationMutationResponse,
  isTaskNotificationSnapshot,
} from '../../shared/desktopContractTypeGuards';
import { useToastContext } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';

export type UseTaskNotificationsResult = {
  notifications: TaskNotificationRecord[];
  unseenCount: number;
  countLabel: string;
  isOpen: boolean;
  refresh: () => Promise<boolean>;
  openPanel: () => Promise<void>;
  closePanel: () => void;
  togglePanel: () => void;
  dismiss: (notificationId: string) => Promise<void>;
  dismissAll: () => Promise<void>;
};

const EMPTY_SNAPSHOT: Pick<TaskNotificationSnapshot, 'notifications' | 'unseenCount'> = {
  notifications: [],
  unseenCount: 0,
};

function reasonFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function countLabelFor(unseenCount: number): string {
  return unseenCount > 99 ? '99+' : String(unseenCount);
}

export function useTaskNotifications(client: DesktopShellClient): UseTaskNotificationsResult {
  const { addToast } = useToastContext();
  const [notifications, setNotifications] = useState<TaskNotificationRecord[]>(
    EMPTY_SNAPSHOT.notifications,
  );
  const [unseenCount, setUnseenCount] = useState(EMPTY_SNAPSHOT.unseenCount);
  const [isOpen, setIsOpen] = useState(false);

  const applySnapshot = useCallback((
    snapshot: TaskNotificationSnapshot | TaskNotificationMutationResponse,
  ) => {
    setNotifications(snapshot.notifications);
    setUnseenCount(snapshot.unseenCount);
  }, []);

  const showFailureToast = useCallback((message: string) => {
    addToast({ severity: 'error', message, duration: 6000 });
  }, [addToast]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!client.readTaskNotifications) {
      showFailureToast('Task notifications are unavailable in this desktop shell.');
      return false;
    }

    let result: DesktopInvokeResult;
    try {
      result = await client.readTaskNotifications();
    } catch (error: unknown) {
      showFailureToast(reasonFromError(error, 'Unable to load task notifications.'));
      return false;
    }

    if (!result.ok) {
      showFailureToast(result.error);
      return false;
    }
    if (!isTaskNotificationSnapshot(result.response)) {
      showFailureToast('Task notifications returned an invalid snapshot.');
      return false;
    }

    applySnapshot(result.response);
    return true;
  }, [client, applySnapshot, showFailureToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!client.onTaskNotificationsUpdate) return undefined;
    try {
      return client.onTaskNotificationsUpdate((event) => {
        if (event.type === 'snapshot') {
          applySnapshot(event.snapshot);
        }
      });
    } catch {
      showFailureToast('Task notification updates are unavailable in this desktop shell.');
      return undefined;
    }
  }, [client, applySnapshot, showFailureToast]);

  const runMutation = useCallback(async (
    invoke: (() => Promise<DesktopInvokeResult>) | undefined,
    messages: { unavailable: string; failure: string; invalid: string },
  ): Promise<void> => {
    if (!invoke) {
      showFailureToast(messages.unavailable);
      return;
    }

    let result: DesktopInvokeResult;
    try {
      result = await invoke();
    } catch (error: unknown) {
      showFailureToast(reasonFromError(error, messages.failure));
      await refresh();
      return;
    }

    if (!result.ok) {
      showFailureToast(result.error);
      await refresh();
      return;
    }
    if (isTaskNotificationMutationResponse(result.response)) {
      applySnapshot(result.response);
      return;
    }

    showFailureToast(messages.invalid);
    await refresh();
  }, [applySnapshot, refresh, showFailureToast]);

  const markVisibleUnseenSeen = useCallback(async () => {
    const method = client.markTaskNotificationsSeen;
    await runMutation(
      method ? () => method({ allVisible: true }) : undefined,
      {
        unavailable: 'Task notification seen state is unavailable in this desktop shell.',
        failure: 'Unable to mark task notifications seen.',
        invalid: 'Task notification seen state returned an invalid snapshot.',
      },
    );
  }, [client, runMutation]);

  const openPanel = useCallback(async () => {
    setIsOpen(true);
    const loaded = await refresh();
    if (loaded || notifications.length > 0) {
      await markVisibleUnseenSeen();
    }
  }, [markVisibleUnseenSeen, notifications.length, refresh]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    if (isOpen) {
      closePanel();
      return;
    }
    void openPanel();
  }, [closePanel, isOpen, openPanel]);

  const dismiss = useCallback(async (notificationId: string) => {
    const method = client.dismissTaskNotification;
    await runMutation(
      method ? () => method(notificationId) : undefined,
      {
        unavailable: 'Task notification dismissal is unavailable in this desktop shell.',
        failure: 'Unable to dismiss task notification.',
        invalid: 'Task notification dismissal returned an invalid snapshot.',
      },
    );
  }, [client, runMutation]);

  const dismissAll = useCallback(async () => {
    const method = client.dismissAllTaskNotifications;
    await runMutation(
      method ? () => method() : undefined,
      {
        unavailable: 'Task notification dismissal is unavailable in this desktop shell.',
        failure: 'Unable to dismiss task notifications.',
        invalid: 'Task notification dismissal returned an invalid snapshot.',
      },
    );
  }, [client, runMutation]);

  return useMemo(
    () => ({
      notifications,
      unseenCount,
      countLabel: countLabelFor(unseenCount),
      isOpen,
      refresh,
      openPanel,
      closePanel,
      togglePanel,
      dismiss,
      dismissAll,
    }),
    [
      notifications,
      unseenCount,
      isOpen,
      refresh,
      openPanel,
      closePanel,
      togglePanel,
      dismiss,
      dismissAll,
    ],
  );
}
