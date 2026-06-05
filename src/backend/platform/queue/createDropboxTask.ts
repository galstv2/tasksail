import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import {
  ensureDir,
  writeTextFile,
  ensurePathWithinDropbox,
  findRepoRoot,
  ValidationError,
} from '../core/index.js';
import { writeTextFileExclusive } from '../core/io.js';
import { assertValidTaskId, resolveQueuePaths } from './paths.js';
import {
  formatBranchChainSection,
  formatContextPackBindingSection,
  type TaskBranchChainBinding,
  type TaskContextPackTarget,
} from './markdown.js';
import type { ContextPackRepositoryTypes } from './repositoryTypes.js';
import type { PrimaryFocusTarget } from '../context-pack/deepFocusNormalization.js';
import { registerTask } from './taskRegistry.js';
import { buildReadableTaskFileName } from './taskNames.js';
import { resolveFrozenStandardSelectionRoles } from './standardSelectionRoles.js';

export interface CreateDropboxTaskOptions {
  title: string;
  summary?: string;
  desiredOutcome?: string;
  constraints?: string;
  criticalRequirements?: string;
  compatibilityRequirements?: string;
  requiredValidation?: string;
  acceptanceSignals?: string;
  suggestedPath?: string;
  planningNotes?: string;
  kind?: string;
  outputPath?: string;
  force?: boolean;
  /** Parent task ID, required for child-task kind. */
  parentTaskId?: string;
  /** Parent QMD record ID for child tasks. */
  parentQmdRecordId?: string;
  /** Parent QMD scope for child tasks. */
  parentQmdScope?: string;
  /** Root task ID for lineage tracking. */
  rootTaskId?: string;
  /** Reason for follow-up, required for child-task kind. */
  followupReason?: string;
  /** Carry-forward summary from parent task. */
  carryForwardSummary?: string;
  /** Override repo root for path resolution. */
  repoRoot?: string;
  /** Context pack dir active at submission time. */
  contextPackDir?: string;
  /** Context pack ID active at submission time. */
  contextPackId?: string;
  /** Workspace scope mode at submission time. */
  scopeMode?: string;
  /** Selected repo IDs at submission time. */
  selectedRepoIds?: string[];
  /** Selected focus IDs at submission time. */
  selectedFocusIds?: string[];
  /** Standard-mode repository/focus role authority at submission time. */
  repositoryTypes?: ContextPackRepositoryTypes;
  /** Primary repo ID at submission time. */
  primaryRepoId?: string | null;
  /** Primary focus ID at submission time. */
  primaryFocusId?: string | null;
  /** Whether Deep Focus metadata should be persisted. */
  deepFocusEnabled?: boolean;
  /** Selected Deep Focus path relative to the primary repo root. */
  selectedFocusPath?: string | null;
  /** Selected Deep Focus target kind. */
  selectedFocusTargetKind?: 'directory' | 'file' | null;
  /** Ordered Deep Focus primary targets. */
  selectedFocusTargets?: PrimaryFocusTarget[];
  /** Optional Deep Focus test target. */
  selectedTestTarget?: TaskContextPackTarget | null;
  /** Normalized Deep Focus support targets. */
  selectedSupportTargets?: TaskContextPackTarget[];
  branchChain?: TaskBranchChainBinding;
  deepFocusPrimaryRepoId?: string | null;
  deepFocusPrimaryFocusId?: string | null;
}

/**
 * Create a queue-ready markdown task file in the dropbox directory.
 * Returns the absolute path to the created file.
 */
export async function createDropboxTask(
  options: CreateDropboxTaskOptions,
): Promise<string> {
  const {
    summary = '',
    desiredOutcome = '',
    constraints = '',
    criticalRequirements = 'None',
    compatibilityRequirements = 'None',
    requiredValidation = 'None',
    acceptanceSignals = '',
    suggestedPath = 'sequential',
    planningNotes = '',
    kind = 'standard',
    force = false,
    parentQmdRecordId = '',
    rootTaskId: rawRootTaskId = '',
    repoRoot,
  } = options;

  const title = (options.title ?? '').trim();
  const parentTaskId = (options.parentTaskId ?? '').trim();
  const parentQmdScope = (options.parentQmdScope ?? '').trim();
  const followupReason = (options.followupReason ?? '').trim();
  const carryForwardSummary = (options.carryForwardSummary ?? '').trim();

  if (!title) {
    throw new ValidationError('--title is required.', { code: 'TITLE_REQUIRED', category: 'user' });
  }

  if (kind !== 'standard' && kind !== 'child-task') {
    throw new ValidationError('--task-kind must be standard or child-task.', { code: 'TASK_KIND_INVALID', category: 'user' });
  }
  if (options.branchChain && kind !== 'child-task') {
    throw new ValidationError('Branch Chain metadata is only valid for child-task intake.', { code: 'BRANCH_CHAIN_TASK_KIND_INVALID', category: 'user' });
  }

  if (suggestedPath !== 'sequential' && suggestedPath !== 'parallel') {
    throw new ValidationError('--suggested-path must be sequential or parallel.', { code: 'SUGGESTED_PATH_INVALID', category: 'user' });
  }

  if (kind === 'child-task') {
    if (!parentTaskId) {
      throw new ValidationError('--parent-task-id is required for child-task intake.', { code: 'PARENT_TASK_ID_REQUIRED', category: 'user' });
    }
    if (!followupReason) {
      throw new ValidationError('--followup-reason is required for child-task intake.', { code: 'FOLLOWUP_REASON_REQUIRED', category: 'user' });
    }
    if (!carryForwardSummary) {
      throw new ValidationError(
        '--carry-forward-summary is required for child-task intake.',
        { code: 'CARRY_FORWARD_SUMMARY_REQUIRED', category: 'user' },
      );
    }
    if (!parentQmdScope) {
      throw new ValidationError('--parent-qmd-scope is required for child-task intake.', { code: 'PARENT_QMD_SCOPE_REQUIRED', category: 'user' });
    }
  }

  const rootTaskId = rawRootTaskId || (kind === 'child-task' ? parentTaskId : '');

  const effectiveRepoRoot = repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(effectiveRepoRoot);
  await ensureDir(queuePaths.dropboxDir);

  const explicitOutputPath = options.outputPath ?? '';
  // Whether the caller supplied an explicit destination path. Explicit paths
  // use the legacy existsSync + force check; auto-generated paths use the
  // exclusive-create retry loop below so two callers in the same second never
  // silently clobber each other.
  const isAutoPath = !explicitOutputPath;

  let outputFile: string;
  if (explicitOutputPath) {
    outputFile = path.isAbsolute(explicitOutputPath)
      ? explicitOutputPath
      : path.join(queuePaths.dropboxDir, explicitOutputPath);
  } else {
    outputFile = buildAutoOutputFile(title, queuePaths);
  }

  ensurePathWithinDropbox(queuePaths.dropboxDir, outputFile);
  const outputBase = path.basename(outputFile);
  if (!outputBase.endsWith('.md') || outputBase.startsWith('.')) {
    throw new ValidationError('Dropbox task output path must be a visible .md file.', { code: 'DROPBOX_OUTPUT_PATH_INVALID', category: 'user' });
  }
  assertValidTaskId(path.basename(outputFile, '.md'));

  if (!isAutoPath && existsSync(outputFile) && !force) {
    throw new ValidationError(`${outputFile} already exists. Use --force to overwrite.`, { code: 'DROPBOX_OUTPUT_EXISTS', category: 'user' });
  }

  const createdAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const repositoryTypes = await resolveFrozenStandardSelectionRoles({
    repoRoot: effectiveRepoRoot,
    contextPackDir: options.contextPackDir,
    deepFocusEnabled: options.deepFocusEnabled,
    selectedRepoIds: options.selectedRepoIds,
    selectedFocusIds: options.selectedFocusIds,
    repositoryTypes: options.repositoryTypes,
    primaryRepoId: options.primaryRepoId,
    primaryFocusId: options.primaryFocusId,
  });

  const bindingSection = formatContextPackBindingSection({
    contextPackDir: (options.contextPackDir ?? '').trim() || undefined,
    contextPackId: (options.contextPackId ?? '').trim() || undefined,
    scopeMode: (options.scopeMode ?? '').trim() || undefined,
    primaryRepoId: (options.primaryRepoId ?? '')?.trim() || undefined,
    primaryFocusId: (options.primaryFocusId ?? '')?.trim() || undefined,
    selectedRepoIds: options.selectedRepoIds,
    selectedFocusIds: options.selectedFocusIds,
    repositoryTypes,
    deepFocusEnabled: options.deepFocusEnabled,
    deepFocusPrimaryRepoId: options.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: options.deepFocusPrimaryFocusId,
    selectedFocusPath: options.selectedFocusPath,
    selectedFocusTargetKind: options.selectedFocusTargetKind,
    selectedFocusTargets: options.selectedFocusTargets,
    selectedTestTarget: options.selectedTestTarget,
    selectedSupportTargets: options.selectedSupportTargets,
  });
  const branchChainDepthLine = kind === 'child-task' && options.branchChain
    ? `- Depth: ${options.branchChain.depth}\n`
    : '';

  const content = `# ${title}

## Task Lineage

- Task Kind: ${kind}
- Parent Task ID: ${parentTaskId}
- Root Task ID: ${rootTaskId}
${branchChainDepthLine}- Parent QMD Record ID: ${parentQmdRecordId}
- Parent QMD Scope: ${parentQmdScope}
- Follow-Up Reason: ${followupReason}

${bindingSection}

${options.branchChain ? `${formatBranchChainSection(options.branchChain)}\n\n` : ''}## Request Summary

${summary}

## Desired Outcome

${desiredOutcome}

## Constraints

${constraints}

## Critical Requirements

${criticalRequirements}

## Compatibility Requirements

${compatibilityRequirements}

## Required Validation

${requiredValidation}

## Acceptance Signals

${acceptanceSignals}

## Parent Task Carry-Forward Summary

${carryForwardSummary}

## Suggested Routing

- Recommended Execution: ${suggestedPath === 'parallel' ? 'Complex' : 'Simple'}
- Planner Notes: ${planningNotes}

## Source

- Created By: Planning Agent
- Created At (UTC): ${createdAt}
`;

  if (isAutoPath) {
    // Exclusive-create with rescan retry: if another caller concurrently wrote
    // the same filename, EEXIST fires. We re-scan the dropbox dir and recompute
    // a fresh candidate instead of clobbering the existing file.
    const MAX_EXCLUSIVE_ATTEMPTS = 5;
    let writeAttempt = 0;
    while (true) {
      try {
        await writeTextFileExclusive(outputFile, content);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        writeAttempt += 1;
        if (writeAttempt >= MAX_EXCLUSIVE_ATTEMPTS) {
          throw new Error(
            `createDropboxTask: could not create a unique dropbox file for "${title}" after ${MAX_EXCLUSIVE_ATTEMPTS} attempts (EEXIST on every candidate).`,
          );
        }
        // Rescan to pick up the file that now occupies this name.
        outputFile = buildAutoOutputFile(title, queuePaths);
      }
    }
  } else {
    // Explicit path: honor the caller's intent. The existsSync+force check above
    // already guards against unintended overwrites.
    await writeTextFile(outputFile, content);
  }

  // Register the new dropbox task in the centralized registry so the task
  // board's registry-first read path surfaces it without waiting for a
  // restart-time `repairTaskRegistry` rebuild. Best-effort: file write is the
  // authoritative operation; a failed registry write is corrected on next
  // startup repair.
  try {
    const registryRoot = path.resolve(queuePaths.dropboxDir, '..', '..');
    const fileName = path.basename(outputFile);
    await registerTask(registryRoot, {
      taskId: fileName.replace(/\.md$/, ''),
      fileName,
      title,
      state: 'open',
      contextPackId: (options.contextPackId ?? '').trim() || null,
      contextPackDir: (options.contextPackDir ?? '').trim() || null,
      scopeMode: (options.scopeMode ?? '').trim() || null,
      selectedRepoIds: options.selectedRepoIds ?? [],
      selectedFocusIds: options.selectedFocusIds ?? [],
      deepFocusEnabled: options.deepFocusEnabled,
      selectedFocusPath: options.selectedFocusPath ?? undefined,
      selectedFocusTargetKind: options.selectedFocusTargetKind ?? undefined,
      selectedFocusTargets: options.selectedFocusTargets,
      selectedTestTarget: options.selectedTestTarget ?? undefined,
      selectedSupportTargets: options.selectedSupportTargets,
      createdAt,
      completedAt: null,
      archivePath: null,
    });
  } catch {
    // Best-effort — see comment above.
  }

  return outputFile;
}

/**
 * Scan all queue directories and return a fresh auto-generated output path
 * for the given title. Called both at initial filename selection and on EEXIST
 * retry so the re-scan picks up files written by concurrent callers.
 */
function buildAutoOutputFile(title: string, queuePaths: ReturnType<typeof resolveQueuePaths>): string {
  const existingFileNames = new Set<string>();
  const tasksDir = path.dirname(queuePaths.taskWorktree('placeholder'));
  for (const dir of [queuePaths.dropboxDir, queuePaths.pendingDir, queuePaths.errorItemsDir, tasksDir]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      existingFileNames.add(entry);
    }
  }
  return path.join(queuePaths.dropboxDir, buildReadableTaskFileName({ rawTitle: title, existingFileNames }));
}
