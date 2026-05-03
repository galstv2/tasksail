import { createDropboxTask } from './createDropboxTask.js';
import type { TaskContextPackTarget } from './markdown.js';
import type { PrimaryFocusTarget } from '../context-pack/deepFocusNormalization.js';
import { assertPolicyPasses } from './policyValidation.js';
import { findRepoRoot } from '../core/index.js';

export interface CreateFollowupTaskOptions {
  /** Parent task file path (for context extraction). */
  parentTaskPath?: string;
  title: string;
  summary?: string;
  desiredOutcome?: string;
  constraints?: string;
  acceptanceSignals?: string;
  parentTaskId: string;
  parentQmdScope: string;
  parentQmdRecordId?: string;
  rootTaskId?: string;
  followupReason: string;
  carryForwardSummary: string;
  requestedAdjustment?: string;
  suggestedPath?: string;
  planningNotes?: string;
  outputPath?: string;
  force?: boolean;
  repoRoot?: string;
  contextPackDir?: string;
  contextPackId?: string;
  scopeMode?: string;
  selectedRepoIds?: string[];
  selectedFocusIds?: string[];
  deepFocusEnabled?: boolean;
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: 'directory' | 'file' | null;
  selectedFocusTargets?: PrimaryFocusTarget[];
  selectedTestTarget?: TaskContextPackTarget | null;
  selectedSupportTargets?: TaskContextPackTarget[];
}

/**
 * Create a child-task follow-up draft with carry-forward context from a parent.
 * Validates parent closeout state before creation.
 * Delegates to createDropboxTask with child-task kind pre-set.
 * Returns the absolute path to the created file.
 */
export async function createFollowupTask(
  options: CreateFollowupTaskOptions,
): Promise<string> {
  const {
    title,
    summary = '',
    desiredOutcome = '',
    constraints = '',
    acceptanceSignals = '',
    parentTaskId,
    parentQmdScope,
    parentQmdRecordId = '',
    rootTaskId = '',
    followupReason,
    carryForwardSummary,
    suggestedPath = 'sequential',
    planningNotes = '',
    outputPath,
    force = false,
    repoRoot,
  } = options;

  if (!title) {
    throw new Error('--title is required.');
  }
  if (!parentTaskId) {
    throw new Error('--parent-task-id is required.');
  }
  if (!parentQmdScope) {
    throw new Error('--parent-qmd-scope is required.');
  }
  if (!followupReason) {
    throw new Error('--followup-reason is required.');
  }

  // Validate parent closeout before creating the follow-up
  if (!force) {
    await assertPolicyPasses({
      mode: 'pre-closeout',
      repoRoot: repoRoot ?? findRepoRoot(),
      taskId: parentTaskId,
      errorMessage: 'Follow-up creation blocked by closeout policy validation.',
    });
  }

  return createDropboxTask({
    title,
    summary,
    desiredOutcome,
    constraints,
    acceptanceSignals,
    kind: 'child-task',
    parentTaskId,
    parentQmdRecordId,
    parentQmdScope,
    rootTaskId: rootTaskId || parentTaskId,
    followupReason,
    carryForwardSummary,
    suggestedPath,
    planningNotes,
    outputPath,
    force,
    repoRoot,
    contextPackDir: options.contextPackDir,
    contextPackId: options.contextPackId,
    scopeMode: options.scopeMode,
    selectedRepoIds: options.selectedRepoIds,
    selectedFocusIds: options.selectedFocusIds,
    deepFocusEnabled: options.deepFocusEnabled,
    selectedFocusPath: options.selectedFocusPath,
    selectedFocusTargetKind: options.selectedFocusTargetKind,
    selectedFocusTargets: options.selectedFocusTargets,
    selectedTestTarget: options.selectedTestTarget,
    selectedSupportTargets: options.selectedSupportTargets,
  });
}
