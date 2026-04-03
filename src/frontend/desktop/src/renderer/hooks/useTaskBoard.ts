import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ArchivedTaskEntry,
  TaskBoardContentColumn,
  TaskBoardDeleteColumn,
  TaskBoardItem,
  TaskBoardReadBoardResponse,
  TaskBoardReadTaskContentResponse,
} from '../../shared/desktopContract';
import { isTaskBoardReadBoardResponse } from '../../shared/desktopContractTypeGuards';
import { useToastContext } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';

export type TaskBoardState = {
  dropboxItems: TaskBoardItem[];
  pendingItems: (TaskBoardItem & { state: 'active' | 'pending' })[];
  errorItems: TaskBoardItem[];
  completedItems: ArchivedTaskEntry[];
};

const EMPTY_BOARD: TaskBoardState = {
  dropboxItems: [],
  pendingItems: [],
  errorItems: [],
  completedItems: [],
};

export type UseTaskBoardResult = {
  board: TaskBoardState;
  refresh: () => Promise<void>;
  reorderPending: (order: string[]) => Promise<void>;
  requeueErrorItem: (fileName: string, insertAtIndex: number) => Promise<void>;
  deleteTask: (fileName: string, column: TaskBoardDeleteColumn) => Promise<boolean>;
  moveToPending: (fileName: string, insertAtIndex: number) => Promise<void>;
  moveToOpen: (fileName: string) => Promise<void>;
  readTaskContent: (fileName: string, column: TaskBoardContentColumn) => Promise<string | null>;
};

export function useTaskBoard(client: DesktopShellClient): UseTaskBoardResult {
  const [board, setBoard] = useState<TaskBoardState>(EMPTY_BOARD);
  const { addToast } = useToastContext();

  const refresh = useCallback(async () => {
    const result = await client.readTaskBoard();
    if (!result.ok) {
      addToast({ severity: 'error', message: result.error, duration: 6000 });
      return;
    }
    if (isTaskBoardReadBoardResponse(result.response)) {
      const resp = result.response as TaskBoardReadBoardResponse;
      setBoard({
        dropboxItems: resp.dropboxItems,
        pendingItems: resp.pendingItems,
        errorItems: resp.errorItems,
        completedItems: resp.completedItems,
      });
    }
  }, [client, addToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to push-based board updates from the filesystem watcher.
  // Skip no-op updates to avoid unnecessary re-renders.
  const lastBoardJsonRef = useRef('');
  useEffect(() => {
    if (!window.desktopShell?.onTaskBoardUpdate) return;
    const unsubscribe = window.desktopShell.onTaskBoardUpdate((response) => {
      const json = JSON.stringify([
        response.dropboxItems,
        response.pendingItems,
        response.errorItems,
      ]);
      if (json === lastBoardJsonRef.current) return;
      lastBoardJsonRef.current = json;
      setBoard({
        dropboxItems: response.dropboxItems,
        pendingItems: response.pendingItems,
        errorItems: response.errorItems,
        completedItems: response.completedItems,
      });
    });
    return unsubscribe;
  }, []);

  const reorderPending = useCallback(
    async (order: string[]) => {
      const result = await client.reorderPending(order);
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
      const result = await client.requeueErrorItem(fileName, insertAtIndex);
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
    async (fileName: string, column: TaskBoardContentColumn): Promise<string | null> => {
      const result = await client.readTaskContent(fileName, column);
      if (!result.ok) return null;
      const resp = result.response as TaskBoardReadTaskContentResponse;
      if (resp.mode === 'not-found') return null;
      return resp.content;
    },
    [client],
  );

  const deleteTask = useCallback(
    async (fileName: string, column: TaskBoardDeleteColumn): Promise<boolean> => {
      const result = await client.deleteTask(fileName, column);
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        return false;
      }
      addToast({ severity: 'success', message: `Deleted ${fileName}.`, duration: 3000 });
      return true;
    },
    [client, addToast],
  );

  const moveToPending = useCallback(
    async (fileName: string, insertAtIndex: number) => {
      const result = await client.moveToPending(fileName, insertAtIndex);
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        return;
      }
      addToast({ severity: 'success', message: `Moved ${fileName} to pending.`, duration: 3000 });
    },
    [client, addToast],
  );

  const moveToOpen = useCallback(
    async (fileName: string) => {
      const result = await client.moveToOpen(fileName);
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error, duration: 6000 });
        return;
      }
      addToast({ severity: 'success', message: `Moved ${fileName} to open.`, duration: 3000 });
    },
    [client, addToast],
  );

  return { board, refresh, reorderPending, requeueErrorItem, deleteTask, moveToPending, moveToOpen, readTaskContent };
}
