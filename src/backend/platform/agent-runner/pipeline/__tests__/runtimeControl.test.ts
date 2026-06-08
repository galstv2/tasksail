import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  pipelineKillSwitchPath,
  pipelineKillSwitchExists,
  readPipelineKillRequest,
  requestPipelineKill,
  clearPipelineKill,
  getAllActiveKillSwitches,
} from '../runtimeControl.js';

// Simulate acquirePipelineLock via mkdir (the same primitive sequencer.ts uses).
async function acquireLock(taskRuntime: string): Promise<{ release: () => Promise<void> }> {
  const { mkdir, rm } = await import('node:fs/promises');
  const lockDir = path.join(taskRuntime, 'pipeline.lock');
  await mkdir(lockDir, { recursive: false });
  return {
    release: async () => {
      await rm(lockDir, { recursive: true, force: true });
    },
  };
}

describe('runtimeControl — per-task kill-switch', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'runtime-ctrl-'));
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('pipelineKillSwitchPath routes under per-task directory', () => {
    const p = pipelineKillSwitchPath(repoRoot, 'task-A');
    expect(p).toBe(
      path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A', 'pipeline-kill-switch.json'),
    );
  });

  it('pipelineKillSwitchExists returns false when no kill file present', () => {
    expect(pipelineKillSwitchExists(repoRoot, 'task-A')).toBe(false);
  });

  it('requestPipelineKill writes the kill-switch file to the per-task directory', async () => {
    await requestPipelineKill(repoRoot, 'task-B', 'test-reason');
    expect(pipelineKillSwitchExists(repoRoot, 'task-B')).toBe(true);
    const record = await readPipelineKillRequest(repoRoot, 'task-B');
    expect(record).toBeDefined();
    expect(record!.reason).toBe('test-reason');
  });

  it('clearPipelineKill removes the per-task kill-switch and returns true', async () => {
    await requestPipelineKill(repoRoot, 'task-C', 'clear-me');
    const cleared = await clearPipelineKill(repoRoot, 'task-C');
    expect(cleared).toBe(true);
    expect(pipelineKillSwitchExists(repoRoot, 'task-C')).toBe(false);
  });

  it('clearPipelineKill returns false when no kill-switch file exists', async () => {
    const cleared = await clearPipelineKill(repoRoot, 'task-D');
    expect(cleared).toBe(false);
  });

  it('Task A kill-switch does NOT trigger for Task B (cross-task isolation)', async () => {
    await requestPipelineKill(repoRoot, 'task-A', 'kill-A');

    // Task B should not see Task A's kill-switch.
    expect(pipelineKillSwitchExists(repoRoot, 'task-B')).toBe(false);
    const recordB = await readPipelineKillRequest(repoRoot, 'task-B');
    expect(recordB).toBeUndefined();
  });

  it('two concurrent requestPipelineKill calls for different taskIds both succeed independently', async () => {
    await Promise.all([
      requestPipelineKill(repoRoot, 'task-X', 'reason-X'),
      requestPipelineKill(repoRoot, 'task-Y', 'reason-Y'),
    ]);

    const recordX = await readPipelineKillRequest(repoRoot, 'task-X');
    const recordY = await readPipelineKillRequest(repoRoot, 'task-Y');

    expect(recordX?.reason).toBe('reason-X');
    expect(recordY?.reason).toBe('reason-Y');

    // Each file is isolated.
    expect(pipelineKillSwitchPath(repoRoot, 'task-X')).not.toBe(
      pipelineKillSwitchPath(repoRoot, 'task-Y'),
    );
  });
});

describe('runtimeControl — pipeline lock (per-task isolation)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'runtime-lock-'));
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('two concurrent acquirePipelineLock calls with different taskIds both succeed (independent locks)', async () => {
    const taskRuntimeA = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');
    const taskRuntimeB = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-B');
    mkdirSync(taskRuntimeA, { recursive: true });
    mkdirSync(taskRuntimeB, { recursive: true });

    // Both acquisitions must succeed concurrently — no serialization expected across tasks.
    const [lockA, lockB] = await Promise.all([
      acquireLock(taskRuntimeA),
      acquireLock(taskRuntimeB),
    ]);

    expect(existsSync(path.join(taskRuntimeA, 'pipeline.lock'))).toBe(true);
    expect(existsSync(path.join(taskRuntimeB, 'pipeline.lock'))).toBe(true);

    await lockA.release();
    await lockB.release();

    expect(existsSync(path.join(taskRuntimeA, 'pipeline.lock'))).toBe(false);
    expect(existsSync(path.join(taskRuntimeB, 'pipeline.lock'))).toBe(false);
  });

  it('same taskId serializes — second acquisition fails when lock is held', async () => {
    const taskRuntime = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-serial');
    mkdirSync(taskRuntime, { recursive: true });

    const lock1 = await acquireLock(taskRuntime);

    // Second acquisition on same taskRuntime must fail (EEXIST).
    await expect(acquireLock(taskRuntime)).rejects.toThrow();

    await lock1.release();

    // After release, acquisition succeeds again.
    const lock2 = await acquireLock(taskRuntime);
    expect(existsSync(path.join(taskRuntime, 'pipeline.lock'))).toBe(true);
    await lock2.release();
  });
});

describe('runtimeControl — getAllActiveKillSwitches', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'runtime-all-ks-'));
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it.each([
    ['no tasks directory exists', true],
    ['tasks directory exists but no kill switches', false],
  ] as const)('returns empty map when %s', async (_label, removeDir) => {
    if (removeDir) {
      rmSync(path.join(repoRoot, '.platform-state'), { recursive: true, force: true });
    }
    const result = await getAllActiveKillSwitches(repoRoot);
    expect(result.size).toBe(0);
  });

  it('enumerates kill switches for multiple tasks correctly', async () => {
    await requestPipelineKill(repoRoot, 'task-P', 'reason-P');
    await requestPipelineKill(repoRoot, 'task-Q', 'reason-Q');

    const result = await getAllActiveKillSwitches(repoRoot);

    expect(result.size).toBe(2);
    expect(result.get('task-P')?.reason).toBe('reason-P');
    expect(result.get('task-Q')?.reason).toBe('reason-Q');
  });

  it('excludes tasks with no kill-switch file', async () => {
    // Create a task directory with no kill-switch.
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-no-kill'), { recursive: true });
    await requestPipelineKill(repoRoot, 'task-with-kill', 'active');

    const result = await getAllActiveKillSwitches(repoRoot);

    expect(result.has('task-no-kill')).toBe(false);
    expect(result.get('task-with-kill')?.reason).toBe('active');
    expect(result.size).toBe(1);
  });

  it('cleared kill-switch is no longer enumerated', async () => {
    await requestPipelineKill(repoRoot, 'task-R', 'reason-R');
    await requestPipelineKill(repoRoot, 'task-S', 'reason-S');
    await clearPipelineKill(repoRoot, 'task-R');

    const result = await getAllActiveKillSwitches(repoRoot);

    expect(result.has('task-R')).toBe(false);
    expect(result.get('task-S')?.reason).toBe('reason-S');
    expect(result.size).toBe(1);
  });
});
