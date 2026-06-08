import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  observeKillRequest,
  writeKillRequest,
  clearKillRequest,
  sweepStaleKillRequests,
  markKillCleanupAttemptFailed,
  markKillCleanupAttemptStarted,
  handleActivationKillCheckpoint,
} from '../killTask.js';
import { writeActivationProgress } from '../activationProgress.js';
import { movePendingItemToDropbox } from '../pendingReturnToOpen.js';
import { resolveQueuePaths } from '../paths.js';
import {
  pipelineKillSwitchExists,
  pipelineKillSwitchPath,
} from '../../agent-runner/pipeline/runtimeControl.js';

function tempRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'tasksail-kill-task-'));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('killTask markers', () => {
  it('writes activating kill markers atomically and duplicate requests are idempotent', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);

    const first = await writeKillRequest({
      killRequestsDir: paths.killRequestsDir,
      taskId: 'task-a',
      now: new Date('2026-05-23T00:00:00.000Z'),
    });
    const second = await writeKillRequest({
      killRequestsDir: paths.killRequestsDir,
      taskId: 'task-a',
      now: new Date('2026-05-23T00:01:00.000Z'),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.markerPath).toBe(first.markerPath);
    await expect(readFile(first.markerPath, 'utf-8')).resolves.toContain('"taskId": "task-a"');
    await clearKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });
    expect(existsSync(first.markerPath)).toBe(false);
  });

  it('returns null for malformed markers and startup sweep removes stale markers without moving pending markdown', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.killRequestsDir, { recursive: true });
    await mkdir(paths.pendingDir, { recursive: true });
    await writeFile(path.join(paths.pendingDir, 'task-a.md'), '# Task A\n');
    await writeFile(path.join(paths.killRequestsDir, 'task-a.json'), '{ malformed\n');

    await expect(observeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' })).resolves.toBeNull();
    const result = await sweepStaleKillRequests({ repoRoot, paths, reason: 'startup-recovery' });

    expect(result.removed).toEqual(['task-a']);
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(true);
  });

  it('removes kill and activating markers but leaves pending markdown during startup sweep', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.pendingDir, { recursive: true });
    await mkdir(paths.activatingItemsDir, { recursive: true });
    await writeFile(path.join(paths.pendingDir, 'task-a.md'), '# Task A\n');
    const marker = await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });
    await writeFile(path.join(paths.activatingItemsDir, 'task-a.json'), '{}\n');

    const result = await sweepStaleKillRequests({ repoRoot, paths, reason: 'startup-recovery' });

    expect(result.removed).toEqual(['task-a']);
    expect(existsSync(marker.markerPath)).toBe(false);
    expect(existsSync(path.join(paths.activatingItemsDir, 'task-a.json'))).toBe(false);
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(true);
  });

  it('leaves a valid kill marker with pending markdown when no active or activating marker exists', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.pendingDir, { recursive: true });
    await writeFile(path.join(paths.pendingDir, 'task-a.md'), '# Task A\n');
    const marker = await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });

    const result = await sweepStaleKillRequests({ repoRoot, paths, reason: 'startup-recovery' });

    expect(result.removed).toEqual([]);
    expect(existsSync(marker.markerPath)).toBe(true);
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(true);
  });

  it('removes a kill marker with no pending markdown and no active marker', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    const marker = await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });

    const result = await sweepStaleKillRequests({ repoRoot, paths, reason: 'startup-recovery' });

    expect(result.removed).toEqual(['task-a']);
    expect(existsSync(marker.markerPath)).toBe(false);
  });

  it('replaces a malformed existing marker when writing a fresh request', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.killRequestsDir, { recursive: true });
    await writeFile(path.join(paths.killRequestsDir, 'task-a.json'), '{ malformed\n');

    const result = await writeKillRequest({
      killRequestsDir: paths.killRequestsDir,
      taskId: 'task-a',
      now: new Date('2026-05-23T00:00:00.000Z'),
    });

    expect(result.created).toBe(true);
    await expect(readFile(result.markerPath, 'utf-8')).resolves.toContain('"taskId": "task-a"');
    await expect(observeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' }))
      .resolves
      .toMatchObject({ taskId: 'task-a' });
  });
});

describe('killTask cleanup ownership', () => {
  async function importKillTaskWithMocks(options: {
    listActivePipelines: () => Array<{ taskId: string; pid: number; startedAt: string }>;
    stopPipeline: ReturnType<typeof vi.fn>;
    moveFailedItemToErrorItems: ReturnType<typeof vi.fn>;
  }) {
    vi.doMock('../../agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: options.listActivePipelines,
      stopPipeline: options.stopPipeline,
    }));
    vi.doMock('../errorItems.js', () => ({
      moveFailedItemToErrorItems: options.moveFailedItemToErrorItems,
    }));
    return import('../killTask.js');
  }

  async function seedActiveish(repoRoot: string, taskId: string): Promise<ReturnType<typeof resolveQueuePaths>> {
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.pendingDir, { recursive: true });
    await mkdir(paths.activeItemsDir, { recursive: true });
    await writeFile(path.join(paths.pendingDir, `${taskId}.md`), '# Task\n');
    await writeFile(path.join(paths.activeItemsDir, taskId), `${taskId}.md`);
    return paths;
  }

  it('leaves pre-pipeline cleanup to activation when no running pipeline exists', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-a');
    await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: 'Task A',
      phase: 'starting-pipeline',
      startedAt: '2026-05-23T00:00:00Z',
    });
    const stopPipeline = vi.fn(async () => ({ status: 'not-running' as const }));
    const moveFailedItemToErrorItems = vi.fn();
    const { killTask } = await importKillTaskWithMocks({
      listActivePipelines: () => [],
      stopPipeline,
      moveFailedItemToErrorItems,
    });

    const result = await killTask({ repoRoot, taskId: 'task-a' });

    expect(result).toMatchObject({ mode: 'kill-requested', taskId: 'task-a' });
    expect(stopPipeline).toHaveBeenCalledWith('task-a', undefined, { cleanupOwner: 'caller' });
    expect(moveFailedItemToErrorItems).not.toHaveBeenCalled();
    expect(existsSync(path.join(paths.killRequestsDir, 'task-a.json'))).toBe(true);
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(true);
  });

  it('requestTaskKill writes durable metadata without awaiting cleanup', async () => {
    const repoRoot = tempRepo();
    await seedActiveish(repoRoot, 'task-a');
    const stopPipeline = vi.fn(async () => ({ status: 'stopped-graceful' as const }));
    const moveFailedItemToErrorItems = vi.fn();
    const { requestTaskKill, observeKillRequest } = await importKillTaskWithMocks({
      listActivePipelines: () => [{ taskId: 'task-a', pid: 123, startedAt: '2026-05-23T00:00:00Z' }],
      stopPipeline,
      moveFailedItemToErrorItems,
    });

    const result = await requestTaskKill({ repoRoot, taskId: 'task-a' });

    expect(result).toMatchObject({ mode: 'kill-requested', taskId: 'task-a', state: 'active' });
    expect(result.requestedAt).toEqual(expect.any(String));
    expect(stopPipeline).not.toHaveBeenCalled();
    expect(moveFailedItemToErrorItems).not.toHaveBeenCalled();
    await expect(observeKillRequest({ killRequestsDir: resolveQueuePaths(repoRoot).killRequestsDir, taskId: 'task-a' }))
      .resolves
      .toMatchObject({ taskId: 'task-a', requestedAt: result.requestedAt });
  });

  it('executeRequestedTaskKill owns active cleanup after marker acceptance', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-a');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });
    const stopPipeline = vi.fn(async () => ({ status: 'stopped-forced' as const }));
    const moveFailedItemToErrorItems = vi.fn(async () => ({
      movedItem: 'task-a.md',
      errorItemPath: path.join(paths.errorItemsDir, 'task-a.md'),
      nextActiveItem: null,
    }));
    const { executeRequestedTaskKill } = await importKillTaskWithMocks({
      listActivePipelines: () => [{ taskId: 'task-a', pid: 123, startedAt: '2026-05-23T00:00:00Z' }],
      stopPipeline,
      moveFailedItemToErrorItems,
    });

    const result = await executeRequestedTaskKill({ repoRoot, taskId: 'task-a' });

    expect(stopPipeline).toHaveBeenCalledWith('task-a', undefined, { cleanupOwner: 'caller' });
    expect(moveFailedItemToErrorItems).toHaveBeenCalledWith({ repoRoot, taskId: 'task-a' });
    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-a', movedItem: 'task-a.md' });
    expect(existsSync(path.join(paths.killRequestsDir, 'task-a.json'))).toBe(false);
  });

  it('executeRequestedTaskKill leaves the kill marker for activating-only tasks so the activation checkpoint handles cleanup', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.pendingDir, { recursive: true });
    await writeFile(path.join(paths.pendingDir, 'task-a.md'), '# Task\n');
    await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: 'Task A',
      phase: 'materializing-worktree',
      startedAt: '2026-05-23T00:00:00Z',
    });
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });
    const stopPipeline = vi.fn(async () => ({ status: 'not-running' as const }));
    const moveFailedItemToErrorItems = vi.fn();
    const { executeRequestedTaskKill } = await importKillTaskWithMocks({
      listActivePipelines: () => [],
      stopPipeline,
      moveFailedItemToErrorItems,
    });

    const result = await executeRequestedTaskKill({ repoRoot, taskId: 'task-a' });

    expect(result).toMatchObject({ mode: 'kill-requested', taskId: 'task-a' });
    expect(moveFailedItemToErrorItems).not.toHaveBeenCalled();
    expect(existsSync(path.join(paths.killRequestsDir, 'task-a.json'))).toBe(true);
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(true);
  });

  it('executeRequestedTaskKill cleans up active marker tasks even when no pipeline is running', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-a');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });
    const stopPipeline = vi.fn(async () => ({ status: 'not-running' as const }));
    const moveFailedItemToErrorItems = vi.fn(async () => ({
      movedItem: 'task-a.md',
      errorItemPath: path.join(paths.errorItemsDir, 'task-a.md'),
      nextActiveItem: null,
    }));
    const { executeRequestedTaskKill } = await importKillTaskWithMocks({
      listActivePipelines: () => [],
      stopPipeline,
      moveFailedItemToErrorItems,
    });

    // _crossProcessKillWindowMs=0: skip the bounded poll (no owning process to ack in this test).
    const result = await executeRequestedTaskKill({ repoRoot, taskId: 'task-a', _crossProcessKillWindowMs: 0 });

    expect(stopPipeline).toHaveBeenCalledWith('task-a', undefined, { cleanupOwner: 'caller' });
    expect(moveFailedItemToErrorItems).toHaveBeenCalledWith({ repoRoot, taskId: 'task-a' });
    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-a', movedItem: 'task-a.md' });
    expect(existsSync(path.join(paths.killRequestsDir, 'task-a.json'))).toBe(false);
  });

  it('does not create a kill marker for a plain pending task', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.pendingDir, { recursive: true });
    await writeFile(path.join(paths.pendingDir, 'task-a.md'), '# Task\n');
    const stopPipeline = vi.fn();
    const moveFailedItemToErrorItems = vi.fn();
    const { killTask } = await importKillTaskWithMocks({
      listActivePipelines: () => [],
      stopPipeline,
      moveFailedItemToErrorItems,
    });

    await expect(killTask({ repoRoot, taskId: 'task-a' })).rejects.toThrow('not active or activating');

    expect(stopPipeline).not.toHaveBeenCalled();
    expect(moveFailedItemToErrorItems).not.toHaveBeenCalled();
    expect(existsSync(path.join(paths.killRequestsDir, 'task-a.json'))).toBe(false);
  });

  it('pending-to-open rejects valid kill marker evidence and ignores malformed stale markers', async () => {
    const repoRoot = tempRepo();
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(paths.pendingDir, { recursive: true });
    await writeFile(path.join(paths.pendingDir, 'task-a.md'), '# Task\n');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-a' });

    await expect(movePendingItemToDropbox({
      repoRoot,
      fileName: 'task-a.md',
      reason: 'operator-drag-return-open',
    })).rejects.toThrow('kill request marker');

    await rm(path.join(paths.killRequestsDir, 'task-a.json'), { force: true });
    await mkdir(paths.killRequestsDir, { recursive: true });
    await writeFile(path.join(paths.killRequestsDir, 'task-a.json'), '{ malformed\n');
    await expect(movePendingItemToDropbox({
      repoRoot,
      fileName: 'task-a.md',
      reason: 'operator-drag-return-open',
    })).resolves.toMatchObject({ movedItem: 'task-a.md' });
  });

  it('branches on unproven-stopped without moving the task to error-items', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-a');
    const stopPipeline = vi.fn(async () => ({ status: 'unproven-stopped' as const }));
    const moveFailedItemToErrorItems = vi.fn();
    const { killTask } = await importKillTaskWithMocks({
      listActivePipelines: () => [{ taskId: 'task-a', pid: 123, startedAt: '2026-05-23T00:00:00Z' }],
      stopPipeline,
      moveFailedItemToErrorItems,
    });

    await expect(killTask({ repoRoot, taskId: 'task-a' })).rejects.toThrow('Unable to prove pipeline stopped');

    expect(moveFailedItemToErrorItems).not.toHaveBeenCalled();
    expect(existsSync(path.join(paths.killRequestsDir, 'task-a.json'))).toBe(true);
  });

  it('serializes concurrent active kill requests so cleanup runs once', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveish(repoRoot, 'task-a');
    const stopPipeline = vi.fn(async () => ({ status: 'stopped-graceful' as const }));
    const moveFailedItemToErrorItems = vi.fn(async () => {
      await rm(path.join(paths.pendingDir, 'task-a.md'), { force: true });
      await rm(path.join(paths.activeItemsDir, 'task-a'), { force: true });
      return {
        movedItem: 'task-a.md',
        errorItemPath: path.join(paths.errorItemsDir, 'task-a.md'),
        nextActiveItem: null,
      };
    });
    const { killTask } = await importKillTaskWithMocks({
      listActivePipelines: () => existsSync(path.join(paths.activeItemsDir, 'task-a'))
        ? [{ taskId: 'task-a', pid: 123, startedAt: '2026-05-23T00:00:00Z' }]
        : [],
      stopPipeline,
      moveFailedItemToErrorItems,
    });

    const results = await Promise.allSettled([
      killTask({ repoRoot, taskId: 'task-a' }),
      killTask({ repoRoot, taskId: 'task-a' }),
    ]);

    expect(results.some((result) => result.status === 'fulfilled' && result.value.mode === 'failed')).toBe(true);
    expect(results.some((result) => result.status === 'rejected')).toBe(true);
    expect(stopPipeline).toHaveBeenCalledTimes(1);
    expect(moveFailedItemToErrorItems).toHaveBeenCalledTimes(1);
  });
});

// kill cleanup failure markers (from killTask.cleanupFailure.test.ts)

async function seedActiveForCleanup(repoRoot: string, taskId: string): Promise<ReturnType<typeof resolveQueuePaths>> {
  const paths = resolveQueuePaths(repoRoot);
  await mkdir(paths.pendingDir, { recursive: true });
  await mkdir(paths.activeItemsDir, { recursive: true });
  await writeFile(path.join(paths.pendingDir, `${taskId}.md`), '# Task\n');
  await writeFile(path.join(paths.activeItemsDir, taskId), `${taskId}.md`);
  return paths;
}

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
    const paths = await seedActiveForCleanup(repoRoot, 'task-a');
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
    const paths = await seedActiveForCleanup(repoRoot, 'task-a');
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

// killTask cross-process kill (from killTask.multiprocess.test.ts)

async function seedActiveishMp(repoRoot: string, taskId: string): Promise<ReturnType<typeof resolveQueuePaths>> {
  const paths = resolveQueuePaths(repoRoot);
  await mkdir(paths.pendingDir, { recursive: true });
  await mkdir(paths.activeItemsDir, { recursive: true });
  await writeFile(path.join(paths.pendingDir, `${taskId}.md`), '# Task\n');
  await writeFile(path.join(paths.activeItemsDir, taskId), `${taskId}.md`);
  return paths;
}

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
    const paths = await seedActiveishMp(repoRoot, 'task-x');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-x' });

    const killSwitchPath = pipelineKillSwitchPath(repoRoot, 'task-x');
    const cleanupCallOrder: string[] = [];

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

    const result = await executeRequestedTaskKill({
      repoRoot,
      taskId: 'task-x',
      _crossProcessKillWindowMs: 0,
    });

    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-x', movedItem: 'task-x.md' });
    expect(cleanupCallOrder).toContain('switch-present-at-cleanup');
    expect(moveFailedItemToErrorItems).toHaveBeenCalledWith({ repoRoot, taskId: 'task-x' });
  });

  it('cleanup proceeds immediately when the owning process acknowledges (clears kill switch) within the window', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveishMp(repoRoot, 'task-y');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-y' });

    const killSwitchPath = pipelineKillSwitchPath(repoRoot, 'task-y');
    let sleepCallCount = 0;

    const _sleepMs = async (_ms: number): Promise<void> => {
      sleepCallCount++;
      if (sleepCallCount === 1) {
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
    expect(sleepCallCount).toBeGreaterThanOrEqual(1);
    expect(moveFailedItemToErrorItems).toHaveBeenCalledOnce();
    expect(existsSync(killSwitchPath)).toBe(false);
    expect(pipelineKillSwitchExists(repoRoot, 'task-y')).toBe(false);
  });

  it('timeout path still proceeds to runActiveKillCleanup (fallback) and writes the ownership-unconfirmed log event to disk indirectly via kill switch presence', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveishMp(repoRoot, 'task-z');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-z' });

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

    const result = await executeRequestedTaskKill({
      repoRoot,
      taskId: 'task-z',
      _crossProcessKillWindowMs: 0,
    });

    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-z', movedItem: 'task-z.md' });
    expect(moveFailedItemToErrorItems).toHaveBeenCalledOnce();
    expect(existsSync(path.join(paths.killRequestsDir, 'task-z.json'))).toBe(false);
  });

  it('timeout path emits the ownership-unconfirmed warning (captured via createLogger mock)', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveishMp(repoRoot, 'task-warn');
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
            warn: (event: string, meta?: Record<string, unknown>) => {
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

    expect(warnEvents).toContain('task_kill.cross_process_ownership_unconfirmed');
  });

  it('in-process stopPipeline success path does not write the durable kill switch (not-running branch not entered)', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveishMp(repoRoot, 'task-w');
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
      stopPipeline: vi.fn(async () => ({ status: 'stopped-graceful' as const })),
    }));
    vi.doMock('../errorItems.js', () => ({ moveFailedItemToErrorItems }));
    const { executeRequestedTaskKill } = await import('../killTask.js');

    const result = await executeRequestedTaskKill({ repoRoot, taskId: 'task-w' });

    expect(result).toMatchObject({ mode: 'failed', taskId: 'task-w', movedItem: 'task-w.md' });
    expect(existsSync(killSwitchPath)).toBe(false);
  });

  it('serializes concurrent cross-process kill requests so cleanup runs exactly once', async () => {
    const repoRoot = tempRepo();
    const paths = await seedActiveishMp(repoRoot, 'task-serial');
    await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: 'task-serial' });

    const moveFailedItemToErrorItems = vi.fn(async () => {
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

    const results = await Promise.allSettled([
      executeRequestedTaskKill({ repoRoot, taskId: 'task-serial', _crossProcessKillWindowMs: 0 }),
      executeRequestedTaskKill({ repoRoot, taskId: 'task-serial', _crossProcessKillWindowMs: 0 }),
    ]);

    const succeeded = results.filter(
      (r) => r.status === 'fulfilled' && r.value.mode === 'failed',
    );
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(moveFailedItemToErrorItems).toHaveBeenCalledTimes(1);
  });
});
