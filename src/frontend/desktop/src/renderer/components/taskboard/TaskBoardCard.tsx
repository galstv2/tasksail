import { useState, type DragEvent, type MouseEvent } from 'react';

import { classNames } from '../../utils/classNames';
import { DND_MIME_SOURCE_COLUMN, DND_MIME_MOVABLE_TO_OPEN } from './dndConstants';

export type TaskBoardCardProps = {
  fileName: string;
  title: string | null;
  taskId: string | null;
  isActive?: boolean;
  isActivating?: boolean;
  isStopping?: boolean;
  isCleanupAttention?: boolean;
  draggable?: boolean;
  sourceColumn?: string;
  meta?: string | null;
  onClick?: () => void;
  onDelete?: () => void;
  onStop?: () => void;
  onRetryCleanup?: () => void;
};

function TaskBoardCard({
  fileName,
  title,
  taskId,
  isActive = false,
  isActivating = false,
  isStopping = false,
  isCleanupAttention = false,
  draggable = false,
  sourceColumn,
  meta,
  onClick,
  onDelete,
  onStop,
  onRetryCleanup,
}: TaskBoardCardProps): JSX.Element {
  const [isDragging, setIsDragging] = useState(false);

  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', fileName);
    e.dataTransfer.setData(DND_MIME_SOURCE_COLUMN, sourceColumn ?? '');
    if (sourceColumn === 'error' || sourceColumn === 'pending') {
      e.dataTransfer.setData(DND_MIME_MOVABLE_TO_OPEN, '1');
    }
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const onDragEnd = () => {
    setIsDragging(false);
  };

  const classes = classNames(
    'task-board-card',
    draggable && 'task-board-card--draggable',
    isDragging && 'task-board-card--dragging',
    isActive && 'task-board-card--active',
    isActivating && 'task-board-card--activating',
    isStopping && 'task-board-card--stopping',
    isCleanupAttention && 'task-board-card--cleanup-attention',
    onClick && 'task-board-card--clickable',
  );

  const handleClick = () => {
    if (onClick && !isDragging) onClick();
  };

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };
  const handleStop = (e: MouseEvent) => {
    e.stopPropagation();
    onStop?.();
  };
  const handleRetryCleanup = (e: MouseEvent) => {
    e.stopPropagation();
    onRetryCleanup?.();
  };

  return (
    <div
      className={classes}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={handleClick}
      data-filename={fileName}
    >
      <span className="task-board-card__title">{title ?? fileName}</span>
      {onRetryCleanup ? (
        <button
          className="task-board-card__retry-cleanup"
          onClick={handleRetryCleanup}
          title="Retry cleanup"
          aria-label={`Retry cleanup for ${title ?? fileName}`}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path d="M8.5 1.5v3h-3L6.7 3.3A2.5 2.5 0 1 0 7 6h1.2A3.7 3.7 0 1 1 5 1.3c1 0 1.9.4 2.6 1.1l.9-.9Z" />
          </svg>
        </button>
      ) : onStop ? (
        <button
          className="task-board-card__stop"
          onClick={handleStop}
          title="Stop task"
          aria-label={`Stop task ${title ?? fileName}`}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <rect x="1" y="1" width="8" height="8" rx="2" />
          </svg>
        </button>
      ) : onDelete ? (
        <button
          className="task-board-card__delete"
          onClick={handleDelete}
          title="Delete task"
          aria-label={`Delete ${title ?? fileName}`}
        >
          ×
        </button>
      ) : null}
      {taskId && <span className="task-board-card__id">{taskId}</span>}
      {meta && (
        <span
          className="task-board-card__meta"
          role={isActive || isActivating || isStopping ? 'status' : undefined}
        >
          {meta}
        </span>
      )}
    </div>
  );
}

export default TaskBoardCard;
