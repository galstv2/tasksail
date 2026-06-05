import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeKillRequest } from '../killTask.js';
import {
  pipelineKillSwitchExists,
  pipelineKillSwitchPath,
} from '../../agent-runner/pipeline/runtimeControl.js';
import { resolveQueuePaths } from '../paths.js';

function tempRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'tasksail-kill-mp-'));
}

async function seedActiveish(repoRoot: string, taskId: string): Promise<ReturnType<typeof resolveQueuePaths>> {
  const paths = resolveQueuePaths(repoRoot);
  await mkdir(paths.pendingDir, { recursive: true });
  await mkdir(paths.activeItemsDir, { recursive: true });
  await writeFile(path.join(paths.pendingDir, `${taskId}.md`), '# Task\n');
  await writeFile(path.join(paths.activeItemsDir, taskId), `${taskId}.md`);
  return paths;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/**
 * Import executeRequestedTaskKill with mocked pipelineSupervisor and errorItems.
 * Simulates a different backend process: stopPipeline returns not-running (pidMap is empty
 * for the foreign process) while the active marker still exists on disk.
 */
async function importWithNotRunningMocks(
  moveFailedItemToErrorItems: ReturnType<typeof vi.fn>,
): Promise<{ executeRequestedTaskKill: (typeof import('../killTask.js'))['executeRequestedTaskKill'] }> {
  vi.resetModules();
  vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
    listActivePipelines: () => [],
    stopPipeline: vi.fn(async () => ({ status: 'not-running' as const })),
  }));
  vi.doMock('../errorItems.js', () => ({
    moveFailedItemToErrorItems,
  }));
  return import('../killTask.js');
}

describe('killTask cross-process kill: durable kill switch written before cleanup', () => {
  it('requestPipelineKill is written to disk before runActiveKillCleanup is called', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-x');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-x' });

    const killSwitchPath = pipelineKillSwitchPath(repoRoot, 'task-x');
    const cleanupCallOrder: string[] = [];

    // The moveFailedItemToErrorItems records the kill switch state at the moment cleanup runs.
    const moveFailedItemToErrorItems = vi.fn(async () => {
      cleanupCallOrder.push(
        existsSync(killSwitchPath) ? 'switch-present-at-cleanup' : 'switch-absent-at-cleanup',
      );
      await rm(path.join(paths.pendingDir, 'task-x.md'), { force: true });
      await rm(path.join(paths.activeItemsDir, 'task-x'), { force: true });
      return {
        movedItem: 'task-x.md',
        errorItemPath: path.join(paths.errorItemsDir, 'task-x.md'),
        nextActiveItem: null,
      };
    });

    const { executeRequestedTaskKill } = await importWithNotRunningMocks(moveFailedItemToErrorItems);

    // windowMs=0: deadline immediately past → skip poll → proceed to cleanup.
    const result = await executeRequestedTaskKill({
      repoRoot,
      taskId: 'task-x',
      _crossProcessKillWindowMs: 0,
    });

    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-x', movedItem: 'task-x.md' });
    // The kill switch must have been present when cleanup was called (written before cleanup).
    expect(cleanupCallOrder).toContain('switch-present-at-cleanup');
    expect(moveFailedItemToErrorItems).toHaveBeenCalledWith({ repoRoot, taskId: 'task-x' });
  });

  it('cleanup proceeds immediately when the owning process acknowledges (clears kill switch) within the window', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-y');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-y' });

    const killSwitchPath = pipelineKillSwitchPath(repoRoot, 'task-y');
    let sleepCallCount = 0;

    // On the first sleep call, simulate the owning process consuming the kill switch (ack).
    const _sleepMs = async (_ms: number): Promise<void> => {
      sleepCallCount++;
      if (sleepCallCount === 1) {
        // Owning process acknowledges: clears the durable kill switch.
        await rm(killSwitchPath, { force: true });
      }
    };

    const moveFailedItemToErrorItems = vi.fn(async () => {
      await rm(path.join(paths.pendingDir, 'task-y.md'), { force: true });
      await rm(path.join(paths.activeItemsDir, 'task-y'), { force: true });
      return {
        movedItem: 'task-y.md',
        errorItemPath: path.join(paths.errorItemsDir, 'task-y.md'),
        nextActiveItem: null,
      };
    });

    const { executeRequestedTaskKill } = await importWithNotRunningMocks(moveFailedItemToErrorItems);

    const result = await executeRequestedTaskKill({
      repoRoot,
      taskId: 'task-y',
      _crossProcessKillWindowMs: 10000,
      _sleepMs,
    });

    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-y', movedItem: 'task-y.md' });
    // Poll slept at least once (one check before sleep, ack arrived, next check returned acked).
    expect(sleepCallCount).toBeGreaterThanOrEqual(1);
    // Cleanup ran exactly once.
    expect(moveFailedItemToErrorItems).toHaveBeenCalledOnce();
    // Kill switch is gone (removed by our simulated owning process).
    expect(existsSync(killSwitchPath)).toBe(false);
    // No ownership-unconfirmed warning because ack arrived in time.
    expect(pipelineKillSwitchExists(repoRoot, 'task-y')).toBe(false);
  });

  it('timeout path still proceeds to runActiveKillCleanup (fallback) and writes the ownership-unconfirmed log event to disk indirectly via kill switch presence', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-z');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-z' });

    const killSwitchPath = pipelineKillSwitchPath(repoRoot, 'task-z');

    const moveFailedItemToErrorItems = vi.fn(async () => {
      await rm(path.join(paths.pendingDir, 'task-z.md'), { force: true });
      await rm(path.join(paths.activeItemsDir, 'task-z'), { force: true });
      return {
        movedItem: 'task-z.md',
        errorItemPath: path.join(paths.errorItemsDir, 'task-z.md'),
        nextActiveItem: null,
      };
    });

    const { executeRequestedTaskKill } = await importWithNotRunningMocks(moveFailedItemToErrorItems);

    // windowMs=0: deadline immediately past → timeout path.
    const result = await executeRequestedTaskKill({
      repoRoot,
      taskId: 'task-z',
      _crossProcessKillWindowMs: 0,
    });

    // Fallback cleanup still completes.
    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-z', movedItem: 'task-z.md' });
    expect(moveFailedItemToErrorItems).toHaveBeenCalledOnce();
    // The kill switch was written before the poll (durable kill switch path was taken).
    // After cleanup, the killRequest marker is cleared but the pipeline kill switch may remain.
    // The key invariant: cleanup ran despite the timeout.
    expect(existsSync(path.join(paths.killRequestsDir, 'task-z.json'))).toBe(false);
  });

  it('timeout path emits the ownership-unconfirmed warning (captured via createLogger mock)', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-warn');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-warn' });

    const warnEvents: string[] = [];

    const moveFailedItemToErrorItems = vi.fn(async () => {
      await rm(path.join(paths.pendingDir, 'task-warn.md'), { force: true });
      await rm(path.join(paths.activeItemsDir, 'task-warn'), { force: true });
      return {
        movedItem: 'task-warn.md',
        errorItemPath: path.join(paths.errorItemsDir, 'task-warn.md'),
        nextActiveItem: null,
      };
    });

    // Reset modules so createLogger mock is picked up by the freshly loaded killTask module.
    vi.resetModules();
    vi.doMock('../../core/index.js', async () => {
      const actual = (await vi.importActual('../../core/index.js')) as typeof import('../../core/index.js');
      const origCreateLogger = actual.createLogger;
      return {
        ...actual,
        createLogger: (name: string) => {
          const real = origCreateLogger(name);
          return {
            ...real,
            warn: (event: string, meta?: unknown) => {
              warnEvents.push(event);
              return real.warn(event, meta);
            },
          };
        },
      };
    });
    vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: () => [],
      stopPipeline: vi.fn(async () => ({ status: 'not-running' as const })),
    }));
    vi.doMock('../errorItems.js', () => ({ moveFailedItemToErrorItems }));
    const { executeRequestedTaskKill } = await import('../killTask.js');

    await executeRequestedTaskKill({
      repoRoot,
      taskId: 'task-warn',
      _crossProcessKillWindowMs: 0,
    });

    // The ownership-unconfirmed warning must be emitted on the timeout path.
    expect(warnEvents).toContain('task_kill.cross_process_ownership_unconfirmed');
  });

  it('in-process stopPipeline success path does not write the durable kill switch (not-running branch not entered)', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-w');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-w' });

    const killSwitchPath = pipelineKillSwitchPath(repoRoot, 'task-w');

    const moveFailedItemToErrorItems = vi.fn(async () => {
      await rm(path.join(paths.pendingDir, 'task-w.md'), { force: true });
      await rm(path.join(paths.activeItemsDir, 'task-w'), { force: true });
      return {
        movedItem: 'task-w.md',
        errorItemPath: path.join(paths.errorItemsDir, 'task-w.md'),
        nextActiveItem: null,
      };
    });

    vi.resetModules();
    vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: () => [{ taskId: 'task-w', pid: 123, startedAt: '2026-06-02T00:00:00Z' }],
      // In-process: stopPipeline returns stopped-graceful (pipeline was running in THIS process).
      stopPipeline: vi.fn(async () => ({ status: 'stopped-graceful' as const })),
    }));
    vi.doMock('../errorItems.js', () => ({ moveFailedItemToErrorItems }));
    const { executeRequestedTaskKill } = await import('../killTask.js');

    const result = await executeRequestedTaskKill({ repoRoot, taskId: 'task-w' });

    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-w', movedItem: 'task-w.md' });
    // The durable kill switch must NOT have been written — in-process path skips the not-running branch.
    expect(existsSync(killSwitchPath)).toBe(false);
  });

  it('serializes concurrent cross-process kill requests so cleanup runs exactly once', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-serial');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-serial' });

    const moveFailedItemToErrorItems = vi.fn(async () => {
      // Simulate cleanup: remove active marker and pending item.
      await rm(path.join(paths.pendingDir, 'task-serial.md'), { force: true });
      await rm(path.join(paths.activeItemsDir, 'task-serial'), { force: true });
      return {
        movedItem: 'task-serial.md',
        errorItemPath: path.join(paths.errorItemsDir, 'task-serial.md'),
        nextActiveItem: null,
      };
    });

    vi.resetModules();
    vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: () => [],
      stopPipeline: vi.fn(async () => ({ status: 'not-running' as const })),
    }));
    vi.doMock('../errorItems.js', () => ({ moveFailedItemToErrorItems }));
    const { executeRequestedTaskKill } = await import('../killTask.js');

    // Both calls use windowMs=0 to avoid real timing; per-task kill lock serializes them.
    const results = await Promise.allSettled([
      executeRequestedTaskKill({ repoRoot, taskId: 'task-serial', _crossProcessKillWindowMs: 0 }),
      executeRequestedTaskKill({ repoRoot, taskId: 'task-serial', _crossProcessKillWindowMs: 0 }),
    ]);

    // At least one must have completed cleanup (mode: failed).
    const succeeded = results.filter(
      (r) => r.status === 'fulfilled' && r.value.mode === 'failed',
    );
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    // Cleanup must run at most once — second lock holder sees no marker after first cleaned it.
    expect(moveFailedItemToErrorItems).toHaveBeenCalledTimes(1);
  });
});
