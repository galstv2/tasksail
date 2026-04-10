import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  slugify,
  ensureDir,
  writeTextFile,
  ensurePathWithinDropbox,
} from '../core/index.js';
import { resolveQueuePaths } from './paths.js';
import {
  formatContextPackBindingSection,
  type TaskContextPackTarget,
} from './markdown.js';

export interface CreateDropboxTaskOptions {
  title: string;
  summary?: string;
  desiredOutcome?: string;
  constraints?: string;
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
  /** Whether Deep Focus metadata should be persisted. */
  deepFocusEnabled?: boolean;
  /** Selected Deep Focus path relative to the primary repo root. */
  selectedFocusPath?: string | null;
  /** Selected Deep Focus target kind. */
  selectedFocusTargetKind?: 'directory' | 'file' | null;
  /** Optional Deep Focus test target. */
  selectedTestTarget?: TaskContextPackTarget | null;
  /** Normalized Deep Focus support targets. */
  selectedSupportTargets?: TaskContextPackTarget[];
}

export const CANONICAL_TASK_FILENAME_SEPARATOR = '_';

function formatCanonicalTaskTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function canonicalTaskSlug(title: string): string {
  return slugify(title) || 'task';
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
    throw new Error('--title is required.');
  }

  if (kind !== 'standard' && kind !== 'child-task') {
    throw new Error('--task-kind must be standard or child-task.');
  }

  if (suggestedPath !== 'sequential' && suggestedPath !== 'parallel') {
    throw new Error('--suggested-path must be sequential or parallel.');
  }

  if (kind === 'child-task') {
    if (!parentTaskId) {
      throw new Error('--parent-task-id is required for child-task intake.');
    }
    if (!followupReason) {
      throw new Error('--followup-reason is required for child-task intake.');
    }
    if (!carryForwardSummary) {
      throw new Error(
        '--carry-forward-summary is required for child-task intake.',
      );
    }
    if (!parentQmdScope) {
      throw new Error('--parent-qmd-scope is required for child-task intake.');
    }
  }

  const rootTaskId = rawRootTaskId || (kind === 'child-task' ? parentTaskId : '');

  const queuePaths = resolveQueuePaths(repoRoot);
  await ensureDir(queuePaths.dropboxDir);

  let outputFile = options.outputPath ?? '';

  if (!outputFile) {
    const now = new Date();
    const ts = formatCanonicalTaskTimestamp(now);
    const slug = canonicalTaskSlug(title);
    outputFile = path.join(
      queuePaths.dropboxDir,
      `${ts}${CANONICAL_TASK_FILENAME_SEPARATOR}${slug}.md`,
    );

    // Avoid collision
    if (existsSync(outputFile)) {
      let suffix = 1;
      const stem = outputFile.replace(/\.md$/, '');
      while (existsSync(`${stem}-${suffix}.md`)) {
        suffix++;
      }
      outputFile = `${stem}-${suffix}.md`;
    }
  } else if (!path.isAbsolute(outputFile)) {
    outputFile = path.join(queuePaths.dropboxDir, outputFile);
  }

  ensurePathWithinDropbox(queuePaths.dropboxDir, outputFile);

  if (existsSync(outputFile) && !force) {
    throw new Error(`${outputFile} already exists. Use --force to overwrite.`);
  }

  const createdAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const bindingSection = formatContextPackBindingSection({
    contextPackDir: (options.contextPackDir ?? '').trim() || undefined,
    contextPackId: (options.contextPackId ?? '').trim() || undefined,
    scopeMode: (options.scopeMode ?? '').trim() || undefined,
    selectedRepoIds: options.selectedRepoIds,
    selectedFocusIds: options.selectedFocusIds,
    deepFocusEnabled: options.deepFocusEnabled,
    selectedFocusPath: options.selectedFocusPath,
    selectedFocusTargetKind: options.selectedFocusTargetKind,
    selectedTestTarget: options.selectedTestTarget,
    selectedSupportTargets: options.selectedSupportTargets,
  });

  const content = `# ${title}

## Task Lineage

- Task Kind: ${kind}
- Parent Task ID: ${parentTaskId}
- Root Task ID: ${rootTaskId}
- Parent QMD Record ID: ${parentQmdRecordId}
- Parent QMD Scope: ${parentQmdScope}
- Follow-Up Reason: ${followupReason}

${bindingSection}

## Request Summary

${summary}

## Desired Outcome

${desiredOutcome}

## Constraints

${constraints}

## Acceptance Signals

${acceptanceSignals}

## Parent Task Carry-Forward Summary

${carryForwardSummary}

## Suggested Routing

- Recommended Execution: ${suggestedPath}
- Planner Notes: ${planningNotes}

## Source

- Created By: Planning Agent
- Created At (UTC): ${createdAt}
`;

  await writeTextFile(outputFile, content);
  return outputFile;
}
