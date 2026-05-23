import type {
  ArchivedTaskEntry,
  PlannerChildTaskExecutionScope,
  PlannerLilyPersonalityId,
  PlannerLilyPlanningReloadScope,
  PlannerParentBranchViewRequest,
  PlannerReadParentChainArchiveBundleResponse,
  PlannerReadParentContextBundleResponse,
} from '../shared/desktopContract';
import { PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE } from '../shared/desktopContract';
import { buildChildTaskStarterPrompt } from '../shared/plannerWorkflow';
import type { DesktopShellClient } from './services/desktopShellClient';
import { deriveParentQmdScope } from './plannerComposer';

export { PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE };

export function buildParentTaskBranchViewRequest(task: ArchivedTaskEntry): PlannerParentBranchViewRequest | undefined {
  if (!task.plannerFocusSnapshot) {
    return undefined;
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
