import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createLogger, slugify, findRepoRoot, ensureDir, copyFileSafe } from '../core/index.js';
import { existsSync } from 'node:fs';
import {
  resolveQueuePaths,
  SLICE_TEMPLATE_FILENAME,
  templateSourceFor,
} from './paths.js';
import { initializeTaskArtifacts, handoffWorkspaceIsReady, hasSubstantiveContent } from './lifecycle.js';
import { stampRetrospectiveRequiredMetadata } from './retrospectiveFlag.js';
import {
  buildImplementationSpecSectionsFromIntake,
  buildProfessionalTaskSectionsFromIntake,
} from './markdown.js';

const log = createLogger('platform/queue/newTask');

/**
 * Regex that taskId values MUST conform to.
 * Rules: lowercase alphanumeric, hyphens, underscores; no dots (sentinel ambiguity);
 * no leading/trailing hyphens/underscores; 2–64 chars total.
 */
export const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,62}[a-z0-9]$/;

/**
 * Error thrown when a taskId does not conform to TASK_ID_PATTERN.
 * Callers MUST catch by `.code`, not by instanceof, to survive IPC boundaries.
 */
export interface InvalidTaskIdShapeError {
  code: 'invalid-task-id-shape';
  taskId: string;
  pattern: string;
  reason: string;
}

export type InvalidTaskIdShapeErrorInstance = Error & InvalidTaskIdShapeError;

/**
 * Validate a taskId against the canonical shape regex.
 * Throws InvalidTaskIdShapeErrorInstance when invalid.
 */
export function validateTaskId(taskId: string): void {
  if (!TASK_ID_PATTERN.test(taskId)) {
    let reason = 'taskId does not match pattern';
    if (/[A-Z]/.test(taskId)) {
      reason = 'uppercase not allowed in taskId';
    } else if (/\./.test(taskId)) {
      reason = 'dot not allowed in taskId (sentinel filename ambiguity)';
    } else if (/^[-_]/.test(taskId)) {
      reason = 'taskId must not start with a hyphen or underscore';
    } else if (/[-_]$/.test(taskId)) {
      reason = 'taskId must not end with a hyphen or underscore';
    } else if (taskId.length < 2) {
      reason = 'taskId must be at least 2 characters';
    } else if (taskId.length > 64) {
      reason = 'taskId must be at most 64 characters';
    }
    const err = new Error(
      `invalid-task-id-shape: taskId "${taskId}" failed pattern ${TASK_ID_PATTERN.source}: ${reason}`,
    ) as InvalidTaskIdShapeErrorInstance;
    err.code = 'invalid-task-id-shape';
    err.taskId = taskId;
    err.pattern = TASK_ID_PATTERN.source;
    err.reason = reason;
    throw err;
  }
}

/**
 * Generate a slug from a title + ISO timestamp. Output MUST pass TASK_ID_PATTERN.
 */
export function generateTaskId(rawTitle: string): string {
  const now = new Date();
  // Produce a fully lowercase timestamp: strip separators, replace 'T' with '-', drop sub-seconds
  // e.g. "2026-04-18T23:06:49.123Z" → "20260418-230649z"
  const ts = now.toISOString()
    .replace(/[-:]/g, '')       // remove dashes and colons
    .replace('T', '-')          // lowercase separator between date and time
    .replace(/\.\d+Z$/, 'z');   // drop milliseconds, lowercase trailing Z
  // slugify lowercases and replaces non-alnum with hyphens; then strip leading/trailing hyphens
  const base = slugify(rawTitle).replace(/^[-_]+|[-_]+$/g, '') || 'task';
  const candidate = `${base}-${ts}`;
  // Trim to 64 chars, ensuring no trailing hyphen/underscore
  let trimmed = candidate.slice(0, 64).replace(/[-_]+$/, '');
  // Strip any dots (slugify should not produce them, but be defensive)
  trimmed = trimmed.replace(/\./g, '-');
  return trimmed;
}

/**
 * Check if a markdown file contains authored section content beyond
 * template boilerplate (headings, comments, metadata labels, and
 * stamped metadata values).
 *
 * Returns false if the file does not exist or cannot be read.
 */
async function hasAuthoredContent(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return hasSubstantiveContent(raw);
  } catch {
    // Intentional: missing file means no authored content
    return false;
  }
}

export interface InitializeTaskOptions {
  title?: string;
  taskId?: string;
  source?: string;
  rawRequest?: string;
  withStarterSlice?: boolean;
  /**
   * @deprecated The --reset mode is retired. Per-task dirs are always fresh at
   * creation time; this flag is accepted but ignored.
   */
  reset?: boolean;
  force?: boolean;
  repoRoot?: string;
  /**
   * Explicit context pack path for the new task.
   * Required for new-task invocations.
   */
  contextPackPath?: string;
}

/**
 * Initialize the handoff workspace for a new task.
 * Writes artifacts under AgentWorkSpace/tasks/<taskId>/handoffs/ (per-task path).
 * The --reset mode has been retired: per-task dirs are always fresh at creation.
 */
export async function initializeTask(
  options: InitializeTaskOptions = {},
): Promise<void> {
  const {
    title: rawTitle,
    taskId: rawTaskId,
    source = 'manual',
    rawRequest = '',
    withStarterSlice = false,
    force = false,
    repoRoot: rawRepoRoot,
    contextPackPath,
  } = options;

  const repoRoot = rawRepoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);

  await ensureDir(queuePaths.dropboxDir);
  await ensureDir(queuePaths.pendingDir);

  // Determine taskId — validate if explicit, generate if absent
  const taskTitle = rawTitle || 'New Task';
  let taskId: string;
  if (rawTaskId !== undefined && rawTaskId !== '') {
    validateTaskId(rawTaskId);
    taskId = rawTaskId;
  } else {
    taskId = generateTaskId(taskTitle);
    // Generated slugs must also pass validation (defense-in-depth)
    validateTaskId(taskId);
  }

  // Per-task handoffs directory (§4.1B)
  const perTaskHandoffsDir = queuePaths.taskHandoffs(taskId);
  await ensureDir(perTaskHandoffsDir);

  if (!force) {
    const ready = await handoffWorkspaceIsReady(
      perTaskHandoffsDir,
      queuePaths.templatesDir,
    );
    if (!ready) {
      throw new Error(
        `handoffs/ for task "${taskId}" is not in a reset state. Rerun with --force.`,
      );
    }
  }

  const now = new Date();
  const initializedAt = now.toISOString().replace(/\.\d+Z$/, 'Z');

  const metadata: Record<string, string> = {
    'Task ID': taskId,
    'Task Title': taskTitle,
    'Initialized At (UTC)': initializedAt,
    'Active Branch': 'unknown',
    'Intake Source': source,
  };

  // Manually-initialized tasks have no parent/QMD lineage, but the templates
  // still expose a `- Task Kind:` line. Default it to 'standard' so the
  // stamped handoff matches activation-flow output (operations.ts).
  const lineage: Record<string, string> = {
    'Task Kind': 'standard',
  };

  const intakeMarkdown = rawRequest.includes('## Request Summary')
    ? rawRequest
    : buildMinimalIntakeMarkdown(taskTitle, rawRequest);
  const sections = {
    ...buildProfessionalTaskSectionsFromIntake(intakeMarkdown),
    ...buildImplementationSpecSectionsFromIntake(intakeMarkdown),
  };

  const implementationStepsDir = queuePaths.taskImplementationSteps(taskId);

  await initializeTaskArtifacts({
    handoffsDir: perTaskHandoffsDir,
    templatesDir: queuePaths.templatesDir,
    metadata,
    lineage,
    sections,
    implementationStepsDir,
  });

  // §4.1B: contextPackPath is now passed explicitly; do NOT read ACTIVE_CONTEXT_PACK_DIR env.
  // When missing, treat as non-fatal for task initialization (best-effort).
  const resolvedContextPackDir: string | undefined = contextPackPath;

  await stampRetrospectiveRequiredMetadata({
    repoRoot,
    handoffsDir: perTaskHandoffsDir,
    contextPackDir: resolvedContextPackDir,
  });

  if (withStarterSlice) {
    // Verify pre-slice artifacts exist before creating a starter slice.
    const implSpec = path.join(perTaskHandoffsDir, 'implementation-spec.md');
    const hasImplSpec = await hasAuthoredContent(implSpec);

    if (!hasImplSpec) {
      log.warn('starter_slice.blocked', { reason: 'missing-pre-slice-artifacts' });
      throw new Error('Starter slice blocked by missing pre-slice artifacts.');
    }

    await ensureDir(implementationStepsDir);
    const pmseName = `slice-01-${slugify(taskTitle)}`;
    let candidate = path.join(implementationStepsDir, `${pmseName}.md`);
    let suffix = 1;
    while (existsSync(candidate)) {
      candidate = path.join(
        implementationStepsDir,
        `${pmseName}-${suffix}.md`,
      );
      suffix++;
    }

    const sliceTemplatePath = templateSourceFor(
      SLICE_TEMPLATE_FILENAME,
      queuePaths.templatesDir,
    );
    if (!existsSync(sliceTemplatePath)) {
      throw new Error(
        'Starter slice blocked: canonical slice-template.md is missing.',
      );
    }

    await copyFileSafe(sliceTemplatePath, candidate);
  }
}

function buildMinimalIntakeMarkdown(taskTitle: string, rawRequest: string): string {
  return [
    `# ${taskTitle}`,
    '',
    '## Request Summary',
    '',
    rawRequest || taskTitle,
    '',
    '## Desired Outcome',
    '',
    'Complete the requested task.',
    '',
    '## Constraints',
    '',
    'None',
    '',
    '## Acceptance Signals',
    '',
    '- Requested task is completed without weakening existing behavior.',
    '',
  ].join('\n');
}
