import path from 'node:path';
import { findRepoRoot, readEnvAssignment, resolvePath, readTextFile, safeJsonParse } from '../core/index.js';
import { ACTIVE_CONTEXT_PACK_DIR_KEY, validatePackStructure } from './activate.js';
import { readTaskJson, type TaskContextPackBinding } from '../queue/taskJson.js';

export interface RequireAuthorizedActiveContextPackOptions {
  repoRoot?: string;
  requestedContextPackDir?: string;
  taskId?: string;
}

type ActiveContextPackResolution = {
  configuredContextPackDir: string | undefined;
  fileValue: string | undefined;
  processValue: string | undefined;
};

/**
 * Resolved binding returned when a task sidecar is active.
 * Mirrors the contextPackBinding shape from .task.json.
 */
export type TaskContextPackBindingFromSidecar = TaskContextPackBinding;

async function readWorkspaceSyncActiveContextPackDir(repoRoot: string): Promise<string | undefined> {
  const statePath = path.join(repoRoot, '.platform-state', 'workspace-context-sync.json');
  const raw = await readTextFile(statePath);
  if (raw === undefined) {
    return undefined;
  }
  // safeJsonParse surfaces corruption (vs. the prior bare JSON.parse + swallow,
  // which masked a corrupt workspace-context-sync.json as "no active pack").
  const parsed = safeJsonParse<Record<string, unknown>>(raw, statePath);
  const rawDir = typeof parsed.active_context_pack_dir === 'string'
    ? parsed.active_context_pack_dir.trim()
    : '';
  return rawDir || undefined;
}

async function resolveConfiguredActiveContextPackDir(
  repoRoot: string,
): Promise<ActiveContextPackResolution> {
  const envPath = path.join(repoRoot, '.env');
  const fileValue = (await readEnvAssignment(
    envPath,
    ACTIVE_CONTEXT_PACK_DIR_KEY,
  ))?.trim() || undefined;
  const processValue = process.env[ACTIVE_CONTEXT_PACK_DIR_KEY]?.trim() || undefined;
  const workspaceSyncValue = await readWorkspaceSyncActiveContextPackDir(repoRoot);

  return {
    configuredContextPackDir: fileValue || processValue || workspaceSyncValue,
    fileValue,
    processValue,
  };
}

/**
 * Require the authorized active context pack and return the full
 * TaskContextPackBinding. When taskId (or TASKSAIL_TASK_ID) is set, reads the
 * .task.json sidecar. When neither is set, falls back to the .env path.
 *
 * Throws TaskSidecarError (from taskJson.ts) on sidecar errors.
 * Throws Error on .env misconfiguration.
 */
export async function requireAuthorizedActiveContextPackBinding(
  options: RequireAuthorizedActiveContextPackOptions = {},
): Promise<TaskContextPackBindingFromSidecar> {
  const repoRoot = options.repoRoot ?? findRepoRoot();

  // Resolve taskId: explicit option wins over env.
  const taskId = options.taskId ?? process.env['TASKSAIL_TASK_ID'];

  if (taskId) {
    // Task-launch path: read the sidecar, fail-closed.
    // readTaskJson throws TaskSidecarError on missing/corrupt/stale-schema.
    const taskJson = readTaskJson(taskId, repoRoot);
    return taskJson.contextPackBinding;
  }

  // Non-task path: read .env / process.env, falling back to desktop workspace
  // sync state when the env singleton is empty.
  const { configuredContextPackDir, fileValue, processValue } =
    await resolveConfiguredActiveContextPackDir(repoRoot);

  if (!configuredContextPackDir) {
    throw new Error(
      'No active context pack is configured in repo .env, process environment, or workspace state. ' +
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
      'Write operations are limited to the active context pack.',
    );
  }

  // Return a binding shape consistent with the sidecar schema.
  // contextPackPath is the sentinel pack JSON inside the dir (not the dir itself).
  // For .env resolution, contextPackPath is null (dir-only resolution).
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
 * Falls back to .env resolution when no task is active.
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
    // falling through to .env, which would break task isolation.
    throw new Error(
      `Task sidecar for task "${taskId}" has a null contextPackPath. ` +
      'No context pack is bound to this task.',
    );
  }

  // Non-task path: delegate to singleton/workspace-state resolution.
  const { configuredContextPackDir, fileValue, processValue } =
    await resolveConfiguredActiveContextPackDir(repoRoot);

  if (!configuredContextPackDir) {
    throw new Error(
      'No active context pack is configured in repo .env, process environment, or workspace state. ' +
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
      'Write operations are limited to the active context pack.',
    );
  }

  return authorizedContextPackDir;
}
