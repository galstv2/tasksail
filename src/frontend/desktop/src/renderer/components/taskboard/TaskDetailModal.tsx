import { useCallback, useEffect } from 'react';

import type { TaskBoardContentColumn } from '../../../shared/desktopContract';
import TaskMarkdownView from './TaskMarkdownView';

export type TaskDetailModalProps = {
  title: string | null;
  content: string;
  column: TaskBoardContentColumn;
  onClose: () => void;
};

const COLUMN_LABELS: Record<TaskBoardContentColumn, string> = {
  open: 'Open',
  pending: 'Pending',
  error: 'Failed',
  completed: 'Completed',
};

function TaskDetailModal({
  title,
  content,
  column,
  onClose,
}: TaskDetailModalProps): JSX.Element {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="task-detail-modal__overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Task detail'}
      data-column={column}
    >
      <div className="task-detail-modal">
        <div className="task-detail-modal__header">
          <span className="task-detail-modal__column-dot" />
          <h2 className="task-detail-modal__title">{title ?? 'Task'}</h2>
          <button
            type="button"
            className="task-detail-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="task-detail-modal__body">
          <TaskMarkdownView content={content} />
        </div>
        <div className="task-detail-modal__footer">
          <span className="task-detail-modal__column-badge" data-column={column}>
            <span className="task-detail-modal__badge-dot" />
            {COLUMN_LABELS[column]}
          </span>
          <span className="task-detail-modal__footer-hint">ESC to close</span>
        </div>
      </div>
    </div>
  );
}

export default TaskDetailModal;
