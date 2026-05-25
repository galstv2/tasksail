import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleActivationKillCheckpoint,
  markKillCleanupAttemptFailed,
  markKillCleanupAttemptStarted,
  observeKillRequest,
  writeKillRequest,
} from '../killTask.js';
import { resolveQueuePaths } from '../paths.js';

function tempRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'tasksail-kill-cleanup-'));
}

async function seedActive(repoRoot: string, taskId: string): Promise<ReturnType<typeof resolveQueuePaths>> {
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

describe('kill cleanup failure markers', () => {
  it('marks cleanup running without calling pipeline cleanup and preserves requestedAt', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    const marker = await writeKillRequest({
      killRequestsDir: paths.killRequestsDir,
      taskId: 'task-a',
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    const started = await markKillCleanupAttemptStarted({
      killRequestsDir: paths.killRequestsDir,
      taskId: 'task-a',
      now: new Date('2026-05-24T00:01:00.000Z'),
    });

    expect(started).toMatchObject({
      taskId: 'task-a',
      requestedAt: marker.record.requestedAt,
      cleanupStatus: 'running',
      cleanupAttemptCount: 1,
      cleanupLastAttemptAt: '2026-05-24T00:01:00.000Z',
    });
    await expect(readFile(marker.markerPath, 'utf-8')).resolves.toContain('"cleanupStatus": "running"');
  });

  it('marks cleanup failed with a bounded single-line message and preserves attempt count', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });
    await markKillCleanupAttemptStarted({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });

    const failed = await markKillCleanupAttemptFailed({
      killRequestsDir: paths.killRequestsDir,
      taskId: 'task-a',
      errorCode: 'failed-item-cleanup-failed',
      error: new Error(`first line\n${'x'.repeat(400)}`),
      now: new Date('2026-05-24T00:02:00.000Z'),
    });

    expect(failed?.cleanupStatus).toBe('failed');
    expect(failed?.cleanupAttemptCount).toBe(1);
    expect(failed?.cleanupLastErrorCode).toBe('failed-item-cleanup-failed');
    expect(failed?.cleanupLastFailedAt).toBe('2026-05-24T00:02:00.000Z');
    expect(failed?.cleanupLastErrorMessage).not.toContain('\n');
    expect(failed?.cleanupLastErrorMessage?.length).toBeLessThanOrEqual(240);
  });

  it('does not create a cleanup failure marker when no valid marker exists', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);

    const failed = await markKillCleanupAttemptFailed({
      killRequestsDir: paths.killRequestsDir,
      taskId: 'task-a',
      errorCode: 'unexpected-cleanup-error',
      error: new Error('boom'),
    });

    expect(failed).toBeNull();
    expect(existsSync(path.join(paths.killRequestsDir, 'task-a.json'))).toBe(false);
  });

  it('records activation cleanup failure metadata before propagating checkpoint errors', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.pendingDir, { recursive: true });
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });

    await expect(handleActivationKillCheckpoint({
      repoRoot,
      paths,
      taskId: 'task-a',
      pendingItemPath: path.join(paths.pendingDir, 'missing-task-a.md'),
      phase: 'post-materialization',
      rollbackBindings: [],
    })).rejects.toThrow();

    await expect(observeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' }))
      .resolves
      .toMatchObject({
        cleanupStatus: 'failed',
        cleanupAttemptCount: 1,
        cleanupLastErrorCode: 'activation-cleanup-failed',
      });
  });

  it('records unproven-stopped metadata and does not move the task to Failed', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActive(repoRoot, 'task-a');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });
    vi.resetModules();
    const stopPipeline = vi.fn(async () => ({ status: 'unproven-stopped' as const }));
    const moveFailedItemToErrorItems = vi.fn();
    vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: () => [{ taskId: 'task-a', pid: 123, startedAt: '2026-05-24T00:00:00.000Z' }],
      stopPipeline,
    }));
    vi.doMock('../errorItems.js', () => ({ moveFailedItemToErrorItems }));
    const { executeRequestedTaskKill } = await import('../killTask.js');

    await expect(executeRequestedTaskKill({ repoRoot, taskId: 'task-a' })).rejects.toThrow('Unable to prove pipeline stopped');

    expect(moveFailedItemToErrorItems).not.toHaveBeenCalled();
    await expect(observeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' }))
      .resolves
      .toMatchObject({ cleanupStatus: 'failed', cleanupAttemptCount: 1, cleanupLastErrorCode: 'unproven-stopped' });
  });

  it('records failed-item-cleanup-failed when canonical failed cleanup throws', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActive(repoRoot, 'task-a');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });
    vi.resetModules();
    vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: () => [{ taskId: 'task-a', pid: 123, startedAt: '2026-05-24T00:00:00.000Z' }],
      stopPipeline: vi.fn(async () => ({ status: 'stopped-forced' as const })),
    }));
    vi.doMock('../errorItems.js', () => ({
      moveFailedItemToErrorItems: vi.fn(async () => {
        throw new Error('registry move failed');
      }),
    }));
    const { executeRequestedTaskKill } = await import('../killTask.js');

    await expect(executeRequestedTaskKill({ repoRoot, taskId: 'task-a' })).rejects.toThrow('registry move failed');

    await expect(observeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' }))
      .resolves
      .toMatchObject({ cleanupStatus: 'failed', cleanupAttemptCount: 1, cleanupLastErrorCode: 'failed-item-cleanup-failed' });
  });
});
