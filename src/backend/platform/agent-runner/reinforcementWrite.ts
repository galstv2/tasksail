import path from 'node:path';
import { existsSync } from 'node:fs';
import { runPython, findRepoRoot, PythonRunError } from '../core/index.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/index.js';
import { resolveQueuePaths } from '../queue/index.js';
import type { ExternalMcpRegistry } from '../external-mcp-registry/index.js';
import { readJsonSafe, readStoreJsonSafe } from './reinforcementPaths.js';
import {
  prewarmExternalMcpAssignments,
  prewarmExternalMcpRegistry,
} from './pipeline/externalMcpRegistryCache.js';
import {
  executeRealignmentSession,
  type RealignmentExecutionResult,
} from './realignmentPhase/driver.js';

export interface SubmitReinforcementFeedbackOptions {
  contextPackDir: string;
  taskId: string;
  feedbackType: 'none' | 'positive' | 'negative';
  starRating?: number;
  comment?: string;
  repoRoot?: string;
}

export interface ReinforcementFeedbackResult {
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  data?: Record<string, unknown>;
}

/**
 * Submit operator reinforcement feedback for a completed task.
 * Wraps src/backend/scripts/python/submit-reinforcement-feedback.py.
 */
export async function submitReinforcementFeedback(
  options: SubmitReinforcementFeedbackOptions,
): Promise<ReinforcementFeedbackResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const contextPackDir = await requireAuthorizedActiveContextPack({
    repoRoot,
    requestedContextPackDir: options.contextPackDir,
  });
  const scriptPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts', 'python',
    'submit-reinforcement-feedback.py',
  );

  const args = [
    '--repo-root', repoRoot,
    '--context-pack-dir', contextPackDir,
    '--task-id', options.taskId,
    '--feedback-type', options.feedbackType,
  ];

  if (options.starRating !== undefined) {
    args.push('--star-rating', String(options.starRating));
  }
  if (options.comment) {
    args.push('--comment', options.comment);
  }

  try {
    const result = await runPython(scriptPath, args, {
      cwd: repoRoot,
      timeout: 30_000,
    });
    let data: Record<string, unknown> | undefined;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      // stdout was not valid JSON — leave data undefined
    }
    return {
      passed: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      data,
    };
  } catch (err: unknown) {
    if (err instanceof PythonRunError) {
      return {
        passed: false,
        stdout: err.stdout,
        stderr: err.stderr,
        exitCode: err.exitCode,
      };
    }
    throw err;
  }
}

export interface UpdateGlobalRealignmentDocFieldOptions {
  contextPackDir: string;
  field: string;
  value: string;
  repoRoot?: string;
}

export interface UpdateGlobalRealignmentDocStdinOptions {
  contextPackDir: string;
  stdin: string;
  repoRoot?: string;
}

export interface UpdateGlobalRealignmentDocBulkOptions {
  contextPackDir: string;
  updates: Record<string, unknown>;
  repoRoot?: string;
}

export type UpdateGlobalRealignmentDocOptions =
  | UpdateGlobalRealignmentDocFieldOptions
  | UpdateGlobalRealignmentDocStdinOptions
  | UpdateGlobalRealignmentDocBulkOptions;

export interface RealignmentDocResult {
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  data?: Record<string, unknown>;
}

function isStdinMode(
  opts: UpdateGlobalRealignmentDocOptions,
): opts is UpdateGlobalRealignmentDocStdinOptions {
  return 'stdin' in opts;
}

function isBulkMode(
  opts: UpdateGlobalRealignmentDocOptions,
): opts is UpdateGlobalRealignmentDocBulkOptions {
  return 'updates' in opts;
}

/**
 * Update the Global Realignment Document.
 * Wraps src/backend/scripts/python/update-global-realignment-doc.py.
 * Supports field/value mode and bulk stdin mode.
 */
export async function updateGlobalRealignmentDoc(
  options: UpdateGlobalRealignmentDocOptions,
): Promise<RealignmentDocResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const contextPackDir = await requireAuthorizedActiveContextPack({
    repoRoot,
    requestedContextPackDir: options.contextPackDir,
  });
  const scriptPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts', 'python',
    'update-global-realignment-doc.py',
  );

  const args = ['--repo-root', repoRoot, '--context-pack-dir', contextPackDir];
  let stdin: string | undefined;

  if (isStdinMode(options)) {
    args.push('--stdin');
    stdin = options.stdin;
  } else if (isBulkMode(options)) {
    args.push('--stdin');
    stdin = JSON.stringify(options.updates);
  } else {
    const fieldOpts = options as UpdateGlobalRealignmentDocFieldOptions;
    args.push('--field', fieldOpts.field, '--value', fieldOpts.value);
  }

  try {
    const result = await runPython(scriptPath, args, {
      cwd: repoRoot,
      timeout: 30_000,
      stdin,
    });
    let data: Record<string, unknown> | undefined;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      // stdout was not valid JSON — leave data undefined
    }
    return {
      passed: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      data,
    };
  } catch (err: unknown) {
    if (err instanceof PythonRunError) {
      return {
        passed: false,
        stdout: err.stdout,
        stderr: err.stderr,
        exitCode: err.exitCode,
      };
    }
    throw err;
  }
}

export interface ActiveWorkGuardResult {
  allowed: boolean;
  activeTaskId: string | null;
  message: string;
  hasUnprocessedFeedback: boolean;
}

type TimestampedEntry = { created_at?: string };
type EntriesFile = { entries?: TimestampedEntry[] };

async function computeHasUnprocessedFeedback(repoRoot: string): Promise<boolean> {
  const feedbackFile = await readStoreJsonSafe<EntriesFile>(repoRoot, 'feedback-events.json');
  const feedbackEvents = feedbackFile?.entries ?? [];
  if (feedbackEvents.length === 0) return false;

  const sessionsFile = await readStoreJsonSafe<EntriesFile>(
    repoRoot, 'realignment', 'sessions.json',
  );
  const sessions = sessionsFile?.entries ?? [];
  if (sessions.length === 0) return true;

  const lastSessionTime = sessions
    .map((s) => s.created_at ?? '')
    .sort()
    .pop() ?? '';

  return feedbackEvents.some((e) => (e.created_at ?? '') > lastSessionTime);
}

export async function checkActiveWorkGuard(
  options?: { repoRoot?: string; taskId?: string } | string,
): Promise<ActiveWorkGuardResult> {
  // Back-compat: accept bare string repoRoot or options object
  const root = (typeof options === 'string' ? options : options?.repoRoot) ?? findRepoRoot();
  const explicitTaskId = typeof options === 'object' ? options?.taskId : undefined;
  const queuePaths = resolveQueuePaths(root);
  const hasUnprocessedFeedback = await computeHasUnprocessedFeedback(root);

  // Resolve taskId: explicit param → TASKSAIL_TASK_ID env → enumerate activeItemsDir
  const taskId = explicitTaskId ?? process.env['TASKSAIL_TASK_ID'];

  if (taskId) {
    // Per-task check using activeItemsDir
    const markerExists = existsSync(path.join(queuePaths.activeItemsDir, taskId));
    if (!markerExists) {
      return {
        allowed: true,
        activeTaskId: null,
        message: 'No active work. Corrective realignment is allowed.',
        hasUnprocessedFeedback,
      };
    }
    return {
      allowed: false,
      activeTaskId: taskId,
      message: `Corrective realignment is blocked while pending item "${taskId}" is active. Complete or remove the active item before starting realignment.`,
      hasUnprocessedFeedback,
    };
  }

  // No taskId — enumerate activeItemsDir for any active task
  let activeEntries: string[] = [];
  try {
    const { readdirSync } = await import('node:fs');
    activeEntries = readdirSync(queuePaths.activeItemsDir).filter(
      (f) => !f.endsWith('.completing'),
    );
  } catch { /* directory absent */ }

  if (activeEntries.length === 0) {
    return {
      allowed: true,
      activeTaskId: null,
      message: 'No active work. Corrective realignment is allowed.',
      hasUnprocessedFeedback,
    };
  }

  const activeTaskId = activeEntries[0]!.replace(/\.md$/, '');
  return {
    allowed: false,
    activeTaskId,
    message: `Corrective realignment is blocked while pending item "${activeTaskId}" is active. Complete or remove the active item before starting realignment.`,
    hasUnprocessedFeedback,
  };
}

export interface StartRealignmentOptions {
  contextPackDir: string;
  triggerTaskId: string;
  repoRoot?: string;
}

export interface StartRealignmentResult {
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  data?: Record<string, unknown>;
}

/**
 * Start a UI-triggered corrective realignment session.
 * The Python script enforces the active-work guardrail internally.
 */
export async function startRealignmentSession(
  options: StartRealignmentOptions,
): Promise<StartRealignmentResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const contextPackDir = await requireAuthorizedActiveContextPack({
    repoRoot,
    requestedContextPackDir: options.contextPackDir,
  });
  const scriptPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts', 'python',
    'start-realignment-session.py',
  );

  const args = [
    '--repo-root', repoRoot,
    '--context-pack-dir', contextPackDir,
    '--trigger-task-id', options.triggerTaskId,
  ];

  try {
    const result = await runPython(scriptPath, args, {
      cwd: repoRoot,
      timeout: 30_000,
    });
    let data: Record<string, unknown> | undefined;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      // stdout was not valid JSON — leave data undefined
    }
    return {
      passed: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      data,
    };
  } catch (err: unknown) {
    if (err instanceof PythonRunError) {
      return {
        passed: false,
        stdout: err.stdout,
        stderr: err.stderr,
        exitCode: err.exitCode,
      };
    }
    throw err;
  }
}

export async function runRealignmentAnalysis(options: {
  contextPackDir: string;
  realignmentId: string;
  repoRoot?: string;
  abortSignal?: AbortSignal;
  externalMcpRegistry?: ExternalMcpRegistry;
}): Promise<RealignmentExecutionResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const contextPackDir = await requireAuthorizedActiveContextPack({
    repoRoot,
    requestedContextPackDir: options.contextPackDir,
  });
  const externalMcpRegistry = options.externalMcpRegistry
    ?? await prewarmExternalMcpRegistry(repoRoot);
  // Warm the assignment cache so buildRealignmentPrompt can pair the registry
  // with assignments for the 'ron' realignment prompt (prompt/launch parity).
  await prewarmExternalMcpAssignments(repoRoot);

  return executeRealignmentSession({
    repoRoot,
    contextPackDir,
    realignmentId: options.realignmentId,
    abortSignal: options.abortSignal,
    externalMcpRegistry,
  });
}

export interface DismissRealignmentOptions {
  contextPackDir: string;
  realignmentId: string;
  repoRoot?: string;
}

export interface DismissRealignmentResult {
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  data?: Record<string, unknown>;
}

export async function dismissRealignmentSession(
  options: DismissRealignmentOptions,
): Promise<DismissRealignmentResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const contextPackDir = await requireAuthorizedActiveContextPack({
    repoRoot,
    requestedContextPackDir: options.contextPackDir,
  });
  const receipt = await readJsonSafe<{ status?: string }>(path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'realignment',
    options.realignmentId,
    'job.json',
  ));
  if (receipt?.status === 'running') {
    return {
      passed: false,
      stdout: '',
      stderr: JSON.stringify({
        error: 'realignment_in_progress',
        message: 'This realignment is currently in progress and cannot be dismissed.',
      }),
      exitCode: 1,
    };
  }
  const scriptPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts', 'python',
    'dismiss-realignment-session.py',
  );

  try {
    const result = await runPython(scriptPath, [
      '--repo-root', repoRoot,
      '--context-pack-dir', contextPackDir,
      '--realignment-id', options.realignmentId,
    ], {
      cwd: repoRoot,
      timeout: 30_000,
    });
    let data: Record<string, unknown> | undefined;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      // stdout was not valid JSON — leave data undefined
    }
    return {
      passed: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      data,
    };
  } catch (err: unknown) {
    if (err instanceof PythonRunError) {
      return {
        passed: false,
        stdout: err.stdout,
        stderr: err.stderr,
        exitCode: err.exitCode,
      };
    }
    throw err;
  }
}
