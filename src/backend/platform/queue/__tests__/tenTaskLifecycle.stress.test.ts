/**
 * 10-task lifecycle stress test.
 *
 * One in-process backend over a temp repo with max_parallel_tasks=10.
 * Creates 10 distinct tasks, activates them under the cap, drives a mix
 * of terminal outcomes released together via injected barriers, and asserts
 * all five lifecycle invariants.
 *
 * Deterministic approach:
 *   - All external I/O (archive, shared-MCP bootstrap, pipeline spawn) is
 *     mocked with controllable Promise barriers. No real agents, containers,
 *     sockets, or wall-clock races.
 *   - The bootstrap-failure rollback (assertion e) is forced by injecting a
 *     rejection into ensureSharedMcpRunning for one task. The active-marker
 *     presence before that rejection is confirmed via a "marker-written"
 *     deferred resolved by the mock (no polling, no wall-clock dependency).
 *   - Concurrent closeout pressure is produced by launching all terminal-
 *     outcome handlers in parallel via Promise.all. They serialize on the
 *     global queue lock, which is the contract under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Mock registrations stay before modules that consume them.
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
  ensureSharedMcpRunning: vi.fn(),
}));

vi.mock('../../container/runtime.js', () => ({
  createRuntimeFromConfig: vi.fn().mockResolvedValue({ requiresComposeFile: false }),
}));

vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({
  startPipeline: vi.fn(),
  // stopPipeline: tasks in this test are not running in-process, so stopPipeline
  // returns not-running. executeRequestedTaskKill then takes the cross-process
  // kill path (writes durable kill switch, skips poll with windowMs=0, runs cleanup).
  stopPipeline: vi.fn().mockResolvedValue({ status: 'not-running' }),
  // listActivePipelines: no pipelines are tracked in-process for this test.
  listActivePipelines: vi.fn().mockReturnValue([]),
}));

vi.mock('../branchVerification.js', () => ({
  verifyTaskBranches: vi.fn().mockResolvedValue({ ok: true, failures: [] }),
}));

vi.mock('../../task-notifications/producer.js', () => ({
  recordTaskFailedNotification: vi.fn().mockResolvedValue(null),
  recordTaskCompletedNotification: vi.fn().mockResolvedValue(null),
}));

vi.mock('../childTaskChainFailure.js', () => ({
  markChildTaskChainTaskFailed: vi.fn().mockResolvedValue({ marked: false }),
  resetFailedChildTaskChainTaskToPlanned: vi.fn().mockResolvedValue(undefined),
}));

// commitTaskSnapshot is a best-effort git operation — mock to avoid real git.
vi.mock('../errorItems.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../errorItems.js')>();
  return {
    ...actual,
    commitTaskSnapshot: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined),
  finalizeTaskWorktreesWithReport: vi.fn().mockResolvedValue({
    skipNextActivation: true, // prevent re-activation loops from adding noise
    chainRollbackReport: null,
  }),
  discardRetainedTaskWorktrees: vi.fn().mockResolvedValue(undefined),
  gcTaskRuntime: vi.fn().mockResolvedValue(undefined),
}));

// Scale the real mkdir-lock backoff by 50x instead of flattening it. The test
// still exercises contention, retry budgets, and exponential handoff windows
// while reducing the closeout race from about 9s to under 1s.
vi.mock('../../core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/index.js')>();
  return {
    ...actual,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, Math.ceil(ms / 50)))),
  };
});

// Import the system under test after mock registration.
import { fileTaskArchive } from '../archive.js';
import { completePendingItem } from '../completePendingItem.js';
import { executeRequestedTaskKill } from '../killTask.js';
import { moveFailedItemToErrorItems } from '../errorItems.js';
import {
  activateNextPendingItemIfReady,
  getActiveTaskIds,
  ACTIVATION_GATE_REASON,
  _getLastRollbackRedriveForTest,
} from '../operations.js';
import { resolveQueuePaths } from '../paths.js';
import { createDropboxTask } from '../createDropboxTask.js';
import { ensureSharedMcpRunning as _ensureSharedMcpRunning } from '../../container/sharedMcp.js';
import { startPipeline as _startPipeline } from '../../agent-runner/pipelineSupervisor.js';
import { recordTaskFailedNotification as _recordTaskFailedNotification } from '../../task-notifications/producer.js';

const mockFileTaskArchive = vi.mocked(fileTaskArchive);
const ensureSharedMcpRunning = vi.mocked(_ensureSharedMcpRunning);
const startPipeline = vi.mocked(_startPipeline);
const mockRecordTaskFailedNotification = vi.mocked(_recordTaskFailedNotification);

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

/** Platform config JSON for a given parallel task cap. */
function platformConfig(maxParallelTasks: number): string {
  return JSON.stringify({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'direct',
    container_engine_host: 'auto',
    container_engine_wsl_distro: null,
    max_parallel_tasks: maxParallelTasks,
    retain_failed_task_worktrees: false,
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

/** Bootstrap a temp repo with templates and platform config at the given cap. */
async function makeTmpRepo(maxParallelTasks: number): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tasksail-stress-'));
  await mkdir(path.join(root, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
  await mkdir(path.join(root, 'AgentWorkSpace', 'dropbox'), { recursive: true });
  await mkdir(path.join(root, 'AgentWorkSpace', 'templates'), { recursive: true });
  await mkdir(path.join(root, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  await mkdir(path.join(root, 'config'), { recursive: true });
  const configJson = platformConfig(maxParallelTasks);
  // Write BOTH the default config (used by seedPlatformConfig / loadPlatformConfig)
  // and the runtime config (used by getPlatformConfig, which reads .platform-state/platform.json).
  // Without the runtime config, getPlatformConfig throws and the activation falls
  // back to cap=1, which would immediately block with 8+ active tasks.
  await writeFile(path.join(root, 'config', 'platform.default.json'), configJson);
  await writeFile(path.join(root, '.platform-state', 'platform.json'), configJson);
  for (const name of TEMPLATE_NAMES) {
    await writeFile(path.join(root, 'AgentWorkSpace', 'templates', name), `# ${name}\n`);
  }
  await writeFile(path.join(root, 'AgentWorkSpace', 'templates', 'slice-template.md'), '# Slice\n');
  return root;
}

/** Write the minimal handoff set for a task (mirrors what activation produces). */
async function writeHandoffSet(repoRoot: string, taskId: string): Promise<void> {
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

/**
 * Seed a task as already-active: write the queue entry, active marker, and
 * minimal handoff set. This bypasses activation machinery and directly puts the
 * task into the active state that completePendingItem / moveFailedItem expect.
 */
async function seedActiveTask(repoRoot: string, taskId: string): Promise<void> {
  const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  const activeDir = path.join(pendingDir, '.active-items');
  await writeFile(path.join(pendingDir, `${taskId}.md`), `# ${taskId}\n`);
  await writeFile(path.join(activeDir, taskId), `${taskId}.md`);
  await writeHandoffSet(repoRoot, taskId);
}

// The stress test

describe('10-task lifecycle stress (Track M)', () => {
  let repoRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    repoRoot = await makeTmpRepo(10);

    // Default archive mock: resolves immediately.
    mockFileTaskArchive.mockImplementation(async ({ taskId }) => ({
      passed: true,
      stdout: '{}',
      stderr: '',
      exitCode: 0,
      data: { record_md_path: path.join(repoRoot, 'archive', `${taskId}.md`) },
    }));

    // Default bootstrap: succeeds immediately (overridden per test as needed).
    ensureSharedMcpRunning.mockResolvedValue(undefined);

    // Default pipeline: succeeds immediately.
    startPipeline.mockResolvedValue({ status: 'started', pid: 12345 });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  // Gated behind RUN_SLOW_TESTS=1: this is the heaviest seam test — it drives the
  // real mkdir-based queue lock under 10-way closeout contention (with compressed
  // but real exponential backoff). It is the closeout gate, not part of the
  // default fast suite; run with RUN_SLOW_TESTS=1. Skipped otherwise.
  it.runIf(process.env['RUN_SLOW_TESTS'] === '1')('all five lifecycle invariants hold across 10 concurrent tasks', { timeout: 30000 }, async () => {
  // Create 10 pending items via createDropboxTask and assert (a):
    //           10 distinct filenames (no exclusive-create collision).
    //
    // createDropboxTask writes to the dropbox dir using writeTextFileExclusive
  // (the auto-path / exclusive-create path). Task IDs are derived from
    // the returned filenames. After creation the dropbox files are moved to the
    // pending dir so activateNextPendingItemIfReady can find them.
    //
    // 8 tasks are seeded directly as active (bypassing activation machinery).
    // 1 task (DOOMED_TASK) goes through real activation with a bootstrap failure.
    // 1 task (REDRIVEN_TASK) is picked by the re-drive after DOOMED_TASK rolls back.

    const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    const activeItemsDir = path.join(pendingDir, '.active-items');

    // Create 10 tasks sequentially. createDropboxTask auto-generates distinct
  // filenames via the exclusive-create retry loop.
    const createdFiles: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const title = `Task ${String(i).padStart(2, '0')}`;
      const file = await createDropboxTask({ title, repoRoot });
      createdFiles.push(file);
    }

    // Assertion (a): 10 distinct filenames — no exclusive-create collision.
    const createdNames = createdFiles.map((f) => path.basename(f));
    expect(createdFiles).toHaveLength(10);
    const uniqueNames = new Set(createdNames);
    expect(uniqueNames.size).toBe(10);

    // Derive task IDs from the returned paths (no hardcoding).
    const taskIds = createdFiles.map((f) => path.basename(f, '.md'));

    // Move dropbox files → pending dir so activation machinery can find them.
    for (const file of createdFiles) {
      await rename(file, path.join(pendingDir, path.basename(file)));
    }

  // Seed 8 tasks as active.

    const DIRECTLY_ACTIVE = taskIds.slice(0, 8); // first 8 tasks
    const DOOMED_TASK = taskIds[8]!;             // 9th task — bootstrap failure
    const REDRIVEN_TASK = taskIds[9]!;           // 10th task — re-drive target

    for (const id of DIRECTLY_ACTIVE) {
      await seedActiveTask(repoRoot, id);
    }

    // 8 active markers exist.
    const afterSeed = readdirSync(activeItemsDir).filter(
      (f) => !f.endsWith('.completing') && !f.endsWith('.d'),
    );
    expect(afterSeed).toHaveLength(8);

    const paths = resolveQueuePaths(repoRoot);

  // Assertion (e): bootstrap failure -> rollback -> freed slot re-driven.
    //
    // The mock signals "active marker written" via markerWrittenSignal when
    // ensureSharedMcpRunning is first called (which happens AFTER the active
    // marker is committed inside the activation lock). This replaces any timer
    // poll: the signal is purely event-driven.

    const markerWrittenSignal = deferred();
    const bootstrapBarrier = deferred();

    let bootstrapCallIdx = 0;
    ensureSharedMcpRunning.mockImplementation(() => {
      bootstrapCallIdx++;
      if (bootstrapCallIdx === 1) {
        // DOOMED_TASK: signal that the marker is written, then block until released.
        markerWrittenSignal.resolve();
        return bootstrapBarrier.promise.then(() => {
          throw new Error('simulated-bootstrap-failure-doomed-task');
        });
      }
      // All subsequent calls (re-drive + later activations): succeed immediately.
      return Promise.resolve();
    });

    // Start activation of DOOMED_TASK. It will:
    //   1. Acquire the queue lock.
    //   2. Cap check: 8 < 10 → proceed.
    //   3. Select DOOMED_TASK (first alphabetically among unselected pending items).
    //   4. Write the DOOMED_TASK active marker (9 total active).
    //   5. Release the activation lock.
    //   6. Call ensureSharedMcpRunning → signals markerWrittenSignal → blocks on barrier.
    const activationDoomedPromise = activateNextPendingItemIfReady({ paths, repoRoot });

    // Wait deterministically for the mock to confirm the active marker is present.
    // Race the doomed activation's own promise so that any unexpected early
    // resolution surfaces as an immediate diagnostic error rather than a hang.
    await Promise.race([
      markerWrittenSignal.promise,
      activationDoomedPromise.then(
        (r) => Promise.reject(new Error(`doomed activation resolved before markerWritten: ${JSON.stringify(r)}`)),
        (e: unknown) => Promise.reject(new Error(`doomed activation rejected before markerWritten: ${e instanceof Error ? e.message : String(e)}`)),
      ),
    ]);

    // With 9 active (8 seeded + DOOMED_TASK), cap=10, one slot remains.
    // Activate REDRIVEN_TASK independently — DOOMED_TASK's marker is in the activeSet so
    // REDRIVEN_TASK is the next unselected pending item.
    const activationTask10 = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(activationTask10.activated).toBe(true);
    expect(activationTask10.activatedTaskId).toBe(REDRIVEN_TASK);

    // 10 active markers: 8 seeded + DOOMED_TASK + REDRIVEN_TASK.
    const afterBothActivations = readdirSync(activeItemsDir).filter(
      (f) => !f.endsWith('.completing') && !f.endsWith('.d'),
    );
    expect(afterBothActivations).toHaveLength(10);

    // Assertion (b): with cap=10 filled, another activation must be blocked.
    const capCheckResult = await activateNextPendingItemIfReady({ paths, repoRoot });
    expect(capCheckResult.activated).toBe(false);
    expect(capCheckResult.reason).toBe(ACTIVATION_GATE_REASON.CONCURRENCY_CAP_REACHED);

    // Release the bootstrap barrier → DOOMED_TASK fails → rollback removes marker → re-drive fires.
    bootstrapBarrier.resolve();
    const doomedResult = await activationDoomedPromise;
    expect(doomedResult.activated).toBe(false);
    expect(doomedResult.reason).toBe(ACTIVATION_GATE_REASON.SHARED_MCP_BOOTSTRAP_FAILED);

    // DOOMED_TASK's active marker must be absent (rollback removed it).
    const afterRollback = readdirSync(activeItemsDir).filter(
      (f) => !f.endsWith('.completing') && !f.endsWith('.d'),
    );
    expect(afterRollback).not.toContain(DOOMED_TASK);

    // The rollback fires a re-drive. Await it to confirm the freed slot was consumed.
    const redrivePromise = _getLastRollbackRedriveForTest();
    expect(redrivePromise).not.toBeNull();
    const redriveOutcome = await redrivePromise!;

    // Assertion (e) — specific invariant: the re-drive must activate the doomed task.
    //
    // After rollback: 9 tasks are active (8 seeded + REDRIVEN_TASK), cap=10, one slot free.
    // DOOMED_TASK's pending file survived rollback (bootstrap failure does not remove
    // the pending markdown). It is the only remaining pending file, so the re-drive
    // must select it. The re-drive succeeds (bootstrap mock now resolves for call idx ≥ 2).
    expect(redriveOutcome.activated, 're-drive must activate the doomed task').toBe(true);
    expect(redriveOutcome.activatedTaskId, 're-drive must select the doomed task whose pending file survived rollback').toBe(DOOMED_TASK);

    // Seed task-09 handoffs in case re-drive did not write them (activation writes
    // handoffs, but our mock skips real worktree materialization).
    await writeHandoffSet(repoRoot, DOOMED_TASK);
    // Ensure DOOMED_TASK has an active marker for the terminal-outcome step.
    // If the re-drive activated it, the marker exists; if not, seed it.
    if (!existsSync(path.join(activeItemsDir, DOOMED_TASK))) {
      await writeFile(path.join(activeItemsDir, DOOMED_TASK), `${DOOMED_TASK}.md`);
    }

  // Drive terminal outcomes for all 10 tasks concurrently.
    //
    // Assertion (c): every closeout acquires the queue lock and produces exactly
    // one consistent terminal state per task (no double-dispose, no lost task).
    // Assertion (d): no cross-task notification bleed.
    //
    // All 10 closeouts are launched in parallel. They serialize on the global
    // queue lock. Each must complete without error and leave its task in exactly
    // one terminal location.
    //
    // Terminal outcome buckets (10 tasks total):
    //   complete (6): completePendingItem     → first 6 tasks
    //   fail    (2): moveFailedItemToErrorItems → tasks 7, 8
    //   kill    (2): executeRequestedTaskKill  → tasks 9, 10
  //                (exercises durable kill-switch path: writes
    //                 requestPipelineKill marker, skips poll via windowMs=0,
    //                 then calls moveFailedItemToErrorItems internally)

    const COMPLETE_TASKS = taskIds.slice(0, 6); // first 6
    const FAIL_TASKS    = [taskIds[6]!, taskIds[7]!]; // tasks 7, 8
    const KILL_TASKS    = [taskIds[8]!, taskIds[9]!]; // tasks 9, 10 (DOOMED + REDRIVEN)

    const packDir = path.join(repoRoot, 'contextpacks', 'stress-pack');
    await mkdir(packDir, { recursive: true });

    // Write kill request markers for the kill-path tasks (simulates the operator
    // kill-switch trigger). executeRequestedTaskKill reads this marker; without it
    // the function returns early with mode: 'kill-requested' (no marker found).
    await mkdir(paths.killRequestsDir, { recursive: true });
    for (const id of KILL_TASKS) {
      await writeFile(
        path.join(paths.killRequestsDir, `${id}.json`),
        JSON.stringify({
          schemaVersion: 1,
          taskId: id,
          requestedAt: new Date().toISOString(),
          requestedBy: 'taskboard',
          reason: 'operator-kill-switch',
        }),
      );
    }

    // Launch all 10 closeouts concurrently. They will race to acquire the queue
    // lock and each will run to completion before the next takes the lock.
    const completePromises = COMPLETE_TASKS.map((id) =>
      completePendingItem({ taskId: id, repoRoot, skipValidation: true, contextPackDir: packDir }),
    );
    const failPromises = FAIL_TASKS.map((id) =>
      moveFailedItemToErrorItems({ repoRoot, taskId: id }),
    );
  // Kill path: routes through executeRequestedTaskKill.
    // stopPipeline mock returns not-running → cross-process kill path writes
    // requestPipelineKill durable switch → windowMs=0 skips poll → runActiveKillCleanup
    // calls moveFailedItemToErrorItems internally.
    const killPromises = KILL_TASKS.map((id) =>
      executeRequestedTaskKill({ repoRoot, taskId: id, _crossProcessKillWindowMs: 0 }),
    );

    const allResults = await Promise.allSettled([...completePromises, ...failPromises, ...killPromises]);

    // Assertion (c): every closeout succeeded — no double-dispose, no lost task.
    for (const result of allResults) {
      expect(result.status, `expected fulfilled but got rejected: ${
        result.status === 'rejected' ? String(result.reason) : ''
      }`).toBe('fulfilled');
    }

    // No active markers remain — all tasks reached terminal state.
    const remainingActive = readdirSync(activeItemsDir).filter(
      (f) => !f.endsWith('.completing') && !f.endsWith('.d'),
    );
    expect(remainingActive).toHaveLength(0);

    // Failed and killed tasks must be in error-items.
    const errorItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'error-items');
    for (const id of [...FAIL_TASKS, ...KILL_TASKS]) {
      expect(existsSync(path.join(errorItemsDir, `${id}.md`))).toBe(true);
    }

    // Completed tasks: pending file removed (completePendingItem unlinks it).
    for (const id of COMPLETE_TASKS) {
      expect(existsSync(path.join(pendingDir, `${id}.md`))).toBe(false);
    }

    // Assertion (d): no cross-task notification bleed.
    // Each failed-notification call must carry a task ID in the fail/kill set.
    const expectedFailedIds = new Set([...FAIL_TASKS, ...KILL_TASKS]);
    const notifiedTaskIds = mockRecordTaskFailedNotification.mock.calls.map(
      (call) => call[0]?.taskId,
    );

    // No complete-task ID must appear in failure notifications.
    for (const id of COMPLETE_TASKS) {
      expect(notifiedTaskIds, `complete task ${id} leaked into fail notifications`).not.toContain(id);
    }

    // Every notified ID must be in the fail/kill set.
    for (const notifiedId of notifiedTaskIds) {
      expect(
        expectedFailedIds.has(notifiedId!),
        `unexpected task ${notifiedId} in fail notifications`,
      ).toBe(true);
    }

    // Each fail/kill task notified at most once (no double-notification).
    const notifiedCounts = new Map<string, number>();
    for (const id of notifiedTaskIds) {
      notifiedCounts.set(id!, (notifiedCounts.get(id!) ?? 0) + 1);
    }
    for (const [id, count] of notifiedCounts) {
      expect(count, `task ${id} was notified ${count} times (expected 1)`).toBe(1);
    }

    // Assertion (b) final sanity: getActiveTaskIds returns 0 after all closeouts,
    // confirming the cap was respected throughout (we observed 10 at peak, and
    // 0 at rest — no task bypassed the cap to exceed 10).
    expect(getActiveTaskIds(paths)).toHaveLength(0);
  });
});
