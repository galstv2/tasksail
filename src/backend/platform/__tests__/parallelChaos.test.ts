/**
 * §7.2 Parallel chaos — 30-iteration seeded randomized allocate/release cycle.
 *
 * Drives the REAL port allocator through 30 pseudo-random operations on a pool
 * of 6 task IDs with `max_parallel_tasks: 3`. After every single step the test
 * asserts the hard invariants that MUST hold irrespective of the operation
 * sequence:
 *
 *   I1. Ground truth matches disk — the set of allocated (taskId, port) pairs
 *       tracked in-memory by the test is byte-identical to what readAllocTable
 *       returns.
 *   I2. Port uniqueness — no two held entries share a port.
 *   I3. Port range bound — every held port is inside [min, max] from platform.json.
 *   I4. Record integrity — every record has the correct taskId + composeProjectName.
 *
 * The RNG is a seeded LCG so failures are reproducible. Override the seed via
 * `CHAOS_SEED=<int>` to re-run a specific sequence. Default seed = 20260418
 * (today's date). Any failure reports the seed and the operation trace so an
 * operator can replay the exact run that broke.
 *
 * Run: pnpm vitest run src/backend/platform/__tests__/parallelChaos.test.ts
 * Reproduce: CHAOS_SEED=123 pnpm vitest run src/backend/platform/__tests__/parallelChaos.test.ts
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

import { allocate, release } from '../container/portAllocator.js';
import { composeProjectName } from '../container/containerNaming.js';
import { _clearPlatformConfigCache } from '../platform-config/get.js';

// ---------------------------------------------------------------------------
// Fixture + RNG helpers
// ---------------------------------------------------------------------------

const PORT_MIN = 8811;
const PORT_MAX = 8820;
const CAP = 3;
const ITERATIONS = 30;
const TASK_POOL = ['chaos-t1', 'chaos-t2', 'chaos-t3', 'chaos-t4', 'chaos-t5', 'chaos-t6'] as const;

/**
 * Seeded LCG — numerical-recipes constants. Returns a 32-bit unsigned int.
 * Deterministic so test failures are reproducible from the seed alone.
 */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function seedPlatformJson(repoRoot: string): void {
  const dir = path.join(repoRoot, '.platform-state');
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  writeFileSync(
    path.join(dir, 'platform.json'),
    JSON.stringify(
      {
        schema_version: 1,
        container_runtime: 'docker',
        max_parallel_tasks: CAP,
        retain_failed_task_worktrees: false,
        max_retained_failed_task_worktrees: 5,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port_range: { min: PORT_MIN, max: PORT_MAX },
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

function readAllocTable(repoRoot: string): Record<string, { port: number; taskId: string; composeProjectName: string }> {
  const tbl = path.join(repoRoot, '.platform-state', 'runtime', 'port-allocations.json');
  if (!existsSync(tbl)) return {};
  return JSON.parse(readFileSync(tbl, 'utf-8')) as Record<string, { port: number; taskId: string; composeProjectName: string }>;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('§7.2 parallel chaos — seeded 30-iteration allocate/release invariant sweep', () => {
  let repoRoot: string;
  const seed = Number.parseInt(process.env['CHAOS_SEED'] ?? '20260418', 10);

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'parallel-chaos-'));
    seedPlatformJson(repoRoot);
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    _clearPlatformConfigCache();
  });

  it(`holds all four invariants across ${ITERATIONS} random ops (seed=${seed})`, async () => {
    const rng = makeLcg(seed);
    // Ground truth: taskId → port. Mirror of on-disk table that the test itself maintains.
    const truth = new Map<string, number>();
    // Operation trace for diagnostic output on failure.
    const trace: string[] = [];

    for (let step = 0; step < ITERATIONS; step++) {
      const taskId = TASK_POOL[rng() % TASK_POOL.length]!;
      const op = rng() & 1 ? 'ALLOC' : 'RELEASE';

      if (op === 'ALLOC') {
        if (truth.has(taskId)) {
          // Idempotent allocate returns the existing port — we still expect it.
          const existingPort = truth.get(taskId)!;
          const got = await allocate(taskId, composeProjectName(taskId), repoRoot);
          expect(got, `step=${step} ALLOC(${taskId}) should return existing port`).toBe(existingPort);
          trace.push(`${step}: ALLOC(${taskId}) → ${got} [re-entry]`);
        } else {
          const port = await allocate(taskId, composeProjectName(taskId), repoRoot);
          truth.set(taskId, port);
          trace.push(`${step}: ALLOC(${taskId}) → ${port}`);
        }
      } else {
        const had = truth.has(taskId);
        await release(taskId, repoRoot);
        truth.delete(taskId);
        trace.push(`${step}: RELEASE(${taskId}) [${had ? 'was-held' : 'no-op'}]`);
      }

      // After every step, verify all four invariants. Diagnostic output on
      // failure includes the seed + trace so the operator can replay.
      const table = readAllocTable(repoRoot);
      const ctx = `step=${step} seed=${seed} trace=[\n${trace.slice(-5).join('\n')}\n]`;

      // I1. Ground truth matches disk.
      expect(
        new Set(Object.keys(table)),
        `I1 (key-set) ${ctx}`,
      ).toEqual(new Set(truth.keys()));
      for (const [id, port] of truth) {
        expect(table[id]?.port, `I1 (port) id=${id} ${ctx}`).toBe(port);
      }

      // I2. Port uniqueness across held entries.
      const heldPorts = Object.values(table).map((r) => r.port);
      expect(
        new Set(heldPorts).size,
        `I2 (uniqueness) ports=${JSON.stringify(heldPorts)} ${ctx}`,
      ).toBe(heldPorts.length);

      // I3. Every held port is in range.
      for (const p of heldPorts) {
        expect(p, `I3 (range) port=${p} ${ctx}`).toBeGreaterThanOrEqual(PORT_MIN);
        expect(p, `I3 (range) port=${p} ${ctx}`).toBeLessThanOrEqual(PORT_MAX);
      }

      // I4. Record integrity: composeProjectName matches derivation.
      for (const [id, rec] of Object.entries(table)) {
        expect(rec.taskId, `I4 (taskId) id=${id} ${ctx}`).toBe(id);
        expect(
          rec.composeProjectName,
          `I4 (composeProjectName) id=${id} ${ctx}`,
        ).toBe(composeProjectName(id));
      }
    }
  });
});
