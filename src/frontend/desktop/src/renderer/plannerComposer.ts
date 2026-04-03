import type { ArchivedTaskEntry } from '../shared/desktopContract';
import { planningAgentDisplayName } from '../shared/agentRoster';

export type ComposerStage = 'compose' | 'preview' | 'confirm';

export type PlannerConversationMessage = {
  id: string;
  role: 'planner' | 'operator';
  text: string;
};

export type PlannerDraftSeed = {
  title: string;
  summary: string;
  desiredOutcome: string;
  constraints: string[];
  acceptanceSignals: string[];
  planningNotes: string;
  suggestedPath: 'sequential' | 'parallel';
};

export type FollowUpDraftContext = {
  parentTaskId: string;
  parentTaskTitle: string;
  parentQmdRecordId: string;
  parentQmdScope: string;
  rootTaskId: string;
  followupReason: string;
  carryForwardSummary: string;
  childTitle: string;
  requestedAdjustment: string;
  desiredOutcome: string;
  constraints: string[];
  acceptanceSignals: string[];
  planningNotes: string;
  suggestedPath: 'sequential' | 'parallel';
};

export type PlannerDraftModel = {
  title: string;
  taskKind: 'standard' | 'child-task';
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  parentTaskId: string;
  parentQmdRecordId: string;
  parentQmdScope: string;
  rootTaskId: string;
  followupReason: string;
  carryForwardSummary: string;
  suggestedPath: 'sequential' | 'parallel';
  planningNotes: string;
};

export function createLocalDraft(seed: PlannerDraftSeed): PlannerDraftModel {
  return {
    title: seed.title,
    taskKind: 'standard',
    summary: seed.summary,
    desiredOutcome: seed.desiredOutcome,
    constraints: seed.constraints.join('\n'),
    acceptanceSignals: seed.acceptanceSignals.join('\n'),
    parentTaskId: '',
    parentQmdRecordId: '',
    parentQmdScope: '',
    rootTaskId: '',
    followupReason: '',
    carryForwardSummary: '',
    suggestedPath: seed.suggestedPath,
    planningNotes: seed.planningNotes,
  };
}

export function createFollowUpDraft(context: FollowUpDraftContext): PlannerDraftModel {
  return {
    title: context.childTitle,
    taskKind: 'child-task',
    summary: context.requestedAdjustment,
    desiredOutcome: context.desiredOutcome,
    constraints: context.constraints.join('\n'),
    acceptanceSignals: context.acceptanceSignals.join('\n'),
    parentTaskId: context.parentTaskId,
    parentQmdRecordId: context.parentQmdRecordId,
    parentQmdScope: context.parentQmdScope,
    rootTaskId: context.rootTaskId,
    followupReason: context.followupReason,
    carryForwardSummary: context.carryForwardSummary,
    suggestedPath: context.suggestedPath,
    planningNotes: context.planningNotes,
  };
}

export function deriveParentQmdScope(contextPackName: string): string {
  return `qmd/context-packs/${contextPackName}`;
}

export function normalizeArchivedTaskToFollowUpContext(
  entry: ArchivedTaskEntry,
): FollowUpDraftContext {
  return {
    parentTaskId: entry.taskId,
    parentTaskTitle: entry.title,
    parentQmdRecordId: entry.qmdRecordId,
    parentQmdScope: deriveParentQmdScope(entry.contextPackName),
    rootTaskId: entry.rootTaskId || entry.taskId,
    followupReason: entry.followupReason,
    carryForwardSummary: entry.summary,
    childTitle: '',
    requestedAdjustment: '',
    desiredOutcome: '',
    constraints: [],
    acceptanceSignals: [],
    planningNotes: '',
    suggestedPath: 'sequential',
  };
}

export function formatDraftMarkdown(draft: PlannerDraftModel): string {
  return `# ${draft.title}

## Task Lineage

- Task Kind: ${draft.taskKind}
- Parent Task ID: ${draft.parentTaskId}
- Root Task ID: ${draft.rootTaskId}
- Parent QMD Record ID: ${draft.parentQmdRecordId}
- Parent QMD Scope: ${draft.parentQmdScope}
- Follow-Up Reason: ${draft.followupReason}

## Request Summary

${draft.summary}

## Desired Outcome

${draft.desiredOutcome}

## Constraints

${draft.constraints}

## Acceptance Signals

${draft.acceptanceSignals}

## Parent Task Carry-Forward Summary

${draft.carryForwardSummary}

## Suggested Routing

- Recommended Execution: ${draft.suggestedPath}
- Planner Notes: ${draft.planningNotes}

## Source

- Created By: ${planningAgentDisplayName}
- Created At (UTC): local-preview-only`;
}
