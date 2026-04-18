import path from 'node:path';
import { findRepoRoot, readEnvAssignment, resolvePath } from '../core/index.js';
import { ACTIVE_CONTEXT_PACK_DIR_KEY, validatePackStructure } from './activate.js';
import { readTaskJson, type TaskContextPackBinding } from '../queue/taskJson.js';

export interface RequireAuthorizedActiveContextPackOptions {
  repoRoot?: string;
  requestedContextPackDir?: string;
  taskId?: string;
}

/**
 * Resolved binding returned when a task sidecar is active.
 * Mirrors the contextPackBinding shape from .task.json.
 */
export type TaskContextPackBindingFromSidecar = TaskContextPackBinding;

/**
 * Require the authorized active context pack and return the full
 * TaskContextPackBinding. When taskId (or TASKSAIL_TASK_ID) is set, reads the
 * .task.json sidecar. When neither is set, falls back to the singleton
 * .platform-state/queue/active-context-pack.json / .env path.
 *
 * Throws TaskSidecarError (from taskJson.ts) on sidecar errors.
 * Throws Error on singleton misconfiguration.
 */
export async function requireAuthorizedActiveContextPackBinding(
  options: RequireAuthorizedActiveContextPackOptions = {},
): Promise<TaskContextPackBindingFromSidecar> {
  const repoRoot = options.repoRoot ?? findRepoRoot();

  // Resolve taskId: explicit option wins over env.
  const taskId = options.taskId ?? process.env['TASKSAIL_TASK_ID'];

  if (taskId) {
    // Task-launch path: read the sidecar, fail-closed (no fallback to singleton).
    // readTaskJson throws TaskSidecarError on missing/corrupt/stale-schema.
    const taskJson = readTaskJson(taskId, repoRoot);
    return taskJson.contextPackBinding;
  }

  // Legacy singleton path: read .env / process.env (no sidecar).
  const envPath = path.join(repoRoot, '.env');
  const fileValue = (await readEnvAssignment(
    envPath,
    ACTIVE_CONTEXT_PACK_DIR_KEY,
  ))?.trim();

  const processValue = process.env[ACTIVE_CONTEXT_PACK_DIR_KEY]?.trim();

  // .env is the persistent source of truth; process.env is the runtime fallback.
  const configuredContextPackDir = fileValue || processValue;

  if (!configuredContextPackDir) {
    throw new Error(
      'No active context pack is configured in repo .env or process environment. ' +
      'Activate a context pack before running write operations.',
    );
  }

  const authorizedContextPackDir = resolvePath(repoRoot, configuredContextPackDir);
  const validation = validatePackStructure(authorizedContextPackDir);
  if (!validation.valid) {
    throw new Error(
      `Active context pack validation failed: ${validation.errors.join('; ')}`,
    );
  }

  // When both sources are set, they must agree.
  if (
    fileValue && processValue &&
    resolvePath(repoRoot, fileValue) !== resolvePath(repoRoot, processValue)
  ) {
    throw new Error(
      'ACTIVE_CONTEXT_PACK_DIR does not match the repo .env active context pack. ' +
      'Refusing write operation.',
    );
  }

  if (
    options.requestedContextPackDir &&
    resolvePath(repoRoot, options.requestedContextPackDir) !== authorizedContextPackDir
  ) {
    throw new Error(
      'Write operations are limited to the active context pack configured in repo .env.',
    );
  }

  // Return a binding shape consistent with the sidecar schema.
  // contextPackPath is the sentinel pack JSON inside the dir (not the dir itself).
  // For singleton, contextPackPath is null (dir-only resolution).
  return {
    contextPackPath: null,
    dataHostDir: null,
    dataContainerDir: null,
    repoBindings: [],
  };
}

/**
 * Require the authorized active context pack and return the directory path.
 * This is the string-returning facade used by all existing call sites.
 *
 * When taskId (or TASKSAIL_TASK_ID) is set, reads the .task.json sidecar and
 * returns path.dirname(contextPackPath) when contextPackPath is non-null.
 * Falls back to the singleton .env resolution when no task is active.
 */
export async function requireAuthorizedActiveContextPack(
  options: RequireAuthorizedActiveContextPackOptions = {},
): Promise<string> {
  const repoRoot = options.repoRoot ?? findRepoRoot();

  // Resolve taskId: explicit option wins over env.
  const taskId = options.taskId ?? process.env['TASKSAIL_TASK_ID'];

  if (taskId) {
    // Task-launch path: read the sidecar, fail-closed.
    const binding = await requireAuthorizedActiveContextPackBinding({ ...options, taskId });
    if (binding.contextPackPath) {
      return path.dirname(binding.contextPackPath);
    }
    // contextPackPath is null (e.g., L0 fixture without a real context pack).
    // Return empty string to signal "no context pack configured" without silently
    // falling through to the singleton, which would break task isolation.
    throw new Error(
      `Task sidecar for task "${taskId}" has a null contextPackPath. ` +
      'No context pack is bound to this task.',
    );
  }

  // Legacy singleton path: delegate to the full binding helper then extract dir.
  const envPath = path.join(repoRoot, '.env');
  const fileValue = (await readEnvAssignment(
    envPath,
    ACTIVE_CONTEXT_PACK_DIR_KEY,
  ))?.trim();

  const processValue = process.env[ACTIVE_CONTEXT_PACK_DIR_KEY]?.trim();

  const configuredContextPackDir = fileValue || processValue;

  if (!configuredContextPackDir) {
    throw new Error(
      'No active context pack is configured in repo .env or process environment. ' +
      'Activate a context pack before running write operations.',
    );
  }

  const authorizedContextPackDir = resolvePath(repoRoot, configuredContextPackDir);
  const validation = validatePackStructure(authorizedContextPackDir);
  if (!validation.valid) {
    throw new Error(
      `Active context pack validation failed: ${validation.errors.join('; ')}`,
    );
  }

  if (
    fileValue && processValue &&
    resolvePath(repoRoot, fileValue) !== resolvePath(repoRoot, processValue)
  ) {
    throw new Error(
      'ACTIVE_CONTEXT_PACK_DIR does not match the repo .env active context pack. ' +
      'Refusing write operation.',
    );
  }

  if (
    options.requestedContextPackDir &&
    resolvePath(repoRoot, options.requestedContextPackDir) !== authorizedContextPackDir
  ) {
    throw new Error(
      'Write operations are limited to the active context pack configured in repo .env.',
    );
  }

  return authorizedContextPackDir;
}
