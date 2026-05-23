import path from 'node:path';

import { createLogger, ensureDir } from '../core/index.js';
import { withDirLock } from './dirLock.js';
import {
  readChildTaskChains,
  writeChildTaskChains,
  type ChildTaskChainTaskRecord,
  type ChildTaskChainsState,
} from './childTaskChains.js';

export type DeletedChildTaskChainCleanupResult = {
  mode: 'not-child-chain-task' | 'rolled-back-to-parent' | 'removed-chain';
  taskId: string;
  rootTaskId?: string;
  parentTaskId?: string | null;
  previousTipTaskId?: string;
};

const log = createLogger('queue/childTaskChainDeletion');

function blocked(prefix: string, taskId: string, reason: string, details: Record<string, unknown>): never {
  log.warn('child-task-chain.delete-cleanup.blocked', { taskId, reason, ...details });
  throw new Error(`${prefix} for task "${taskId}": ${reason}`);
}

function cloneState(state: ChildTaskChainsState): ChildTaskChainsState {
  return {
    ...state,
    chains: Object.fromEntries(Object.entries(state.chains).map(([id, chain]) => [id, { ...chain, taskIds: [...chain.taskIds] }])),
    tasks: Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, { ...task }])),
  };
}

function isSyntheticRootOnly(task: ChildTaskChainTaskRecord | undefined, rootTaskId: string): boolean {
  return Boolean(
    task &&
    task.taskId === rootTaskId &&
    task.rootTaskId === rootTaskId &&
    task.parentTaskId === null &&
    task.depth === 0 &&
    task.state === 'completed',
  );
}

export async function cleanupDeletedChildTaskChainTask(
  repoRoot: string,
  taskId: string,
  performQueueDelete: () => Promise<void>,
  options?: { now?: string },
): Promise<DeletedChildTaskChainCleanupResult> {
  await ensureDir(path.join(repoRoot, '.platform-state'));
  return withDirLock(path.join(repoRoot, '.platform-state', 'child-task-chains.lock'), 'Clean child task chain deleted task', async () => {
    const state = await readChildTaskChains(repoRoot);
    const task = state.tasks[taskId];
    if (!task) {
      await performQueueDelete();
      log.info('child-task-chain.delete-cleanup.skipped', { taskId, mode: 'not-child-chain-task', reason: 'task-not-in-child-chain-state' });
      return { mode: 'not-child-chain-task', taskId };
    }
    if (task.state === 'completed') {
      blocked('child-task-chain-delete-cleanup-blocked-completed-task', taskId, 'completed chain tasks must remain archived history', {
        rootTaskId: task.rootTaskId,
        parentTaskId: task.parentTaskId,
      });
    }
    const chain = state.chains[task.rootTaskId];
    if (!chain || chain.currentTipTaskId !== taskId || !chain.taskIds.includes(taskId)) {
      blocked('child-task-chain-delete-cleanup-blocked-non-tip-task', taskId, 'only the non-completed current chain tip can be cleaned up during task-board delete', {
        rootTaskId: task.rootTaskId,
        parentTaskId: task.parentTaskId,
        currentTipTaskId: chain?.currentTipTaskId,
      });
    }
    if (task.rootTaskId !== chain.rootTaskId) {
      blocked('child-task-chain-delete-cleanup-blocked-non-tip-task', taskId, 'task root does not match chain root', {
        rootTaskId: task.rootTaskId,
        chainRootTaskId: chain.rootTaskId,
      });
    }
    if (task.parentTaskId === null) {
      blocked('child-task-chain-delete-cleanup-invalid-root-task', taskId, 'non-completed root child-chain tasks are not supported', {
        rootTaskId: task.rootTaskId,
      });
    }

    const next = cloneState(state);
    const nextChain = { ...chain, taskIds: chain.taskIds.filter((id) => id !== taskId) };
    delete next.tasks[taskId];
    const parentTask = next.tasks[task.parentTaskId];
    const now = options?.now ?? new Date().toISOString();
    next.updatedAt = now;

    let result: DeletedChildTaskChainCleanupResult;
    if (nextChain.taskIds.length === 1 && isSyntheticRootOnly(parentTask, task.rootTaskId)) {
      delete next.chains[task.rootTaskId];
      delete next.tasks[task.rootTaskId];
      result = {
        mode: 'removed-chain',
        taskId,
        rootTaskId: task.rootTaskId,
        parentTaskId: task.parentTaskId,
        previousTipTaskId: taskId,
      };
    } else {
      if (!parentTask || parentTask.rootTaskId !== task.rootTaskId || parentTask.state !== 'completed') {
        blocked('child-task-chain-delete-cleanup-invalid-parent-state', taskId, 'parent task must be a completed task in the same child chain', {
          rootTaskId: task.rootTaskId,
          parentTaskId: task.parentTaskId,
          parentState: parentTask?.state,
        });
      }
      next.chains[task.rootTaskId] = {
        ...nextChain,
        currentTipTaskId: task.parentTaskId,
        updatedAt: now,
      };
      result = {
        mode: 'rolled-back-to-parent',
        taskId,
        rootTaskId: task.rootTaskId,
        parentTaskId: task.parentTaskId,
        previousTipTaskId: taskId,
      };
    }

    await performQueueDelete();
    try {
      await writeChildTaskChains(repoRoot, next);
    } catch (error) {
      log.error('child-task-chain.delete-cleanup.failed', error, {
        taskId,
        rootTaskId: task.rootTaskId,
        parentTaskId: task.parentTaskId,
        mode: result.mode,
        reason: 'child-chain-write-failed',
      });
      throw error;
    }
    log.info(
      result.mode === 'removed-chain'
        ? 'child-task-chain.delete-cleanup.removed-chain'
        : 'child-task-chain.delete-cleanup.rolled-back',
      result,
    );
    return result;
  });
}
