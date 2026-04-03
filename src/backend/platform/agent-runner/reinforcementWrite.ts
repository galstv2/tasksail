import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { runPython, findRepoRoot, PythonRunError } from '../core/index.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/index.js';
import { resolveQueuePaths } from '../queue/index.js';

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
}

/**
 * Check whether UI-triggered corrective realignment is allowed.
 * Blocked when an active pending item is claimed in the queue.
 */
const ALLOWED_RESULT: ActiveWorkGuardResult = {
  allowed: true,
  activeTaskId: null,
  message: 'No active work. Corrective realignment is allowed.',
};

export async function checkActiveWorkGuard(
  repoRoot?: string,
): Promise<ActiveWorkGuardResult> {
  const root = repoRoot ?? findRepoRoot();
  const { activeItemLink, pendingDir } = resolveQueuePaths(root);

  let name: string;
  try {
    name = (await readFile(activeItemLink, 'utf-8')).trim();
  } catch {
    // ENOENT or other read failure — no active item
    return ALLOWED_RESULT;
  }

  if (!name) {
    return ALLOWED_RESULT;
  }
  try {
    await access(path.join(pendingDir, name));
  } catch {
    return ALLOWED_RESULT;
  }

  const activeTaskId = name.replace(/\.md$/, '');
  return {
    allowed: false,
    activeTaskId,
    message: `Corrective realignment is blocked while pending item "${activeTaskId}" is active. Complete or remove the active item before starting realignment.`,
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
