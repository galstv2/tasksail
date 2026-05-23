import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { createDropboxTask } from './createDropboxTask.js';
import type { TaskBranchChainBinding, TaskContextPackTarget } from './markdown.js';
import type { PrimaryFocusTarget } from '../context-pack/deepFocusNormalization.js';
import type { ContextPackRepositoryTypes } from './repositoryTypes.js';
import { assertPolicyPasses } from './policyValidation.js';
import { findRepoRoot, ValidationError } from '../core/index.js';
import { resolveQueuePaths } from './paths.js';
import { removeTask } from './taskRegistry.js';
import { recordPlannedChildTask } from './childTaskChainPlanning.js';
import type { ChildTaskContextSnapshot } from './childTaskChains.js';

export interface CreateFollowupTaskOptions {
  /** Parent task file path (for context extraction). */
  parentTaskPath?: string;
  title: string;
  summary?: string;
  desiredOutcome?: string;
  constraints?: string;
  criticalRequirements?: string;
  compatibilityRequirements?: string;
  requiredValidation?: string;
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
  primaryRepoId?: string | null;
  primaryFocusId?: string | null;
  selectedRepoIds?: string[];
  selectedFocusIds?: string[];
  repositoryTypes?: ContextPackRepositoryTypes;
  deepFocusEnabled?: boolean;
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: 'directory' | 'file' | null;
  selectedFocusTargets?: PrimaryFocusTarget[];
  selectedTestTarget?: TaskContextPackTarget | null;
  selectedSupportTargets?: TaskContextPackTarget[];
  branchChain?: TaskBranchChainBinding;
  deepFocusPrimaryRepoId?: string | null;
  deepFocusPrimaryFocusId?: string | null;
  parentContextSnapshot?: ChildTaskContextSnapshot | null;
  childExecutionScope?: ChildTaskContextSnapshot | null;
  parentArchivePath?: string | null;
  parentArchiveArtifactDir?: string | null;
  previousTaskId?: string | null;
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
    criticalRequirements = 'None',
    compatibilityRequirements = 'None',
    requiredValidation = 'None',
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
  const effectiveRepoRoot = repoRoot ?? findRepoRoot();

  if (!title) {
    throw new ValidationError('--title is required.', { code: 'TITLE_REQUIRED', category: 'user' });
  }
  if (!parentTaskId) {
    throw new ValidationError('--parent-task-id is required.', { code: 'PARENT_TASK_ID_REQUIRED', category: 'user' });
  }
  if (!parentQmdScope) {
    throw new ValidationError('--parent-qmd-scope is required.', { code: 'PARENT_QMD_SCOPE_REQUIRED', category: 'user' });
  }
  if (!followupReason) {
    throw new ValidationError('--followup-reason is required.', { code: 'FOLLOWUP_REASON_REQUIRED', category: 'user' });
  }

  if (options.branchChain && force) {
    throw new ValidationError('Branch-chain child creation does not support --force.', { code: 'BRANCH_CHAIN_FORCE_UNSUPPORTED', category: 'user' });
  }
  if (options.branchChain && (
    options.branchChain.rootTaskId !== (rootTaskId || parentTaskId)
    || options.branchChain.parentTaskId !== parentTaskId
  )) {
    throw new ValidationError('Branch-chain metadata does not match child lineage.', { code: 'BRANCH_CHAIN_LINEAGE_MISMATCH', category: 'user' });
  }
  const requiredChildExecutionScope = options.branchChain
    ? requireChildExecutionScope(options.childExecutionScope)
    : null;

  // Validate parent closeout before creating the follow-up
  if (!force) {
    await assertPolicyPasses({
      mode: 'pre-closeout',
      repoRoot: effectiveRepoRoot,
      taskId: parentTaskId,
      errorMessage: 'Follow-up creation blocked by closeout policy validation.',
    });
  }

  const queuePaths = resolveQueuePaths(effectiveRepoRoot);
  const explicitOutputPath = outputPath
    ? path.resolve(path.isAbsolute(outputPath) ? outputPath : path.join(queuePaths.dropboxDir, outputPath))
    : null;
  const existedBefore = explicitOutputPath ? existsSync(explicitOutputPath) : false;
  const createdPath = await createDropboxTask({
    title,
    summary,
    desiredOutcome,
    constraints,
    criticalRequirements,
    compatibilityRequirements,
    requiredValidation,
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
    repoRoot: effectiveRepoRoot,
    contextPackDir: options.contextPackDir,
    contextPackId: options.contextPackId,
    scopeMode: options.scopeMode,
    primaryRepoId: options.primaryRepoId,
    primaryFocusId: options.primaryFocusId,
    selectedRepoIds: options.selectedRepoIds,
    selectedFocusIds: options.selectedFocusIds,
    repositoryTypes: options.repositoryTypes,
    deepFocusEnabled: options.deepFocusEnabled,
    selectedFocusPath: options.selectedFocusPath,
    selectedFocusTargetKind: options.selectedFocusTargetKind,
    selectedFocusTargets: options.selectedFocusTargets,
    selectedTestTarget: options.selectedTestTarget,
    selectedSupportTargets: options.selectedSupportTargets,
    branchChain: options.branchChain,
    deepFocusPrimaryRepoId: options.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: options.deepFocusPrimaryFocusId,
  });
  if (!options.branchChain) {
    return createdPath;
  }
  if (!requiredChildExecutionScope) {
    throw new ValidationError('Branch-chain child creation requires childExecutionScope.', { code: 'BRANCH_CHAIN_CHILD_SCOPE_REQUIRED', category: 'user' });
  }

  const taskId = path.basename(createdPath, '.md');
  try {
    await recordPlannedChildTask(effectiveRepoRoot, {
      taskId,
      rootTaskId: rootTaskId || parentTaskId,
      parentTaskId,
      previousTaskId: options.previousTaskId ?? parentTaskId,
      branchChain: options.branchChain,
      parentArchivePath: options.parentArchivePath ?? null,
      parentArchiveArtifactDir: options.parentArchiveArtifactDir ?? null,
      parentContextSnapshot: options.parentContextSnapshot ?? null,
      childExecutionScope: requiredChildExecutionScope,
    });
    return createdPath;
  } catch (error) {
    const resolvedCreatedPath = path.resolve(createdPath);
    const inDropbox = resolvedCreatedPath.startsWith(`${path.resolve(queuePaths.dropboxDir)}${path.sep}`);
    if (inDropbox && (!explicitOutputPath || !existedBefore)) {
      await unlink(resolvedCreatedPath).catch(() => undefined);
    }
    await removeTask(effectiveRepoRoot, taskId).catch(() => undefined);
    throw error;
  }
}

function requireChildExecutionScope(value: ChildTaskContextSnapshot | null | undefined): ChildTaskContextSnapshot {
  if (!value) {
    throw new ValidationError('Branch-chain child creation requires childExecutionScope.', { code: 'BRANCH_CHAIN_CHILD_SCOPE_REQUIRED', category: 'user' });
  }
  return value;
}
