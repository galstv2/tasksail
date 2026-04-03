import type { DragEvent, ReactNode } from 'react';

import { classNames } from '../../utils/classNames';

export type TaskBoardColumnProps = {
  title: string;
  count: number;
  children: ReactNode;
  columnId: string;
  isDropActive?: boolean;
  columnRef?: (el: HTMLDivElement | null) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnter?: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
};

function TaskBoardColumn({
  title,
  count,
  children,
  columnId,
  isDropActive = false,
  columnRef,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}: TaskBoardColumnProps): JSX.Element {
  return (
    <div
      ref={columnRef}
      className={classNames(
        'task-board-column',
        isDropActive && 'task-board-column--drop-active',
      )}
      data-column={columnId}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="task-board-column__header">
        <span className="task-board-column__dot" />
        <span className="task-board-column__name">{title}</span>
        <span className="task-board-column__count">{count}</span>
      </div>
      <div className="task-board-column__list">
        {children}
      </div>
    </div>
  );
}

export default TaskBoardColumn;
