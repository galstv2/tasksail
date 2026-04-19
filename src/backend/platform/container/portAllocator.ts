/**
 * §6.2 Port Allocator — real implementation replacing `port-allocator/stub.ts`.
 *
 * Shared allocation table at `.platform-state/runtime/port-allocations.json`.
 * One table covers every task. Record shape is `{port, taskId, composeProjectName}`
 * keyed by `taskId` (NOT the bare `{<port>: <taskId>}` pair from the stub) because
 * §5.2's orphan-container sweep reads the table to cross-reference live compose
 * projects — stripping composeProjectName would make that sweep impossible.
 *
 * Concurrency is guarded by an advisory file lock on
 * `.platform-state/runtime/port-allocations.json.lock` implemented as an atomic
 * `writeFileSync(flag: 'wx')` + PID-and-staleness reclaim. No third-party lock
 * library — TaskSail forbids enterprise-questionable imports per CLAUDE.md.
 */
import path from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import { getPlatformConfig } from '../platform-config/get.js';

// ---------------------------------------------------------------------------
// Constants (EXPORTED so tests can assert without rehardcoding)
// ---------------------------------------------------------------------------

/** Poll interval between stale-lock retries, milliseconds. */
export const PORT_ALLOCATOR_LOCK_POLL_MS = 50;
/** Maximum retry count (total timeout = POLL_MS * MAX_RETRIES = 5000ms). */
export const PORT_ALLOCATOR_LOCK_MAX_RETRIES = 100;
/** Lock is considered stale after this duration, milliseconds. */
export const PORT_ALLOCATOR_LOCK_STALE_MS = 30_000;

const PORT_ALLOCATIONS_RELATIVE = path.join(
  '.platform-state', 'runtime', 'port-allocations.json',
);
const PORT_ALLOCATIONS_LOCK_SUFFIX = '.lock';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AllocationRecord {
  port: number;
  taskId: string;
  composeProjectName: string;
}

export interface McpPortRangeExhaustedError {
  code: 'mcp-port-range-exhausted';
  allocated: Record<string, AllocationRecord>;
  range: { min: number; max: number };
}

export interface McpPortRangeTooSmallError {
  code: 'mcp-port-range-too-small';
  rangeSize: number;
  cap: number;
}

export interface PortAllocatorLockTimeoutError {
  code: 'port-allocator-lock-timeout';
  lockPath: string;
  retries: number;
  staleAfterMs: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function tablePath(repoRoot: string): string {
  return path.join(repoRoot, PORT_ALLOCATIONS_RELATIVE);
}

function lockPath(repoRoot: string): string {
  return tablePath(repoRoot) + PORT_ALLOCATIONS_LOCK_SUFFIX;
}

// ---------------------------------------------------------------------------
// Lock adapter — private, sync; atomic create + PID + staleness reclaim.
// Kept sync so the critical section cannot span await boundaries.
// ---------------------------------------------------------------------------

interface LockFileBody {
  pid: number;
  ts: number;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryAcquire(lp: string): boolean {
  try {
    mkdirSync(path.dirname(lp), { recursive: true });
    const body: LockFileBody = { pid: process.pid, ts: Date.now() };
    writeFileSync(lp, JSON.stringify(body), { flag: 'wx', encoding: 'utf-8' });
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') return false;
    throw err;
  }
}

function readLockBody(lp: string): LockFileBody | null {
  try {
    const raw = readFileSync(lp, 'utf-8');
    const parsed = JSON.parse(raw) as LockFileBody;
    if (
      typeof parsed?.pid === 'number'
      && typeof parsed?.ts === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function maybeReclaimStale(lp: string, now: number): boolean {
  const body = readLockBody(lp);
  if (body === null) {
    // Malformed — treat as stale and reclaim.
    try { unlinkSync(lp); } catch { /* already gone */ }
    return true;
  }
  const ageMs = now - body.ts;
  const pidDead = !isProcessAlive(body.pid);
  const timedOut = ageMs >= PORT_ALLOCATOR_LOCK_STALE_MS;
  if (pidDead || timedOut) {
    try { unlinkSync(lp); } catch { /* already gone */ }
    return true;
  }
  return false;
}

function sleepSync(ms: number): void {
  // Atomics.wait on a zeroed SharedArrayBuffer — bounded, no busy-spin.
  const buf = new SharedArrayBuffer(4);
  const view = new Int32Array(buf);
  Atomics.wait(view, 0, 0, ms);
}

function withPortAllocatorLock<T>(lp: string, fn: () => T): T {
  for (let retry = 0; retry < PORT_ALLOCATOR_LOCK_MAX_RETRIES; retry++) {
    if (tryAcquire(lp)) {
      try {
        return fn();
      } finally {
        try { unlinkSync(lp); } catch { /* best-effort, peer may have reclaimed */ }
      }
    }
    const reclaimed = maybeReclaimStale(lp, Date.now());
    if (reclaimed) {
      // Immediate retry — no sleep after reclaim.
      continue;
    }
    sleepSync(PORT_ALLOCATOR_LOCK_POLL_MS);
  }
  const err: PortAllocatorLockTimeoutError = {
    code: 'port-allocator-lock-timeout',
    lockPath: lp,
    retries: PORT_ALLOCATOR_LOCK_MAX_RETRIES,
    staleAfterMs: PORT_ALLOCATOR_LOCK_STALE_MS,
  };
  throw err;
}

// ---------------------------------------------------------------------------
// Table I/O (sync, called only under the advisory lock)
// ---------------------------------------------------------------------------

function readTableSync(repoRoot: string): Record<string, AllocationRecord> {
  const tp = tablePath(repoRoot);
  if (!existsSync(tp)) return {};
  try {
    const raw = readFileSync(tp, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, AllocationRecord>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeTableSync(repoRoot: string, table: Record<string, AllocationRecord>): void {
  const tp = tablePath(repoRoot);
  mkdirSync(path.dirname(tp), { recursive: true });
  const tmpPath = tp + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(table, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, tp);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Allocate a port for `taskId`.
 *
 * Idempotent: if the taskId already has an allocation, returns the existing port
 * (and does NOT overwrite `composeProjectName` — bootstrap time is authoritative).
 *
 * F31: asserts `(max - min + 1) >= max_parallel_tasks` at each call. The port
 * range is read from platform config via `getPlatformConfig` so env-overrides
 * flow through the cache (MUST NOT call `loadPlatformConfig` directly).
 */
export async function allocate(
  taskId: string,
  composeProjectName: string,
  repoRoot: string,
): Promise<number> {
  const cfg = await getPlatformConfig(repoRoot);
  const range = cfg.mcp_port_range;
  const rangeSize = range.max - range.min + 1;
  const cap = cfg.max_parallel_tasks;
  if (rangeSize < cap) {
    const err: McpPortRangeTooSmallError = {
      code: 'mcp-port-range-too-small',
      rangeSize,
      cap,
    };
    throw err;
  }

  return withPortAllocatorLock(lockPath(repoRoot), () => {
    const table = readTableSync(repoRoot);

    const existing = table[taskId];
    if (existing && typeof existing.port === 'number') {
      return existing.port;
    }

    const used = new Set<number>();
    for (const entry of Object.values(table)) {
      if (typeof entry?.port === 'number') used.add(entry.port);
    }

    let picked: number | null = null;
    for (let port = range.min; port <= range.max; port++) {
      if (!used.has(port)) {
        picked = port;
        break;
      }
    }

    if (picked === null) {
      const err: McpPortRangeExhaustedError = {
        code: 'mcp-port-range-exhausted',
        allocated: { ...table },
        range: { min: range.min, max: range.max },
      };
      throw err;
    }

    table[taskId] = { port: picked, taskId, composeProjectName };
    writeTableSync(repoRoot, table);
    return picked;
  });
}

/**
 * Release the allocation for `taskId`.
 *
 * Idempotent: no-op when no record exists (matches §4.14A in-session failure
 * path + §6.3B teardown chain + §5.2 recoverOnStartup sweep, all of which can
 * legitimately call release for an already-cleared entry).
 */
export async function release(taskId: string, repoRoot: string): Promise<void> {
  try {
    withPortAllocatorLock(lockPath(repoRoot), () => {
      const table = readTableSync(repoRoot);
      if (!(taskId in table)) return;
      delete table[taskId];
      writeTableSync(repoRoot, table);
    });
  } catch (err: unknown) {
    // Lock-timeout during release is best-effort only — swallowing here avoids
    // blocking peer-task cleanup. A genuine failure is reported via stderr so
    // observability catches it without a fatal throw.
    const errCode = (err as { code?: string } | undefined)?.code;
    if (errCode === 'port-allocator-lock-timeout') {
      process.stderr.write(
        `[portAllocator] release: lock timeout for taskId=${taskId} — skipping\n`,
      );
      return;
    }
    throw err;
  }
}

/**
 * List every allocation currently in the shared table.
 * Return a Map<taskId, AllocationRecord> so callers can iterate deterministically.
 */
export async function listAllocations(
  repoRoot: string,
): Promise<Map<string, AllocationRecord>> {
  return withPortAllocatorLock(lockPath(repoRoot), () => {
    const table = readTableSync(repoRoot);
    const result = new Map<string, AllocationRecord>();
    for (const [tid, rec] of Object.entries(table)) {
      if (rec && typeof rec.port === 'number') {
        result.set(tid, rec);
      }
    }
    return result;
  });
}
