import path from 'node:path';
import { mkdir, rmdir } from 'node:fs/promises';
import { readTextFile, safeJsonParse, writeTextFile, sleep } from '../core/index.js';
import { setLabelValue } from './artifacts.js';

const TASK_COUNTER_DIR_RELATIVE = '.platform-state/task-counters';
const DEFAULT_CONTEXT_PACK_ID = 'platform-core';
const RETROSPECTIVE_CYCLE_LENGTH = 10;
const SCHEMA_VERSION = 'task-counter/v1';

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
): Promise<(() => Promise<void>) | null> {
  const lockDir = path.join(counterDir, `${contextPackId}.lock`);
  let waitMs = backoffMs;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await mkdir(lockDir, { recursive: false });
      return async () => {
        try {
          await rmdir(lockDir);
        } catch {
          // Already removed — safe to ignore
        }
      };
    } catch {
      // Lock held by another caller — wait and retry
    }
    await sleep(waitMs);
    waitMs = Math.min(waitMs * 2, 500);
  }
  return null;
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
  await writeTextFile(counterPath, JSON.stringify(payload, null, 2) + '\n');
}

function incrementCounter(
  state: CounterPayload,
  contextPackId: string,
  taskId?: string,
): CounterPayload {
  const next = { ...state };
  next.completed_count = (next.completed_count ?? 0) + 1;
  if (next.completed_count >= RETROSPECTIVE_CYCLE_LENGTH) {
    next.completed_count = 0;
    next.cycle_count = (next.cycle_count ?? 0) + 1;
  }
  next.schema_version = SCHEMA_VERSION;
  next.context_pack_id = contextPackId;
  if (taskId) {
    const cycleTaskIds = Array.isArray(next.cycle_task_ids)
      ? [...next.cycle_task_ids, taskId]
      : [taskId];
    next.last_archived_task_id = taskId;
    next.last_archived_at = new Date().toISOString();
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

  const release = await acquireCounterLock(counterDir, contextPackId);
  if (!release) {
    throw new Error(
      `syncRetrospectiveRequiredMetadata: could not acquire counter lock for context pack "${contextPackId}"`,
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

    const updated = setLabelValue(
      content,
      'Retrospective Required',
      required ? 'true' : 'false',
    );
    if (updated !== content) {
      await writeTextFile(retrospectivePath, updated);
    }
  } finally {
    await release();
  }
}
