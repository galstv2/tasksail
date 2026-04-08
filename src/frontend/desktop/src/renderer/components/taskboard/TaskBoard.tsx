import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';

import type { TaskBoardContentColumn, TaskBoardDeleteColumn } from '../../../shared/desktopContract';
import type { TaskBoardState } from '../../hooks/useTaskBoard';
import TaskBoardColumn from './TaskBoardColumn';
import TaskBoardCard from './TaskBoardCard';
import TaskDetailModal from './TaskDetailModal';
import { DND_MIME_SOURCE_COLUMN, DND_MIME_MOVABLE_TO_OPEN } from './dndConstants';

export type TaskBoardProps = {
  board: TaskBoardState;
  onReorderPending: (order: string[]) => Promise<void>;
  onRequeueErrorItem: (fileName: string, insertAtIndex: number) => Promise<void>;
  onDeleteTask?: (fileName: string, column: TaskBoardDeleteColumn) => Promise<boolean>;
  onMoveToPending?: (fileName: string, insertAtIndex: number) => Promise<void>;
  onMoveToOpen?: (fileName: string) => Promise<void>;
  readTaskContent?: (fileName: string, column: TaskBoardContentColumn) => Promise<string | null>;
};

function computeDropIndex(
  e: DragEvent<HTMLDivElement>,
  columnEl: HTMLDivElement,
): number {
  const cards = Array.from(
    columnEl.querySelectorAll<HTMLElement>('.task-board-card'),
  );
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) return i;
  }
  return cards.length;
}

type SelectedTask = {
  fileName: string;
  title: string | null;
  column: TaskBoardContentColumn;
};

type DeleteTarget = {
  fileName: string;
  title: string | null;
  column: TaskBoardDeleteColumn;
};

function TaskBoard({
  board,
  onReorderPending,
  onRequeueErrorItem,
  onDeleteTask,
  onMoveToPending,
  onMoveToOpen,
  readTaskContent,
}: TaskBoardProps): JSX.Element {
  const [dropActive, setDropActive] = useState(false);
  const [openDropActive, setOpenDropActive] = useState(false);
  const [pendingColumnEl, setPendingColumnEl] = useState<HTMLDivElement | null>(null);
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [modalContent, setModalContent] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  useEffect(() => {
    if (!selectedTask || !readTaskContent) {
      setModalContent(null);
      return;
    }
    let cancelled = false;
    void readTaskContent(selectedTask.fileName, selectedTask.column).then((text) => {
      if (!cancelled) setModalContent(text);
    });
    return () => { cancelled = true; };
  }, [selectedTask, readTaskContent]);

  const handleCardClick = useCallback(
    (fileName: string, title: string | null, column: TaskBoardContentColumn) => {
      if (!readTaskContent) return;
      setSelectedTask({ fileName, title, column });
    },
    [readTaskContent],
  );

  const handleOpenDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DND_MIME_MOVABLE_TO_OPEN)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleOpenDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DND_MIME_MOVABLE_TO_OPEN)) return;
    setOpenDropActive(true);
  }, []);
  const handleOpenDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setOpenDropActive(false);
  }, []);

  const handleOpenDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setOpenDropActive(false);
      const fileName = e.dataTransfer.getData('text/plain');
      const sourceColumn = e.dataTransfer.getData(DND_MIME_SOURCE_COLUMN);
      if (!fileName) return;

      if (sourceColumn === 'error') {
        void onMoveToOpen?.(fileName);
      }
    },
    [onMoveToOpen],
  );

  const handlePendingDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handlePendingDragEnter = useCallback(() => setDropActive(true), []);
  const handlePendingDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDropActive(false);
  }, []);

  const handlePendingDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropActive(false);
      const fileName = e.dataTransfer.getData('text/plain');
      const sourceColumn = e.dataTransfer.getData(DND_MIME_SOURCE_COLUMN);
      if (!fileName) return;

      if (!pendingColumnEl) return;
      const dropIndex = computeDropIndex(e, pendingColumnEl);

      const activeItem = board.pendingItems.find((item) => item.state === 'active');

      if (sourceColumn === 'open') {
        const safeIndex = activeItem ? Math.max(dropIndex, 1) : dropIndex;
        void onMoveToPending?.(fileName, safeIndex);
        return;
      }

      if (sourceColumn === 'error') {
        const safeIndex = activeItem ? Math.max(dropIndex, 1) : dropIndex;
        void onRequeueErrorItem(fileName, safeIndex);
        return;
      }

      if (sourceColumn === 'pending') {
        const currentOrder = board.pendingItems.map((item) => item.fileName);
        const filtered = currentOrder.filter((name) => name !== fileName);
        const clampedIndex = Math.min(dropIndex, filtered.length);
        filtered.splice(clampedIndex, 0, fileName);

        // Pin active item to position 0
        if (activeItem) {
          const activeIdx = filtered.indexOf(activeItem.fileName);
          if (activeIdx > 0) {
            filtered.splice(activeIdx, 1);
            filtered.unshift(activeItem.fileName);
          }
        }
        void onReorderPending(filtered);
      }
    },
    [board.pendingItems, pendingColumnEl, onReorderPending, onRequeueErrorItem, onMoveToPending],
  );

  const sortedPendingItems = useMemo(
    () =>
      [...board.pendingItems].sort((a, b) =>
        a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0,
      ),
    [board.pendingItems],
  );

  const totalCount =
    board.dropboxItems.length +
    board.pendingItems.length +
    board.errorItems.length +
    board.completedItems.length;

  return (
    <div className="task-board" aria-label="Task board">
      <div className="task-board__chrome">
        <span className="task-board__title">Task Board</span>
        <span className="task-board__summary">
          {totalCount} task{totalCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="task-board__columns">
        <TaskBoardColumn
          title="Open"
          count={board.dropboxItems.length}
          columnId="open"
          isDropActive={openDropActive}
          onDragOver={onMoveToOpen ? handleOpenDragOver : undefined}
          onDragEnter={onMoveToOpen ? handleOpenDragEnter : undefined}
          onDragLeave={onMoveToOpen ? handleOpenDragLeave : undefined}
          onDrop={onMoveToOpen ? handleOpenDrop : undefined}
        >
          {board.dropboxItems.length === 0 ? (
            <p className="task-board-column__empty">No items</p>
          ) : (
            board.dropboxItems.map((item) => (
              <TaskBoardCard
                key={item.fileName}
                fileName={item.fileName}
                title={item.title}
                taskId={item.taskId}
                draggable={Boolean(onMoveToPending)}
                sourceColumn="open"
                onClick={() => handleCardClick(item.fileName, item.title, 'open')}
                onDelete={onDeleteTask ? () => setDeleteTarget({ fileName: item.fileName, title: item.title, column: 'open' }) : undefined}
              />
            ))
          )}
        </TaskBoardColumn>

        <TaskBoardColumn
          title="Pending"
          count={board.pendingItems.length}
          columnId="pending"
          columnRef={setPendingColumnEl}
          isDropActive={dropActive}
          onDragOver={handlePendingDragOver}
          onDragEnter={handlePendingDragEnter}
          onDragLeave={handlePendingDragLeave}
          onDrop={handlePendingDrop}
        >
          {board.pendingItems.length === 0 ? (
            <p className="task-board-column__empty">
              {board.dropboxItems.length > 0 ? 'Drag tasks here to queue' : 'No items'}
            </p>
          ) : (
            sortedPendingItems.map((item) => (
              <TaskBoardCard
                key={item.fileName}
                fileName={item.fileName}
                title={item.title}
                taskId={item.taskId}
                isActive={item.state === 'active'}
                draggable={item.state !== 'active'}
                sourceColumn="pending"
                onClick={() => handleCardClick(item.fileName, item.title, 'pending')}
                onDelete={onDeleteTask && item.state !== 'active' ? () => setDeleteTarget({ fileName: item.fileName, title: item.title, column: 'pending' }) : undefined}
              />
            ))
          )}
        </TaskBoardColumn>

        <TaskBoardColumn title="Failed" count={board.errorItems.length} columnId="error">
          {board.errorItems.length === 0 ? (
            <p className="task-board-column__empty">No items</p>
          ) : (
            board.errorItems.map((item) => (
              <TaskBoardCard
                key={item.fileName}
                fileName={item.fileName}
                title={item.title}
                taskId={item.taskId}
                draggable
                sourceColumn="error"
                onClick={() => handleCardClick(item.fileName, item.title, 'error')}
                onDelete={onDeleteTask ? () => setDeleteTarget({ fileName: item.fileName, title: item.title, column: 'error' }) : undefined}
              />
            ))
          )}
        </TaskBoardColumn>

        <TaskBoardColumn title="Completed" count={board.completedItems.length} columnId="completed">
          {board.completedItems.length === 0 ? (
            <p className="task-board-column__empty">No items</p>
          ) : (
            board.completedItems.map((item) => (
              <TaskBoardCard
                key={item.taskId}
                fileName={`${item.taskId}.md`}
                title={item.title}
                taskId={item.taskId}
                onClick={() => handleCardClick(`${item.taskId}.md`, item.title, 'completed')}
              />
            ))
          )}
        </TaskBoardColumn>
      </div>

      {selectedTask && modalContent !== null && (
        <TaskDetailModal
          title={selectedTask.title}
          content={modalContent}
          column={selectedTask.column}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {deleteTarget && (
        <div className="task-board-confirm__overlay" onClick={() => setDeleteTarget(null)}>
          <div className="task-board-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="task-board-confirm__title">
              Delete &ldquo;{deleteTarget.title ?? deleteTarget.fileName}&rdquo;?
            </p>
            <p className="task-board-confirm__hint">
              This removes the task file from disk and cannot be undone.
            </p>
            <div className="task-board-confirm__actions">
              <button
                className="task-board-confirm__btn"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="task-board-confirm__btn task-board-confirm__btn--danger"
                onClick={() => {
                  if (!deleteTarget || !onDeleteTask) return;
                  void onDeleteTask(deleteTarget.fileName, deleteTarget.column)
                    .catch(() => {})
                    .finally(() => setDeleteTarget(null));
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TaskBoard;
