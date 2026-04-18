/**
 * §3.2 Per-task .task.json sidecar reader.
 *
 * This is the SOLE module authorized to do inline readFileSync + JSON.parse
 * against the .task.json path. All other modules MUST import readTaskJson or
 * readTaskJsonSafe from here.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../core/index.js';

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export interface TaskRepoBinding {
  originalRoot: string;
  worktreeRoot: string;
  worktreeBranch: string;
  baseCommitSha: string;
}

export interface TaskContextPackBinding {
  contextPackPath: string | null;
  dataHostDir: string | null;
  dataContainerDir: string | null;
  repoBindings: TaskRepoBinding[];
}

export interface TaskMaterialization {
  strategy: 'copy' | 'apfs-clonefile' | 'reflink';
  cloned: string[];
  skipped: string[];
  composeProjectName: string;
}

export interface TaskJson {
  schema_version: number;
  taskId: string;
  contextPackBinding: TaskContextPackBinding;
  materialization: TaskMaterialization;
  frozenAt: string;
  finalizedAt: string | null;
  state: 'active' | 'completed' | 'failed';
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export interface TaskSidecarErrorBase {
  code: 'task-sidecar-missing' | 'task-sidecar-corrupt' | 'task-sidecar-stale-schema';
  taskId: string;
  sidecarPath: string;
}

export interface TaskSidecarMissingError extends TaskSidecarErrorBase {
  code: 'task-sidecar-missing';
}

export interface TaskSidecarCorruptError extends TaskSidecarErrorBase {
  code: 'task-sidecar-corrupt';
  parseError?: string;
}

export interface TaskSidecarStaleSchemaError extends TaskSidecarErrorBase {
  code: 'task-sidecar-stale-schema';
  foundVersion: number;
  expectedVersion: number;
}

export type TaskSidecarError =
  | TaskSidecarMissingError
  | TaskSidecarCorruptError
  | TaskSidecarStaleSchemaError;

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const MINIMUM_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical path to a task's .task.json sidecar.
 */
export function resolveTaskJsonPath(taskId: string, repoRoot?: string): string {
  const root = repoRoot ?? findRepoRoot();
  return path.join(root, 'AgentWorkSpace', 'tasks', taskId, '.task.json');
}

// ---------------------------------------------------------------------------
// Error factory helpers
// ---------------------------------------------------------------------------

class TaskSidecarErrorImpl extends Error {
  readonly payload: TaskSidecarError;
  constructor(payload: TaskSidecarError) {
    super(`[${payload.code}] taskId=${payload.taskId} path=${payload.sidecarPath}`);
    this.name = 'TaskSidecarError';
    this.payload = payload;
  }
}

function throwMissing(taskId: string, sidecarPath: string): never {
  const payload: TaskSidecarMissingError = { code: 'task-sidecar-missing', taskId, sidecarPath };
  throw new TaskSidecarErrorImpl(payload);
}

function throwCorrupt(taskId: string, sidecarPath: string, parseError?: string): never {
  const payload: TaskSidecarCorruptError = { code: 'task-sidecar-corrupt', taskId, sidecarPath, parseError };
  throw new TaskSidecarErrorImpl(payload);
}

function throwStaleSchema(taskId: string, sidecarPath: string, foundVersion: number): never {
  const payload: TaskSidecarStaleSchemaError = {
    code: 'task-sidecar-stale-schema',
    taskId,
    sidecarPath,
    foundVersion,
    expectedVersion: MINIMUM_SCHEMA_VERSION,
  };
  throw new TaskSidecarErrorImpl(payload);
}

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

function isValidContextPackBinding(value: unknown): value is TaskContextPackBinding {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!('contextPackPath' in v)) return false;
  if (!('dataHostDir' in v)) return false;
  if (!('dataContainerDir' in v)) return false;
  if (!Array.isArray(v['repoBindings'])) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Core reader
// ---------------------------------------------------------------------------

function strictTaskJsonReader(taskId: string, repoRoot?: string): TaskJson {
  const sidecarPath = resolveTaskJsonPath(taskId, repoRoot);

  if (!existsSync(sidecarPath)) {
    throwMissing(taskId, sidecarPath);
  }

  let raw: string;
  try {
    raw = readFileSync(sidecarPath, 'utf-8');
  } catch (err) {
    throwCorrupt(taskId, sidecarPath, err instanceof Error ? err.message : String(err));
  }

  // JSON.parse can throw; catch and re-throw as TaskSidecarCorruptError.
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throwCorrupt(taskId, sidecarPath, err instanceof Error ? err.message : String(err));
  }

  // F33: absent/null schema_version defaults to 1 (do NOT throw for absence).
  if (json['schema_version'] === undefined || json['schema_version'] === null) {
    json['schema_version'] = 1;
  }

  // Stale-schema check: only fires when schema_version is present AND < minimum.
  if (typeof json['schema_version'] === 'number' && json['schema_version'] < MINIMUM_SCHEMA_VERSION) {
    throwStaleSchema(taskId, sidecarPath, json['schema_version']);
  }

  // Shape check: contextPackBinding must be present and valid.
  if (!isValidContextPackBinding(json['contextPackBinding'])) {
    throwCorrupt(
      taskId,
      sidecarPath,
      'contextPackBinding field is absent or has wrong shape',
    );
  }

  return json as unknown as TaskJson;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read and validate the .task.json sidecar for a task.
 * Strict: throws TaskSidecarError (via TaskSidecarErrorImpl) on any error.
 * Use this on all task-launch paths.
 */
export function readTaskJson(taskId: string, repoRoot?: string): TaskJson {
  return strictTaskJsonReader(taskId, repoRoot);
}

/**
 * Read the .task.json sidecar for a task without throwing.
 * Returns null on missing, corrupt, or stale-schema errors.
 * Only for callers that iterate multiple tasks and need to skip bad entries
 * (§4.15 retention scan, §5.2 recovery-path enumeration).
 */
export function readTaskJsonSafe(taskId: string, repoRoot?: string): TaskJson | null {
  try {
    return strictTaskJsonReader(taskId, repoRoot);
  } catch {
    return null;
  }
}

/**
 * Determine whether a thrown error is a TaskSidecarError.
 * Allows callers to inspect the structured payload.
 */
export function isTaskSidecarError(err: unknown): err is TaskSidecarErrorImpl {
  return err instanceof TaskSidecarErrorImpl;
}
