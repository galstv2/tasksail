// @vitest-environment node

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { Readable } from 'node:stream';
import { resolveQueuePaths } from '../../queue/paths.js';
import { writeActivationProgress } from '../../queue/activationProgress.js';

// Vitest hoists these mock registrations before the modules under test load.
const spawnPipelineForTaskMock = vi.fn();
const moveFailedItemToErrorItemsMock = vi.fn();
const finalizeTaskWorktreesMock = vi.fn();
const sweepRuntimeGCMock = vi.fn();
const verifyTaskBranchesMock = vi.fn();
const resumeCloseoutFromSentinelMock = vi.fn();

vi.mock('../spawnPipeline.js', () => ({
  spawnPipelineForTask: spawnPipelineForTaskMock,
}));

vi.mock('../../queue/errorItems.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../queue/errorItems.js')>();
  return {
    ...actual,
    moveFailedItemToErrorItems: moveFailedItemToErrorItemsMock,
  };
});

vi.mock('../../queue/branchVerification.js', () => ({
  verifyTaskBranches: verifyTaskBranchesMock,
}));

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: finalizeTaskWorktreesMock,
  sweepRuntimeGC: sweepRuntimeGCMock,
}));

vi.mock('../../queue/resumeCloseout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../queue/resumeCloseout.js')>();
  return {
    ...actual,
    resumeCloseoutFromSentinel: resumeCloseoutFromSentinelMock,
  };
});


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

// Tests

describe('pipelineSupervisor', () => {
  let repoRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    moveFailedItemToErrorItemsMock.mockResolvedValue({ movedItem: 'test.md', errorItemPath: '/error/test.md', nextActiveItem: null });
    finalizeTaskWorktreesMock.mockResolvedValue(undefined);
    sweepRuntimeGCMock.mockReturnValue(undefined);
    verifyTaskBranchesMock.mockResolvedValue({ ok: true, failures: [] });
    // Default: pass through to the real implementation so recoverOnStartup
    // branch tests exercise actual sentinel/marker unlinks. Tests that need to
    // assert the mock was called (e.g. code-78 routing) override with
    // mockResolvedValue to short-circuit.
    resumeCloseoutFromSentinelMock.mockImplementation(async (taskId: string, root: string) => {
      const actual = await vi.importActual<typeof import('../../queue/resumeCloseout.js')>(
        '../../queue/resumeCloseout.js',
      );
      return actual.resumeCloseoutFromSentinel(taskId, root);
    });
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

  it('stopPipeline waits for an in-flight start before stopping with caller-owned cleanup', async () => {
    const child = makeChildStub({ pid: 77771 });
    let resolveSpawn!: (value: typeof child) => void;
    spawnPipelineForTaskMock.mockReturnValue(new Promise((resolve) => {
      resolveSpawn = resolve;
    }));

    const { startPipeline, stopPipeline } = await import('../pipelineSupervisor.js');

    const startPromise = startPipeline('task-starting', repoRoot);
    const stopPromise = stopPipeline('task-starting', 100, { cleanupOwner: 'caller' });
    resolveSpawn(child);
    await expect(startPromise).resolves.toEqual({ status: 'started', pid: child.pid });
    child.triggerExit(0);

    await expect(stopPromise).resolves.toEqual({ status: 'stopped-graceful' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(moveFailedItemToErrorItemsMock).not.toHaveBeenCalledWith({
      repoRoot,
      taskId: 'task-starting',
    });
  });

  it('routes child exit promise failures through the task failure path', async () => {
    let rejectExit!: (err: unknown) => void;
    const child = makeChildStub({ pid: 33333 });
    spawnPipelineForTaskMock.mockResolvedValue({
      ...child,
      exit: new Promise<number>((_resolve, reject) => {
        rejectExit = reject;
      }),
    });

    const { startPipeline, listActivePipelines } = await import('../pipelineSupervisor.js');

    await startPipeline('task-a', repoRoot);
    rejectExit(new Error('child process error'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith({
      repoRoot,
      taskId: 'task-a',
    });
    expect(listActivePipelines()).toEqual([]);
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

  it('recoverOnStartup with unproven sentinel falls back to failed recovery', async () => {
    const tmpDir = await setupTmpRepo({
      activeTaskIds: ['completing-task'],
      sentinelTaskIds: ['completing-task'],
      taskJsonTaskIds: ['completing-task'],
    });

    const { recoverOnStartup } = await import('../pipelineSupervisor.js');
    await recoverOnStartup(tmpDir);

    expect(finalizeTaskWorktreesMock).toHaveBeenCalledWith('completing-task', 'failed', tmpDir);
    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      taskId: 'completing-task',
    });

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

  it('recoverOnStartup logs when missing .task.json recovery cannot move the task to error items', async () => {
    const tmpDir = await setupTmpRepo({
      activeTaskIds: ['missing-json-task'],
    });
    moveFailedItemToErrorItemsMock.mockRejectedValueOnce(new Error('move failed'));
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let errorOutput = '';

    try {
      const { recoverOnStartup } = await import('../pipelineSupervisor.js');
      await recoverOnStartup(tmpDir);
      errorOutput = String(errorSpy.mock.calls.flat().join('\n'));
    } finally {
      errorSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }

    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      taskId: 'missing-json-task',
    });
    expect(errorOutput).toContain('startup.recovery.error.items.move.failed');
    expect(errorOutput).toContain('missing-json-task');
    expect(errorOutput).toContain('missing-task-json');
  });

  it('recoverOnStartup logs when failed crash recovery cannot move the task to error items', async () => {
    const tmpDir = await setupTmpRepo({
      activeTaskIds: ['crashed-task'],
      taskJsonTaskIds: ['crashed-task'],
    });
    moveFailedItemToErrorItemsMock.mockRejectedValueOnce(new Error('move failed'));
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let errorOutput = '';

    try {
      const { recoverOnStartup } = await import('../pipelineSupervisor.js');
      await recoverOnStartup(tmpDir);
      errorOutput = String(errorSpy.mock.calls.flat().join('\n'));
    } finally {
      errorSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }

    expect(finalizeTaskWorktreesMock).toHaveBeenCalledWith('crashed-task', 'failed', tmpDir);
    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      taskId: 'crashed-task',
    });
    expect(errorOutput).toContain('startup.recovery.error.items.move.failed');
    expect(errorOutput).toContain('crashed-task');
    expect(errorOutput).toContain('pid-gone');
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

  it('child exit with closeout-failure code routes to resumeCloseoutFromSentinel when completion is provable', async () => {
    const child = makeChildStub({ pid: 66661, exitCode: 78 });
    spawnPipelineForTaskMock.mockResolvedValue(child);
    // Short-circuit the real impl: this test only proves the routing decision,
    // not the resume side-effects (those are covered in resumeCloseout.test.ts).
    resumeCloseoutFromSentinelMock.mockResolvedValue({ status: 'completed', drove: [] });

    const { startPipeline } = await import('../pipelineSupervisor.js');
    await startPipeline('task-closeout-failed', repoRoot);

    child.triggerExit(78);
    await child.exit;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(moveFailedItemToErrorItemsMock).not.toHaveBeenCalled();
    expect(resumeCloseoutFromSentinelMock).toHaveBeenCalledTimes(1);
    expect(resumeCloseoutFromSentinelMock).toHaveBeenCalledWith('task-closeout-failed', repoRoot);
  });

  it('child exit with closeout-failure code moves to error-items when completion is not provable', async () => {
    const child = makeChildStub({ pid: 66662, exitCode: 78 });
    spawnPipelineForTaskMock.mockResolvedValue(child);
    resumeCloseoutFromSentinelMock.mockResolvedValue({ status: 'no-sentinel', drove: [] });
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { startPipeline } = await import('../pipelineSupervisor.js');
    await startPipeline('task-closeout-no-sentinel', repoRoot);

    child.triggerExit(78);
    await child.exit;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(resumeCloseoutFromSentinelMock).toHaveBeenCalledTimes(1);
    expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith({
      repoRoot,
      taskId: 'task-closeout-no-sentinel',
    });
    const warnings = String(warnSpy.mock.calls.flat().join('\n'));
    expect(warnings).toContain('closeout_recovery.incomplete');
    expect(warnings).toContain('task-closeout-no-sentinel');
    warnSpy.mockRestore();
  });

  describe('_recoverOnStartupImpl completed-sentinel branch', () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'tasksail-recover-completed-'));
    });

    afterEach(async () => {
      await rm(tmpRoot, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it('re-drives closeout when a completing sentinel proves archival', async () => {
      const taskId = 'task-recover-completed-test';
      const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
      mkdirSync(activeItemsDir, { recursive: true });
      writeFileSync(path.join(activeItemsDir, taskId), `${taskId}.md`);
      const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId);
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({ taskId }));
      const archiveDir = path.join(tmpRoot, 'contextpacks', 'pack', 'qmd', 'context-packs', 'pack', 'archive', 'tasks', '2026');
      mkdirSync(archiveDir, { recursive: true });
      const archivePath = path.join(archiveDir, `${taskId}.md`);
      writeFileSync(archivePath, '# archive\n');
      writeFileSync(
        path.join(activeItemsDir, `${taskId}.completing`),
        JSON.stringify({
          ts: Date.now(),
          archiveSucceeded: true,
          archivePath,
          contextPackDir: path.join(tmpRoot, 'contextpacks', 'pack'),
          retrospectiveSynced: true,
        }),
      );
      const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
      writeFileSync(path.join(pendingDir, `${taskId}.md`), '# pending\n');

      const { recoverOnStartup } = await import('../pipelineSupervisor.js');
      await recoverOnStartup(tmpRoot);

      expect(existsSync(path.join(pendingDir, `${taskId}.md`))).toBe(false);
      expect(existsSync(path.join(activeItemsDir, taskId))).toBe(false);
      expect(existsSync(path.join(activeItemsDir, `${taskId}.completing`))).toBe(false);
    });

    it('falls through to failure recovery when sentinel cannot prove archival', async () => {
      const taskId = 'task-recover-unproven-test';
      const activeItemsDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
      mkdirSync(activeItemsDir, { recursive: true });
      writeFileSync(path.join(activeItemsDir, taskId), `${taskId}.md`);
      const taskDir = path.join(tmpRoot, 'AgentWorkSpace', 'tasks', taskId);
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({ taskId }));
      writeFileSync(
        path.join(activeItemsDir, `${taskId}.completing`),
        JSON.stringify({ ts: Date.now() }),
      );
      const pendingDir = path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems');
      mkdirSync(pendingDir, { recursive: true });
      writeFileSync(path.join(pendingDir, `${taskId}.md`), '# pending\n');

      const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { recoverOnStartup } = await import('../pipelineSupervisor.js');
      await recoverOnStartup(tmpRoot);

      expect(String(warnSpy.mock.calls.flat().join('\n'))).toContain('startup_recovery.completion_unproven');
      expect(existsSync(path.join(activeItemsDir, taskId))).toBe(false);
      expect(existsSync(path.join(activeItemsDir, `${taskId}.completing`))).toBe(false);
    });
  });

  describe('activation progress startup recovery', () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'tasksail-recover-activating-'));
    });

    afterEach(async () => {
      await rm(tmpRoot, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it('removes stale activating marker for pending markdown without moving task state', async () => {
      const paths = resolveQueuePaths(tmpRoot);
      mkdirSync(paths.pendingDir, { recursive: true });
      writeFileSync(path.join(paths.pendingDir, 'task-pending.md'), '# Pending\n');
      await writeActivationProgress(paths, {
        taskId: 'task-pending',
        queueName: 'task-pending.md',
        title: null,
        phase: 'validating',
        startedAt: '2026-05-23T10:00:00Z',
      });

      const { recoverOnStartup } = await import('../pipelineSupervisor.js');
      await recoverOnStartup(tmpRoot);

      expect(existsSync(path.join(paths.activatingItemsDir, 'task-pending.json'))).toBe(false);
      expect(existsSync(path.join(paths.pendingDir, 'task-pending.md'))).toBe(true);
      expect(moveFailedItemToErrorItemsMock).not.toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-pending',
      }));
    });

    it('removes activating marker when active marker exists and lets active recovery own the task', async () => {
      const paths = resolveQueuePaths(tmpRoot);
      mkdirSync(paths.pendingDir, { recursive: true });
      mkdirSync(paths.activeItemsDir, { recursive: true });
      writeFileSync(path.join(paths.pendingDir, 'task-active.md'), '# Active\n');
      writeFileSync(path.join(paths.activeItemsDir, 'task-active'), 'task-active.md');
      await writeActivationProgress(paths, {
        taskId: 'task-active',
        queueName: 'task-active.md',
        title: null,
        phase: 'starting-pipeline',
        startedAt: '2026-05-23T10:00:00Z',
      });

      const { recoverOnStartup } = await import('../pipelineSupervisor.js');
      await recoverOnStartup(tmpRoot);

      expect(existsSync(path.join(paths.activatingItemsDir, 'task-active.json'))).toBe(false);
      expect(moveFailedItemToErrorItemsMock).toHaveBeenCalledWith(expect.objectContaining({
        repoRoot: tmpRoot,
        taskId: 'task-active',
      }));
    });
  });
});
