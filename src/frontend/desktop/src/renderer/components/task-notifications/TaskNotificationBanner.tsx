import type { TaskNotificationRecord } from '../../../shared/desktopContract';
import { AlertIcon, CheckIcon, CloseIcon } from '../creation-steps/icons';
import { classNames } from '../../utils/classNames';

export type TaskNotificationBannerProps = {
  notification: TaskNotificationRecord;
  onDismiss: (notificationId: string) => void;
};

function formatRelativeTime(createdAt: string): string {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return '';

  const diffSeconds = Math.round((createdMs - Date.now()) / 1000);
  const divisions: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, seconds] of divisions) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return formatter.format(diffSeconds, 'second');
}

export function TaskNotificationBanner({
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
}
