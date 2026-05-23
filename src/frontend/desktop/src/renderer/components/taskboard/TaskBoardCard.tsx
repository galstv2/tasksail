import { useState, type DragEvent, type MouseEvent } from 'react';

import { classNames } from '../../utils/classNames';
import { DND_MIME_SOURCE_COLUMN, DND_MIME_MOVABLE_TO_OPEN } from './dndConstants';

export type TaskBoardCardProps = {
  fileName: string;
  title: string | null;
  taskId: string | null;
  isActive?: boolean;
  draggable?: boolean;
  sourceColumn?: string;
  meta?: string | null;
  onClick?: () => void;
  onDelete?: () => void;
};

function TaskBoardCard({
  fileName,
  title,
  taskId,
  isActive = false,
  draggable = false,
  sourceColumn,
  meta,
  onClick,
  onDelete,
}: TaskBoardCardProps): JSX.Element {
  const [isDragging, setIsDragging] = useState(false);

  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', fileName);
    e.dataTransfer.setData(DND_MIME_SOURCE_COLUMN, sourceColumn ?? '');
    if (sourceColumn === 'error') {
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
    onClick && 'task-board-card--clickable',
  );

  const handleClick = () => {
    if (onClick && !isDragging) onClick();
  };

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
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
      {meta && <span className="task-board-card__meta">{meta}</span>}
      {taskId && <span className="task-board-card__id">{taskId}</span>}
      {isActive && <span className="task-board-card__badge">Active</span>}
      {onDelete && (
        <button
          className="task-board-card__delete"
          onClick={handleDelete}
          title="Delete task"
          aria-label={`Delete ${title ?? fileName}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

export default TaskBoardCard;
