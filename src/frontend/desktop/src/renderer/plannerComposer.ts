import type {
  ArchivedTaskEntry,
  FollowUpDirectSubmissionDraft,
  PlannerDirectSubmissionDraft,
  PlannerEditableDraftModel,
  SuggestedPath,
} from '../shared/desktopContract';
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
  suggestedPath: SuggestedPath;
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
  suggestedPath: SuggestedPath;
};

export type PlannerDraftModel = PlannerDirectSubmissionDraft & {
  title: string;
};

export type PlannerPreviewMetadata = {
  title?: string;
  taskKind?: 'standard' | 'child-task';
  taskLineage?: {
    parentTaskId?: string;
    rootTaskId?: string;
    parentQmdRecordId?: string;
    parentQmdScope?: string;
    followupReason?: string;
  } | null;
  contextPackBinding?: string[] | null;
  source?: {
    createdBy?: string;
    createdAt?: string;
  } | null;
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

export function toEditablePlannerDraft(
  draft: Pick<
    PlannerDraftModel,
    | 'summary'
    | 'desiredOutcome'
    | 'constraints'
    | 'acceptanceSignals'
    | 'carryForwardSummary'
    | 'suggestedPath'
    | 'planningNotes'
  >,
): PlannerEditableDraftModel {
  return {
    summary: draft.summary,
    desiredOutcome: draft.desiredOutcome,
    constraints: draft.constraints,
    acceptanceSignals: draft.acceptanceSignals,
    carryForwardSummary: draft.carryForwardSummary,
    suggestedPath: draft.suggestedPath,
    planningNotes: draft.planningNotes,
  };
}

export function toPlannerDirectSubmissionDraft(
  draft: PlannerDraftModel,
): PlannerDirectSubmissionDraft {
  const { title: _title, ...submissionDraft } = draft;
  return submissionDraft;
}

export function toFollowUpDirectSubmissionDraft(
  draft: PlannerDraftModel,
): FollowUpDirectSubmissionDraft {
  return toPlannerDirectSubmissionDraft(draft) as FollowUpDirectSubmissionDraft;
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

export function formatDraftMarkdown(
  draft: PlannerEditableDraftModel,
  metadata: PlannerPreviewMetadata = {},
): string {
  const sections: string[] = [];
  const title = metadata.title?.trim() || 'Task intake draft preview';
  sections.push(`# ${title}`);

  if (metadata.taskKind || metadata.taskLineage) {
    const taskLineage = metadata.taskLineage ?? {};
    const taskKind = metadata.taskKind ?? 'standard';
    sections.push(
      '## Task Lineage',
      '',
      `- Task Kind: ${taskKind}`,
      `- Parent Task ID: ${taskLineage.parentTaskId ?? ''}`,
      `- Root Task ID: ${taskLineage.rootTaskId ?? ''}`,
      `- Parent QMD Record ID: ${taskLineage.parentQmdRecordId ?? ''}`,
      `- Parent QMD Scope: ${taskLineage.parentQmdScope ?? ''}`,
      `- Follow-Up Reason: ${taskLineage.followupReason ?? ''}`,
    );
  }

  if (metadata.contextPackBinding && metadata.contextPackBinding.length > 0) {
    sections.push(
      '## Context Pack Binding',
      '',
      ...metadata.contextPackBinding.map((line) => `- ${line}`),
    );
  }

  sections.push(
    '## Request Summary',
    '',
    draft.summary,
    '',
    '## Desired Outcome',
    '',
    draft.desiredOutcome,
    '',
    '## Constraints',
    '',
    draft.constraints,
    '',
    '## Acceptance Signals',
    '',
    draft.acceptanceSignals,
    '',
    '## Parent Task Carry-Forward Summary',
    '',
    draft.carryForwardSummary,
    '',
    '## Suggested Routing',
    '',
    `- Recommended Execution: ${draft.suggestedPath === 'parallel' ? 'Complex' : 'Simple'}`,
    `- Planner Notes: ${draft.planningNotes}`,
  );

  if (metadata.source) {
    sections.push(
      '',
      '## Source',
      '',
      `- Created By: ${metadata.source.createdBy ?? planningAgentDisplayName}`,
      `- Created At (UTC): ${metadata.source.createdAt ?? 'local-preview-only'}`,
    );
  }

  return sections.join('\n');
}
