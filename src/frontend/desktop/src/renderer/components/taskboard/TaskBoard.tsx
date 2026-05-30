import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import type { ArchivedTaskEntry, TaskBoardContentColumn, TaskBoardDeleteColumn, TaskBoardPendingItem, TaskBoardReadChildChainBranchInventoryResponse } from '../../../shared/desktopContract';
import type { TaskBoardContentResult, TaskBoardState } from '../../hooks/useTaskBoard';
import { formatLocalTimeShort, formatRelativeDay } from '../../utils/localTimestamp';
import TaskBoardColumn from './TaskBoardColumn';
import TaskBoardCard from './TaskBoardCard';
import TaskDetailModal from './TaskDetailModal';
import ChildChainBranchInventoryModal from './ChildChainBranchInventoryModal';
import { DND_MIME_SOURCE_COLUMN, DND_MIME_MOVABLE_TO_OPEN } from './dndConstants';

export type TaskBoardProps = {
  board: TaskBoardState;
  onReorderPending: (order: string[]) => Promise<void>;
  onRequeueErrorItem: (fileName: string, insertAtIndex: number) => Promise<void>;
  onDeleteTask?: (fileName: string, column: TaskBoardDeleteColumn) => Promise<boolean>;
  onMoveToPending?: (fileName: string, insertAtIndex: number) => Promise<void>;
  onMoveToOpen?: (fileName: string, sourceColumn?: 'error' | 'pending') => Promise<void>;
  onKillTask?: (fileName: string, taskId: string) => Promise<void>;
  onRetryKillCleanup?: (fileName: string, taskId: string) => Promise<void>;
  readTaskContent?: (
    fileName: string,
    column: TaskBoardContentColumn,
    artifactRelativePath?: string,
  ) => Promise<TaskBoardContentResult | null>;
  readChildChainBranchInventory?: (
    taskId: string,
    expectedRootTaskId?: string | null,
  ) => Promise<TaskBoardReadChildChainBranchInventoryResponse | null>;
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
  artifactRelativePath?: string;
  taskId?: string;
  childChain?: ArchivedTaskEntry['childChain'];
};

type DeleteTarget = {
  fileName: string;
  title: string | null;
  column: TaskBoardDeleteColumn;
};

type KillTarget = {
  fileName: string;
  taskId: string;
  title: string | null;
};

const ACTIVATION_PHASE_LABELS = {
  claimed: 'Activating',
  validating: 'Checking task',
  'preparing-worktree': 'Creating worktree',
  'materializing-worktree': 'Copying workspace files',
  'initializing-task': 'Preparing task files',
  'starting-pipeline': 'Starting pipeline',
} as const;

function isPinnedPendingState(state: TaskBoardPendingItem['state']): boolean {
  return state === 'active' || state === 'activating' || state === 'stopping';
}

function archivedAtMs(task: ArchivedTaskEntry): number | null {
  if (!task.archivedAt) return null;
  const ms = new Date(task.archivedAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Completed meta: "14:37 · Today" / "12:48 · Yesterday" / "14:37 · May 22".
// Falls back to whichever piece is available if either is unparseable.
function completedMeta(archivedAt: string | null | undefined): string | null {
  if (!archivedAt) return null;
  const time = formatLocalTimeShort(archivedAt);
  const day = formatRelativeDay(archivedAt);
  if (time && day) return `${time} · ${day}`;
  return time ?? day ?? null;
}

// Active/Activating meta: "Active · Started 14:37" or
// "Activating · Copying workspace files · 14:37". When activationStartedAt
// is missing we still surface the state word so the meta line is never empty.
function pendingMeta(item: TaskBoardPendingItem): string | null {
  if (item.state === 'pending') return null;
  const startedAt = item.activationStartedAt
    ? formatLocalTimeShort(item.activationStartedAt)
    : null;
  if (item.state === 'active') {
    return startedAt ? `Active · Started ${startedAt}` : 'Active';
  }
  if (item.state === 'stopping') {
    if (item.stopCleanupStatus === 'failed') {
      return 'Stopping · Cleanup needs attention';
    }
    const requestedAt = item.stopRequestedAt
      ? formatLocalTimeShort(item.stopRequestedAt)
      : null;
    return requestedAt ? `Stopping · Requested ${requestedAt}` : 'Stopping';
  }
  const phaseLabel = item.activationPhase
    ? ACTIVATION_PHASE_LABELS[item.activationPhase]
    : 'Activating';
  if (startedAt) return `Activating · ${phaseLabel} · ${startedAt}`;
  return `Activating · ${phaseLabel}`;
}

function completedChildChainBadge(item: ArchivedTaskEntry): string | null {
  if (!item.childChain) return null;
  if (item.childChain.rootTaskId === item.taskId) return 'Chain root';
  if (item.childChain.isCurrentTip) return 'Chain tip';
  return 'Child task';
}

function TaskBoard({
  board,
  onReorderPending,
  onRequeueErrorItem,
  onDeleteTask,
  onMoveToPending,
  onMoveToOpen,
  onKillTask,
  onRetryKillCleanup,
  readTaskContent,
  readChildChainBranchInventory,
}: TaskBoardProps): JSX.Element {
  const [dropActive, setDropActive] = useState(false);
  const [openDropActive, setOpenDropActive] = useState(false);
  const [pendingColumnEl, setPendingColumnEl] = useState<HTMLDivElement | null>(null);
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [modalResult, setModalResult] = useState<TaskBoardContentResult | null>(null);
  // Tracks which task the current modalResult belongs to, so a failed artifact
  // re-read on the SAME task keeps the previous content, while switching tasks
  // clears stale content if the new task's initial read fails.
  const modalTaskFileNameRef = useRef<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [killTarget, setKillTarget] = useState<KillTarget | null>(null);
  const [chainInventory, setChainInventory] = useState<TaskBoardReadChildChainBranchInventoryResponse | null>(null);
  const [chainInventoryLoading, setChainInventoryLoading] = useState(false);
  const sortedCompletedItems = useMemo(
    () => board.completedItems
      .map((item, index) => ({ item, index, ms: archivedAtMs(item) }))
      .sort((left, right) => {
        if (left.ms !== null && right.ms !== null && left.ms !== right.ms) return right.ms - left.ms;
        if (left.ms !== null && right.ms === null) return -1;
        if (left.ms === null && right.ms !== null) return 1;
        return left.index - right.index;
      })
      .map((entry) => entry.item),
    [board.completedItems],
  );

  useEffect(() => {
    if (!selectedTask || !readTaskContent) {
      setModalResult(null);
      modalTaskFileNameRef.current = null;
      return;
    }
    const isTaskSwitch = modalTaskFileNameRef.current !== selectedTask.fileName;
    if (isTaskSwitch) {
      // New task: drop prior content so a failed initial read can't show stale content.
      setModalResult(null);
    }
    modalTaskFileNameRef.current = selectedTask.fileName;
    let cancelled = false;
    void readTaskContent(selectedTask.fileName, selectedTask.column, selectedTask.artifactRelativePath)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setModalResult(result);
        } else if (isTaskSwitch) {
          setModalResult(null);
        }
        // Same-task artifact read failed: keep the previous modalResult.
      });
    return () => { cancelled = true; };
  }, [selectedTask, readTaskContent]);

  const handleCardClick = useCallback(
    (fileName: string, title: string | null, column: TaskBoardContentColumn, completedEntry?: ArchivedTaskEntry) => {
      if (!readTaskContent) return;
      // Omit artifactRelativePath so the initial completed read defaults to archive.md.
      // Retain childChain metadata so the completed detail modal can offer View Chain
      // without re-deriving chain membership from file names or markdown.
      setSelectedTask({
        fileName,
        title,
        column,
        ...(completedEntry ? { taskId: completedEntry.taskId, childChain: completedEntry.childChain } : {}),
      });
    },
    [readTaskContent],
  );

  const handleSelectArtifact = useCallback((relativePath: string) => {
    setSelectedTask((prev) => (prev ? { ...prev, artifactRelativePath: relativePath } : prev));
  }, []);

  const handleViewChain = useCallback(() => {
    if (!readChildChainBranchInventory || !selectedTask) return;
    if (selectedTask.column !== 'completed' || !selectedTask.taskId || !selectedTask.childChain) return;
    setChainInventoryLoading(true);
    void readChildChainBranchInventory(selectedTask.taskId, selectedTask.childChain.rootTaskId)
      .then((response) => {
        if (response) setChainInventory(response);
      })
      .finally(() => setChainInventoryLoading(false));
  }, [readChildChainBranchInventory, selectedTask]);

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

      if (sourceColumn === 'error' || sourceColumn === 'pending') {
        void onMoveToOpen?.(fileName, sourceColumn);
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

      const pinnedCount = board.pendingItems.filter((item) => isPinnedPendingState(item.state)).length;

      if (sourceColumn === 'open') {
        const safeIndex = Math.max(dropIndex, pinnedCount);
        void onMoveToPending?.(fileName, safeIndex);
        return;
      }

      if (sourceColumn === 'error') {
        const safeIndex = Math.max(dropIndex, pinnedCount);
        void onRequeueErrorItem(fileName, safeIndex);
        return;
      }

      if (sourceColumn === 'pending') {
        const currentOrder = board.pendingItems.map((item) => item.fileName);
        const filtered = currentOrder.filter((name) => name !== fileName);
        const clampedIndex = Math.min(dropIndex, filtered.length);
        filtered.splice(clampedIndex, 0, fileName);

        // Pin active and activating items above normal pending rows.
        const pinnedNames = board.pendingItems
          .filter((item) => isPinnedPendingState(item.state))
          .map((item) => item.fileName);
        for (const pinnedName of [...pinnedNames].reverse()) {
          const pinnedIdx = filtered.indexOf(pinnedName);
          if (pinnedIdx > 0) {
            filtered.splice(pinnedIdx, 1);
            filtered.unshift(pinnedName);
          }
        }
        void onReorderPending(filtered);
      }
    },
    [board.pendingItems, pendingColumnEl, onReorderPending, onRequeueErrorItem, onMoveToPending],
  );

  const sortedPendingItems = useMemo(
    () =>
      [...board.pendingItems].sort((a, b) => {
        const pa = isPinnedPendingState(a.state);
        const pb = isPinnedPendingState(b.state);
        return pa === pb ? 0 : pa ? -1 : 1;
      }),
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
                isActivating={item.state === 'activating'}
                isStopping={item.state === 'stopping'}
                isCleanupAttention={item.state === 'stopping' && item.stopCleanupStatus === 'failed'}
                meta={pendingMeta(item)}
                draggable={item.state === 'pending'}
                sourceColumn="pending"
                onClick={() => handleCardClick(item.fileName, item.title, 'pending')}
                onDelete={onDeleteTask && item.state === 'pending' ? () => setDeleteTarget({ fileName: item.fileName, title: item.title, column: 'pending' }) : undefined}
                onStop={onKillTask && item.taskId && (item.state === 'active' || item.state === 'activating')
                  ? () => setKillTarget({ fileName: item.fileName, taskId: item.taskId!, title: item.title })
                  : undefined}
                onRetryCleanup={onRetryKillCleanup && item.taskId && item.state === 'stopping' && item.stopCleanupStatus === 'failed' && item.stopCleanupRetryable
                  ? () => { void onRetryKillCleanup(item.fileName, item.taskId!); }
                  : undefined}
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
            sortedCompletedItems.map((item) => (
              <TaskBoardCard
                key={item.taskId}
                fileName={`${item.taskId}.md`}
                title={item.title}
                taskId={item.taskId}
                meta={completedMeta(item.archivedAt)}
                badge={completedChildChainBadge(item)}
                onClick={() => handleCardClick(`${item.taskId}.md`, item.title, 'completed', item)}
              />
            ))
          )}
        </TaskBoardColumn>
      </div>

      {selectedTask && modalResult !== null && (
        <TaskDetailModal
          title={selectedTask.title}
          content={modalResult.content}
          column={selectedTask.column}
          onClose={() => { setSelectedTask(null); setChainInventory(null); }}
          artifactExplorer={
            selectedTask.column === 'completed' && modalResult.artifacts
              ? {
                  artifacts: modalResult.artifacts,
                  selectedRelativePath: modalResult.artifactRelativePath ?? 'archive.md',
                  onSelectArtifact: handleSelectArtifact,
                }
              : undefined
          }
          childChainAction={
            selectedTask.column === 'completed' && selectedTask.childChain
              ? {
                  onViewChain: handleViewChain,
                  disabled: chainInventoryLoading,
                  loading: chainInventoryLoading,
                }
              : undefined
          }
        />
      )}

      {chainInventory && (
        <ChildChainBranchInventoryModal
          response={chainInventory}
          onClose={() => setChainInventory(null)}
          zIndex={102}
          escPriority={20}
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

      {killTarget && (
        <div className="task-board-confirm__overlay" onClick={() => setKillTarget(null)}>
          <div className="task-board-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="task-board-confirm__title">Stop this task?</p>
            <p className="task-board-confirm__hint">
              This will stop the task, run failure cleanup, and move it to Failed.
            </p>
            <div className="task-board-confirm__actions">
              <button
                className="task-board-confirm__btn"
                onClick={() => setKillTarget(null)}
              >
                Cancel
              </button>
              <button
                className="task-board-confirm__btn task-board-confirm__btn--danger"
                onClick={() => {
                  if (!killTarget || !onKillTask) return;
                  const target = killTarget;
                  setKillTarget(null);
                  void onKillTask(target.fileName, target.taskId).catch(() => {});
                }}
              >
                Stop task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TaskBoard;
