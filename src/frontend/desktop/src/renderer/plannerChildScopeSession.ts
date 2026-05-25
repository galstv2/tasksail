import type {
  ArchivedTaskEntry, PlannerChildTaskExecutionScope, PlannerFocusSnapshot, PlannerLilyPersonalityId,
  PlannerLilyPlanningReloadScope, PlannerParentBranchViewRequest, PlannerReadParentChainArchiveBundleResponse,
  PlannerReadParentContextBundleResponse,
} from '../shared/desktopContract';
import { PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE } from '../shared/desktopContract';
import { buildChildTaskStarterPrompt } from '../shared/plannerWorkflow';
import type { DesktopShellClient } from './services/desktopShellClient';
import { deriveParentQmdScope } from './plannerComposer';

export { PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE };

type ParentBranchHandoffCoverageGap = {
  parentTaskId: string; contextPackId: string; estateType: 'distributed-platform' | 'monolith' | 'unknown';
  expectedPrimaryRepoCount: number; branchHandoffCount: number; missingPrimaryRepoIds: string[];
};

export function buildParentTaskBranchViewRequest(task: ArchivedTaskEntry): PlannerParentBranchViewRequest | undefined {
  if (!task.plannerFocusSnapshot) {
    return undefined;
  }
  try {
    const coverageGap = assessParentBranchHandoffCoverage(task);
    if (coverageGap) emitParentBranchHandoffCoverageWarning(coverageGap);
  } catch {
    console.warn('plannerParentBranchView.coverage.assessment-failed', { parentTaskId: task.taskId });
  }
  return {
    schemaVersion: 1,
    parentTaskId: task.taskId,
    contextPackDir: task.plannerFocusSnapshot.contextPackDir,
    contextPackId: task.plannerFocusSnapshot.contextPackId,
    branchChainAvailability: task.branchChainAvailability ?? {
      status: 'missing-branch-handoffs',
      message: PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE,
    },
    ...(task.branchHandoffs?.length ? { branchHandoffs: task.branchHandoffs } : {}),
  };
}

function assessParentBranchHandoffCoverage(task: ArchivedTaskEntry): ParentBranchHandoffCoverageGap | null {
  const snapshot = task.plannerFocusSnapshot;
  if (!snapshot || task.branchChainAvailability?.status !== 'ready') {
    return null;
  }
  const binding = snapshot.contextPackBinding;
  const estateType = inferEstateType(binding);
  const expectedPrimaryRepoCount = countExpectedPrimaryRepos(binding, estateType);
  const branchHandoffCount = new Set((task.branchHandoffs ?? []).map((handoff) => handoff.repoRoot).filter(Boolean)).size;
  if (expectedPrimaryRepoCount <= branchHandoffCount) {
    return null;
  }
  return {
    parentTaskId: task.taskId,
    contextPackId: snapshot.contextPackId,
    estateType,
    expectedPrimaryRepoCount,
    branchHandoffCount,
    missingPrimaryRepoIds: deriveMissingPrimaryRepoIds(binding, task.branchHandoffs ?? []),
  };
}

function emitParentBranchHandoffCoverageWarning(gap: ParentBranchHandoffCoverageGap): void {
  console.warn('plannerParentBranchView.coverage.partial', gap);
}

function inferEstateType(binding: PlannerFocusSnapshot['contextPackBinding']): ParentBranchHandoffCoverageGap['estateType'] {
  if (binding.selectedRepoIds.length > 0
    || Boolean(binding.primaryRepoId)
    || Boolean(binding.deepFocusPrimaryRepoId)
    || binding.selectedFocusTargets.some((target) => Boolean(target.repoId))) return 'distributed-platform';
  return binding.selectedFocusIds.length > 0
    || Boolean(binding.primaryFocusId)
    || Boolean(binding.deepFocusPrimaryFocusId)
    || binding.selectedFocusTargets.some((target) => Boolean(target.focusId))
    ? 'monolith'
    : 'unknown';
}
function countExpectedPrimaryRepos(binding: PlannerFocusSnapshot['contextPackBinding'], estateType: ParentBranchHandoffCoverageGap['estateType']): number {
  if (binding.deepFocusEnabled) {
    if (estateType === 'monolith') {
      return Number(binding.selectedFocusTargets.length > 0
        || binding.selectedFocusIds.length > 0
        || Boolean(binding.deepFocusPrimaryFocusId)
        || Boolean(binding.primaryFocusId));
    }
    const identities = new Set<string>();
    for (const target of binding.selectedFocusTargets) {
      const identity = target.repoId ?? target.repoLocalPath ?? binding.deepFocusPrimaryRepoId ?? binding.primaryRepoId;
      if (identity) identities.add(identity);
    }
    return identities.size || Number(Boolean(binding.deepFocusPrimaryRepoId || binding.primaryRepoId));
  }
  if (estateType === 'monolith') {
    if (binding.selectedFocusIds.length === 0) return 0;
    if (!binding.repositoryTypes) return 1;
    return binding.selectedFocusIds.some((id) => binding.repositoryTypes?.[id] === 'primary') ? 1 : 0;
  }
  if (binding.selectedRepoIds.length === 0) return 0;
  if (!binding.repositoryTypes) return binding.selectedRepoIds.length;
  return binding.selectedRepoIds.filter((id) => binding.repositoryTypes?.[id] === 'primary').length;
}
function deriveMissingPrimaryRepoIds(binding: PlannerFocusSnapshot['contextPackBinding'], handoffs: NonNullable<ArchivedTaskEntry['branchHandoffs']>): string[] {
  if (!binding.deepFocusEnabled || binding.selectedFocusTargets.length === 0) return [];
  const primaryTargets = binding.selectedFocusTargets.filter((target) => target.repoId && target.repoLocalPath);
  if (primaryTargets.length !== binding.selectedFocusTargets.length) return [];
  const handoffRoots = new Set(handoffs.map((handoff) => handoff.repoRoot));
  const missing = new Set<string>();
  for (const target of primaryTargets) {
    if (!handoffRoots.has(target.repoLocalPath!)) missing.add(target.repoId!);
  }
  return [...missing];
}

export async function restartChildPlannerWithScope(args: {
  client: DesktopShellClient;
  task: ArchivedTaskEntry;
  childScope: PlannerChildTaskExecutionScope;
  reloadScope: PlannerLilyPlanningReloadScope;
  lilyPersonalityId: PlannerLilyPersonalityId;
  parentContextBundle?: PlannerReadParentContextBundleResponse['bundle'];
  onBeforeStart: () => void;
  onStatus?: (message: string) => void;
  onStarted: (sessionId: string, starterPrompt: string) => void;
}): Promise<void> {
  const { client, task, childScope, reloadScope, lilyPersonalityId, parentContextBundle, onBeforeStart, onStatus, onStarted } = args;
  if (!task.plannerFocusSnapshot) {
    throw new Error('This archived parent task has no saved planner focus and cannot be used as a parent. Refresh the parent list and try again.');
  }
  const parentChainArchiveBundleResult = await client.readParentChainArchiveBundle({
    parentTaskId: task.taskId,
    rootTaskId: task.rootTaskId || task.taskId,
    contextPackDir: task.plannerFocusSnapshot.contextPackDir,
    contextPackId: task.plannerFocusSnapshot.contextPackId,
  });
  if (!parentChainArchiveBundleResult.ok) {
    throw new Error(parentChainArchiveBundleResult.error ?? 'Failed to read parent chain archive bundle.');
  }
  if (parentChainArchiveBundleResult.response.action !== 'planner.readParentChainArchiveBundle') {
    throw new Error('Unexpected parent chain archive bundle response.');
  }
  const parentChainArchiveBundle = (parentChainArchiveBundleResult.response as PlannerReadParentChainArchiveBundleResponse).bundle;
  await client.endPlannerSession();
  onBeforeStart();
  const start = await client.startPlannerSession({
    contextPackDir: task.plannerFocusSnapshot.contextPackDir,
    lilyPersonalityId,
    childTaskFocusSnapshot: task.plannerFocusSnapshot,
    childTaskLineage: {
      parentTaskId: task.taskId,
      parentQmdRecordId: task.qmdRecordId,
      parentQmdScope: deriveParentQmdScope(task.contextPackName),
      rootTaskId: task.rootTaskId || task.taskId,
      followUpReason: task.followupReason || 'Continue from the archived parent task.',
    },
    childTaskExecutionScope: childScope,
    lilyPlanningReloadScope: reloadScope,
    parentTaskBranchView: buildParentTaskBranchViewRequest(task),
  });
  if (!start.ok || start.response.action !== 'planner.startSession') {
    throw new Error(start.ok ? 'Unexpected planner child-task start response.' : start.error ?? 'Failed to start child-task planner session.');
  }
  if (start.response.parentBranchViewStatus?.mode === 'skipped-missing-handoffs') {
    onStatus?.(PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE);
  }
  onStarted(start.response.sessionId, buildChildTaskStarterPrompt({
    parentTaskId: task.taskId,
    parentTaskTitle: task.title,
    rootTaskId: task.rootTaskId || task.taskId,
    parentQmdScope: deriveParentQmdScope(task.contextPackName),
    parentTaskContent: task.parentTaskContent,
    parentContextBundle,
    parentChainArchiveBundle,
    childTaskExecutionScope: childScope,
    lilyPlanningReloadScope: reloadScope,
  }));
}
