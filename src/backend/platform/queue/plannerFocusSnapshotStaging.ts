/**
 * Planner-focus-snapshot staging primitives.
 *
 * The planner writes a snapshot of its focus state at session-finalize time
 * so child tasks can replay their parent's context. Historically the snapshot
 * was a sibling JSON next to the dropbox/pendingitems markdown. That leaked
 * platform-internal state into operator-facing queue dirs and required the
 * file to follow the markdown across renames.
 *
 * The staged snapshot now lives under
 * `.platform-state/runtime/tasks/<taskId>/planner-focus-snapshot.json`,
 * wrapped in an envelope whose `bindingKey` echoes the taskId. Activation
 * reads the envelope, verifies the bindingKey, writes the unwrapped snapshot
 * into the active task dir (where the python closeout writer already reads
 * from), and unlinks the staging file.
 *
 * On dropbox → pendingitems queue advance, `queueNameForSource` rewrites the
 * timestamp prefix on the markdown filename, so the taskId changes. To
 * preserve 100%-correct binding via the per-task subdirectory, we move the
 * staging file too and rewrite the envelope's `bindingKey` to the new taskId.
 */
import path from 'node:path';
import { readFile, rmdir, unlink } from 'node:fs/promises';

import { createLogger, ensureDir, writeTextFileAtomic } from '../core/index.js';

const log = createLogger('platform/queue/plannerFocusSnapshotStaging');

export const PLANNER_FOCUS_SNAPSHOT_ENVELOPE_SCHEMA_VERSION = 1;

export interface PlannerFocusSnapshotEnvelope {
  schemaVersion: typeof PLANNER_FOCUS_SNAPSHOT_ENVELOPE_SCHEMA_VERSION;
  bindingKey: string;
  stagedAt: string;
  markdownDestination: string;
  /**
   * The unwrapped planner-focus-snapshot payload (frontend-typed
   * `PlannerFocusSnapshot`). Treated opaquely by backend — strict shape
   * validation happens at the frontend writer's point of construction and
   * again at the python closeout reader.
   */
  snapshot: unknown;
}

export function plannerFocusSnapshotStagingPath(repoRoot: string, taskId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'tasks',
    taskId,
    'planner-focus-snapshot.json',
  );
}

function activePlannerFocusSnapshotPath(repoRoot: string, taskId: string): string {
  return path.join(
    repoRoot,
    'AgentWorkSpace',
    'tasks',
    taskId,
    '.planner-focus-snapshot.json',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate the on-disk envelope. Returns an array of error messages; empty
 * array means valid. Caller may pass `expectedBindingKey` to enforce content
 * binding to a specific taskId.
 */
export function validatePlannerFocusSnapshotEnvelope(
  value: unknown,
  options?: { expectedBindingKey?: string },
): string[] {
  if (!isRecord(value)) {
    return ['envelope must be an object.'];
  }
  const errors: string[] = [];
  if (value['schemaVersion'] !== PLANNER_FOCUS_SNAPSHOT_ENVELOPE_SCHEMA_VERSION) {
    errors.push(
      `envelope.schemaVersion must be ${PLANNER_FOCUS_SNAPSHOT_ENVELOPE_SCHEMA_VERSION}.`,
    );
  }
  if (!isNonEmptyString(value['bindingKey'])) {
    errors.push('envelope.bindingKey must be a non-empty string.');
  } else if (
    options?.expectedBindingKey !== undefined &&
    value['bindingKey'] !== options.expectedBindingKey
  ) {
    errors.push(
      `envelope.bindingKey "${value['bindingKey']}" does not match expected "${options.expectedBindingKey}".`,
    );
  }
  if (!isNonEmptyString(value['stagedAt'])) {
    errors.push('envelope.stagedAt must be a non-empty string.');
  }
  if (!isNonEmptyString(value['markdownDestination'])) {
    errors.push('envelope.markdownDestination must be a non-empty string.');
  }
  if (!isRecord(value['snapshot'])) {
    errors.push('envelope.snapshot must be an object.');
  }
  return errors;
}

/**
 * Stage 1: write a planner-focus-snapshot envelope at staging time. Creates
 * `.platform-state/runtime/tasks/<taskId>/` if needed and writes the envelope
 * atomically.
 */
export async function writeStagedPlannerFocusSnapshot(options: {
  repoRoot: string;
  taskId: string;
  markdownDestination: string;
  snapshot: unknown;
  /** Override timestamp for deterministic tests. */
  now?: () => Date;
}): Promise<void> {
  const { repoRoot, taskId, markdownDestination, snapshot } = options;
  const envelope: PlannerFocusSnapshotEnvelope = {
    schemaVersion: PLANNER_FOCUS_SNAPSHOT_ENVELOPE_SCHEMA_VERSION,
    bindingKey: taskId,
    stagedAt: (options.now ?? (() => new Date()))().toISOString(),
    markdownDestination,
    snapshot,
  };
  const target = plannerFocusSnapshotStagingPath(repoRoot, taskId);
  await ensureDir(path.dirname(target));
  await writeTextFileAtomic(target, JSON.stringify(envelope, null, 2) + '\n');
}

/**
 * Stage 2: dropbox → pendingitems queue advance renames the markdown to a
 * new timestamped basename. Move the staged snapshot to the new per-task dir
 * and rewrite the envelope's `bindingKey` and `markdownDestination`. ENOENT
 * is silent (non-Lily tasks have no staging entry).
 */
export async function moveStagedPlannerFocusSnapshot(options: {
  repoRoot: string;
  oldTaskId: string;
  newTaskId: string;
  newMarkdownDestination: string;
}): Promise<void> {
  const { repoRoot, oldTaskId, newTaskId, newMarkdownDestination } = options;
  if (oldTaskId === newTaskId) {
    return;
  }
  const oldPath = plannerFocusSnapshotStagingPath(repoRoot, oldTaskId);
  let raw: string;
  try {
    raw = await readFile(oldPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    log.warn('planner_focus_snapshot.move.skipped', { taskId: oldTaskId, reason: 'read-failed' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn('planner_focus_snapshot.move.skipped', { taskId: oldTaskId, reason: 'parse-failed', error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const errors = validatePlannerFocusSnapshotEnvelope(parsed, { expectedBindingKey: oldTaskId });
  if (errors.length > 0) {
    log.warn('planner_focus_snapshot.move.skipped', { taskId: oldTaskId, reason: 'invalid-envelope', errors });
    return;
  }
  const envelope = parsed as PlannerFocusSnapshotEnvelope;
  envelope.bindingKey = newTaskId;
  envelope.markdownDestination = newMarkdownDestination;

  const newPath = plannerFocusSnapshotStagingPath(repoRoot, newTaskId);
  await ensureDir(path.dirname(newPath));
  await writeTextFileAtomic(newPath, JSON.stringify(envelope, null, 2) + '\n');
  try { await unlink(oldPath); } catch { /* best-effort */ }
  // The old per-task runtime dir was created by stage 1 just for this snapshot
  // and never accumulated other receipts (stage 1 fires before any pipeline
  // work for the task). rmdir is a no-op if the dir is non-empty for any
  // reason.
  try { await rmdir(path.dirname(oldPath)); } catch { /* best-effort */ }
}

/**
 * Stage 3: at task activation, read the staged envelope, verify
 * `bindingKey === taskId`, atomically write the unwrapped `snapshot` payload
 * into the active task dir (where stage 4 reads from), and unlink the
 * staging file.
 *
 * No-ops silently if the staging file is absent (CLI-created tasks, recovered
 * from erroritems, etc). On envelope corruption / bindingKey mismatch, leaves
 * the staging file in place for operator inspection.
 */
export async function transferStagedSnapshotToActiveTask(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  const stagingPath = plannerFocusSnapshotStagingPath(repoRoot, taskId);
  let raw: string;
  try {
    raw = await readFile(stagingPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    log.warn('planner_focus_snapshot.transfer.skipped', { taskId, reason: 'read-failed' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn('planner_focus_snapshot.transfer.skipped', { taskId, reason: 'parse-failed', error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const errors = validatePlannerFocusSnapshotEnvelope(parsed, { expectedBindingKey: taskId });
  if (errors.length > 0) {
    log.warn('planner_focus_snapshot.transfer.skipped', { taskId, reason: 'invalid-envelope', errors });
    return;
  }
  const envelope = parsed as PlannerFocusSnapshotEnvelope;
  const activePath = activePlannerFocusSnapshotPath(repoRoot, taskId);
  await ensureDir(path.dirname(activePath));
  await writeTextFileAtomic(activePath, JSON.stringify(envelope.snapshot, null, 2) + '\n');
  try { await unlink(stagingPath); } catch { /* best-effort */ }
}

/**
 * Failure-path cleanup: remove the staged snapshot for `taskId`. ENOENT-safe.
 */
export async function cleanupStagedPlannerFocusSnapshot(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  const stagingPath = plannerFocusSnapshotStagingPath(repoRoot, taskId);
  try {
    await unlink(stagingPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('planner_focus_snapshot.cleanup.skipped', { taskId, reason: 'cleanup-failed' });
    }
  }
}

/**
 * Cleanup the active-dir copy after stage 3 has written it (used by activation
 * rollback). ENOENT-safe.
 */
export async function cleanupActivePlannerFocusSnapshot(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  const activePath = activePlannerFocusSnapshotPath(repoRoot, taskId);
  try {
    await unlink(activePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('planner_focus_snapshot.active_cleanup.skipped', { taskId, reason: 'cleanup-failed' });
    }
  }
}
