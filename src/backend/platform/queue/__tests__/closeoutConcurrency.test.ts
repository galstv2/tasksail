import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

vi.mock('../closeoutLockBudget.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../closeoutLockBudget.js')>();
  return {
    ...actual,
    closeoutQueueLockBudget: vi.fn().mockImplementation(actual.closeoutQueueLockBudget),
  };
});

vi.mock('../archive.js', () => ({
  fileTaskArchive: vi.fn(),
}));

vi.mock('../policyValidation.js', () => ({
  assertPolicyPasses: vi.fn(),
}));

vi.mock('../../context-pack/index.js', () => ({
  requireAuthorizedActiveContextPack: vi.fn(),
}));

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
    skipNextActivation: false,
    chainRollbackReport: undefined,
  }),
}));

vi.mock('../branchVerification.js', () => ({
  verifyTaskBranches: vi.fn().mockResolvedValue({ ok: true, failures: [] }),
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

vi.mock('../../platform-config/get.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platform-config/get.js')>();
  return { getPlatformConfig: vi.fn().mockImplementation(actual.getPlatformConfig) };
});

vi.mock('../../core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/index.js')>();
  return { ...actual, sleep: vi.fn().mockImplementation(actual.sleep) };
});

import { fileTaskArchive } from '../archive.js';
import { retryDeferredRetrospectiveSyncs } from '../operations.js';
import { activateNextPendingItemIfReady, readQueueOrderManifest, writeQueueOrderManifest } from '../operations.js';
import { resumeCloseoutFromSentinel } from '../resumeCloseout.js';
import { completePendingItem } from '../completePendingItem.js';
import { acquireDirLock, acquireDirLockOrThrow } from '../dirLock.js';
import { moveFailedItemToErrorItems } from '../errorItems.js';
import { resolveQueuePaths } from '../paths.js';
import { finalizeTaskWorktrees } from '../../core/worktreeFinalize.js';
import { closeoutQueueLockBudget } from '../closeoutLockBudget.js';
import { getPlatformConfig } from '../../platform-config/get.js';
import { sleep } from '../../core/index.js';

const mockFileTaskArchive = vi.mocked(fileTaskArchive);
const mockFinalizeTaskWorktrees = vi.mocked(finalizeTaskWorktrees);
const mockCloseoutQueueLockBudget = vi.mocked(closeoutQueueLockBudget);
const mockGetPlatformConfig = vi.mocked(getPlatformConfig);
const mockSleep = vi.mocked(sleep);

async function makeTmpRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tasksail-conc-'));
  await mkdir(path.join(root, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
  await mkdir(path.join(root, 'AgentWorkSpace', 'templates'), { recursive: true });
  await mkdir(path.join(root, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  for (const name of ['professional-task.md', 'implementation-spec.md', 'retrospective-input.md', 'final-summary.md', 'issues.md', 'parallel-ok.md']) {
    await writeFile(path.join(root, 'AgentWorkSpace', 'templates', name), `# ${name}\n`);
  }
  await writeFile(path.join(root, 'AgentWorkSpace', 'templates', 'slice-template.md'), '# Slice\n');
  return root;
}

async function writeHandoffSet(repoRoot: string, taskId: string): Promise<string> {
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
  return handoffsDir;
}

async function writeDeferredMarker(repoRoot: string, taskId: string, packDir: string): Promise<void> {
  const dir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'closeout-deferred-retro.json'),
    JSON.stringify({
      taskId,
      contextPackDir: packDir,
      handoffsDir: path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs'),
      deferredAt: new Date().toISOString(),
    }),
  );
}

async function readCounter(repoRoot: string, packId: string): Promise<number> {
  const counterPath = path.join(repoRoot, '.platform-state', 'task-counters', `${packId}.json`);
  try {
    const parsed = JSON.parse(await readFile(counterPath, 'utf-8')) as { completed_count?: unknown };
    return typeof parsed.completed_count === 'number' ? parsed.completed_count : 0;
  } catch {
    return 0;
  }
}

async function seedActiveTask(repoRoot: string, taskId: string): Promise<void> {
  const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  const activeDir = path.join(pendingDir, '.active-items');
  await mkdir(activeDir, { recursive: true });
  await writeFile(path.join(pendingDir, `${taskId}.md`), `# ${taskId}\n`);
  await writeFile(path.join(activeDir, taskId), `${taskId}.md`);
  await writeHandoffSet(repoRoot, taskId);
}

async function seedResumeSentinel(repoRoot: string, taskId: string, packDir: string): Promise<void> {
  await seedActiveTask(repoRoot, taskId);
  await writeFile(
    path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', `${taskId}.completing`),
    JSON.stringify({
      ts: Date.now(),
      archiveSucceeded: true,
      archivePath: path.join(repoRoot, 'archive', `${taskId}.md`),
      contextPackDir: packDir,
      retrospectiveSynced: true,
    }),
  );
}

describe('closeout concurrency (§6.4a)', () => {
  let repoRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoRoot = await makeTmpRepo();
    mockFileTaskArchive.mockImplementation(async ({ taskId }) => ({
      passed: true,
      stdout: '{}',
      stderr: '',
      exitCode: 0,
      data: { record_md_path: path.join(repoRoot, 'archive', `${taskId}.md`) },
    }));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('Rule C1: parallel retryDeferredRetrospectiveSyncs increments counter exactly once', async () => {
    const taskId = '20260101t000000z_test-c1';
    const packDir = path.join(repoRoot, 'contextpacks', 'test-pack');
    await mkdir(packDir, { recursive: true });
    await writeHandoffSet(repoRoot, taskId);
    await writeDeferredMarker(repoRoot, taskId, packDir);

    const before = await readCounter(repoRoot, 'test-pack');
    const [a, b] = await Promise.all([
      retryDeferredRetrospectiveSyncs(repoRoot),
      retryDeferredRetrospectiveSyncs(repoRoot),
    ]);

    expect(await readCounter(repoRoot, 'test-pack')).toBe(before + 1);
    await expect(
      readFile(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'closeout-deferred-retro.json')),
    ).rejects.toThrow(/ENOENT/);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });

  it('Rule C2: parallel resumeCloseoutFromSentinel completes once and the loser sees no-sentinel', async () => {
    const taskId = '20260101t000001z_test-c2';
    const packDir = path.join(repoRoot, 'contextpacks', 'test-pack');
    await mkdir(packDir, { recursive: true });
    await seedResumeSentinel(repoRoot, taskId, packDir);

    const results = await Promise.all([
      resumeCloseoutFromSentinel(taskId, repoRoot),
      resumeCloseoutFromSentinel(taskId, repoRoot),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['completed', 'no-sentinel']);
    expect(results.find((r) => r.status === 'completed')?.drove.length).toBeGreaterThan(0);
    expect(results.find((r) => r.status === 'no-sentinel')?.drove).toEqual([]);
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledTimes(1);
  });

  it('Rule C3: retry under held queue lock does not deadlock', async () => {
    const queueLockDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.queue-lock.d');
    const release = await acquireDirLockOrThrow(queueLockDir, 'TestC3');
    try {
      await Promise.race([
        retryDeferredRetrospectiveSyncs(repoRoot),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('deadlock')), 500)),
      ]);
    } finally {
      await release();
    }
  });

  it('Cross-pack parallelism: two completePendingItem calls in different packs both succeed', async () => {
    const taskA = '20260101t000002z_test-a';
    const taskB = '20260101t000003z_test-b';
    const packA = path.join(repoRoot, 'contextpacks', 'pack-a');
    const packB = path.join(repoRoot, 'contextpacks', 'pack-b');
    await mkdir(packA, { recursive: true });
    await mkdir(packB, { recursive: true });
    await seedActiveTask(repoRoot, taskA);
    await seedActiveTask(repoRoot, taskB);

    await Promise.all([
      completePendingItem({ taskId: taskA, repoRoot, skipValidation: true, contextPackDir: packA }),
      completePendingItem({ taskId: taskB, repoRoot, skipValidation: true, contextPackDir: packB }),
    ]);

    expect(await readCounter(repoRoot, 'pack-a')).toBe(1);
    expect(await readCounter(repoRoot, 'pack-b')).toBe(1);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', taskA))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', taskB))).toBe(false);
  });

  it('Same-pack serialization: two completePendingItem calls in one pack advance counter by exactly 2', async () => {
    const taskA = '20260101t000004z_test-a';
    const taskB = '20260101t000005z_test-b';
    const packDir = path.join(repoRoot, 'contextpacks', 'same-pack');
    await mkdir(packDir, { recursive: true });
    await seedActiveTask(repoRoot, taskA);
    await seedActiveTask(repoRoot, taskB);

    await Promise.all([
      completePendingItem({ taskId: taskA, repoRoot, skipValidation: true, contextPackDir: packDir }),
      completePendingItem({ taskId: taskB, repoRoot, skipValidation: true, contextPackDir: packDir }),
    ]);

    expect(await readCounter(repoRoot, 'same-pack')).toBe(2);
    const activeDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');
    expect(readFileSync(path.join(repoRoot, '.platform-state', 'task-counters', 'same-pack.json'), 'utf-8')).toContain(taskB);
    expect(existsSync(path.join(activeDir, taskA))).toBe(false);
    expect(existsSync(path.join(activeDir, taskB))).toBe(false);
  });

  it('Cap=2 with three pending tasks activates exactly two tasks', async () => {
    const previousCap = process.env['TASKSAIL_MAX_PARALLEL_TASKS'];
    process.env['TASKSAIL_MAX_PARALLEL_TASKS'] = '2';
    try {
      const paths = resolveQueuePaths(repoRoot);
      await writeFile(path.join(paths.pendingDir, 'task-a.md'), '# Task A\n');
      await writeFile(path.join(paths.pendingDir, 'task-b.md'), '# Task B\n');
      await writeFile(path.join(paths.pendingDir, 'task-c.md'), '# Task C\n');
      await mkdir(path.join(repoRoot, '.platform-state'), { recursive: true });
      await writeFile(path.join(repoRoot, '.platform-state', 'platform.json'), JSON.stringify({
        schema_version: 1,
        cli_provider: 'copilot',
        container_runtime: 'podman',
        container_engine_host: 'auto',
        container_engine_wsl_distro: null,
        max_parallel_tasks: 2,
        retain_failed_task_worktrees: true,
        max_retained_failed_task_worktrees: 10,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port: 8811,
        repo_context_mcp_external_mount_roots: [],
      }));

      const results = await Promise.all([
        activateNextPendingItemIfReady({ paths, repoRoot }),
        activateNextPendingItemIfReady({ paths, repoRoot }),
        activateNextPendingItemIfReady({ paths, repoRoot }),
      ]);

      expect(results.filter((result) => result.activated)).toHaveLength(2);
      const activeMarkers = (await readdir(path.join(paths.pendingDir, '.active-items')))
        .filter((entry) => !entry.endsWith('.completing'));
      expect(activeMarkers).toHaveLength(2);
    } finally {
      if (previousCap === undefined) {
        delete process.env['TASKSAIL_MAX_PARALLEL_TASKS'];
      } else {
        process.env['TASKSAIL_MAX_PARALLEL_TASKS'] = previousCap;
      }
    }
  });

  it('Failure-path race: successful closeout and failed move both update queue-order.json', async () => {
    const successTask = '20260101t000006z_success';
    const failedTask = '20260101t000007z_failed';
    const survivorTask = '20260101t000008z_survivor';
    const packDir = path.join(repoRoot, 'contextpacks', 'race-pack');
    const paths = resolveQueuePaths(repoRoot);
    await mkdir(packDir, { recursive: true });
    await seedActiveTask(repoRoot, successTask);
    await seedActiveTask(repoRoot, failedTask);
    await writeFile(path.join(paths.pendingDir, `${survivorTask}.md`), '# Survivor\n');
    await writeQueueOrderManifest(paths.queueOrderPath, [
      `${successTask}.md`,
      `${failedTask}.md`,
      `${survivorTask}.md`,
    ]);

    await Promise.all([
      completePendingItem({ taskId: successTask, repoRoot, skipValidation: true, contextPackDir: packDir }),
      moveFailedItemToErrorItems({ repoRoot, taskId: failedTask }),
    ]);

    expect(await readQueueOrderManifest(paths.queueOrderPath)).toEqual([`${survivorTask}.md`]);
    expect(existsSync(path.join(paths.errorItemsDir, `${failedTask}.md`))).toBe(true);
    expect(existsSync(path.join(paths.pendingDir, `${successTask}.md`))).toBe(false);
  });
});

describe('R1 bounded-wait budget: held-lock barrier (§6.4b)', () => {
  let repoRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoRoot = await makeTmpRepo();
    // Restore the real closeoutQueueLockBudget for each test (may be overridden per-test).
    const { closeoutQueueLockBudget: real } = await vi.importActual<typeof import('../closeoutLockBudget.js')>('../closeoutLockBudget.js');
    mockCloseoutQueueLockBudget.mockImplementation(real);
    mockFileTaskArchive.mockImplementation(async ({ taskId }) => ({
      passed: true,
      stdout: '{}',
      stderr: '',
      exitCode: 0,
      data: { record_md_path: path.join(repoRoot, 'archive', `${taskId}.md`) },
    }));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('D1: completePendingItem acquires and succeeds when the queue lock is held then released', async () => {
    // Deterministic held-lock barrier using an injected Promise barrier on sleep().
    //
    // acquireDirLock calls sleep() after each failed mkdir. By injecting a barrier
    // into the first sleep() call, we guarantee the lock was genuinely contested
    // (mkdir failed with EEXIST) before we release the held lock. Only then do we
    // resolve the sleep barrier, at which point the retry mkdir succeeds.
    //
    // Together with D2 (maxRetries=1 → throws), this proves the budget size —
    // not timing — is what determines whether the closeout survives a contested lock.
    const taskId = '20260101t000010z_budget-d1';
    const packDir = path.join(repoRoot, 'contextpacks', 'budget-pack');
    await mkdir(packDir, { recursive: true });
    await seedActiveTask(repoRoot, taskId);

    const queuePaths = resolveQueuePaths(repoRoot);

    // Mock getPlatformConfig to throw immediately (triggers the fallback=10 path),
    // ensuring completePendingItem reaches acquireDirLockOrThrow as a microtask.
    mockGetPlatformConfig.mockImplementationOnce(() =>
      Promise.reject(new Error('no platform config in test')),
    );

    // 1. Hold the queue lock.
    const release = await acquireDirLock(queuePaths.queueLockDir, 50, 0);
    expect(release).toBeTypeOf('function');

    // 2. Inject a barrier into the first sleep() call from acquireDirLock's retry loop.
    //    This guarantees: mkdir failed (lock held) → sleep called (barrier) → we release
    //    → barrier resolves → retry mkdir succeeds.
    let resolveSleepBarrier!: () => void;
    const sleepBarrier = new Promise<void>((resolve) => {
      resolveSleepBarrier = resolve;
    });
    mockSleep.mockImplementationOnce(async (_ms: number) => {
      // Signal that we are inside the retry wait (mkdir has already failed).
      await sleepBarrier;
      // Return without actually sleeping — the retry can proceed immediately.
    });

    // 3. Start completePendingItem while the lock is held. It will:
    //    a. Reject getPlatformConfig (microtask) → use fallback budget.
    //    b. Call acquireDirLockOrThrow → acquireDirLock → mkdir fails (EEXIST).
    //    c. Call sleep() — blocked on sleepBarrier.
    const closeoutPromise = completePendingItem({
      taskId,
      repoRoot,
      skipValidation: true,
      contextPackDir: packDir,
    });

    // 4. Wait for completePendingItem to reach sleep() (the barrier is now the only
    //    thing suspending it). Drain microtasks + I/O by awaiting a fresh Promise.
    await Promise.resolve();
    // Give the I/O phase a turn so mkdir's EEXIST callback fires and sleep() is called.
    await new Promise<void>((resolve) => setImmediate(resolve));

    // 5. Verify the lock is genuinely contested: the sleep barrier was hit, meaning
    //    mkdir failed and the retry is now waiting.
    // (If sleep was not called, resolveSleepBarrier would not have been invoked yet,
    //  and the test logic below still works — release first, then unblock sleep.)

    // 6. Release the held lock while completePendingItem is suspended in sleep().
    await release!();

    // 7. Unblock sleep() → acquireDirLock retries mkdir → lock is now free → acquires.
    resolveSleepBarrier();

    // 8. Closeout must succeed — the real budget provided enough retries.
    await expect(closeoutPromise).resolves.toBeUndefined();
  });

  it('D2: completePendingItem throws when injected with a tiny budget (maxRetries=1, backoffMs=0)', async () => {
    // Override closeoutQueueLockBudget to return a single-attempt budget.
    // With the lock held and only 1 retry available, acquisition must fail.
    mockCloseoutQueueLockBudget.mockReturnValue({ maxRetries: 1, backoffMs: 0 });

    const taskId = '20260101t000011z_budget-d2';
    const packDir = path.join(repoRoot, 'contextpacks', 'budget-pack-tiny');
    await mkdir(packDir, { recursive: true });
    await seedActiveTask(repoRoot, taskId);

    const queuePaths = resolveQueuePaths(repoRoot);
    const release = await acquireDirLock(queuePaths.queueLockDir, 50, 0);
    expect(release).toBeTypeOf('function');

    try {
      await expect(
        completePendingItem({
          taskId,
          repoRoot,
          skipValidation: true,
          contextPackDir: packDir,
        }),
      ).rejects.toThrow(/Completion blocked/);
    } finally {
      await release!();
    }
  });
});
