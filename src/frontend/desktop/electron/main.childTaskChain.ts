import path from 'node:path';
import { readChildTaskChains, type ChildTaskContextSnapshot } from '../../../backend/platform/queue/childTaskChains.js';
import type { TaskBranchChainBinding } from '../../../backend/platform/queue/markdown.js';
import type { PlannerStagingContextPackBinding } from '../../../backend/platform/planner-history/types.js';
import type { PlannerListArchivedTasksResponse } from '../src/shared/desktopContract';
import { listArchivedTasksAction } from './main.archivedTasks';
import { buildAdjustedChildBranchChainRepos } from './main.childTaskChainDivergence';
import type { ContextPackLister } from './main.contextPackTaskVisibility';

export type ResolvedChildTaskChainCreationContext = {
  branchChain: TaskBranchChainBinding;
  rootTaskId: string;
  depth: number;
  previousTaskId: string;
  parentArchivePath: string;
  parentArchiveArtifactDir: string | null;
  parentContextSnapshot: ChildTaskContextSnapshot | null;
  childExecutionScope: ChildTaskContextSnapshot;
};

export async function resolveChildTaskChainCreationContext(args: {
  repoRoot: string;
  listContextPacks: ContextPackLister;
  parentTaskId: string;
  requestedRootTaskId: string;
  childExecutionScope: PlannerStagingContextPackBinding;
}): Promise<ResolvedChildTaskChainCreationContext> {
  if (!args.childExecutionScope.contextPackDir.trim() || !args.childExecutionScope.contextPackId.trim()) {
    blocked('child execution scope is missing context pack identity.');
  }
  const archiveResult = await listArchivedTasksAction(args.listContextPacks, {
    scope: {
      contextPackDir: args.childExecutionScope.contextPackDir,
      contextPackId: args.childExecutionScope.contextPackId,
      contextPackName: path.basename(args.childExecutionScope.contextPackDir),
    },
  });
  if (!archiveResult.ok) blocked(archiveResult.error);
  const response = archiveResult.response as PlannerListArchivedTasksResponse;
  if (response.mode === 'no-context-pack') blocked('explicit child execution scope archive could not be listed.');
  if (response.tasks.length === 0) blocked('no archived parent tasks are available.');
  const parent = response.tasks.find((task) => task.taskId === args.parentTaskId);
  if (!parent) blocked(`archived parent ${args.parentTaskId} was not found.`);
  if (parent.branchChainAvailability?.status !== 'ready') blocked(parent.branchChainAvailability?.message ?? 'parent branch handoffs are not ready.');
  if (!parent.branchHandoffs?.length) blocked('parent archive is missing branch handoffs.');
  if (response.childChainStateStatus?.status === 'invalid') blocked(response.childChainStateStatus.message);
  if (!parent.plannerFocusSnapshot) blocked('parent archive is missing planner focus snapshot.');

  const state = await readChildTaskChains(args.repoRoot).catch((error: unknown) => {
    blocked(error instanceof Error ? error.message : String(error));
  });
  const parentTask = state.tasks[args.parentTaskId];
  let rootTaskId = args.requestedRootTaskId;
  let parentDepth = 0;
  let previousBranchChain: TaskBranchChainBinding | null = null;
  if (parentTask) {
    const chain = state.chains[parentTask.rootTaskId];
    if (!chain || chain.currentTipTaskId !== args.parentTaskId) {
      blocked('selected parent is not the current child chain tip.');
    }
    if (parentTask.state !== 'completed') {
      blocked('selected parent current child chain tip is not completed.');
    }
    rootTaskId = parentTask.rootTaskId;
    if (args.requestedRootTaskId !== rootTaskId) blocked('requested root task does not match parent chain root.');
    parentDepth = parentTask.depth;
    if (parentTask.branchChain) {
      previousBranchChain = parentTask.branchChain;
    } else if (parentTask.depth > 0) {
      blocked('stored parent chain metadata is missing.');
    }
  } else if (args.requestedRootTaskId !== args.parentTaskId) {
    blocked('parent is missing from child-chain state and is not a root parent.');
  }

  const depth = parentDepth + 1;
  const branchChain: TaskBranchChainBinding = {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId,
    parentTaskId: args.parentTaskId,
    depth,
    repos: await buildAdjustedChildBranchChainRepos({
      repoRoot: args.repoRoot,
      rootTaskId,
      parentTaskId: args.parentTaskId,
      childExecutionScope: args.childExecutionScope,
      parentBranchHandoffs: parent.branchHandoffs,
      childChainState: state,
      previousBranchChain,
    }),
  };

  return {
    branchChain,
    rootTaskId,
    depth,
    previousTaskId: args.parentTaskId,
    parentArchivePath: parent.archivePath,
    parentArchiveArtifactDir: parent.archiveArtifactDir ?? null,
    parentContextSnapshot: contextSnapshotFromBinding(parent.plannerFocusSnapshot.contextPackBinding),
    childExecutionScope: contextSnapshotFromBinding(args.childExecutionScope),
  };
}

function contextSnapshotFromBinding(binding: PlannerStagingContextPackBinding): ChildTaskContextSnapshot {
  return {
    contextPackDir: binding.contextPackDir || null,
    contextPackId: binding.contextPackId || null,
    scopeMode: binding.scopeMode || null,
    primaryRepoId: binding.primaryRepoId ?? null,
    primaryFocusId: binding.primaryFocusId ?? null,
    selectedRepoIds: [...binding.selectedRepoIds],
    selectedFocusIds: [...binding.selectedFocusIds],
    ...(binding.repositoryTypes ? { repositoryTypes: { ...binding.repositoryTypes } } : {}),
    deepFocusEnabled: binding.deepFocusEnabled,
    deepFocusPrimaryRepoId: binding.deepFocusPrimaryRepoId ?? null,
    deepFocusPrimaryFocusId: binding.deepFocusPrimaryFocusId ?? null,
    selectedFocusPath: binding.selectedFocusPath ?? null,
    selectedFocusTargetKind: binding.selectedFocusTargetKind ?? null,
    selectedFocusTargets: binding.selectedFocusTargets.map((target) => ({ ...target })),
    selectedTestTarget: binding.selectedTestTarget ? { ...binding.selectedTestTarget } : null,
    selectedSupportTargets: binding.selectedSupportTargets.map((target) => ({ ...target })),
  };
}

function blocked(message: string): never {
  throw new Error(`child-task-chain-creation-blocked: ${message}`);
}
