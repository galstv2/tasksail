import path from 'node:path';
import { mkdir, rm, rmdir, stat } from 'node:fs/promises';
import { createLogger, readTextFile, safeJsonParse, writeTextFileAtomic, sleep } from '../core/index.js';
import { setLabelValue } from './artifacts.js';
import { acquireDirLock } from './dirLock.js';

const log = createLogger('platform/queue/retrospectiveFlag');

const TASK_COUNTER_DIR_RELATIVE = '.platform-state/task-counters';
const RETROSPECTIVE_RUN_LOCK_DIR_RELATIVE = '.platform-state/retrospective-runs';
const DEFAULT_CONTEXT_PACK_ID = 'platform-core';
export const RETROSPECTIVE_CYCLE_LENGTH = 10;
export const RETROSPECTIVE_REQUIRED_LABEL = 'Retrospective Required';
const SCHEMA_VERSION = 'task-counter/v1';
const COUNTER_LOCK_STALE_MS = 5 * 60 * 1000;

interface RetrospectiveRunClaim {
  contextPackId: string;
  lockDir: string;
  release: () => Promise<void>;
}

export type RetrospectiveRunClaimResult =
  | { claimed: true; claim: RetrospectiveRunClaim }
  | {
      claimed: false;
      contextPackId: string;
      lockDir: string;
      reason: 'already-running' | 'counter-not-required';
    };

interface CounterLockDiagnostics {
  lockDir: string;
  attempts: number;
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  estimatedWaitMs: number;
  staleAfterMs: number;
  lockExists: boolean;
  lockAgeMs?: number;
  lockMtime?: string;
}

type CounterLockAcquireResult =
  | { release: () => Promise<void>; diagnostics: CounterLockDiagnostics }
  | { release: null; diagnostics: CounterLockDiagnostics };

function contextPackIdFromDir(contextPackDir?: string): string {
  const trimmed = contextPackDir?.trim();
  if (!trimmed) {
    return DEFAULT_CONTEXT_PACK_ID;
  }
  return path.basename(trimmed);
}

export function isRetrospectiveRequiredForCompletedCount(completedCount: number): boolean {
  return (completedCount + 1) % RETROSPECTIVE_CYCLE_LENGTH === 0;
}

// ── Per-context-pack file lock (precedence 4 — acquire AFTER queue lock) ──

/**
 * Acquire a directory-based lock keyed on contextPackId.
 * The lock dir lives alongside the counter file:
 *   .platform-state/task-counters/<contextPackId>.lock
 * Returns a release function on success, or null when the lock
 * could not be acquired within the retry budget.
 */
async function acquireCounterLock(
  counterDir: string,
  contextPackId: string,
  maxRetries = 50,
  backoffMs = 20,
): Promise<CounterLockAcquireResult> {
  const lockDir = path.join(counterDir, `${contextPackId}.lock`);
  let waitMs = backoffMs;
  let estimatedWaitMs = 0;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await mkdir(lockDir, { recursive: false });
      return {
        release: async () => {
          try {
            await rmdir(lockDir);
          } catch {
            // Already removed — safe to ignore
          }
        },
        diagnostics: {
          lockDir,
          attempts: attempt + 1,
          maxRetries,
          initialBackoffMs: backoffMs,
          maxBackoffMs: 500,
          estimatedWaitMs,
          staleAfterMs: COUNTER_LOCK_STALE_MS,
          lockExists: false,
        },
      };
    } catch {
      // Lock held by another caller — check for staleness, then wait and retry
      await reclaimIfStale(lockDir);
    }
    estimatedWaitMs += waitMs;
    await sleep(waitMs);
    waitMs = Math.min(waitMs * 2, 500);
  }
  return {
    release: null,
    diagnostics: await readCounterLockDiagnostics({
      lockDir,
      attempts: maxRetries,
      maxRetries,
      initialBackoffMs: backoffMs,
      maxBackoffMs: 500,
      estimatedWaitMs,
      staleAfterMs: COUNTER_LOCK_STALE_MS,
    }),
  };
}

async function readCounterLockDiagnostics(
  options: Omit<CounterLockDiagnostics, 'lockExists' | 'lockAgeMs' | 'lockMtime'>,
): Promise<CounterLockDiagnostics> {
  try {
    const info = await stat(options.lockDir);
    const lockAgeMs = Math.max(0, Date.now() - info.mtimeMs);
    return {
      ...options,
      lockExists: true,
      lockAgeMs: Math.round(lockAgeMs),
      lockMtime: info.mtime.toISOString(),
    };
  } catch {
    return { ...options, lockExists: false };
  }
}

function formatCounterLockDiagnostics(diagnostics: CounterLockDiagnostics): string {
  const parts = [
    `lockDir="${diagnostics.lockDir}"`,
    `attempts=${diagnostics.attempts}/${diagnostics.maxRetries}`,
    `estimatedWaitMs=${diagnostics.estimatedWaitMs}`,
    `retryBackoffMs=${diagnostics.initialBackoffMs}-${diagnostics.maxBackoffMs}`,
    `staleAfterMs=${diagnostics.staleAfterMs}`,
    `lockExists=${diagnostics.lockExists}`,
  ];
  if (diagnostics.lockAgeMs !== undefined) {
    parts.push(`lockAgeMs=${diagnostics.lockAgeMs}`);
  }
  if (diagnostics.lockMtime !== undefined) {
    parts.push(`lockMtime="${diagnostics.lockMtime}"`);
  }
  return parts.join(' ');
}

async function reclaimIfStale(lockDir: string): Promise<void> {
  try {
    const info = await stat(lockDir);
    const ageMs = Date.now() - info.mtimeMs;
    if (ageMs > COUNTER_LOCK_STALE_MS) {
      log.warn('counter_lock.stale.reclaiming', { lockDir, ageMs: Math.round(ageMs) });
      // `rm` with recursive+force handles both directory locks (canonical
      // shape) and stray regular files left over from earlier code versions
      // or partial writes. `rmdir` would throw ENOTDIR on the file case and
      // trap the acquire loop in an infinite "reclaiming" log.
      await rm(lockDir, { recursive: true, force: true });
    }
  } catch {
    // Lock vanished between mkdir-failure and stat (race) — let next mkdir retry decide.
  }
}

// ── Counter file read/write helpers (used under lock) ────────────────────

interface CounterPayload {
  schema_version: string;
  context_pack_id: string;
  completed_count: number;
  cycle_count: number;
  last_archived_task_id: string;
  last_archived_at: string;
  last_retrospective_at: string;
  last_retrospective_task_id: string;
  cycle_task_ids: string[];
}

function emptyCounter(contextPackId: string): CounterPayload {
  return {
    schema_version: SCHEMA_VERSION,
    context_pack_id: contextPackId,
    completed_count: 0,
    cycle_count: 0,
    last_archived_task_id: '',
    last_archived_at: '',
    last_retrospective_at: '',
    last_retrospective_task_id: '',
    cycle_task_ids: [],
  };
}

async function readCounter(
  counterPath: string,
  contextPackId: string,
): Promise<CounterPayload> {
  const raw = await readTextFile(counterPath);
  if (!raw) {
    return emptyCounter(contextPackId);
  }
  try {
    const parsed = safeJsonParse<Record<string, unknown>>(raw, counterPath);
    if (typeof parsed.completed_count !== 'number') {
      return emptyCounter(contextPackId);
    }
    return parsed as unknown as CounterPayload;
  } catch {
    return emptyCounter(contextPackId);
  }
}

async function writeCounter(
  counterPath: string,
  payload: CounterPayload,
): Promise<void> {
  await writeTextFileAtomic(counterPath, JSON.stringify(payload, null, 2) + '\n');
}

function incrementCounter(
  state: CounterPayload,
  contextPackId: string,
  taskId?: string,
): CounterPayload {
  const next = { ...state };
  const countedAt = new Date().toISOString();
  next.completed_count = (next.completed_count ?? 0) + 1;
  if (next.completed_count >= RETROSPECTIVE_CYCLE_LENGTH) {
    next.completed_count = 0;
    next.cycle_count = (next.cycle_count ?? 0) + 1;
    next.last_retrospective_at = countedAt;
    next.last_retrospective_task_id = taskId ?? '';
  }
  next.schema_version = SCHEMA_VERSION;
  next.context_pack_id = contextPackId;
  if (taskId) {
    const cycleTaskIds = Array.isArray(next.cycle_task_ids)
      ? [...next.cycle_task_ids, taskId]
      : [taskId];
    next.last_archived_task_id = taskId;
    next.last_archived_at = countedAt;
    next.cycle_task_ids = cycleTaskIds.slice(-RETROSPECTIVE_CYCLE_LENGTH);
  }
  return next;
}

function shouldIncrementCounterForTask(state: CounterPayload, taskId?: string): boolean {
  if (!taskId) {
    return true;
  }
  if (state.last_archived_task_id === taskId) {
    return false;
  }
  return !Array.isArray(state.cycle_task_ids) || !state.cycle_task_ids.includes(taskId);
}

function retrospectiveRequiredForTask(
  state: CounterPayload,
  taskId: string | undefined,
  willIncrement: boolean,
): boolean {
  if (!taskId || willIncrement) {
    return isRetrospectiveRequiredForCompletedCount(state.completed_count);
  }

  if (state.last_retrospective_task_id === taskId) {
    return true;
  }

  if (state.last_archived_task_id !== taskId) {
    return false;
  }

  // Duplicate recovery after the archive writer already counted this task.
  // Reconstruct the pre-increment position so label sync remains correct
  // without mutating the counter a second time.
  if (state.completed_count === 0 && state.cycle_count > 0) {
    return true;
  }
  return isRetrospectiveRequiredForCompletedCount(
    Math.max(0, state.completed_count - 1),
  );
}

// ── Public read-only query (no lock — caller must serialize externally) ────

export async function getRetrospectiveRequiredForNextTask(options: {
  repoRoot: string;
  contextPackDir?: string;
}): Promise<boolean> {
  const contextPackId = contextPackIdFromDir(options.contextPackDir);
  const counterPath = path.join(
    options.repoRoot,
    TASK_COUNTER_DIR_RELATIVE,
    `${contextPackId}.json`,
  );
  const raw = await readTextFile(counterPath);
  if (!raw) {
    return false;
  }
  try {
    const payload = safeJsonParse<Record<string, unknown>>(raw, counterPath);
    const completedCount = typeof payload.completed_count === 'number'
      ? payload.completed_count
      : 0;
    return isRetrospectiveRequiredForCompletedCount(completedCount);
  } catch {
    return false;
  }
}

async function claimRetrospectiveCounterBoundary(options: {
  repoRoot: string;
  contextPackId: string;
  taskId: string;
}): Promise<boolean> {
  const counterDir = path.join(options.repoRoot, TASK_COUNTER_DIR_RELATIVE);
  const counterPath = path.join(counterDir, `${options.contextPackId}.json`);
  await mkdir(counterDir, { recursive: true });

  const lock = await acquireCounterLock(counterDir, options.contextPackId);
  if (!lock.release) {
    throw new Error(
      `claimRetrospectiveRun: could not acquire counter lock for context pack "${options.contextPackId}" (${formatCounterLockDiagnostics(lock.diagnostics)})`,
    );
  }

  try {
    const state = await readCounter(counterPath, options.contextPackId);
    if (!isRetrospectiveRequiredForCompletedCount(state.completed_count)) {
      return false;
    }

    // Claim the cycle boundary before the long-running Ron launch. Otherwise
    // a stale-label loser can skip the active run lock, close out first, and
    // incorrectly become the 10th counted task.
    await writeCounter(counterPath, incrementCounter(state, options.contextPackId, options.taskId));
    return true;
  } finally {
    await lock.release();
  }
}

export async function claimRetrospectiveRun(options: {
  repoRoot: string;
  contextPackDir?: string;
  taskId: string;
}): Promise<RetrospectiveRunClaimResult> {
  const contextPackId = contextPackIdFromDir(options.contextPackDir);
  const lockRoot = path.join(options.repoRoot, RETROSPECTIVE_RUN_LOCK_DIR_RELATIVE);
  const lockDir = path.join(lockRoot, `${contextPackId}.lock`);
  await mkdir(lockRoot, { recursive: true });

  const release = await acquireDirLock(lockDir, 2, 0);
  if (!release) {
    return { claimed: false, contextPackId, lockDir, reason: 'already-running' };
  }

  try {
    const counterClaimed = await claimRetrospectiveCounterBoundary({
      repoRoot: options.repoRoot,
      contextPackId,
      taskId: options.taskId,
    });
    if (!counterClaimed) {
      await release();
      return { claimed: false, contextPackId, lockDir, reason: 'counter-not-required' };
    }

    return {
      claimed: true,
      claim: {
        contextPackId,
        lockDir,
        release,
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}

async function writeRetrospectiveRequiredLabel(
  retrospectivePath: string,
  content: string,
  required: boolean,
): Promise<void> {
  const updated = setLabelValue(
    content,
    RETROSPECTIVE_REQUIRED_LABEL,
    required ? 'true' : 'false',
  );
  if (updated !== content) {
    await writeTextFileAtomic(retrospectivePath, updated);
  }
}

/**
 * Stamp the activation-time `Retrospective Required` label from the current
 * counter position without mutating the completion counter. Retrospective run
 * claim and archive/closeout paths own counter mutation.
 */
export async function stampRetrospectiveRequiredMetadata(options: {
  repoRoot: string;
  handoffsDir: string;
  contextPackDir?: string;
}): Promise<void> {
  const retrospectivePath = path.join(options.handoffsDir, 'retrospective-input.md');
  const content = await readTextFile(retrospectivePath);
  if (content === undefined) {
    return;
  }

  const contextPackId = contextPackIdFromDir(options.contextPackDir);
  const counterPath = path.join(
    options.repoRoot,
    TASK_COUNTER_DIR_RELATIVE,
    `${contextPackId}.json`,
  );
  const state = await readCounter(counterPath, contextPackId);
  const required = isRetrospectiveRequiredForCompletedCount(state.completed_count);
  await writeRetrospectiveRequiredLabel(retrospectivePath, content, required);
}

// ── Locked sync: read → decide → increment → write (F2 lock scope) ───────

/**
 * Atomically: acquire per-context-pack counter lock (precedence 4, held AFTER
 * queue lock), read the counter, decide whether a retrospective is required for
 * the task being completed, increment the counter, write it back, then update
 * the `Retrospective Required` label in retrospective-input.md.
 *
 * The lock is held continuously across the entire read-decide-increment-write
 * triple — releasing between any two steps would allow two concurrent callers
 * to both read N and both write N+1, causing exactly one retrospective trigger
 * instead of the correct two-increment, one-trigger behaviour.
 */
export async function syncRetrospectiveRequiredMetadata(options: {
  repoRoot: string;
  handoffsDir: string;
  contextPackDir?: string;
  taskId?: string;
}): Promise<void> {
  const retrospectivePath = path.join(options.handoffsDir, 'retrospective-input.md');
  const content = await readTextFile(retrospectivePath);
  if (content === undefined) {
    return;
  }

  const contextPackId = contextPackIdFromDir(options.contextPackDir);
  const counterDir = path.join(options.repoRoot, TASK_COUNTER_DIR_RELATIVE);
  const counterPath = path.join(counterDir, `${contextPackId}.json`);

  // Ensure the counter directory exists before acquiring the lock dir inside it
  try {
    await mkdir(counterDir, { recursive: true });
  } catch {
    // Already exists
  }

  const lock = await acquireCounterLock(counterDir, contextPackId);
  if (!lock.release) {
    throw new Error(
      `syncRetrospectiveRequiredMetadata: could not acquire counter lock for context pack "${contextPackId}" (${formatCounterLockDiagnostics(lock.diagnostics)})`,
    );
  }

  try {
    // F2 lock scope: read → decide → increment → write held atomically
    const state = await readCounter(counterPath, contextPackId);
    const taskId = options.taskId;
    const shouldIncrement = shouldIncrementCounterForTask(state, taskId);
    const required = retrospectiveRequiredForTask(state, taskId, shouldIncrement);
    if (shouldIncrement) {
      const nextState = incrementCounter(state, contextPackId, taskId);
      await writeCounter(counterPath, nextState);
    }

    await writeRetrospectiveRequiredLabel(retrospectivePath, content, required);
  } finally {
    await lock.release();
  }
}
