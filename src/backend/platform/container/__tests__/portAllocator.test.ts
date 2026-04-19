/**
 * §6.2 Port Allocator tests.
 *
 * Covers: allocate/release/listAllocations, F31 range-vs-cap validation,
 * exhaustion, idempotency, concurrency, stale-lock reclaim.
 *
 * Run: pnpm vitest run src/backend/platform/container/__tests__/portAllocator.test.ts
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  allocate,
  release,
  listAllocations,
  PORT_ALLOCATOR_LOCK_POLL_MS,
  PORT_ALLOCATOR_LOCK_MAX_RETRIES,
  PORT_ALLOCATOR_LOCK_STALE_MS,
} from '../portAllocator.js';
import type {
  McpPortRangeExhaustedError,
  McpPortRangeTooSmallError,
} from '../portAllocator.js';
import { _clearPlatformConfigCache } from '../../platform-config/get.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writePlatformJson(
  repoRoot: string,
  overrides: Partial<{
    max_parallel_tasks: number;
    mcp_port_range: { min: number; max: number };
  }> = {},
): void {
  const dir = path.join(repoRoot, '.platform-state');
  mkdirSync(dir, { recursive: true });
  const json = {
    schema_version: 1,
    container_runtime: 'docker',
    max_parallel_tasks: overrides.max_parallel_tasks ?? 5,
    retain_failed_task_worktrees: true,
    max_retained_failed_task_worktrees: 5,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3_600_000,
    mcp_port_range: overrides.mcp_port_range ?? { min: 8811, max: 8815 },
  };
  writeFileSync(path.join(dir, 'platform.json'), JSON.stringify(json, null, 2) + '\n');
}

function tablePath(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state', 'runtime', 'port-allocations.json');
}

function lockPath(repoRoot: string): string {
  return tablePath(repoRoot) + '.lock';
}

// ---------------------------------------------------------------------------
// Constants surfaced for tests
// ---------------------------------------------------------------------------

describe('§6.2 portAllocator constants', () => {
  it('exports the three lock timing constants verbatim', () => {
    expect(PORT_ALLOCATOR_LOCK_POLL_MS).toBe(50);
    expect(PORT_ALLOCATOR_LOCK_MAX_RETRIES).toBe(100);
    expect(PORT_ALLOCATOR_LOCK_STALE_MS).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// allocate / release basics
// ---------------------------------------------------------------------------

describe('§6.2 portAllocator allocate/release', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'portalloc-'));
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('allocate N, free some, re-allocate — no double-allocation', async () => {
    writePlatformJson(repoRoot, {
      max_parallel_tasks: 5,
      mcp_port_range: { min: 8811, max: 8815 },
    });

    const ports = await Promise.all([
      allocate('t1', 'repo-context-mcp-t1', repoRoot),
      allocate('t2', 'repo-context-mcp-t2', repoRoot),
      allocate('t3', 'repo-context-mcp-t3', repoRoot),
    ]);
    expect(new Set(ports).size).toBe(3);

    await release('t2', repoRoot);

    const p4 = await allocate('t4', 'repo-context-mcp-t4', repoRoot);
    // First-fit scan in-range: t4 reuses t2's freed port (ports[1]).
    // The other two live allocations (ports[0], ports[2]) remain untouched.
    expect(p4).toBe(ports[1]);

    const listing = await listAllocations(repoRoot);
    expect(listing.size).toBe(3);
    expect(listing.has('t2')).toBe(false);
    expect(listing.get('t4')?.composeProjectName).toBe('repo-context-mcp-t4');
  });

  it('allocate is idempotent per taskId (existing record wins)', async () => {
    writePlatformJson(repoRoot);
    const p1 = await allocate('t1', 'repo-context-mcp-t1', repoRoot);
    const p2 = await allocate('t1', 'repo-context-mcp-t1-different-project', repoRoot);
    expect(p2).toBe(p1);

    const listing = await listAllocations(repoRoot);
    // Existing composeProjectName MUST NOT be overwritten — bootstrap time
    // is authoritative. The allocator does NOT re-derive on repeat allocate().
    expect(listing.get('t1')?.composeProjectName).toBe('repo-context-mcp-t1');
  });

  it('release is idempotent on unknown taskId (silent no-op)', async () => {
    writePlatformJson(repoRoot);
    await expect(release('unknown', repoRoot)).resolves.toBeUndefined();
  });

  it('exhaustion raises McpPortRangeExhaustedError with range + snapshot', async () => {
    writePlatformJson(repoRoot, {
      max_parallel_tasks: 2,
      mcp_port_range: { min: 8811, max: 8812 },
    });

    await allocate('t1', 'proj-1', repoRoot);
    await allocate('t2', 'proj-2', repoRoot);

    let caught: McpPortRangeExhaustedError | null = null;
    try {
      await allocate('t3', 'proj-3', repoRoot);
    } catch (err) {
      caught = err as McpPortRangeExhaustedError;
    }
    expect(caught?.code).toBe('mcp-port-range-exhausted');
    expect(caught?.range).toEqual({ min: 8811, max: 8812 });
    expect(Object.keys(caught?.allocated ?? {}).sort()).toEqual(['t1', 't2']);
  });

  it('F31 — port-range smaller than cap raises McpPortRangeTooSmallError', async () => {
    writePlatformJson(repoRoot, {
      max_parallel_tasks: 5,
      mcp_port_range: { min: 8811, max: 8812 }, // size = 2, cap = 5
    });

    let caught: McpPortRangeTooSmallError | null = null;
    try {
      await allocate('t1', 'proj-1', repoRoot);
    } catch (err) {
      caught = err as McpPortRangeTooSmallError;
    }
    expect(caught?.code).toBe('mcp-port-range-too-small');
    expect(caught?.rangeSize).toBe(2);
    expect(caught?.cap).toBe(5);
  });

  it('F31 — range == cap succeeds (exact-fit boundary)', async () => {
    writePlatformJson(repoRoot, {
      max_parallel_tasks: 5,
      mcp_port_range: { min: 8811, max: 8815 }, // size = 5, cap = 5
    });

    const ports = await Promise.all(
      ['t1', 't2', 't3', 't4', 't5'].map((id) =>
        allocate(id, `proj-${id}`, repoRoot),
      ),
    );
    expect(new Set(ports).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Concurrency — two allocate calls on empty range converge to distinct ports
// ---------------------------------------------------------------------------

describe('§6.2 portAllocator concurrency', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'portalloc-conc-'));
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('two Promise.all() allocate calls → two distinct ports, no duplicates', async () => {
    writePlatformJson(repoRoot, {
      max_parallel_tasks: 5,
      mcp_port_range: { min: 8811, max: 8815 },
    });

    const [pA, pB] = await Promise.all([
      allocate('taskA', 'projA', repoRoot),
      allocate('taskB', 'projB', repoRoot),
    ]);
    expect(pA).not.toBe(pB);

    const raw = JSON.parse(readFileSync(tablePath(repoRoot), 'utf-8')) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['taskA', 'taskB']);
  });
});

// ---------------------------------------------------------------------------
// Lock-adapter stale reclaim — simulated dead-PID lockfile
// ---------------------------------------------------------------------------

describe('§6.2 portAllocator lock stale reclaim', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'portalloc-stale-'));
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('dead-PID lock is reclaimed on next allocate (no timeout)', async () => {
    writePlatformJson(repoRoot);
    // Pre-seed a lockfile with a guaranteed-dead pid. Pid 1 would be alive
    // (init); use process.pid + a huge offset that cannot map to a live process.
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime'), { recursive: true });
    const lp = lockPath(repoRoot);
    writeFileSync(lp, JSON.stringify({ pid: 999_999_999, ts: Date.now() }), 'utf-8');

    // Allocate succeeds — stale reclaim kicks in inside Acquire.
    const port = await allocate('t1', 'proj-1', repoRoot);
    expect(port).toBe(8811);

    // Lockfile MUST be unlinked by the finally-block of withPortAllocatorLock.
    expect(existsSync(lp)).toBe(false);
  });

  it('time-stale lock (ts older than STALE_MS) is reclaimed even if pid appears alive', async () => {
    writePlatformJson(repoRoot);
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime'), { recursive: true });
    const lp = lockPath(repoRoot);
    // process.pid IS alive — PID check would keep the lock.
    // ts is ancient → staleness check fires.
    writeFileSync(
      lp,
      JSON.stringify({ pid: process.pid, ts: Date.now() - (PORT_ALLOCATOR_LOCK_STALE_MS + 1000) }),
      'utf-8',
    );

    const port = await allocate('t1', 'proj-1', repoRoot);
    expect(port).toBe(8811);
    expect(existsSync(lp)).toBe(false);
  });
});
