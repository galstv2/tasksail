/**
 * §6.2B + F35 — per-task runtime-state GC and startup sweep.
 *
 * Covers: gcTaskRuntime sentinel write, opportunistic setTimeout deletion,
 * retain-indefinitely skip, sweepRuntimeGC expired-epoch reclaim.
 *
 * Placed in a separate file from worktreeFinalize.test.ts because the latter
 * is already at the 1000-line ceiling; splitting concerns keeps both files
 * within the size policy.
 *
 * Run: pnpm vitest run src/backend/platform/core/__tests__/worktreeFinalize.gc.test.ts
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

import { gcTaskRuntime, sweepRuntimeGC } from '../worktreeFinalize.js';
import { _clearPlatformConfigCache } from '../../platform-config/get.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writePlatformJson(
  repoRoot: string,
  overrides: Partial<{
    retain_failed_task_worktrees: boolean;
    completed_task_runtime_retention_ms: number;
  }> = {},
): void {
  const platformStateDir = path.join(repoRoot, '.platform-state');
  mkdirSync(platformStateDir, { recursive: true });
  const json = {
    schema_version: 1,
    container_runtime: 'docker',
    max_parallel_tasks: 10,
    retain_failed_task_worktrees: overrides.retain_failed_task_worktrees ?? false,
    max_retained_failed_task_worktrees: 5,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: overrides.completed_task_runtime_retention_ms ?? 3_600_000,
    mcp_port_range: { min: 8811, max: 8820 },
  };
  writeFileSync(
    path.join(platformStateDir, 'platform.json'),
    JSON.stringify(json, null, 2) + '\n',
  );
}

function seedRuntimeTaskDir(repoRoot: string, taskId: string): string {
  const dir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'receipts.log'), 'line1\n', 'utf-8');
  return dir;
}

// ---------------------------------------------------------------------------
// gcTaskRuntime
// ---------------------------------------------------------------------------

describe('§6.2B gcTaskRuntime', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'gc-runtime-'));
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('completed: writes sentinel; in-session timer deletes dir after retention', async () => {
    writePlatformJson(tmpRoot, { completed_task_runtime_retention_ms: 75 });
    const taskId = 'task-complete-01';
    const runtimeDir = seedRuntimeTaskDir(tmpRoot, taskId);

    const beforeTs = Date.now();
    await gcTaskRuntime(taskId, 'completed', tmpRoot);

    // F35: sentinel MUST be written authoritatively before the timer fires.
    const sentinelPath = path.join(runtimeDir, '.gc-after-ts');
    expect(existsSync(sentinelPath)).toBe(true);
    const epoch = Number(readFileSync(sentinelPath, 'utf-8'));
    expect(epoch).toBeGreaterThanOrEqual(beforeTs + 75);
    expect(epoch).toBeLessThanOrEqual(Date.now() + 75);

    // Opportunistic timer deletes the dir inside the retention window.
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it('failed with retain=true: NO sentinel written (retain-indefinitely branch)', async () => {
    writePlatformJson(tmpRoot, {
      retain_failed_task_worktrees: true,
      completed_task_runtime_retention_ms: 50,
    });
    const taskId = 'task-failed-retain-01';
    const runtimeDir = seedRuntimeTaskDir(tmpRoot, taskId);

    await gcTaskRuntime(taskId, 'failed', tmpRoot);

    const sentinelPath = path.join(runtimeDir, '.gc-after-ts');
    expect(existsSync(sentinelPath)).toBe(false);

    // Dir MUST survive — the timer also must not have been scheduled.
    await new Promise((r) => setTimeout(r, 150));
    expect(existsSync(runtimeDir)).toBe(true);
  });

  it('failed with retain=false: writes sentinel and timer deletes dir', async () => {
    writePlatformJson(tmpRoot, {
      retain_failed_task_worktrees: false,
      completed_task_runtime_retention_ms: 75,
    });
    const taskId = 'task-failed-no-retain-01';
    const runtimeDir = seedRuntimeTaskDir(tmpRoot, taskId);

    await gcTaskRuntime(taskId, 'failed', tmpRoot);
    expect(existsSync(path.join(runtimeDir, '.gc-after-ts'))).toBe(true);

    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it('runtime dir absent: silent no-op (idempotent per §6.3B)', async () => {
    writePlatformJson(tmpRoot);
    await expect(gcTaskRuntime('nonexistent-task', 'completed', tmpRoot)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sweepRuntimeGC — restart-side reclaim
// ---------------------------------------------------------------------------

describe('§6.2B sweepRuntimeGC', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'gc-sweep-'));
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('past-epoch sentinel: dir is reclaimed', () => {
    const taskId = 'task-past-01';
    const dir = seedRuntimeTaskDir(tmpRoot, taskId);
    writeFileSync(path.join(dir, '.gc-after-ts'), String(Date.now() - 1000), 'utf-8');

    sweepRuntimeGC(tmpRoot);

    expect(existsSync(dir)).toBe(false);
  });

  it('future-epoch sentinel: dir survives', () => {
    const taskId = 'task-future-01';
    const dir = seedRuntimeTaskDir(tmpRoot, taskId);
    writeFileSync(path.join(dir, '.gc-after-ts'), String(Date.now() + 60_000), 'utf-8');

    sweepRuntimeGC(tmpRoot);

    expect(existsSync(dir)).toBe(true);
  });

  it('missing sentinel: dir survives (retain-indefinitely by design)', () => {
    const taskId = 'task-no-sentinel-01';
    const dir = seedRuntimeTaskDir(tmpRoot, taskId);

    sweepRuntimeGC(tmpRoot);

    expect(existsSync(dir)).toBe(true);
  });

  it('malformed sentinel: skipped (defensive — no accidental early deletion)', () => {
    const taskId = 'task-malformed-01';
    const dir = seedRuntimeTaskDir(tmpRoot, taskId);
    writeFileSync(path.join(dir, '.gc-after-ts'), 'not-a-number', 'utf-8');

    sweepRuntimeGC(tmpRoot);

    expect(existsSync(dir)).toBe(true);
  });

  it('no runtime/tasks dir at all: silent no-op', () => {
    expect(() => sweepRuntimeGC(tmpRoot)).not.toThrow();
  });
});
