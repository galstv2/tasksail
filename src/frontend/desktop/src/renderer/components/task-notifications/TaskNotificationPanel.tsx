import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { TaskNotificationRecord } from '../../../shared/desktopContract';
import { registerEscHandler } from '../../utils/modalShellEscRegistry';
import { TaskNotificationBanner } from './TaskNotificationBanner';

export type TaskNotificationPanelProps = {
  notifications: TaskNotificationRecord[];
  onClose: () => void;
  onRefresh: () => void;
  onDismiss: (notificationId: string) => void;
  onDismissAll: () => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
  isClosing?: boolean;
};

export function TaskNotificationPanel({
  notifications,
  onClose,
  onRefresh,
  onDismiss,
  onDismissAll,
  returnFocusRef,
  isClosing = false,
}: TaskNotificationPanelProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [returnFocusRef]);

  useEffect(() => registerEscHandler(20, onClose), [onClose]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (returnFocusRef.current?.contains(target)) {
        return;
      }
      if (!panelRef.current?.contains(target)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose, returnFocusRef]);

  return createPortal(
    <div
      ref={panelRef}
      id="task-notifications-panel"
      className="task-notifications__panel"
      data-closing={isClosing ? 'true' : undefined}
      role="dialog"
      aria-modal="false"
      aria-label="Notifications"
      tabIndex={-1}
    >
      <div className="task-notifications__panel-header">
        <h2 className="task-notifications__panel-title">Notifications</h2>
        <div className="task-notifications__panel-actions">
          <button
            type="button"
            className="action-button action-button--secondary action-button--compact"
            onClick={onRefresh}
          >
            Refresh
          </button>
          <button
            type="button"
            className="action-button action-button--secondary action-button--compact"
            onClick={onDismissAll}
            disabled={notifications.length === 0}
          >
            Dismiss all
          </button>
        </div>
      </div>
      <div className="task-notifications__panel-divider" />
      <div className="task-notifications__list">
        {notifications.length === 0 ? (
          <div className="task-notifications__empty">No notifications</div>
        ) : (
          notifications.map((notification) => (
            <TaskNotificationBanner
              key={notification.notificationId}
              notification={notification}
              onDismiss={onDismiss}
            />
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
