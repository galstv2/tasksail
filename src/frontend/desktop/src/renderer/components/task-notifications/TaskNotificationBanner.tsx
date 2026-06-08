import { memo } from 'react';

import type { TaskNotificationRecord } from '../../../shared/desktopContract';
import { AlertIcon, CheckIcon, CloseIcon } from '../icons';
import { classNames } from '../../utils/classNames';

export type TaskNotificationBannerProps = {
  notification: TaskNotificationRecord;
  onDismiss: (notificationId: string) => void;
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const RELATIVE_TIME_DIVISIONS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

function formatRelativeTime(createdAt: string): string {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return '';

  const diffSeconds = Math.round((createdMs - Date.now()) / 1000);
  for (const [unit, seconds] of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(diffSeconds) >= seconds) {
      return relativeTimeFormatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return relativeTimeFormatter.format(diffSeconds, 'second');
}

export const TaskNotificationBanner = memo(function TaskNotificationBanner({
  notification,
  onDismiss,
}: TaskNotificationBannerProps): JSX.Element {
  const isSuccess = notification.severity === 'success';
  const typeLabel = notification.type === 'task-completed' ? 'Task completed' : 'Task failed';
  const title = notification.taskTitle ?? notification.taskId;
  const contextPackLabel = notification.contextPackLabel ?? 'Unknown context pack';

  return (
    <article
      className={classNames(
        'task-notifications__banner',
        isSuccess
          ? 'task-notifications__banner--severity-success'
          : 'task-notifications__banner--severity-error',
        notification.seenAt === null && 'task-notifications__banner--unseen',
      )}
    >
      <div className="task-notifications__severity-tile" aria-hidden="true">
        {isSuccess ? <CheckIcon /> : <AlertIcon />}
      </div>
      <div className="task-notifications__pack">{contextPackLabel}</div>
      <div className="task-notifications__title">{title}</div>
      <div className="task-notifications__type">{typeLabel}</div>
      <time className="task-notifications__timestamp" dateTime={notification.createdAt}>
        {formatRelativeTime(notification.createdAt)}
      </time>
      <button
        type="button"
        className="task-notifications__dismiss"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(notification.notificationId)}
      >
        <CloseIcon />
      </button>
    </article>
  );
});
