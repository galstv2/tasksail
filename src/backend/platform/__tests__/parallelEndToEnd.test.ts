/**
 * §7.1 Parallel end-to-end isolation — N=2 orchestration contract.
 *
 * This test exercises the REAL port allocator, REAL containerNaming, and REAL
 * finalizeTaskWorktrees teardown chain under parallel two-task workloads with
 * `max_parallel_tasks: 2`. Pipeline children (agent spawns, docker compose)
 * are NOT exercised here — §7.1's scope is the orchestration-layer isolation
 * contracts that must hold before N>1 is safe:
 *
 *   1. Two tasks allocate DISTINCT ports from the shared table.
 *   2. Two tasks yield DISTINCT compose project names and container names
 *      under the F4 `tasksail-<slug>` scheme.
 *   3. Releasing task A's port preserves task B's port lease byte-identically.
 *   4. After releasing A, a third task C allocates a port NOT equal to B's.
 *   5. finalizeTaskWorktrees(A, 'failed') with no `.task.json` sidecar still
 *      releases A's port (via the §6.3B teardown chain) and leaves B's
 *      allocation and runtime dir untouched.
 *   6. Concurrent `allocate()` calls for 3 tasks serialize under the file
 *      lock and yield 3 distinct ports (no race → no collision).
 *
 * Full pipeline end-to-end (queue activation → MCP bootstrap → agent spawn)
 * is covered by integration tests under RUN_CONTAINER_TESTS=1. This file is
 * the fast, deterministic gate that runs on every `pnpm run test`.
 *
 * Run: pnpm vitest run src/backend/platform/__tests__/parallelEndToEnd.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { allocate, release, listAllocations } from '../container/portAllocator.js';
import {
  composeProjectName,
  repoContextMcpContainerName,
} from '../container/containerNaming.js';
import { finalizeTaskWorktrees } from '../core/worktreeFinalize.js';
import { _clearPlatformConfigCache } from '../platform-config/get.js';

// ---------------------------------------------------------------------------
// Fixture helpers — minimal, no git worktrees, no docker.
// ---------------------------------------------------------------------------

const TASK_A = 'parallel-task-a';
const TASK_B = 'parallel-task-b';
const TASK_C = 'parallel-task-c';

/** Seed `.platform-state/platform.json` with `max_parallel_tasks: cap`. */
function seedPlatformJson(repoRoot: string, cap: number): void {
  const dir = path.join(repoRoot, '.platform-state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'platform.json'),
    JSON.stringify(
      {
        schema_version: 1,
        container_runtime: 'docker',
        max_parallel_tasks: cap,
        retain_failed_task_worktrees: false,
        max_retained_failed_task_worktrees: 5,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        // Range sized to exceed cap so range-vs-cap F31 validation passes.
        mcp_port_range: { min: 8811, max: 8820 },
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
  mkdirSync(path.join(dir, 'runtime'), { recursive: true });
}

function readAllocTable(repoRoot: string): Record<string, { port: number; taskId: string; composeProjectName: string }> {
  const tblPath = path.join(repoRoot, '.platform-state', 'runtime', 'port-allocations.json');
  if (!existsSync(tblPath)) return {};
  return JSON.parse(readFileSync(tblPath, 'utf-8')) as Record<string, { port: number; taskId: string; composeProjectName: string }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('§7.1 parallel end-to-end — N=2 isolation contracts', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'parallel-e2e-'));
    seedPlatformJson(repoRoot, 2);
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    _clearPlatformConfigCache();
  });

  it('two allocations yield DISTINCT ports AND DISTINCT compose project names', async () => {
    const projectA = composeProjectName(TASK_A);
    const projectB = composeProjectName(TASK_B);
    expect(projectA).not.toBe(projectB);
    expect(projectA).toBe(`tasksail-${TASK_A}`);
    expect(projectB).toBe(`tasksail-${TASK_B}`);

    const portA = await allocate(TASK_A, projectA, repoRoot);
    const portB = await allocate(TASK_B, projectB, repoRoot);
    expect(portA).not.toBe(portB);

    // Container names MUST also be distinct (F34 identity derivation).
    expect(repoContextMcpContainerName(TASK_A))
      .not.toBe(repoContextMcpContainerName(TASK_B));

    // The allocation table records BOTH entries with their respective project names.
    const table = readAllocTable(repoRoot);
    expect(table[TASK_A]).toEqual({ port: portA, taskId: TASK_A, composeProjectName: projectA });
    expect(table[TASK_B]).toEqual({ port: portB, taskId: TASK_B, composeProjectName: projectB });
  });

  it('releasing task A preserves task B byte-identically', async () => {
    await allocate(TASK_A, composeProjectName(TASK_A), repoRoot);
    const portB = await allocate(TASK_B, composeProjectName(TASK_B), repoRoot);

    const beforeRelease = readAllocTable(repoRoot);
    const bEntryBefore = JSON.stringify(beforeRelease[TASK_B]);

    await release(TASK_A, repoRoot);

    const afterRelease = readAllocTable(repoRoot);
    expect(afterRelease[TASK_A]).toBeUndefined();

    // Task B's record MUST be byte-identical — no rekey, no reorder side-effects.
    expect(JSON.stringify(afterRelease[TASK_B])).toBe(bEntryBefore);
    expect(afterRelease[TASK_B]?.port).toBe(portB);

    // Task A's port is reclaimable: allocate a third task and assert it NEVER
    // collides with B's held port. Whether C reuses A's freed port (min-first
    // scan) or picks a new one is an implementation detail — the invariant is
    // strict non-collision with the surviving allocation.
    const portC = await allocate(TASK_C, composeProjectName(TASK_C), repoRoot);
    expect(portC).not.toBe(portB);
  });

  it('finalizeTaskWorktrees(failed) for task A with no sidecar releases A and preserves B', async () => {
    const portA = await allocate(TASK_A, composeProjectName(TASK_A), repoRoot);
    const portB = await allocate(TASK_B, composeProjectName(TASK_B), repoRoot);
    expect(portA).not.toBe(portB);

    // Seed a runtime dir for task B to prove isolation later.
    const taskBRuntime = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TASK_B);
    mkdirSync(path.join(taskBRuntime, 'guardrails'), { recursive: true });
    writeFileSync(
      path.join(taskBRuntime, 'guardrails', 'phase-1.json'),
      JSON.stringify({ phase: 1, ok: true }),
      'utf-8',
    );

    // No .task.json sidecar for task A — exercises the readTaskJsonSafe null
    // path in finalizeTaskWorktrees and the parent-dir-missing skip in
    // persistTaskJson. Teardown chain MUST still release A's port.
    await finalizeTaskWorktrees(TASK_A, 'failed', repoRoot);

    const table = readAllocTable(repoRoot);
    expect(table[TASK_A]).toBeUndefined();
    expect(table[TASK_B]?.port).toBe(portB);

    // Task B's runtime dir MUST be untouched.
    expect(existsSync(path.join(taskBRuntime, 'guardrails', 'phase-1.json'))).toBe(true);
  });

  it('three concurrent allocations (cap=3) serialize through the lock with no port collision', async () => {
    // Reseed with cap=3 to test lock-serialized N=3 allocation.
    seedPlatformJson(repoRoot, 3);
    _clearPlatformConfigCache();

    const projectNames = [TASK_A, TASK_B, TASK_C].map(composeProjectName);
    const [pA, pB, pC] = await Promise.all([
      allocate(TASK_A, projectNames[0]!, repoRoot),
      allocate(TASK_B, projectNames[1]!, repoRoot),
      allocate(TASK_C, projectNames[2]!, repoRoot),
    ]);

    // Three DISTINCT ports — the lock serializes and prevents any collision.
    const uniquePorts = new Set([pA, pB, pC]);
    expect(uniquePorts.size).toBe(3);

    // listAllocations reflects all three entries.
    const listed = await listAllocations(repoRoot);
    expect(listed.size).toBe(3);
    expect(listed.get(TASK_A)?.port).toBe(pA);
    expect(listed.get(TASK_B)?.port).toBe(pB);
    expect(listed.get(TASK_C)?.port).toBe(pC);
  });

  it('per-task runtime dirs under .platform-state/runtime/tasks/<id>/ are independent', async () => {
    // This invariant backs the §6.3B teardown contract: reaping task A's dir
    // must never disturb task B. Model the seed-and-reap cycle directly.
    const taskARuntime = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TASK_A);
    const taskBRuntime = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TASK_B);
    mkdirSync(path.join(taskARuntime, 'guardrails'), { recursive: true });
    mkdirSync(path.join(taskBRuntime, 'guardrails'), { recursive: true });
    writeFileSync(path.join(taskARuntime, 'guardrails', 'a.json'), '{"a":true}', 'utf-8');
    writeFileSync(path.join(taskBRuntime, 'guardrails', 'b.json'), '{"b":true}', 'utf-8');

    // Reap A's runtime dir (simulates §6.3B gcTaskRuntime).
    rmSync(taskARuntime, { recursive: true, force: true });

    expect(existsSync(taskARuntime)).toBe(false);
    // B's dir and file MUST be intact.
    expect(existsSync(path.join(taskBRuntime, 'guardrails', 'b.json'))).toBe(true);
    expect(readFileSync(path.join(taskBRuntime, 'guardrails', 'b.json'), 'utf-8')).toBe('{"b":true}');
  });
});
