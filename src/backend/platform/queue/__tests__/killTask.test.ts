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
} from '../killTask.js';
import { writeActivationProgress } from '../activationProgress.js';
import { movePendingItemToDropbox } from '../pendingReturnToOpen.js';
import { resolveQueuePaths } from '../paths.js';

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

    const result = await executeRequestedTaskKill({ repoRoot, taskId: 'task-a' });

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
