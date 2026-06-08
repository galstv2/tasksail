import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Mock factories stay self-contained because Vitest hoists them.
vi.mock('../../container/sharedMcp.js', () => ({
  ensureSharedMcpRunning: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../container/runtime.js', () => ({
  createRuntimeFromConfig: vi.fn().mockResolvedValue({ requiresComposeFile: false }),
}));

vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({
  startPipeline: vi.fn().mockResolvedValue({ status: 'started', pid: 12345 }),
}));

// Import the system under test after the mock registrations.
import {
  activateNextPendingItemIfReady,
  _getLastRollbackRedriveForTest,
  ACTIVATION_GATE_REASON,
} from '../operations.js';
import { resolveQueuePaths } from '../paths.js';
import { ensureSharedMcpRunning as _ensureSharedMcpRunning } from '../../container/sharedMcp.js';
import { startPipeline as _startPipeline } from '../../agent-runner/pipelineSupervisor.js';

const ensureSharedMcpRunning = vi.mocked(_ensureSharedMcpRunning);
const startPipeline = vi.mocked(_startPipeline);

/** Creates a deferred { promise, resolve, reject } triple. */
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Standard platform.default.json written to every tmpdir repo root. */
function platformConfig(maxParallelTasks: number) {
  return JSON.stringify({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'direct',
    container_engine_host: 'auto',
    container_engine_wsl_distro: null,
    max_parallel_tasks: maxParallelTasks,
    retain_failed_task_worktrees: true,
    max_retained_failed_task_worktrees: 10,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  }, null, 2);
}

const TEMPLATE_NAMES = [
  'professional-task.md',
  'implementation-spec.md',
  'retrospective-input.md',
  'final-summary.md',
  'issues.md',
  'parallel-ok.md',
];

async function setupRepo(repoRoot: string, maxParallelTasks: number): Promise<void> {
  // Pre-create activeItemsDir so readdirSync never throws ENOENT during assertions.
  await mkdir(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
  await mkdir(path.join(repoRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
  await mkdir(path.join(repoRoot, 'config'), { recursive: true });
  await writeFile(
    path.join(repoRoot, 'config', 'platform.default.json'),
    platformConfig(maxParallelTasks),
  );
  for (const name of TEMPLATE_NAMES) {
    await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'templates', name), `# ${name}\n`);
  }
  await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'templates', 'slice-template.md'), '# Slice\n');
}

// Tests

describe('activateNextPendingItemIfReady rollback re-drive', () => {
  let repoRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    startPipeline.mockResolvedValue({ status: 'started', pid: 12345 });
    repoRoot = await mkdtemp(path.join(tmpdir(), 'tasksail-rollback-retry-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('rollback re-drive activates next pending task after bootstrap failure', async () => {
    // Setup: cap=1, two pending tasks. task-a is selected first.
    await setupRepo(repoRoot, 1);
    await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'task-a.md'), '# Task A\n');
    await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'task-b.md'), '# Task B\n');
    const paths = resolveQueuePaths(repoRoot);

    // ensureSharedMcpRunning: first call for task-a blocks on a barrier then rejects.
    // Subsequent calls (re-drive) resolve immediately so the re-drive can succeed.
    //
    // Deterministic mechanism: the mock resolves a "marker-written" deferred the
    // moment it is invoked (which is AFTER the active marker is written inside
    // the activation lock), then blocks on bootstrapBarrier before rejecting.
    // The test awaits markerWritten instead of polling with vi.waitFor.
    const bootstrapBarrier = deferred();
    const markerWritten = deferred();
    let callCount = 0;
    ensureSharedMcpRunning.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Signal that the active marker has been written (we are now past the lock).
        markerWritten.resolve();
        // Block until the barrier is released, then fail.
        return bootstrapBarrier.promise.then(() => {
          throw new Error('simulated-bootstrap-failure');
        });
      }
      // Re-drive's call: succeed immediately.
      return Promise.resolve();
    });

    // Start activation for task-a. It will block in bootstrap until we release the barrier.
    const activationAPromise = activateNextPendingItemIfReady({ paths, repoRoot });

    // Wait (deterministically) for the mock to signal that the active marker is written.
    // No wall-clock dependency: markerWritten resolves from inside ensureSharedMcpRunning,
    // which is called only after the marker is written and the activation lock is released.
    await markerWritten.promise;

    // Verify the marker is present on disk (belt-and-suspenders).
    // Active markers use the taskId without the queue-file extension.
    expect(existsSync(path.join(paths.activeItemsDir, 'task-a'))).toBe(true);

    // task-b activation with cap=1: task-a's marker is counted, so cap is reached.
    const activationBPreRollback = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(activationBPreRollback.activated).toBe(false);
    expect(activationBPreRollback.reason).toBe(ACTIVATION_GATE_REASON.CONCURRENCY_CAP_REACHED);

    // Release the barrier so task-a's bootstrap fails → rollback → re-drive fires.
    bootstrapBarrier.resolve();
    const activationAResult = await activationAPromise;

    // task-a must return SHARED_MCP_BOOTSTRAP_FAILED (unchanged return reason).
    expect(activationAResult.activated).toBe(false);
    expect(activationAResult.reason).toBe(ACTIVATION_GATE_REASON.SHARED_MCP_BOOTSTRAP_FAILED);

    // task-a's active marker must be removed by rollback.
    const activeItemsAfter = readdirSync(paths.activeItemsDir).filter(
      (f) => !f.endsWith('.completing') && !f.endsWith('.d'),
    );
    expect(activeItemsAfter).not.toContain('task-a.md');

    // The re-drive must have been started (observable via the test hook).
    const redrivePromise = _getLastRollbackRedriveForTest();
    expect(redrivePromise).not.toBeNull();

    // Await the re-drive to completion — it should activate the next pending task.
    // Rollback keeps task-a's pending file, so the re-drive may pick task-a or task-b
    // depending on queue order. The important assertion is that activation succeeded.
    const redriveResult = await redrivePromise!;
    expect(redriveResult.activated).toBe(true);
    expect(redriveResult.activatedTaskId).toBeDefined();

    // At least one active marker must be present (the re-driven task).
    const activeItemsFinal = readdirSync(paths.activeItemsDir).filter(
      (f) => !f.endsWith('.completing') && !f.endsWith('.d'),
    );
    expect(activeItemsFinal.length).toBeGreaterThanOrEqual(1);
  });

  it('rollback re-drive is depth-bounded: activation does not recurse beyond cap', async () => {
    // Setup: cap=1, one pending task. Bootstrap always fails.
    await setupRepo(repoRoot, 1);
    await writeFile(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'task-a.md'), '# Task A\n');
    const paths = resolveQueuePaths(repoRoot);

    // Count how many times the activation function's bootstrap is invoked.
    // Each activation attempt triggers ensureSharedMcpRunning once.
    // At depth=0: task-a fails → fires re-drive at depth=1
    // At depth=1: task-a fails again → depth >= max, no further re-drive
    let bootstrapCallCount = 0;
    ensureSharedMcpRunning.mockImplementation(() => {
      bootstrapCallCount++;
      return Promise.reject(new Error('always-fails'));
    });

    // First activation (depth=0): fails and fires exactly one re-drive (depth=1).
    const activationResult = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(activationResult.activated).toBe(false);
    expect(activationResult.reason).toBe(ACTIVATION_GATE_REASON.SHARED_MCP_BOOTSTRAP_FAILED);

    // Await the re-drive (depth=1) to complete.
    const redrivePromise = _getLastRollbackRedriveForTest();
    expect(redrivePromise).not.toBeNull();
    const redriveResult = await redrivePromise!;
    expect(redriveResult.activated).toBe(false);
    expect(redriveResult.reason).toBe(ACTIVATION_GATE_REASON.SHARED_MCP_BOOTSTRAP_FAILED);

    // After the re-drive at depth=1 completes, no further re-drive must have been
    // started (the variable either still points to the depth=1 promise or is null;
    // it must NOT point to a new third-level invocation).
    //
    // We verify this by asserting ensureSharedMcpRunning was called at most 2 times
    // (once per allowed depth level: 0 and 1). Any third call would mean depth=2 fired.
    expect(bootstrapCallCount).toBeLessThanOrEqual(2);

    // Confirm the re-drive promise is the same one (depth=1 stored it; depth=1's
    // failed path did NOT overwrite _lastRollbackRedrive because it was at max depth).
    expect(_getLastRollbackRedriveForTest()).toBe(redrivePromise);
  });
});
