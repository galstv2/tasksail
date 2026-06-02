import path from 'node:path';
import {
  runPython,
  findRepoRoot,
  PythonRunError,
  readTextFile,
  writeTextFileAtomic,
} from '../core/index.js';
import { assertPolicyPasses } from './policyValidation.js';
import { normalizeRetrospectiveListSectionsMarkdown } from '../workflow-policy/rules/retrospectiveHelpers.js';
import { getActiveProvider } from '../cli-provider/index.js';

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

async function normalizeRetrospectiveContributionsForArchive(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  const retrospectivePath = path.join(
    repoRoot,
    'AgentWorkSpace',
    'tasks',
    taskId,
    'handoffs',
    'retrospective-input.md',
  );
  const current = await readTextFile(retrospectivePath);
  if (current === undefined) {
    return;
  }
  const normalized = normalizeRetrospectiveListSectionsMarkdown(current);
  if (normalized !== current) {
    await writeTextFileAtomic(retrospectivePath, normalized);
  }
}

function buildArchiveProviderEnv(repoRoot: string): Record<string, string> {
  const provider = getActiveProvider(repoRoot);
  return {
    TASKSAIL_CLI_HOME_DIR_NAME: provider.homeDirName(),
    TASKSAIL_AGENT_REGISTRY_PATH: path.join(repoRoot, provider.agentConfigPaths().registry),
  };
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
  await normalizeRetrospectiveContributionsForArchive(repoRoot, options.taskId);
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
      env: {
        ...buildArchiveProviderEnv(repoRoot),
        TASKSAIL_TASK_ID: options.taskId,
      },
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
