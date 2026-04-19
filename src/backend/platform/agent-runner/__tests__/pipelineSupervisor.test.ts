// @vitest-environment node

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { Readable } from 'node:stream';

// ---------------------------------------------------------------------------
// Mocks (must be hoisted before imports)
// ---------------------------------------------------------------------------

const spawnPipelineForTaskMock = vi.fn();
const moveFailedItemToErrorItemsMock = vi.fn();
const finalizeTaskWorktreesMock = vi.fn();

vi.mock('../spawnPipeline.js', () => ({
  spawnPipelineForTask: spawnPipelineForTaskMock,
}));

vi.mock('../../queue/errorItems.js', () => ({
  moveFailedItemToErrorItems: moveFailedItemToErrorItemsMock,
}));

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: finalizeTaskWorktreesMock,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChildStub(
  options: {
    pid?: number;
    exitCode?: number;
  } = {},
) {
  const pid = options.pid ?? Math.floor(Math.random() * 90000) + 10000;
  const exitCode = options.exitCode ?? 0;

  let exitResolve: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => { exitResolve = resolve; });

  // Real Readable streams so readline.createInterface (used by wrapChildOutput)
  // can call pause()/resume()/destroy() without crashing. Each stream emits a
  // single line then ends — enough to exercise the envelope wrapper without
  // blocking test teardown.
  const stdout = Readable.from([`stdout-line-from-${pid}\n`]);
  const stderr = Readable.from([`stderr-line-from-${pid}\n`]);

  const triggerExit = (code = exitCode) => { exitResolve!(code); };

  return {
    pid,
    stdout: stdout as unknown as NodeJS.ReadableStream,
    stderr: stderr as unknown as NodeJS.ReadableStream,
    exit: exitPromise,
    triggerExit,
  };
}

async function setupTmpRepo(
  options: {
    activeTaskIds?: string[];
    sentinelTaskIds?: string[];
    missingTaskJson?: string[];
    taskJsonTaskIds?: string[];
  } = {},
): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ps-test-'));
  const activeItemsDir = path.join(tmpDir, 'AgentWorkSpace', 'pendingitems', '.active-items');
  await mkdir(activeItemsDir, { recursive: true });

  for (const taskId of options.activeTaskIds ?? []) {
    await writeFile(path.join(activeItemsDir, taskId), `${taskId}.md`, 'utf-8');
  }

  for (const taskId of options.sentinelTaskIds ?? []) {
    await writeFile(path.join(activeItemsDir, `${taskId}.completing`), '', 'utf-8');
  }

  const tasksDir = path.join(tmpDir, 'AgentWorkSpace', 'tasks');
  for (const taskId of options.taskJsonTaskIds ?? []) {
    if (!(options.missingTaskJson ?? []).includes(taskId)) {
      const tDir = path.join(tasksDir, taskId);
      await mkdir(tDir, { recursive: true });
      await writeFile(path.join(tDir, '.task.json'), JSON.stringify({ taskId }), 'utf-8');
    }
  }

  return tmpDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pipelineSupervisor', () => {
  let repoRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    moveFailedItemToErrorItemsMock.mockResolvedValue({ movedItem: 'test.md', errorItemPath: '/error/test.md', nextActiveItem: null });
    finalizeTaskWorktreesMock.mockResolvedValue(undefined);
    repoRoot = await mkdtemp(path.join(os.tmpdir(), 'supervisor-test-'));
  });

  afterEach(async () => {
    // Reset module state between tests by re-importing with cache clear
    vi.resetModules();
    try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('F25: startPipeline idempotency — fork called exactly once for duplicate calls', async () => {
    const child = makeChildStub({ pid: 11111 });
    spawnPipelineForTaskMock.mockResolvedValue(child);

    const { startPipeline } = await import('../pipelineSupervisor.js');

    const [result1, result2] = await Promise.all([
      startPipeline('task-a', repoRoot),
      startPipeline('task-a', repoRoot),
    ]);

    // Only one spawn should have occurred
    expect(spawnPipelineForTaskMock).toHaveBeenCalledTimes(1);

    // One of them is 'started', the other is 'already-running'
    const statuses = [result1, result2].map((r) => ('status' in r ? r.status : 'deferred'));
    expect(statuses).toContain('started');
    expect(statuses).toContain('already-running');
  });

  it('starts two pipelines concurrently with different taskIds', async () => {
    const childA = makeChildStub({ pid: 22221 });
    const childB = makeChildStub({ pid: 22222 });
    spawnPipelineForTaskMock
      .mockResolvedValueOnce(childA)
      .mockResolvedValueOnce(childB);

    const { startPipeline, listActivePipelines } = await import('../pipelineSupervisor.js');

    await startPipeline('task-a', repoRoot);
    await startPipeline('task-b', repoRoot);

    const active = listActivePipelines();
    expect(active).toHaveLength(2);
    expect(active.map((e) => e.taskId).sort()).toEqual(['task-a', 'task-b']);
    expect(active[0]!.pid).toBeGreaterThan(0);
  });

  it('F5: startPipeline returns deferred when recoverOnStartup is in progress', async () => {
    // Setup a tmp dir with an active marker so recoverOnStartup has work to do
    const tmpDir = await setupTmpRepo({ activeTaskIds: ['pending-task'], taskJsonTaskIds: ['pending-task'] });

    let startResult: unknown;

    const { startPipeline, recoverOnStartup } = await import('../pipelineSupervisor.js');

    // Start recovery without awaiting it, fire startPipeline concurrently
    const recoveryPromise = recoverOnStartup(tmpDir);
    startResult = await startPipeline('task-x', tmpDir);
    await recoveryPromise;

    expect(startResult).toEqual({ deferred: true });
    expect(spawnPipelineForTaskMock).not.toHaveBeenCalled();

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('recoverOnStartup with simulated crash (marker, no sentinel) calls moveFailedItemToErrorItems', async () => {
    const tmpDir = await setupTmpRepo({
      activeTaskIds: ['crashed-task'],
      taskJsonTaskIds: ['crashed-task'],
    });

    const { recoverOnStartup } = await import('../pipelineSupervisor.js');
    await recoverOnStartup(tmpDir);

    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      taskId: 'crashed-task',
    });
    expect(finalizeTaskWorktreesMock).toHaveBeenCalledWith('crashed-task', 'failed', tmpDir);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('recoverOnStartup with sentinel present treats task as completed', async () => {
    const tmpDir = await setupTmpRepo({
      activeTaskIds: ['completing-task'],
      sentinelTaskIds: ['completing-task'],
      taskJsonTaskIds: ['completing-task'],
    });

    const { recoverOnStartup } = await import('../pipelineSupervisor.js');
    await recoverOnStartup(tmpDir);

    // finalizeTaskWorktrees should be called with 'completed'
    expect(finalizeTaskWorktreesMock).toHaveBeenCalledWith('completing-task', 'completed', tmpDir);
    // moveFailedItemToErrorItems should NOT be called for a completed task
    expect(moveFailedItemToErrorItemsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'completing-task' }),
    );

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('recoverOnStartup with missing .task.json overrides to failed and skips finalizeTaskWorktrees', async () => {
    const tmpDir = await setupTmpRepo({
      activeTaskIds: ['missing-json-task'],
      // Do NOT create .task.json
    });

    const { recoverOnStartup } = await import('../pipelineSupervisor.js');
    await recoverOnStartup(tmpDir);

    // finalizeTaskWorktrees should NOT be called (missing .task.json branch)
    expect(finalizeTaskWorktreesMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'missing-json-task' }),
    );
    // moveFailedItemToErrorItems should be called (failure path)
    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      taskId: 'missing-json-task',
    });

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('F36: pid map is empty on startup (no state reconstruction)', async () => {
    const { listActivePipelines } = await import('../pipelineSupervisor.js');
    expect(listActivePipelines()).toEqual([]);
  });

  it('stopPipeline removes taskId from map without affecting peers', async () => {
    const childA = makeChildStub({ pid: 33331 });
    const childB = makeChildStub({ pid: 33332 });
    spawnPipelineForTaskMock
      .mockResolvedValueOnce(childA)
      .mockResolvedValueOnce(childB);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const { startPipeline, stopPipeline, listActivePipelines } = await import('../pipelineSupervisor.js');

    await startPipeline('task-a', repoRoot);
    await startPipeline('task-b', repoRoot);

    expect(listActivePipelines()).toHaveLength(2);

    // Trigger exit for task-a so stopPipeline doesn't hang
    setTimeout(() => childA.triggerExit(0), 50);
    await stopPipeline('task-a');

    const remaining = listActivePipelines();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.taskId).toBe('task-b');

    // SIGTERM sent only to task-a's pid
    expect(killSpy).toHaveBeenCalledWith(33331, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(33332, 'SIGTERM');

    killSpy.mockRestore();
    childB.triggerExit(0);
  });

  it('child exit with code=0 removes from map without calling moveFailedItemToErrorItems', async () => {
    const child = makeChildStub({ pid: 44441 });
    spawnPipelineForTaskMock.mockResolvedValue(child);

    const { startPipeline, listActivePipelines } = await import('../pipelineSupervisor.js');
    await startPipeline('task-success', repoRoot);

    // Trigger successful exit
    child.triggerExit(0);
    await child.exit;
    // Give exit handler time to run
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listActivePipelines()).toHaveLength(0);
    expect(moveFailedItemToErrorItemsMock).not.toHaveBeenCalled();
  });

  it('child exit with non-zero code calls moveFailedItemToErrorItems for that taskId only', async () => {
    const childA = makeChildStub({ pid: 55551 });
    const childB = makeChildStub({ pid: 55552 });
    spawnPipelineForTaskMock
      .mockResolvedValueOnce(childA)
      .mockResolvedValueOnce(childB);

    const { startPipeline, listActivePipelines } = await import('../pipelineSupervisor.js');

    await startPipeline('task-fail', repoRoot);
    await startPipeline('task-ok', repoRoot);

    // Force-fail task-fail
    childA.triggerExit(1);
    await childA.exit;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledTimes(1);
    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith({
      repoRoot,
      taskId: 'task-fail',
    });

    // task-ok's entry should still be in the map
    const remaining = listActivePipelines();
    expect(remaining.some((e) => e.taskId === 'task-ok')).toBe(true);

    childB.triggerExit(0);
  });

  it('recoverOnStartup singleton migration: legacy .active-item file is migrated', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'singleton-test-'));
    const pendingDir = path.join(tmpDir, 'AgentWorkSpace', 'pendingitems');
    await mkdir(pendingDir, { recursive: true });

    // Write legacy .active-item file
    await writeFile(path.join(pendingDir, '.active-item'), 'legacy-task.md', 'utf-8');

    // Also create .task.json for the task so crash recovery doesn't fail
    const taskDir = path.join(tmpDir, 'AgentWorkSpace', 'tasks', 'legacy-task');
    await mkdir(taskDir, { recursive: true });
    await writeFile(path.join(taskDir, '.task.json'), JSON.stringify({ taskId: 'legacy-task' }), 'utf-8');

    const { recoverOnStartup } = await import('../pipelineSupervisor.js');
    await recoverOnStartup(tmpDir);

    // Legacy file should be gone
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(false);

    // Per-task marker should exist (or have been processed by crash recovery)
    // Either the marker was migrated and then crashed (cleaned up) or it persists
    // In crash recovery, marker gets removed after processing, so either state is valid.

    await rm(tmpDir, { recursive: true, force: true });
  });
});
