import { forwardRef } from 'react';

import { BellIcon } from '../creation-steps/icons';

export type TaskNotificationCenterButtonProps = {
  unseenCount: number;
  countLabel: string;
  isOpen: boolean;
  onToggle: () => void;
};

export const TaskNotificationCenterButton = forwardRef<
  HTMLButtonElement,
  TaskNotificationCenterButtonProps
>(function TaskNotificationCenterButton(
  { unseenCount, countLabel, isOpen, onToggle },
  ref,
): JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      className="shell__notification-btn"
      onClick={onToggle}
      aria-label="Notifications"
      title="Notifications"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls="task-notifications-panel"
    >
      <BellIcon />
      {unseenCount > 0 && (
        <span className="status-chip status-chip--active shell__notification-btn__badge">
          {countLabel}
        </span>
      )}
    </button>
  );
});
