import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withDirLock } from './dirLock.js';
import {
  readChildTaskChains,
  writeChildTaskChains,
  type ChildTaskChainsState,
  type ChildTaskContextSnapshot,
} from './childTaskChains.js';
import type { TaskBranchChainBinding } from './markdown.js';

export type RecordPlannedChildTaskOptions = {
  taskId: string;
  rootTaskId: string;
  parentTaskId: string;
  previousTaskId: string;
  branchChain: TaskBranchChainBinding;
  parentArchivePath: string | null;
  parentArchiveArtifactDir: string | null;
  parentContextSnapshot: ChildTaskContextSnapshot | null;
  childExecutionScope: ChildTaskContextSnapshot;
  now?: Date;
};

export async function recordPlannedChildTask(
  repoRoot: string,
  options: RecordPlannedChildTaskOptions,
): Promise<ChildTaskChainsState> {
  const stateDir = path.join(repoRoot, '.platform-state');
  await mkdir(stateDir, { recursive: true });
  return withDirLock(
    path.join(stateDir, 'child-task-chains.lock'),
    'recordPlannedChildTask',
    async () => recordPlannedChildTaskLocked(repoRoot, options),
  );
}

async function recordPlannedChildTaskLocked(
  repoRoot: string,
  options: RecordPlannedChildTaskOptions,
): Promise<ChildTaskChainsState> {
  validateOptions(options);
  const state = await readChildTaskChains(repoRoot);
  if (state.tasks[options.taskId]) {
    throw new Error('child-task-chain-task-exists');
  }

  const now = (options.now ?? new Date()).toISOString();
  const parent = state.tasks[options.parentTaskId];
  const chains = { ...state.chains };
  const tasks = { ...state.tasks };
  let depth: number;
  let taskIds: string[];
  let chainCreatedAt = now;

  if (parent) {
    const chain = chains[parent.rootTaskId];
    if (!chain || chain.currentTipTaskId !== options.parentTaskId) {
      throw new Error('child-task-chain-parent-not-current-tip');
    }
    if (parent.state !== 'completed') {
      throw new Error('child-task-chain-parent-tip-not-completed');
    }
    if (options.rootTaskId !== parent.rootTaskId) {
      throw new Error('child-task-chain-root-mismatch');
    }
    depth = parent.depth + 1;
    taskIds = chain.taskIds.includes(options.taskId)
      ? [...chain.taskIds]
      : [...chain.taskIds, options.taskId];
    chainCreatedAt = chain.createdAt;
  } else {
    if (options.rootTaskId !== options.parentTaskId) {
      throw new Error('child-task-chain-parent-state-missing');
    }
    depth = 1;
    taskIds = [options.parentTaskId, options.taskId];
    tasks[options.parentTaskId] = {
      taskId: options.parentTaskId,
      rootTaskId: options.rootTaskId,
      parentTaskId: null,
      previousTaskId: null,
      depth: 0,
      state: 'completed',
      archivePath: options.parentArchivePath,
      archiveArtifactDir: options.parentArchiveArtifactDir,
      parentArchivePath: null,
      parentArchiveArtifactDir: null,
      parentContextSnapshot: options.parentContextSnapshot,
      childExecutionScope: options.parentContextSnapshot,
      branchChain: null,
      completedBranchHandoffs: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (options.branchChain.depth !== depth) {
    throw new Error('child-task-chain-depth-mismatch');
  }
  tasks[options.taskId] = {
    taskId: options.taskId,
    rootTaskId: options.rootTaskId,
    parentTaskId: options.parentTaskId,
    previousTaskId: options.previousTaskId,
    depth,
    state: 'planned',
    archivePath: null,
    archiveArtifactDir: null,
    parentArchivePath: options.parentArchivePath,
    parentArchiveArtifactDir: options.parentArchiveArtifactDir,
    parentContextSnapshot: options.parentContextSnapshot,
    childExecutionScope: options.childExecutionScope,
    branchChain: options.branchChain,
    completedBranchHandoffs: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  chains[options.rootTaskId] = {
    rootTaskId: options.rootTaskId,
    currentTipTaskId: options.taskId,
    contextPackId: options.childExecutionScope.contextPackId,
    contextPackDir: options.childExecutionScope.contextPackDir,
    taskIds,
    createdAt: chainCreatedAt,
    updatedAt: now,
  };
  const updated = { schemaVersion: 1 as const, updatedAt: now, chains, tasks };
  await writeChildTaskChains(repoRoot, updated);
  return readChildTaskChains(repoRoot);
}

function validateOptions(options: RecordPlannedChildTaskOptions): void {
  for (const key of ['taskId', 'rootTaskId', 'parentTaskId', 'previousTaskId'] as const) {
    if (!options[key]?.trim()) {
      throw new Error(`child-task-chain-${key}-missing`);
    }
  }
  if (
    options.branchChain.rootTaskId !== options.rootTaskId
    || options.branchChain.parentTaskId !== options.parentTaskId
    || options.previousTaskId !== options.parentTaskId
  ) {
    throw new Error('child-task-chain-branch-chain-mismatch');
  }
  if (options.branchChain.repos.length === 0) {
    throw new Error('child-task-chain-branch-chain-missing-repos');
  }
}
