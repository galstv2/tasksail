import {
  type DesktopInvokeResult,
} from '../src/shared/desktopContract';
import { emitStreamEvent } from './main.stream';
import type { PlannerDraftModel } from '../src/renderer/plannerComposer';
import { createDropboxTask } from '../../../backend/platform/queue/createDropboxTask.js';
import { createFollowupTask } from '../../../backend/platform/queue/createFollowupTask.js';
import { readWorkspaceSyncStateSnapshot } from './main.contextPackCatalog';

export type DropboxScriptRunner = (options: {
  title: string;
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  suggestedPath: string;
  planningNotes: string;
  kind: string;
}) => Promise<string>;

export type FollowUpScriptRunner = (options: {
  title: string;
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  parentTaskId: string;
  parentQmdScope: string;
  parentQmdRecordId: string;
  rootTaskId: string;
  followupReason: string;
  carryForwardSummary: string;
  suggestedPath: string;
  planningNotes: string;
}) => Promise<string>;

export async function runDropboxTaskScript(options: {
  title: string;
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  suggestedPath: string;
  planningNotes: string;
  kind: string;
}): Promise<string> {
  // Capture the operator's active context pack focus state at submission time.
  const syncState = await readWorkspaceSyncStateSnapshot();
  const filePath = await createDropboxTask({
    title: options.title,
    summary: options.summary,
    desiredOutcome: options.desiredOutcome,
    constraints: options.constraints,
    acceptanceSignals: options.acceptanceSignals,
    suggestedPath: options.suggestedPath,
    planningNotes: options.planningNotes,
    kind: options.kind,
    contextPackDir: syncState.activeContextPackDir ?? undefined,
    contextPackId: syncState.activeContextPackId ?? undefined,
    scopeMode: syncState.scopeMode ?? undefined,
    selectedRepoIds: syncState.selectedRepoIds,
    selectedFocusIds: syncState.selectedFocusIds,
  });
  emitStreamEvent({ message: `Created dropbox task: ${filePath}`, source: 'createDropboxTask', role: 'queue' });
  return filePath;
}

export async function runFollowUpTaskScript(options: {
  title: string;
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  parentTaskId: string;
  parentQmdScope: string;
  parentQmdRecordId: string;
  rootTaskId: string;
  followupReason: string;
  carryForwardSummary: string;
  suggestedPath: string;
  planningNotes: string;
}): Promise<string> {
  const syncState = await readWorkspaceSyncStateSnapshot();
  const filePath = await createFollowupTask({
    title: options.title,
    summary: options.summary,
    desiredOutcome: options.desiredOutcome,
    constraints: options.constraints,
    acceptanceSignals: options.acceptanceSignals,
    parentTaskId: options.parentTaskId,
    parentQmdScope: options.parentQmdScope,
    parentQmdRecordId: options.parentQmdRecordId,
    rootTaskId: options.rootTaskId,
    followupReason: options.followupReason,
    carryForwardSummary: options.carryForwardSummary,
    suggestedPath: options.suggestedPath,
    planningNotes: options.planningNotes,
    contextPackDir: syncState.activeContextPackDir ?? undefined,
    contextPackId: syncState.activeContextPackId ?? undefined,
    scopeMode: syncState.scopeMode ?? undefined,
    selectedRepoIds: syncState.selectedRepoIds,
    selectedFocusIds: syncState.selectedFocusIds,
  });
  emitStreamEvent({ message: `Created child-task follow-up: ${filePath}`, source: 'createFollowupTask', role: 'queue' });
  return filePath;
}

export function validatePlannerDraftForSubmission(
  draft: PlannerDraftModel,
): string[] {
  const errors: string[] = [];

  if (draft.taskKind === 'child-task') {
    return [
      'Child-task drafts must use the follow-up intake path (followup.begin), not planner.submitDraft.',
    ];
  }

  if (!draft.title.trim()) {
    errors.push('Title is required before submitting to dropbox.');
  }

  if (!draft.summary.trim()) {
    errors.push('Request summary is required before submitting to dropbox.');
  }

  if (!draft.desiredOutcome.trim()) {
    errors.push('Desired outcome is required before submitting to dropbox.');
  }

  return errors;
}

export function validateFollowUpDraftForSubmission(
  draft: PlannerDraftModel,
): string[] {
  const errors: string[] = [];

  if (draft.taskKind !== 'child-task') {
    errors.push('Follow-up drafts must use the child-task task kind.');
  }

  if (!draft.title.trim()) {
    errors.push('Title is required before creating a follow-up child task.');
  }

  if (!draft.summary.trim()) {
    errors.push('Requested adjustment is required before creating a follow-up child task.');
  }

  if (!draft.parentTaskId.trim()) {
    errors.push('Parent task ID is required for follow-up creation.');
  }

  if (!draft.parentQmdScope.trim()) {
    errors.push('Parent QMD scope is required for follow-up creation.');
  }

  if (!draft.followupReason.trim()) {
    errors.push('Follow-up reason is required for follow-up creation.');
  }

  if (!draft.carryForwardSummary.trim()) {
    errors.push('Carry-forward summary is required when follow-up lineage must stay local and explicit.');
  }

  return errors;
}

export function buildDropboxTaskArgs(
  draft: PlannerDraftModel,
): string[] {
  return [
    '--title',
    draft.title,
    '--task-kind',
    draft.taskKind,
    '--summary',
    draft.summary,
    '--desired-outcome',
    draft.desiredOutcome,
    '--constraints',
    draft.constraints,
    '--acceptance-signals',
    draft.acceptanceSignals,
    '--suggested-path',
    draft.suggestedPath,
    '--planning-notes',
    draft.planningNotes,
  ];
}

export function buildFollowUpTaskArgs(
  draft: PlannerDraftModel,
): string[] {
  const args = [
    '--title',
    draft.title,
    '--requested-adjustment',
    draft.summary,
    '--desired-outcome',
    draft.desiredOutcome,
    '--constraints',
    draft.constraints,
    '--acceptance-signals',
    draft.acceptanceSignals,
    '--parent-task-id',
    draft.parentTaskId,
    '--parent-qmd-scope',
    draft.parentQmdScope,
    '--root-task-id',
    draft.rootTaskId || draft.parentTaskId,
    '--followup-reason',
    draft.followupReason,
    '--carry-forward-summary',
    draft.carryForwardSummary,
    '--planning-notes',
    draft.planningNotes,
    '--suggested-path',
    draft.suggestedPath,
  ];

  if (draft.parentQmdRecordId.trim()) {
    args.push('--parent-qmd-record-id', draft.parentQmdRecordId);
  }

  return args;
}

export async function submitDraftViaDropboxHelper(
  draft: PlannerDraftModel,
  runner: DropboxScriptRunner = runDropboxTaskScript,
): Promise<DesktopInvokeResult> {
  const validationErrors = validatePlannerDraftForSubmission(draft);

  if (validationErrors.length > 0) {
    return {
      ok: false,
      action: 'planner.submitDraft',
      error: 'Planner draft validation failed before dropbox submission.',
      details: validationErrors,
    };
  }

  try {
    const submittedPath = await runner({
      title: draft.title,
      summary: draft.summary,
      desiredOutcome: draft.desiredOutcome,
      constraints: draft.constraints,
      acceptanceSignals: draft.acceptanceSignals,
      suggestedPath: draft.suggestedPath,
      planningNotes: draft.planningNotes,
      kind: draft.taskKind,
    });

    return {
      ok: true,
      response: {
        action: 'planner.submitDraft',
        mode: 'submitted',
        accepted: true,
        message:
          'Planner draft submitted via platform queue module. Queue automation can now claim the task from AgentWorkSpace/dropbox/.',
        draftTitle: draft.title,
        suggestedPath: draft.suggestedPath,
        submittedPath,
        observationMode: true,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.submitDraft',
      error:
        error instanceof Error
          ? error.message
          : 'Dropbox submission failed unexpectedly in the Electron main process.',
    };
  }
}

export async function submitFollowUpViaHelper(
  draft: PlannerDraftModel,
  runner: FollowUpScriptRunner = runFollowUpTaskScript,
): Promise<DesktopInvokeResult> {
  const validationErrors = validateFollowUpDraftForSubmission(draft);

  if (validationErrors.length > 0) {
    return {
      ok: false,
      action: 'followup.begin',
      error: 'Follow-up draft validation failed before child-task submission.',
      details: validationErrors,
    };
  }

  try {
    const submittedPath = await runner({
      title: draft.title,
      summary: draft.summary,
      desiredOutcome: draft.desiredOutcome,
      constraints: draft.constraints,
      acceptanceSignals: draft.acceptanceSignals,
      parentTaskId: draft.parentTaskId,
      parentQmdScope: draft.parentQmdScope,
      parentQmdRecordId: draft.parentQmdRecordId,
      rootTaskId: draft.rootTaskId || draft.parentTaskId,
      followupReason: draft.followupReason,
      carryForwardSummary: draft.carryForwardSummary,
      suggestedPath: draft.suggestedPath,
      planningNotes: draft.planningNotes,
    });

    return {
      ok: true,
      response: {
        action: 'followup.begin',
        mode: 'submitted',
        accepted: true,
        message:
          'Follow-up child task created via platform queue module. The closed parent task remains unchanged while queue automation can claim the new child-task intake from AgentWorkSpace/dropbox/.',
        suggestedTaskKind: 'child-task',
        sourceTaskId: draft.parentTaskId,
        parentTaskId: draft.parentTaskId,
        rootTaskId: draft.rootTaskId || draft.parentTaskId,
        submittedPath,
        reopenedTask: false,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'followup.begin',
      error:
        error instanceof Error
          ? error.message
          : 'Follow-up submission failed unexpectedly in the Electron main process.',
    };
  }
}
