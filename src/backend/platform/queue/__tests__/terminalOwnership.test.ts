/**
 * Track C — Same-task terminal ownership tests.
 *
 * Asserts that fail/kill worktree finalization now runs under the global queue
 * lock, making complete and fail mutually exclusive on the same task.
 *
 * Deterministic approach:
 *   - finalizeTaskWorktreesWithReport is mocked with a Promise barrier injected
 *     by the test to pause the FIRST caller mid-flight while the SECOND caller
 *     races to start.
 *   - acquireDirLockOrThrow (via withDirLock) provides real filesystem
 *     serialization — the lock dir is a real tmpdir subdir. No real OS race is
 *     needed: the barrier forces the exact interleaving.
 *   - All git I/O, archive, pipeline, and platform-config are mocked to keep the
 *     tests deterministic and free of real sockets or subprocesses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest before any imports)
// ---------------------------------------------------------------------------

vi.mock('../archive.js', () => ({
  fileTaskArchive: vi.fn(),
}));

vi.mock('../policyValidation.js', () => ({
  assertPolicyPasses: vi.fn(),
}));

vi.mock('../../context-pack/index.js', () => ({
  requireAuthorizedActiveContextPack: vi.fn(),
}));

vi.mock('../../agent-runner/pipeline/remediation.js', () => ({
  buildAdvisoryFindingSection: vi.fn().mockResolvedValue(null),
  ADVISORY_FINDING_HEADING: '## QA Advisory Finding',
}));

vi.mock('../../container/sharedMcp.js', () => ({
  ensureSharedMcpRunning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({
  startPipeline: vi.fn().mockResolvedValue({ status: 'started', pid: 12345 }),
}));

vi.mock('../branchVerification.js', () => ({
  verifyTaskBranches: vi.fn().mockResolvedValue({ ok: true, failures: [] }),
}));

vi.mock('../../task-notifications/producer.js', () => ({
  recordTaskFailedNotification: vi.fn().mockResolvedValue(null),
}));

vi.mock('../childTaskChainFailure.js', () => ({
  markChildTaskChainTaskFailed: vi.fn().mockResolvedValue({ marked: false }),
  resetFailedChildTaskChainTaskToPlanned: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn().mockResolvedValue({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'docker',
    container_engine_host: 'auto',
    container_engine_wsl_distro: null,
    max_parallel_tasks: 2,
    retain_failed_task_worktrees: false,
    max_retained_failed_task_worktrees: 10,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  }),
}));

// commitTaskSnapshot is a best-effort git operation — mock it to avoid real git.
vi.mock('../errorItems.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../errorItems.js')>();
  return {
    ...actual,
    commitTaskSnapshot: vi.fn().mockResolvedValue(true),
  };
});

// finalizeTaskWorktreesWithReport is the key mock: tests inject barriers here.
vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined),
  finalizeTaskWorktreesWithReport: vi.fn().mockResolvedValue({
    skipNextActivation: false,
    chainRollbackReport: null,
  }),
  discardRetainedTaskWorktrees: vi.fn().mockResolvedValue(undefined),
  gcTaskRuntime: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Module imports (after mocks)
// ---------------------------------------------------------------------------

import { fileTaskArchive } from '../archive.js';
import { moveFailedItemToErrorItems } from '../errorItems.js';
import { completePendingItem } from '../completePendingItem.js';
import { acquireDirLockOrThrow } from '../dirLock.js';
import { resolveQueuePaths, type QueuePaths } from '../paths.js';
import { finalizeTaskWorktrees, finalizeTaskWorktreesWithReport } from '../../core/worktreeFinalize.js';

const mockFileTaskArchive = vi.mocked(fileTaskArchive);
const mockFinalize = vi.mocked(finalizeTaskWorktrees);
const mockFinalizeWithReport = vi.mocked(finalizeTaskWorktreesWithReport);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function makeTmpRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tasksail-term-own-'));
  await mkdir(path.join(root, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
  await mkdir(path.join(root, 'AgentWorkSpace', 'templates'), { recursive: true });
  await mkdir(path.join(root, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  for (const name of ['professional-task.md', 'implementation-spec.md', 'retrospective-input.md', 'final-summary.md', 'issues.md', 'parallel-ok.md']) {
    await writeFile(path.join(root, 'AgentWorkSpace', 'templates', name), `# ${name}\n`);
  }
  await writeFile(path.join(root, 'AgentWorkSpace', 'templates', 'slice-template.md'), '# Slice\n');
  return root;
}

async function seedActiveTask(repoRoot: string, taskId: string): Promise<void> {
  const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  const activeDir = path.join(pendingDir, '.active-items');
  await mkdir(activeDir, { recursive: true });
  await writeFile(path.join(pendingDir, `${taskId}.md`), `# ${taskId}\n`);
  await writeFile(path.join(activeDir, taskId), `${taskId}.md`);
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
  await mkdir(handoffsDir, { recursive: true });
  await writeFile(path.join(handoffsDir, 'professional-task.md'), '# Task\n');
  await writeFile(path.join(handoffsDir, 'implementation-spec.md'), '# Spec\n');
  await writeFile(
    path.join(handoffsDir, 'retrospective-input.md'),
    '# Retrospective\n\n- Retrospective Required: false\n',
  );
  await writeFile(path.join(handoffsDir, 'final-summary.md'), '# Final Summary\n');
  await writeFile(path.join(handoffsDir, 'issues.md'), '# Issues\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('terminal ownership — Track C', () => {
  let repoRoot: string;
  let queuePaths: QueuePaths;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoRoot = await makeTmpRepo();
    queuePaths = resolveQueuePaths(repoRoot);
    mockFileTaskArchive.mockImplementation(async ({ taskId }) => ({
      passed: true,
      stdout: '{}',
      stderr: '',
      exitCode: 0,
      data: { record_md_path: path.join(repoRoot, 'archive', `${taskId}.md`) },
    }));
    // Default: finalizeTaskWorktreesWithReport resolves immediately.
    mockFinalizeWithReport.mockResolvedValue({ skipNextActivation: false, chainRollbackReport: null });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('T-C1: same-task concurrent complete+fail: finalize runs exactly once and terminal state is consistent', async () => {
    const taskId = '20260101t000100z_test-c1';
    const packDir = path.join(repoRoot, 'contextpacks', 'test-pack');
    await mkdir(packDir, { recursive: true });
    await seedActiveTask(repoRoot, taskId);

    // Barrier: the first call to finalizeTaskWorktreesWithReport holds here
    // until the test releases it. This forces the interleaving deterministically.
    let barrierRelease!: () => void;
    const barrier = new Promise<void>((resolve) => { barrierRelease = resolve; });

    // Count finalizations across BOTH terminal APIs — finalizeTaskWorktrees
    // (complete path) and finalizeTaskWorktreesWithReport (fail path) — because
    // the XML requires exactly one finalization total for a same-task
    // complete+fail. Whichever path finalizes first holds the barrier.
    let finalizeTotal = 0;
    const holdFirst = async () => {
      finalizeTotal++;
      if (finalizeTotal === 1) {
        await barrier;
      }
    };
    mockFinalize.mockImplementation(async () => { await holdFirst(); });
    mockFinalizeWithReport.mockImplementation(async (_taskId, _outcome, _root) => {
      await holdFirst();
      return { skipNextActivation: false, chainRollbackReport: null };
    });

    // Start both operations concurrently.
    const failPromise = moveFailedItemToErrorItems({ repoRoot, taskId });
    const completePromise = completePendingItem({
      taskId,
      repoRoot,
      skipValidation: true,
      contextPackDir: packDir,
    });

    // Give both a tick to start, then release the barrier.
    await new Promise<void>((resolve) => setImmediate(resolve));
    barrierRelease();

    // Both settle — one will succeed, the other may throw or be a no-op.
    const results = await Promise.allSettled([failPromise, completePromise]);

    // At least one must succeed.
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    // Exactly one finalization across BOTH terminal APIs: the second entrant is
    // serialized out by the global lock and gated by the terminal-ownership
    // check (it sees a task already in a terminal state), so it never finalizes.
    expect(finalizeTotal).toBe(1);

    // The active marker must be gone — task is in terminal state.
    expect(existsSync(path.join(queuePaths.activeItemsDir, taskId))).toBe(false);

    // The pending item is moved in both paths — it must not remain at rest.
    const pendingExists = existsSync(path.join(queuePaths.pendingDir, `${taskId}.md`));
    expect(pendingExists).toBe(false);
  });

  it('T-C2: while completePendingItem holds queue lock, moveFailedItemToErrorItems blocks on lock acquisition', async () => {
    const taskId = '20260101t000101z_test-c2';
    const packDir = path.join(repoRoot, 'contextpacks', 'test-pack');
    await mkdir(packDir, { recursive: true });
    await seedActiveTask(repoRoot, taskId);

    // Acquire the queue lock externally to simulate completePendingItem holding it.
    const release = await acquireDirLockOrThrow(queuePaths.queueLockDir, 'TestC2-held');

    let failResolvedAt: number | null = null;

    // moveFailedItemToErrorItems must block until we release.
    const failPromise = moveFailedItemToErrorItems({ repoRoot, taskId }).then((result) => {
      failResolvedAt = Date.now();
      return result;
    });

    // Yield the event loop deterministically (no wall-clock dependency).
    // Chained setImmediate calls give the Node event loop enough turns to
    // advance failPromise to its lock-acquisition attempt. Because the lock dir
    // is held, acquireDirLockOrThrow cannot succeed regardless of how many
    // turns pass — failResolvedAt stays null until we release.
    await new Promise<void>((resolve) => setImmediate(() => setImmediate(() => setImmediate(resolve))));

    // Still blocked — the held lock prevents resolution.
    expect(failResolvedAt).toBeNull();

    // Release the external lock — failPromise should now proceed.
    await release();
    await failPromise;

    // Confirm it resolved after the external lock was released.
    expect(failResolvedAt).not.toBeNull();
  });

  it('T-C3: finalizeTaskWorktreesWithReport is safe under double entry with the real implementation', async () => {
    // Use the real implementation (not the mock) to verify that calling
    // finalizeTaskWorktreesWithReport twice for the same taskId is safe:
    // the second call gracefully handles missing task state and returns a
    // consistent result without throwing.
    //
    // Mechanism: the first call deletes the task dir (retain=false fixture),
    // so the second call finds no parent dir in persistTaskJson and no task
    // dir to rmSync — both operations are already-safe no-ops.
    const { finalizeTaskWorktreesWithReport: realFinalize } =
      await vi.importActual<typeof import('../../core/worktreeFinalize.js')>(
        '../../core/worktreeFinalize.js',
      );

    const taskId = '20260101t000102z_test-c3';
    await seedActiveTask(repoRoot, taskId);

    // First call — normal fail path.
    const result1 = await realFinalize(taskId, 'failed', repoRoot);
    expect(result1).toMatchObject({ skipNextActivation: false, chainRollbackReport: null });

    // Second call — simulates double-entry (e.g., complete fires after fail).
    // Must not throw and must return a consistent result.
    const result2 = await realFinalize(taskId, 'failed', repoRoot);
    expect(result2).toMatchObject({ skipNextActivation: false, chainRollbackReport: null });

    // Return values are consistent across both calls.
    expect(result1.skipNextActivation).toBe(result2.skipNextActivation);
    expect(result1.chainRollbackReport).toBe(result2.chainRollbackReport);
  });

  it('T-C4 (regression): different-task concurrent fail+fail both move items to error-items', async () => {
    const taskA = '20260101t000103z_test-c4a';
    const taskB = '20260101t000104z_test-c4b';
    await seedActiveTask(repoRoot, taskA);
    await seedActiveTask(repoRoot, taskB);

    await Promise.all([
      moveFailedItemToErrorItems({ repoRoot, taskId: taskA }),
      moveFailedItemToErrorItems({ repoRoot, taskId: taskB }),
    ]);

    expect(existsSync(path.join(queuePaths.errorItemsDir, `${taskA}.md`))).toBe(true);
    expect(existsSync(path.join(queuePaths.errorItemsDir, `${taskB}.md`))).toBe(true);
    expect(existsSync(path.join(queuePaths.activeItemsDir, taskA))).toBe(false);
    expect(existsSync(path.join(queuePaths.activeItemsDir, taskB))).toBe(false);
  });

  it('T-C5: moveFailedItemToErrorItems no-ops for an already-completed task (no stale error-items artifact)', async () => {
    const taskId = '20260101t000105z_test-c5';
    await seedActiveTask(repoRoot, taskId);
    // Simulate a prior completion under the queue lock: the active marker and the
    // pending file are already gone (what completePendingItem does on success).
    await rm(path.join(queuePaths.activeItemsDir, taskId), { force: true });
    await rm(path.join(queuePaths.pendingDir, `${taskId}.md`), { force: true });

    let finalizeCount = 0;
    mockFinalizeWithReport.mockImplementation(async () => {
      finalizeCount++;
      return { skipNextActivation: false, chainRollbackReport: null };
    });

    const result = await moveFailedItemToErrorItems({ repoRoot, taskId });

    // Terminal-ownership gate => clean no-op: no stale error-items artifact for
    // the completed task, and no finalization ran.
    expect(existsSync(path.join(queuePaths.errorItemsDir, `${taskId}.md`))).toBe(false);
    expect(finalizeCount).toBe(0);
    expect(result.nextActiveItem).toBeNull();
  });
});
