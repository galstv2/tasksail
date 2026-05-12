import path from 'node:path';
import { runPython, findRepoRoot, PythonRunError } from '../core/index.js';
import { assertPolicyPasses } from './policyValidation.js';

export interface FileTaskArchiveOptions {
  contextPackDir: string;
  taskId: string; // REQUIRED — archive operates on a completed task
  repoRoot?: string;
  qmdScope?: string;
  resume?: boolean;
}

export interface FileTaskArchiveResult {
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  data?: Record<string, unknown>;
}

/**
 * File the current task closeout into a QMD task archive.
 * Wraps src/backend/scripts/python/file-task-archive.py.
 * Returns a result without throwing on failure — the caller
 * decides how to handle errors.
 */
export async function fileTaskArchive(
  options: FileTaskArchiveOptions,
): Promise<FileTaskArchiveResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  await assertPolicyPasses({
    mode: 'pre-archive',
    repoRoot,
    taskId: options.taskId,
    errorMessage: 'Archive filing blocked by workflow policy validation.',
  });
  const scriptPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts', 'python',
    'file-task-archive.py',
  );

  const args = [
    '--context-pack-dir', options.contextPackDir,
    '--repo-root', repoRoot,
    '--format', 'json',
  ];

  if (options.qmdScope) {
    args.push('--qmd-scope', options.qmdScope);
  }
  if (options.resume) {
    args.push('--resume');
  }

  try {
    const result = await runPython(scriptPath, args, {
      cwd: repoRoot,
      timeout: 60_000,
      env: { TASKSAIL_TASK_ID: options.taskId },
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
