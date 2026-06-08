import type { LifecycleState } from '../../shared/desktopContract';
import type { ComposerStage, FollowUpDraftContext, PlannerDraftModel } from '../planner/plannerComposer';

export type CompletedTaskEntry = {
  id: string;
  title: string;
  owner: string;
  status: 'idle' | 'active' | 'blocked' | 'completed';
  summary: string;
  followUpEligible?: boolean;
  followUpContext?: FollowUpDraftContext;
  followUpBlockedReason?: string;
};

export type WorkflowMode =
  | 'pre-task planning'
  | 'in-flight observation'
  | 'post-closeout follow-up';

export type FollowUpTask = CompletedTaskEntry | null;

export type PlannerAccessState =
  | {
      kind: 'locked-no-context-pack';
      planningEnabled: false;
      lockReason: 'Planning agent chat is locked until a context pack is active. Activate an existing pack or create one from the sidebar first.';
    }
  | {
      kind: 'unlocked-concurrent-work';
      planningEnabled: true;
      lockReason: 'Planner input is available while repo workflow execution continues independently.';
    }
  | {
      kind: 'unlocked-follow-up-reentry';
      planningEnabled: true;
      lockReason: 'Follow-up planner input is unlocked only for the selected completed task. The closed parent task remains read-only.';
    }
  | {
      kind: 'locked-after-closeout';
      planningEnabled: false;
      lockReason: 'Planner input is locked after closeout. Use follow-up controls for next-step requests.';
    }
  | {
      kind: 'unlocked-pre-task';
      planningEnabled: true;
      lockReason: 'Planner input is available for approved pre-task planning only.';
    };

export type AppViewModel = {
  workflowMode: WorkflowMode;
  taskLocked: boolean;
  closedTask: boolean;
  selectedFollowUpTask: FollowUpTask;
  followUpPlanningActive: boolean;
  plannerAccessState: PlannerAccessState;
  planningEnabled: boolean;
  isFollowUpDraft: boolean;
  consoleLockMessage: string;
  planningLockReason: string;
  primaryActionLabel: string;
  stageCopy: string;
};

export function deriveWorkflowMode(state: LifecycleState | undefined): WorkflowMode {
  if (state === 'active' || state === 'blocked') {
    return 'in-flight observation';
  }

  if (state === 'complete') {
    return 'post-closeout follow-up';
  }

  return 'pre-task planning';
}

export function deriveTaskLockState(state: LifecycleState | undefined): boolean {
  return state === 'active' || state === 'blocked';
}

export function deriveClosedTask(state: LifecycleState | undefined): boolean {
  return state === 'complete';
}

export function selectFollowUpTask(
  completedTasks: CompletedTaskEntry[],
  followUpSourceTaskId: string | null,
): FollowUpTask {
  return completedTasks.find((task) => task.id === followUpSourceTaskId) ?? null;
}

export function deriveIsFollowUpDraft(draft: PlannerDraftModel): boolean {
  return draft.taskKind === 'child-task';
}

export function deriveFollowUpPlanningActive(args: {
  workflowState: LifecycleState | undefined;
  selectedFollowUpTask: FollowUpTask;
  draft: PlannerDraftModel;
}): boolean {
  return (
    args.workflowState === 'complete' &&
    args.selectedFollowUpTask?.followUpEligible === true &&
    Boolean(args.selectedFollowUpTask.followUpContext) &&
    deriveIsFollowUpDraft(args.draft)
  );
}

export function derivePlanningEnabled(args: {
  workflowState: LifecycleState | undefined;
  followUpPlanningActive: boolean;
  hasActiveContextPack: boolean;
}): boolean {
  return derivePlannerAccessState({
    taskLocked: deriveTaskLockState(args.workflowState),
    closedTask: deriveClosedTask(args.workflowState),
    followUpPlanningActive: args.followUpPlanningActive,
    hasActiveContextPack: args.hasActiveContextPack,
  }).planningEnabled;
}

export function deriveConsoleLockMessage(args: {
  taskLocked: boolean;
  closedTask: boolean;
}): string {
  if (args.taskLocked) {
    return 'Workflow console locked: active repo work is observable only. Use approved operator controls instead of arbitrary commands.';
  }

  if (args.closedTask) {
    return 'Workflow console locked: the task is closed. Use explicit follow-up controls if more work is needed.';
  }

  return 'Workflow console remains read-only. Use the planner composer for approved intake instead of arbitrary shell input.';
}

export function derivePlanningLockReason(args: {
  taskLocked: boolean;
  closedTask: boolean;
  followUpPlanningActive: boolean;
  hasActiveContextPack: boolean;
}): string {
  return derivePlannerAccessState(args).lockReason;
}

export function derivePlannerAccessState(args: {
  taskLocked: boolean;
  closedTask: boolean;
  followUpPlanningActive: boolean;
  hasActiveContextPack: boolean;
}): PlannerAccessState {
  if (!args.hasActiveContextPack) {
    return {
      kind: 'locked-no-context-pack',
      planningEnabled: false,
      lockReason:
        'Planning agent chat is locked until a context pack is active. Activate an existing pack or create one from the sidebar first.',
    };
  }

  if (args.taskLocked) {
    return {
      kind: 'unlocked-concurrent-work',
      planningEnabled: true,
      lockReason: 'Planner input is available while repo workflow execution continues independently.',
    };
  }

  if (args.followUpPlanningActive) {
    return {
      kind: 'unlocked-follow-up-reentry',
      planningEnabled: true,
      lockReason:
        'Follow-up planner input is unlocked only for the selected completed task. The closed parent task remains read-only.',
    };
  }

  if (args.closedTask) {
    return {
      kind: 'locked-after-closeout',
      planningEnabled: false,
      lockReason:
        'Planner input is locked after closeout. Use follow-up controls for next-step requests.',
    };
  }

  return {
    kind: 'unlocked-pre-task',
    planningEnabled: true,
    lockReason: 'Planner input is available for approved pre-task planning only.',
  };
}

export function derivePrimaryActionLabel(args: {
  isFollowUpDraft: boolean;
  composerStage: ComposerStage;
}): string {
  if (args.isFollowUpDraft) {
    return args.composerStage === 'confirm'
      ? 'Create follow-up task'
      : 'Run follow-up dry-run';
  }

  return args.composerStage === 'confirm'
    ? 'Submit to dropbox'
    : 'Run draft dry-run';
}

export function deriveStageCopy(args: {
  isFollowUpDraft: boolean;
  composerStage: ComposerStage;
}): string {
  if (args.isFollowUpDraft) {
    const followUpStageCopy: Record<ComposerStage, string> = {
      compose: 'Compose child-task intake.',
      preview:
        'Review the carry-forward child-task draft locally without creating a new queue item yet.',
      confirm:
        'Confirm the follow-up child-task intake through the approved follow-up helper path.',
    };

    return followUpStageCopy[args.composerStage];
  }

  const standardStageCopy: Record<ComposerStage, string> = {
    compose: 'Plan your task with the planner, then send it to the queue.',
    preview: 'Review the queue-ready markdown shape without calling repo helper scripts.',
    confirm: 'Confirm the draft and submit it through the approved dropbox helper path.',
  };

  return standardStageCopy[args.composerStage];
}

export function buildAppViewModel(args: {
  workflowState: LifecycleState | undefined;
  completedTasks: CompletedTaskEntry[];
  followUpSourceTaskId: string | null;
  draft: PlannerDraftModel;
  composerStage: ComposerStage;
  hasActiveContextPack: boolean;
}): AppViewModel {
  const workflowMode = deriveWorkflowMode(args.workflowState);
  const taskLocked = deriveTaskLockState(args.workflowState);
  const closedTask = deriveClosedTask(args.workflowState);
  const selectedFollowUpTask = selectFollowUpTask(
    args.completedTasks,
    args.followUpSourceTaskId,
  );
  const isFollowUpDraft = deriveIsFollowUpDraft(args.draft);
  const followUpPlanningActive = deriveFollowUpPlanningActive({
    workflowState: args.workflowState,
    selectedFollowUpTask,
    draft: args.draft,
  });
  const plannerAccessState = derivePlannerAccessState({
    taskLocked,
    closedTask,
    followUpPlanningActive,
    hasActiveContextPack: args.hasActiveContextPack,
  });
  const planningEnabled = plannerAccessState.planningEnabled;

  return {
    workflowMode,
    taskLocked,
    closedTask,
    selectedFollowUpTask,
    followUpPlanningActive,
    plannerAccessState,
    planningEnabled,
    isFollowUpDraft,
    consoleLockMessage: deriveConsoleLockMessage({ taskLocked, closedTask }),
    planningLockReason: plannerAccessState.lockReason,
    primaryActionLabel: derivePrimaryActionLabel({
      isFollowUpDraft,
      composerStage: args.composerStage,
    }),
    stageCopy: deriveStageCopy({
      isFollowUpDraft,
      composerStage: args.composerStage,
    }),
  };
}
