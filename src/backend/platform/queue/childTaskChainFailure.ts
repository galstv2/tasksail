import {
  readChildTaskChains,
  writeChildTaskChains,
  type ChildTaskChainsState,
} from './childTaskChains.js';
import { withDirLock } from './dirLock.js';
import path from 'node:path';

export async function markChildTaskChainTaskFailed(args: {
  repoRoot: string;
  taskId: string;
  now?: string;
}): Promise<{ marked: boolean; rootTaskId: string | null; currentTipTaskId: string | null }> {
  const lockDir = path.join(args.repoRoot, '.platform-state', 'child-task-chains.lock');
  return withDirLock(lockDir, 'Mark child-chain task failed', async () => {
    const state = await readChildTaskChains(args.repoRoot);
    const task = state.tasks[args.taskId];
    if (!task) {
      return { marked: false, rootTaskId: null, currentTipTaskId: null };
    }
    const chain = state.chains[task.rootTaskId];
    if (!chain || chain.currentTipTaskId !== args.taskId) {
      throw new Error(`child-task-chain-failure-not-current-tip: ${args.taskId}`);
    }
    if (task.state === 'completed') {
      throw new Error(`child-task-chain-failure-completed-task: ${args.taskId}`);
    }
    if (task.state === 'failed') {
      return { marked: true, rootTaskId: task.rootTaskId, currentTipTaskId: chain.currentTipTaskId };
    }

    const now = args.now ?? new Date().toISOString();
    const updated: ChildTaskChainsState = {
      ...state,
      updatedAt: now,
      chains: {
        ...state.chains,
        [task.rootTaskId]: {
          ...chain,
          updatedAt: now,
        },
      },
      tasks: {
        ...state.tasks,
        [args.taskId]: {
          ...task,
          state: 'failed',
          updatedAt: now,
        },
      },
    };
    await writeChildTaskChains(args.repoRoot, updated);
    return { marked: true, rootTaskId: task.rootTaskId, currentTipTaskId: chain.currentTipTaskId };
  });
}

export async function resetFailedChildTaskChainTaskToPlanned(args: {
  repoRoot: string;
  taskId: string;
  now?: string;
}): Promise<{ reset: boolean; rootTaskId: string | null; currentTipTaskId: string | null }> {
  const lockDir = path.join(args.repoRoot, '.platform-state', 'child-task-chains.lock');
  return withDirLock(lockDir, 'Reset failed child-chain task to planned', async () => {
    const state = await readChildTaskChains(args.repoRoot);
    const task = state.tasks[args.taskId];
    if (!task) {
      return { reset: false, rootTaskId: null, currentTipTaskId: null };
    }
    const chain = state.chains[task.rootTaskId];
    if (!chain || chain.currentTipTaskId !== args.taskId) {
      throw new Error(`child-task-chain-reopen-not-current-tip: ${args.taskId}`);
    }
    if (task.state === 'completed') {
      throw new Error(`child-task-chain-reopen-completed-task: ${args.taskId}`);
    }
    if (task.state !== 'failed') {
      return { reset: false, rootTaskId: task.rootTaskId, currentTipTaskId: chain.currentTipTaskId };
    }

    const now = args.now ?? new Date().toISOString();
    const updated: ChildTaskChainsState = {
      ...state,
      updatedAt: now,
      chains: {
        ...state.chains,
        [task.rootTaskId]: {
          ...chain,
          updatedAt: now,
        },
      },
      tasks: {
        ...state.tasks,
        [args.taskId]: {
          ...task,
          state: 'planned',
          updatedAt: now,
        },
      },
    };
    await writeChildTaskChains(args.repoRoot, updated);
    return { reset: true, rootTaskId: task.rootTaskId, currentTipTaskId: chain.currentTipTaskId };
  });
}
