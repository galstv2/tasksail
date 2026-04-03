import { describe, expect, it } from 'vitest';

import type { CompletedTaskEntry } from './appViewModel';
import {
  buildAppViewModel,
  deriveConsoleLockMessage,
  derivePlannerAccessState,
  derivePlanningEnabled,
  derivePlanningLockReason,
  derivePrimaryActionLabel,
  deriveStageCopy,
  deriveWorkflowMode,
  selectFollowUpTask,
} from './appViewModel';
import { createFollowUpDraft, createLocalDraft, type PlannerDraftSeed } from '../plannerComposer';

const EMPTY_DRAFT_SEED: PlannerDraftSeed = {
  title: 'Test draft',
  summary: 'Test summary',
  desiredOutcome: 'Test outcome',
  constraints: [],
  acceptanceSignals: [],
  planningNotes: '',
  suggestedPath: 'sequential',
};

const completedTaskEntries: CompletedTaskEntry[] = [
  {
    id: 'CAP-CUSTOM-TERMINAL-06',
    title: 'Older completed task',
    owner: 'product-manager',
    status: 'completed',
    summary: 'Completed task without eligible follow-up.',
    followUpEligible: false,
    followUpBlockedReason: 'Archive lineage is unresolved for this older task, so follow-up creation remains unavailable.',
  },
  {
    id: 'CAP-CUSTOM-TERMINAL-08',
    title: 'Most recent completed task',
    owner: 'product-manager',
    status: 'completed',
    summary: 'Completed task with eligible follow-up.',
    followUpEligible: true,
    followUpContext: {
      parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
      parentTaskTitle: 'Most recent completed task',
      parentQmdRecordId: 'record-08',
      parentQmdScope: 'orders-api',
      rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
      followupReason: 'Live follow-up integration needed.',
      carryForwardSummary: 'Carry-forward summary.',
      childTitle: 'Create child-task intake for live follow-up integration',
      requestedAdjustment: 'Integrate remaining live follow-up items.',
      desiredOutcome: 'Live integration complete.',
      constraints: [],
      acceptanceSignals: [],
      planningNotes: '',
      suggestedPath: 'sequential',
    },
  },
];

describe('appViewModel selectors', () => {
  it('maps workflow states to the correct workflow mode', () => {
    expect(deriveWorkflowMode('idle')).toBe('pre-task planning');
    expect(deriveWorkflowMode('queued')).toBe('pre-task planning');
    expect(deriveWorkflowMode(undefined)).toBe('pre-task planning');
    expect(deriveWorkflowMode('active')).toBe('in-flight observation');
    expect(deriveWorkflowMode('blocked')).toBe('in-flight observation');
    expect(deriveWorkflowMode('complete')).toBe('post-closeout follow-up');
  });

  it('resolves a selected follow-up task by id', () => {
    expect(
      selectFollowUpTask(completedTaskEntries, 'CAP-CUSTOM-TERMINAL-08')?.id,
    ).toBe('CAP-CUSTOM-TERMINAL-08');
    expect(selectFollowUpTask(completedTaskEntries, 'missing')).toBeNull();
  });

  it('derives planning enablement for idle, queued, complete, and follow-up-active states', () => {
    expect(derivePlanningEnabled({ workflowState: 'idle', followUpPlanningActive: false, hasActiveContextPack: true })).toBe(
      true,
    );
    expect(
      derivePlanningEnabled({ workflowState: 'queued', followUpPlanningActive: false, hasActiveContextPack: true }),
    ).toBe(true);
    expect(
      derivePlanningEnabled({ workflowState: 'active', followUpPlanningActive: false, hasActiveContextPack: true }),
    ).toBe(false);
    expect(
      derivePlanningEnabled({ workflowState: 'blocked', followUpPlanningActive: false, hasActiveContextPack: true }),
    ).toBe(false);
    expect(
      derivePlanningEnabled({ workflowState: 'complete', followUpPlanningActive: false, hasActiveContextPack: true }),
    ).toBe(false);
    expect(
      derivePlanningEnabled({ workflowState: 'complete', followUpPlanningActive: true, hasActiveContextPack: true }),
    ).toBe(true);
    expect(
      derivePlanningEnabled({ workflowState: 'idle', followUpPlanningActive: false, hasActiveContextPack: false }),
    ).toBe(false);
  });

  it('derives console lock messages for task-locked, closed, and planning states', () => {
    expect(deriveConsoleLockMessage({ taskLocked: true, closedTask: false })).toContain(
      'active repo work is observable only',
    );
    expect(deriveConsoleLockMessage({ taskLocked: false, closedTask: true })).toContain(
      'the task is closed',
    );
    expect(deriveConsoleLockMessage({ taskLocked: false, closedTask: false })).toContain(
      'Workflow console remains read-only',
    );
  });

  it('derives planning lock reasons for locked, follow-up, closed, and default states', () => {
    expect(
      derivePlanningLockReason({
        taskLocked: true,
        closedTask: false,
        followUpPlanningActive: false,
        hasActiveContextPack: true,
      }),
    ).toContain('locked while repo workflow execution is active');
    expect(
      derivePlanningLockReason({
        taskLocked: false,
        closedTask: false,
        followUpPlanningActive: true,
        hasActiveContextPack: true,
      }),
    ).toContain('Follow-up planner input is unlocked only for the selected completed task');
    expect(
      derivePlanningLockReason({
        taskLocked: false,
        closedTask: true,
        followUpPlanningActive: false,
        hasActiveContextPack: true,
      }),
    ).toContain('locked after closeout');
    expect(
      derivePlanningLockReason({
        taskLocked: false,
        closedTask: false,
        followUpPlanningActive: false,
        hasActiveContextPack: true,
      }),
    ).toContain('available for approved pre-task planning only');
    expect(
      derivePlanningLockReason({
        taskLocked: false,
        closedTask: false,
        followUpPlanningActive: false,
        hasActiveContextPack: false,
      }),
    ).toContain('locked until a context pack is active');
  });

  it('models planner access as an explicit unlock state machine', () => {
    expect(
      derivePlannerAccessState({
        taskLocked: false,
        closedTask: false,
        followUpPlanningActive: false,
        hasActiveContextPack: false,
      }).kind,
    ).toBe('locked-no-context-pack');
    expect(
      derivePlannerAccessState({
        taskLocked: true,
        closedTask: false,
        followUpPlanningActive: false,
        hasActiveContextPack: true,
      }).kind,
    ).toBe('locked-active-work');
    expect(
      derivePlannerAccessState({
        taskLocked: false,
        closedTask: true,
        followUpPlanningActive: true,
        hasActiveContextPack: true,
      }).kind,
    ).toBe('unlocked-follow-up-reentry');
    expect(
      derivePlannerAccessState({
        taskLocked: false,
        closedTask: false,
        followUpPlanningActive: false,
        hasActiveContextPack: true,
      }).kind,
    ).toBe('unlocked-pre-task');
  });

  it('derives primary action labels for standard and follow-up drafts', () => {
    expect(
      derivePrimaryActionLabel({ isFollowUpDraft: false, composerStage: 'compose' }),
    ).toBe('Run draft dry-run');
    expect(
      derivePrimaryActionLabel({ isFollowUpDraft: false, composerStage: 'confirm' }),
    ).toBe('Submit to dropbox');
    expect(
      derivePrimaryActionLabel({ isFollowUpDraft: true, composerStage: 'preview' }),
    ).toBe('Run follow-up dry-run');
    expect(
      derivePrimaryActionLabel({ isFollowUpDraft: true, composerStage: 'confirm' }),
    ).toBe('Create follow-up task');
  });

  it('derives stage copy for standard and follow-up drafts', () => {
    expect(deriveStageCopy({ isFollowUpDraft: false, composerStage: 'preview' })).toContain(
      'queue-ready markdown shape',
    );
    expect(deriveStageCopy({ isFollowUpDraft: true, composerStage: 'compose' })).toContain(
      'completed-task lineage',
    );
  });

  it('builds a follow-up-capable app view model for the selected completed task', () => {
    const eligibleTask = completedTaskEntries.find(
      (task) => task.id === 'CAP-CUSTOM-TERMINAL-08',
    );

    expect(eligibleTask?.followUpContext).toBeDefined();

    const followUpDraft = createFollowUpDraft(eligibleTask!.followUpContext!);

    const viewModel = buildAppViewModel({
      workflowState: 'complete',
      completedTasks: completedTaskEntries,
      followUpSourceTaskId: 'CAP-CUSTOM-TERMINAL-08',
      draft: followUpDraft,
      composerStage: 'confirm',
      hasActiveContextPack: true,
    });

    expect(viewModel.workflowMode).toBe('post-closeout follow-up');
    expect(viewModel.closedTask).toBe(true);
    expect(viewModel.isFollowUpDraft).toBe(true);
    expect(viewModel.followUpPlanningActive).toBe(true);
    expect(viewModel.plannerAccessState.kind).toBe('unlocked-follow-up-reentry');
    expect(viewModel.planningEnabled).toBe(true);
    expect(viewModel.primaryActionLabel).toBe('Create follow-up task');
    expect(viewModel.selectedFollowUpTask?.id).toBe('CAP-CUSTOM-TERMINAL-08');
  });

  it('keeps complete-state standard drafts locked until follow-up planning is activated', () => {
    const standardDraft = createLocalDraft(EMPTY_DRAFT_SEED);

    const viewModel = buildAppViewModel({
      workflowState: 'complete',
      completedTasks: completedTaskEntries,
      followUpSourceTaskId: null,
      draft: standardDraft,
      composerStage: 'compose',
      hasActiveContextPack: true,
    });

    expect(viewModel.closedTask).toBe(true);
    expect(viewModel.isFollowUpDraft).toBe(false);
    expect(viewModel.followUpPlanningActive).toBe(false);
    expect(viewModel.planningEnabled).toBe(false);
    expect(viewModel.planningLockReason).toContain('Use follow-up controls');
  });

  it('locks pre-task planning when no active context pack is present', () => {
    const draft = createLocalDraft(EMPTY_DRAFT_SEED);

    const viewModel = buildAppViewModel({
      workflowState: 'idle',
      completedTasks: [],
      followUpSourceTaskId: null,
      draft,
      composerStage: 'compose',
      hasActiveContextPack: false,
    });

    expect(viewModel.workflowMode).toBe('pre-task planning');
    expect(viewModel.plannerAccessState.kind).toBe('locked-no-context-pack');
    expect(viewModel.planningEnabled).toBe(false);
    expect(viewModel.planningLockReason).toContain('locked until a context pack is active');
  });
});
