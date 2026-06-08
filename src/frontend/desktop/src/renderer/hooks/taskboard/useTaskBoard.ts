import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ArchivedTaskEntry,
  TaskBoardContentColumn,
  TaskBoardDeleteColumn,
  TaskBoardItem,
  TaskBoardMarkdownArtifact,
  TaskBoardPendingItem,
  TaskBoardReadBoardResponse,
  TaskBoardReadTaskContentResponse,
  TaskBoardReadChildChainBranchInventoryResponse,
} from '../../../shared/desktopContract';
import { isTaskBoardReadBoardResponse } from '../../../shared/desktopContractTypeGuards';
import { useToastContext } from '../../contexts/ToastContext';
import { createLogger } from '../../log/logger';
import type { DesktopShellClient } from '../../services/desktopShellClient';

export type TaskBoardState = {
  dropboxItems: TaskBoardItem[];
  pendingItems: TaskBoardPendingItem[];
  errorItems: TaskBoardItem[];
  completedItems: ArchivedTaskEntry[];
};

const EMPTY_BOARD: TaskBoardState = {
  dropboxItems: [],
  pendingItems: [],
  errorItems: [],
  completedItems: [],
};

export type TaskBoardContentResult = {
  content: string;
  artifactRelativePath?: string;
  contentType?: TaskBoardMarkdownArtifact['contentType'];
  artifacts?: TaskBoardMarkdownArtifact[];
};

const log = createLogger('src/renderer/hooks/useTaskBoard');

export type UseTaskBoardResult = {
  board: TaskBoardState;
  refresh: () => Promise<void>;
  reorderPending: (order: string[]) => Promise<void>;
  requeueErrorItem: (fileName: string, insertAtIndex: number) => Promise<void>;
  deleteTask: (fileName: string, column: TaskBoardDeleteColumn) => Promise<boolean>;
  moveToPending: (fileName: string, insertAtIndex: number) => Promise<void>;
  moveToOpen: (fileName: string, sourceColumn?: 'error' | 'pending') => Promise<void>;
  killTask: (fileName: string, taskId: string) => Promise<void>;
  retryKillCleanup: (fileName: string, taskId: string) => Promise<void>;
  readTaskContent: (
    fileName: string,
    column: TaskBoardContentColumn,
    artifactRelativePath?: string,
  ) => Promise<TaskBoardContentResult | null>;
  readChildChainBranchInventory: (
    taskId: string,
    expectedRootTaskId?: string | null,
  ) => Promise<TaskBoardReadChildChainBranchInventoryResponse | null>;
};

export function useTaskBoard(client: DesktopShellClient): UseTaskBoardResult {
  const [board, setBoard] = useState<TaskBoardState>(EMPTY_BOARD);
  const { addToast } = useToastContext();

  // Shared apply path: only apply snapshots whose sequence is >= the last applied.
  // This prevents older reads from overwriting newer push/refresh snapshots.
  const lastBoardJsonRef = useRef('');
  const lastAppliedSequenceRef = useRef(-1);

  const applyBoardSnapshot = useCallback((resp: TaskBoardReadBoardResponse) => {
    if (resp.boardSnapshotSequence < lastAppliedSequenceRef.current) return;
    const json = JSON.stringify([
      resp.dropboxItems,
      resp.pendingItems,
      resp.errorItems,
      resp.completedItems,
    ]);
    if (json === lastBoardJsonRef.current) {
      // Still update sequence even when content is unchanged; freshness matters.
      lastAppliedSequenceRef.current = resp.boardSnapshotSequence;
      return;
    }
    lastBoardJsonRef.current = json;
    lastAppliedSequenceRef.current = resp.boardSnapshotSequence;
    setBoard({
      dropboxItems: resp.dropboxItems,
      pendingItems: resp.pendingItems,
      errorItems: resp.errorItems,
      completedItems: resp.completedItems,
    });
  }, []);

  const refresh = useCallback(async () => {
    let result: Awaited<ReturnType<DesktopShellClient['readTaskBoard']>>;
    try {
      result = await client.readTaskBoard();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Task board refresh failed.';
      log.warn('task-board.refresh.failed', { reason });
      addToast({ severity: 'error', message: reason, duration: 6000 });
      return;
    }
    if (!result.ok) {
      addToast({ severity: 'error', message: result.error, duration: 6000 });
      return;
    }
    if (isTaskBoardReadBoardResponse(result.response)) {
      applyBoardSnapshot(result.response as TaskBoardReadBoardResponse);
    }
  }, [client, addToast, applyBoardSnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to push-based board updates from the filesystem watcher.
  useEffect(() => {
    if (!window.desktopShell?.onTaskBoardUpdate) return;
    const unsubscribe = window.desktopShell.onTaskBoardUpdate((response) => {
      applyBoardSnapshot(response);
    });
    return unsubscribe;
  }, [applyBoardSnapshot]);

  const reorderPending = useCallback(
    async (order: string[]) => {
      let result: Awaited<ReturnType<DesktopShellClient['reorderPending']>>;
      try {
        result = await client.reorderPending(order);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to reorder pending queue.';
        log.warn('task-board.reorder-pending.failed', { reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        return;
      }
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        return;
      }
      addToast({ severity: 'success', message: 'Pending queue reordered.', duration: 3000 });
      await refresh();
    },
    [client, addToast, refresh],
  );

  const requeueErrorItem = useCallback(
    async (fileName: string, insertAtIndex: number) => {
      let result: Awaited<ReturnType<DesktopShellClient['requeueErrorItem']>>;
      try {
        result = await client.requeueErrorItem(fileName, insertAtIndex);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to requeue task.';
        log.warn('task-board.requeue-error.failed', { fileName, reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        return;
      }
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        return;
      }
      addToast({ severity: 'success', message: `Requeued ${fileName}.`, duration: 3000 });
      await refresh();
    },
    [client, addToast, refresh],
  );

  const readTaskContent = useCallback(
    async (
      fileName: string,
      column: TaskBoardContentColumn,
      artifactRelativePath?: string,
    ): Promise<TaskBoardContentResult | null> => {
      let result: Awaited<ReturnType<DesktopShellClient['readTaskContent']>>;
      try {
        result = await client.readTaskContent(fileName, column, artifactRelativePath);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to read task content.';
        log.warn('task-board.read-task-content.failed', { fileName, column, reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        return null;
      }
      if (!result.ok) return null;
      const resp = result.response as TaskBoardReadTaskContentResponse;
      if (resp.mode === 'not-found') return null;
      return {
        content: resp.content,
        artifactRelativePath: resp.artifactRelativePath,
        contentType: resp.contentType,
        artifacts: resp.artifacts,
      };
    },
    [client, addToast],
  );

  const readChildChainBranchInventory = useCallback(
    async (
      taskId: string,
      expectedRootTaskId?: string | null,
    ): Promise<TaskBoardReadChildChainBranchInventoryResponse | null> => {
      let result: Awaited<ReturnType<DesktopShellClient['readChildChainBranchInventory']>>;
      try {
        result = await client.readChildChainBranchInventory(taskId, expectedRootTaskId);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to read child chain branches.';
        log.warn('task-board.read-child-chain-branch-inventory.failed', { taskId, reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        return null;
      }
      // not-chain-task and invalid-state are valid modal states, not failures.
      if (!result.ok) return null;
      return result.response as TaskBoardReadChildChainBranchInventoryResponse;
    },
    [client, addToast],
  );

  const deleteTask = useCallback(
    async (fileName: string, column: TaskBoardDeleteColumn): Promise<boolean> => {
      let result: Awaited<ReturnType<DesktopShellClient['deleteTask']>>;
      try {
        result = await client.deleteTask(fileName, column);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to delete task.';
        log.warn('task-board.delete-task.failed', { fileName, column, reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        return false;
      }
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        return false;
      }
      addToast({ severity: 'success', message: `Deleted ${fileName}.`, duration: 3000 });
      // Refresh as a backstop in case watcher delivery is absent.
      await refresh();
      return true;
    },
    [client, addToast, refresh],
  );

  const moveToPending = useCallback(
    async (fileName: string, insertAtIndex: number) => {
      let result: Awaited<ReturnType<DesktopShellClient['moveToPending']>>;
      try {
        result = await client.moveToPending(fileName, insertAtIndex);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to move task to pending.';
        log.warn('task-board.move-to-pending.failed', { fileName, reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        return;
      }
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        return;
      }
      addToast({ severity: 'success', message: `Moved ${fileName} to pending.`, duration: 3000 });
      // Refresh as a backstop in case watcher delivery is absent.
      await refresh();
    },
    [client, addToast, refresh],
  );

  const moveToOpen = useCallback(
    async (fileName: string, sourceColumn: 'error' | 'pending' = 'error') => {
      let result: Awaited<ReturnType<DesktopShellClient['moveToOpen']>>;
      try {
        result = await client.moveToOpen(fileName, sourceColumn);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to move task to open.';
        log.warn('task-board.move-to-open.failed', { fileName, reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        return;
      }
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        return;
      }
      addToast({ severity: 'success', message: `Moved ${fileName} to open.`, duration: 3000 });
      // Refresh as a backstop in case watcher delivery is absent.
      await refresh();
    },
    [client, addToast, refresh],
  );

  const killTask = useCallback(
    async (fileName: string, taskId: string) => {
      let result: Awaited<ReturnType<DesktopShellClient['killTask']>>;
      setBoard((current) => ({
        ...current,
        pendingItems: current.pendingItems.map((item) => (
          item.fileName === fileName && item.taskId === taskId && (item.state === 'active' || item.state === 'activating')
            ? { ...item, state: 'stopping', stopRequestedAt: new Date().toISOString() }
            : item
        )),
      }));
      // Invalidate the dedup cache so the subsequent rollback refresh is never
      // skipped even if the board content matches the pre-optimistic snapshot.
      lastBoardJsonRef.current = '';
      try {
        result = await client.killTask(fileName, taskId);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to stop task.';
        log.warn('task-board.kill-task.failed', { fileName, taskId, reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        await refresh();
        return;
      }
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        await refresh();
        return;
      }
      addToast({ severity: 'success', message: result.response.message, duration: 3000 });
    },
    [client, addToast, refresh],
  );

  const retryKillCleanup = useCallback(
    async (fileName: string, taskId: string) => {
      let result: Awaited<ReturnType<DesktopShellClient['retryKillCleanup']>>;
      try {
        result = await client.retryKillCleanup(fileName, taskId);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unable to retry cleanup.';
        log.warn('task-board.retry-kill-cleanup.failed', { fileName, taskId, reason });
        addToast({ severity: 'error', message: reason, duration: 6000 });
        await refresh();
        return;
      }
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        await refresh();
        return;
      }
      addToast({ severity: 'success', message: result.response.message, duration: 3000 });
    },
    [client, addToast, refresh],
  );

  return {
    board,
    refresh,
    reorderPending,
    requeueErrorItem,
    deleteTask,
    moveToPending,
    moveToOpen,
    killTask,
    retryKillCleanup,
    readTaskContent,
    readChildChainBranchInventory,
  };
}
