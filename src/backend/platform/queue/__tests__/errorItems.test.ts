/**
 * §4.14A Error Items tests — blast-radius isolation, retry-suffix collision,
 * and retry-generations-exhausted enforcement.
 *
 * All git I/O, finalizeTaskWorktrees, and platform-config are mocked so these
 * tests run without real git repos, real sockets, or real worktrees.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// ---------------------------------------------------------------------------
// Mock modules before importing the module under test.
// vi.mock calls are automatically hoisted to the top of the file.
// ---------------------------------------------------------------------------

vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn(),
}));

// We mock node:child_process execFile to control git for-each-ref output used by
// pickNextRetryN inside errorItems.ts. The promisify wrapper uses util.promisify(execFile).
// Node's real execFile has a [util.promisify.custom] symbol that resolves { stdout, stderr }.
// We replicate that to make promisify(mockExecFile) return { stdout, stderr }.
//
// IMPORTANT: The mock's [promisify.custom] is configured per-test to control for-each-ref
// output. For git commands NOT related to for-each-ref (e.g., rev-parse, worktree),
// the default behavior throws (simulating a non-git directory), which causes:
// - preconditionsPass to return { ok: false, reason: 'empty-origin-repo' } → L0 fallback
// - commitTaskSnapshot to log a warning (best-effort, doesn't throw)
// This means activateNextPendingItemIfReady uses L0 mode (worktreeRoot = originalRoot).
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mockExecFile = vi.fn();
  // Default: fail (simulates non-git directory). Per-test overrides control for-each-ref.
  const defaultCustom = vi.fn().mockRejectedValue(new Error('not a git repository'));
  (mockExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = defaultCustom;
  return {
    ...actual,
    spawn: actual.spawn, // keep real spawn for runGit (best-effort, errors are swallowed)
    execFile: mockExecFile,
  };
});

// Import mocked modules
import { finalizeTaskWorktrees } from '../../core/worktreeFinalize.js';
import { getPlatformConfig } from '../../platform-config/get.js';
import { execFile as execFileMocked } from 'node:child_process';

// Import module under test AFTER mocks are in place
import { moveFailedItemToErrorItems, requeueErrorItem } from '../errorItems.js';
import { resolveQueuePaths } from '../paths.js';

const mockFinalizeTaskWorktrees = vi.mocked(finalizeTaskWorktrees);
const mockGetPlatformConfig = vi.mocked(getPlatformConfig);
// The custom promisify symbol on the mock — used to control git for-each-ref output
function getMockExecFilePromisified(): ReturnType<typeof vi.fn> {
  return (execFileMocked as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[promisify.custom] as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskJson(
  taskId: string,
  repoRoot: string,
  repoBindings: Array<{ originalRoot: string; worktreeRoot: string; worktreeBranch: string; baseCommitSha: string }>,
  state: 'active' | 'failed' = 'active',
): void {
  const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    path.join(taskDir, '.task.json'),
    JSON.stringify({
      schema_version: 1,
      taskId,
      state,
      frozenAt: new Date().toISOString(),
      finalizedAt: state === 'failed' ? new Date().toISOString() : null,
      contextPackBinding: {
        contextPackPath: null,
        dataHostDir: null,
        dataContainerDir: null,
        repoBindings,
      },
      materialization: {
        strategy: 'copy',
        cloned: [],
        skipped: [],
        composeProjectName: 'repo-context-mcp',
      },
    }, null, 2) + '\n',
    'utf-8',
  );
}

function makeActiveMarker(
  queuePaths: ReturnType<typeof resolveQueuePaths>,
  taskId: string,
): void {
  mkdirSync(queuePaths.activeItemsDir, { recursive: true });
  writeFileSync(path.join(queuePaths.activeItemsDir, taskId), `${taskId}.md`, 'utf-8');
}

function makePendingItem(
  queuePaths: ReturnType<typeof resolveQueuePaths>,
  taskId: string,
): void {
  mkdirSync(queuePaths.pendingDir, { recursive: true });
  writeFileSync(path.join(queuePaths.pendingDir, `${taskId}.md`), `# ${taskId}\n`, 'utf-8');
}

function makeErrorItem(
  queuePaths: ReturnType<typeof resolveQueuePaths>,
  taskId: string,
): void {
  mkdirSync(queuePaths.errorItemsDir, { recursive: true });
  writeFileSync(path.join(queuePaths.errorItemsDir, `${taskId}.md`), `# ${taskId}\n`, 'utf-8');
}

function makeTaskRuntime(root: string, taskId: string): string {
  const runtimePath = path.join(root, '.platform-state', 'runtime', 'tasks', taskId);
  mkdirSync(runtimePath, { recursive: true });
  return runtimePath;
}

function getMtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return -1;
  }
}

function seedPortAllocation(root: string, taskId: string): void {
  const tablePath = path.join(root, '.platform-state', 'runtime', 'port-allocations.json');
  mkdirSync(path.dirname(tablePath), { recursive: true });
  let table: Record<string, unknown> = {};
  try {
    table = JSON.parse(readFileSync(tablePath, 'utf-8')) as Record<string, unknown>;
  } catch { /* absent — start fresh */ }
  table[taskId] = { port: 9000 };
  writeFileSync(tablePath, JSON.stringify(table, null, 2) + '\n', 'utf-8');
}

function readPortAllocations(root: string): Record<string, unknown> {
  const tablePath = path.join(root, '.platform-state', 'runtime', 'port-allocations.json');
  try {
    return JSON.parse(readFileSync(tablePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function seedTemplates(repoRoot: string): void {
  const templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
  mkdirSync(templatesDir, { recursive: true });
  const handoffFiles = [
    'professional-task.md', 'implementation-spec.md', 'retrospective-input.md',
    'final-summary.md', 'issues.md', 'parallel-ok.md',
  ];
  for (const f of handoffFiles) {
    writeFileSync(path.join(templatesDir, f), `# ${f}\n`, 'utf-8');
  }
  writeFileSync(path.join(templatesDir, 'slice-template.md'), '# slice\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Default platform config
// ---------------------------------------------------------------------------

const DEFAULT_PLATFORM_CONFIG = {
  schema_version: 1,
  container_runtime: 'docker' as const,
  max_parallel_tasks: 3,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  mcp_port_range: { min: 8811, max: 8820 },
};

// ---------------------------------------------------------------------------
// Suite 1: blast-radius three-task isolation (A/B/C)
// ---------------------------------------------------------------------------

describe('§4.14A blast-radius: three-task isolation (A/B/C)', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformConfig.mockResolvedValue(DEFAULT_PLATFORM_CONFIG);
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);

    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-4.14A-abc-'));
    seedTemplates(repoRoot);
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('failing Task B leaves A and C markers, task.json state, and runtime subtrees intact', async () => {
    const queuePaths = resolveQueuePaths(repoRoot);

    // Seed Tasks A, B, C as active
    for (const taskId of ['task-A', 'task-B', 'task-C']) {
      makePendingItem(queuePaths, taskId);
      makeActiveMarker(queuePaths, taskId);
      makeTaskJson(taskId, repoRoot, []);
      makeTaskRuntime(repoRoot, taskId);
      seedPortAllocation(repoRoot, taskId);
    }

    // Snapshot runtime mtimes for A and C BEFORE failing B
    const runtimeA = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-A');
    const runtimeC = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-C');
    const mtimeA_before = getMtime(runtimeA);
    const mtimeC_before = getMtime(runtimeC);

    // Fail Task B
    await moveFailedItemToErrorItems({ repoRoot, taskId: 'task-B' });

    // (a) A and C active markers still present
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-A'))).toBe(true);
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-C'))).toBe(true);

    // B's marker removed
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-B'))).toBe(false);

    // (b) A and C task.json still have state "active"
    const taskJsonA = JSON.parse(
      readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-A', '.task.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const taskJsonC = JSON.parse(
      readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-C', '.task.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(taskJsonA['state']).toBe('active');
    expect(taskJsonC['state']).toBe('active');

    // (c) A and C worktree dirs/branches intact — since finalizeTaskWorktrees is mocked,
    //     it only runs for B (verified by call count below). A/C bindings are empty
    //     so no dirs to check, but the mock confirms they weren't targeted.

    // (d) A and C runtime subtrees not touched (mtimes unchanged)
    expect(getMtime(runtimeA)).toBe(mtimeA_before);
    expect(getMtime(runtimeC)).toBe(mtimeC_before);

    // (e) A and C port allocations still in table
    const table = readPortAllocations(repoRoot);
    expect('task-A' in table).toBe(true);
    expect('task-C' in table).toBe(true);
    // B's port allocation removed
    expect('task-B' in table).toBe(false);

    // (f) finalizeTaskWorktrees called ONLY for B
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledTimes(1);
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledWith('task-B', 'failed', repoRoot);

    // (h) queue order: A and C pending items still present
    expect(existsSync(path.join(queuePaths.pendingDir, 'task-A.md'))).toBe(true);
    expect(existsSync(path.join(queuePaths.pendingDir, 'task-C.md'))).toBe(true);
    expect(existsSync(path.join(queuePaths.pendingDir, 'task-B.md'))).toBe(false);

    // (i) B moved to error-items
    expect(existsSync(path.join(queuePaths.errorItemsDir, 'task-B.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: cross-origin single-task fail
// ---------------------------------------------------------------------------

describe('§4.14A cross-origin single-task fail: A binds X+Y, B binds X+Z', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformConfig.mockResolvedValue(DEFAULT_PLATFORM_CONFIG);
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);

    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-4.14A-cross-'));
    seedTemplates(repoRoot);
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('finalizeTaskWorktrees called only for A; B runtime untouched', async () => {
    const queuePaths = resolveQueuePaths(repoRoot);

    const originX = path.join(repoRoot, 'repos', 'X');
    const originY = path.join(repoRoot, 'repos', 'Y');
    const originZ = path.join(repoRoot, 'repos', 'Z');

    // Task A: binds X and Y
    makePendingItem(queuePaths, 'task-A');
    makeActiveMarker(queuePaths, 'task-A');
    makeTaskJson('task-A', repoRoot, [
      { originalRoot: originX, worktreeRoot: path.join(repoRoot, 'wt', 'A-X'), worktreeBranch: 'task/task-A', baseCommitSha: 'aaa1' },
      { originalRoot: originY, worktreeRoot: path.join(repoRoot, 'wt', 'A-Y'), worktreeBranch: 'task/task-A', baseCommitSha: 'bbb1' },
    ]);
    makeTaskRuntime(repoRoot, 'task-A');

    // Task B: binds X and Z
    makePendingItem(queuePaths, 'task-B');
    makeActiveMarker(queuePaths, 'task-B');
    makeTaskJson('task-B', repoRoot, [
      { originalRoot: originX, worktreeRoot: path.join(repoRoot, 'wt', 'B-X'), worktreeBranch: 'task/task-B', baseCommitSha: 'ccc1' },
      { originalRoot: originZ, worktreeRoot: path.join(repoRoot, 'wt', 'B-Z'), worktreeBranch: 'task/task-B', baseCommitSha: 'ddd1' },
    ]);
    const runtimeB = makeTaskRuntime(repoRoot, 'task-B');
    const mtimeB = getMtime(runtimeB);

    // Fail Task A
    await moveFailedItemToErrorItems({ repoRoot, taskId: 'task-A' });

    // finalizeTaskWorktrees called exactly once, for task-A only
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledTimes(1);
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledWith('task-A', 'failed', repoRoot);

    // Task B's runtime subtree untouched
    expect(getMtime(runtimeB)).toBe(mtimeB);

    // Task B's active marker still present
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-B'))).toBe(true);

    // Task A moved to error-items
    expect(existsSync(path.join(queuePaths.errorItemsDir, 'task-A.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: peer worktree isolation
// ---------------------------------------------------------------------------

describe('§4.14A peer worktree isolation: A and B share origin X', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformConfig.mockResolvedValue(DEFAULT_PLATFORM_CONFIG);
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);

    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-4.14A-peer-'));
    seedTemplates(repoRoot);
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('failing A does not touch B worktree; finalizeTaskWorktrees not called for B', async () => {
    const queuePaths = resolveQueuePaths(repoRoot);

    const originX = path.join(repoRoot, 'repos', 'X');
    const wtB = path.join(repoRoot, 'wt', 'B');

    // Set up B's worktree directory with a sentinel file
    mkdirSync(wtB, { recursive: true });
    writeFileSync(path.join(wtB, 'B-sentinel.txt'), 'B-data', 'utf-8');
    const mtimeBWt = getMtime(wtB);

    // Task A and B both bind origin X with their own worktrees
    makePendingItem(queuePaths, 'task-A');
    makeActiveMarker(queuePaths, 'task-A');
    makeTaskJson('task-A', repoRoot, [
      { originalRoot: originX, worktreeRoot: path.join(repoRoot, 'wt', 'A'), worktreeBranch: 'task/task-A', baseCommitSha: 'aaa' },
    ]);
    makeTaskRuntime(repoRoot, 'task-A');

    makePendingItem(queuePaths, 'task-B');
    makeActiveMarker(queuePaths, 'task-B');
    makeTaskJson('task-B', repoRoot, [
      { originalRoot: originX, worktreeRoot: wtB, worktreeBranch: 'task/task-B', baseCommitSha: 'bbb' },
    ]);
    makeTaskRuntime(repoRoot, 'task-B');

    // Fail Task A
    await moveFailedItemToErrorItems({ repoRoot, taskId: 'task-A' });

    // B's worktree dir untouched (mocked finalizeTaskWorktrees only called for A)
    expect(getMtime(wtB)).toBe(mtimeBWt);
    expect(existsSync(path.join(wtB, 'B-sentinel.txt'))).toBe(true);

    // finalizeTaskWorktrees only called for A, never for B
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledWith('task-A', 'failed', repoRoot);
    expect(mockFinalizeTaskWorktrees).not.toHaveBeenCalledWith('task-B', expect.anything(), expect.anything());
  });
});

// ---------------------------------------------------------------------------
// Suite 4: activation after failure
// ---------------------------------------------------------------------------

describe('§4.14A activation after failure (cap=2, B active, A fails, D pending)', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // Cap = 2: after A fails, count drops to 1 (B), so D can be activated
    mockGetPlatformConfig.mockResolvedValue({
      ...DEFAULT_PLATFORM_CONFIG,
      max_parallel_tasks: 2,
    });
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);

    // The execFile mock (set up at the top of the file) defaults to rejecting,
    // which causes preconditionsPass to return 'empty-origin-repo' → L0 fallback:
    // worktreeRoot = originalRoot (no git worktree add). This lets activation
    // proceed without real git infrastructure.

    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-4.14A-activate-'));
    seedTemplates(repoRoot);
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state', 'queue'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('activates pending D after A fails, B remains active; activateNextPendingItemIfReady runs', async () => {
    const queuePaths = resolveQueuePaths(repoRoot);

    // Task A active
    makePendingItem(queuePaths, 'task-A');
    makeActiveMarker(queuePaths, 'task-A');
    makeTaskJson('task-A', repoRoot, []);
    makeTaskRuntime(repoRoot, 'task-A');

    // Task B active
    makePendingItem(queuePaths, 'task-B');
    makeActiveMarker(queuePaths, 'task-B');
    makeTaskJson('task-B', repoRoot, []);
    makeTaskRuntime(repoRoot, 'task-B');

    // Task D is pending (not active)
    makePendingItem(queuePaths, 'task-D');

    // Fail Task A — active count drops from 2 to 1, cap=2, D should activate
    const result = await moveFailedItemToErrorItems({ repoRoot, taskId: 'task-A' });

    // A moved to error-items
    expect(existsSync(path.join(queuePaths.errorItemsDir, 'task-A.md'))).toBe(true);

    // B's marker still present — B is untouched
    expect(existsSync(path.join(queuePaths.activeItemsDir, 'task-B'))).toBe(true);

    // finalizeTaskWorktrees called only for A (not B)
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledTimes(1);
    expect(mockFinalizeTaskWorktrees).toHaveBeenCalledWith('task-A', 'failed', repoRoot);

    // Verify activateNextPendingItemIfReady ran and picked D:
    // Either nextActiveItem is set (D was activated successfully) or D's active marker exists.
    const activeMarkers = existsSync(queuePaths.activeItemsDir)
      ? readdirSync(queuePaths.activeItemsDir).filter((f) => !f.endsWith('.completing'))
      : [];

    // B is still active
    expect(activeMarkers).toContain('task-B');

    // D was activated: marker or nextActiveItem references it
    const dActivated =
      activeMarkers.includes('task-D') ||
      (result.nextActiveItem !== null && /task-D/.test(result.nextActiveItem ?? ''));
    expect(dActivated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: retry-generations-exhausted
// ---------------------------------------------------------------------------

describe('§4.14A retry-generations-exhausted', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformConfig.mockResolvedValue({
      ...DEFAULT_PLATFORM_CONFIG,
      max_retry_generations_per_slug: 5,
    });
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);

    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-4.14A-exhaust-'));
    seedTemplates(repoRoot);
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state', 'queue'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('rejects requeueErrorItem when 5 retry branches exist in origin; no new branch or activation', async () => {
    const queuePaths = resolveQueuePaths(repoRoot);
    const originX = path.join(repoRoot, 'repos', 'X');
    const originalTaskId = 'task-abc';

    // Seed the failed error item
    makeErrorItem(queuePaths, originalTaskId);

    // Seed .task.json for the failed task with a binding to originX
    makeTaskJson(originalTaskId, repoRoot, [
      {
        originalRoot: originX,
        worktreeRoot: path.join(repoRoot, 'wt', 'abc'),
        worktreeBranch: `task/${originalTaskId}`,
        baseCommitSha: 'abc123',
      },
    ], 'failed');

    // Configure mock: for-each-ref → retry1..retry5; all other git calls → fail.
    getMockExecFilePromisified().mockImplementation(
      async (_cmd: unknown, args: unknown): Promise<{ stdout: string; stderr: string }> => {
        const argsArr = args as string[];
        if (argsArr.includes('for-each-ref')) {
          return {
            stdout: 'task/task-abc-retry1\ntask/task-abc-retry2\ntask/task-abc-retry3\ntask/task-abc-retry4\ntask/task-abc-retry5\n',
            stderr: '',
          };
        }
        throw new Error('not a git repository');
      },
    );

    let caughtError: unknown;
    try {
      await requeueErrorItem({
        fileName: `${originalTaskId}.md`,
        insertAtIndex: 0,
        repoRoot,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    const err = caughtError as Error & {
      code: string;
      slug: string;
      cap: number;
      foundGenerations: number[];
    };
    expect(err.code).toBe('retry-generations-exhausted');
    expect(err.slug).toBe('task-abc');
    expect(err.cap).toBe(5);
    expect(err.foundGenerations).toEqual([1, 2, 3, 4, 5]);

    // Error item NOT moved to pending (still in error-items since we errored BEFORE rename)
    expect(existsSync(path.join(queuePaths.errorItemsDir, `${originalTaskId}.md`))).toBe(true);

    // No pending items with retry suffix
    const pendingFiles = existsSync(queuePaths.pendingDir)
      ? readdirSync(queuePaths.pendingDir).filter((f) => f.endsWith('.md'))
      : [];
    expect(pendingFiles.some((f) => f.includes('retry'))).toBe(false);

    // No activation triggered
    const activeMarkers = existsSync(queuePaths.activeItemsDir)
      ? readdirSync(queuePaths.activeItemsDir).filter((f) => !f.endsWith('.completing'))
      : [];
    expect(activeMarkers.length).toBe(0);
  });

  it('assigns retry1 suffix when no retry branches exist', async () => {
    const queuePaths = resolveQueuePaths(repoRoot);
    const originX = path.join(repoRoot, 'repos', 'X');
    const originalTaskId = 'task-fresh';

    // Ensure pendingDir exists so rename can succeed
    mkdirSync(queuePaths.pendingDir, { recursive: true });
    makeErrorItem(queuePaths, originalTaskId);
    makeTaskJson(originalTaskId, repoRoot, [
      {
        originalRoot: originX,
        worktreeRoot: path.join(repoRoot, 'wt', 'fresh'),
        worktreeBranch: `task/${originalTaskId}`,
        baseCommitSha: 'fresh123',
      },
    ], 'failed');

    // Smart mock: for-each-ref → empty (no existing retries); everything else → reject
    // so preconditionsPass returns 'empty-origin-repo' → L0 activation fallback.
    getMockExecFilePromisified().mockImplementation(
      async (_cmd: unknown, args: unknown): Promise<{ stdout: string; stderr: string }> => {
        const argsArr = args as string[];
        if (argsArr.includes('for-each-ref')) {
          return { stdout: '', stderr: '' };
        }
        throw new Error('not a git repository');
      },
    );

    const result = await requeueErrorItem({
      fileName: `${originalTaskId}.md`,
      insertAtIndex: 0,
      repoRoot,
    });

    // Returned filename uses retry1 suffix
    expect(result.requeuedItem).toBe('task-fresh-retry1.md');

    // Original error item moved out of error-items
    expect(existsSync(path.join(queuePaths.errorItemsDir, `${originalTaskId}.md`))).toBe(false);
  });

  it('picks retry3 when retry1 exists in X and retry2 exists in Y (union scan)', async () => {
    const queuePaths = resolveQueuePaths(repoRoot);
    const originX = path.join(repoRoot, 'repos', 'X');
    const originY = path.join(repoRoot, 'repos', 'Y');
    const originalTaskId = 'task-multi';

    mkdirSync(queuePaths.pendingDir, { recursive: true });
    mkdirSync(queuePaths.errorItemsDir, { recursive: true });
    makeErrorItem(queuePaths, originalTaskId);
    makeTaskJson(originalTaskId, repoRoot, [
      { originalRoot: originX, worktreeRoot: path.join(repoRoot, 'wt', 'mX'), worktreeBranch: `task/${originalTaskId}`, baseCommitSha: 'x1' },
      { originalRoot: originY, worktreeRoot: path.join(repoRoot, 'wt', 'mY'), worktreeBranch: `task/${originalTaskId}`, baseCommitSha: 'y1' },
    ], 'failed');

    // X has retry1, Y has retry2 — union = {1,2} → pick 3
    // Smart mock: for-each-ref returns per-origin branch lists; all other commands fail.
    let callCount = 0;
    getMockExecFilePromisified().mockImplementation(
      async (_cmd: unknown, args: unknown): Promise<{ stdout: string; stderr: string }> => {
        const argsArr = args as string[];
        if (argsArr.includes('for-each-ref')) {
          const cIdx = argsArr.indexOf('-C');
          const originArg = cIdx >= 0 ? argsArr[cIdx + 1] : '';
          callCount++;
          if (originArg === originX) {
            return { stdout: 'task/task-multi-retry1\n', stderr: '' };
          }
          return { stdout: 'task/task-multi-retry2\n', stderr: '' };
        }
        throw new Error('not a git repository');
      },
    );

    const result = await requeueErrorItem({
      fileName: `${originalTaskId}.md`,
      insertAtIndex: 0,
      repoRoot,
    });

    expect(result.requeuedItem).toBe('task-multi-retry3.md');
    // Scanned at least both origins (once in pickNextRetryN)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: F7 pipeline.lock removal before finalizeTaskWorktrees
// ---------------------------------------------------------------------------

describe('§4.14A F7: pipeline.lock removed unconditionally before finalizeTaskWorktrees', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformConfig.mockResolvedValue(DEFAULT_PLATFORM_CONFIG);
    mockFinalizeTaskWorktrees.mockResolvedValue(undefined);

    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-4.14A-f7-'));
    seedTemplates(repoRoot);
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('pipeline.lock dir is absent when finalizeTaskWorktrees is called', async () => {
    const queuePaths = resolveQueuePaths(repoRoot);
    const taskId = 'task-lock-test';

    makePendingItem(queuePaths, taskId);
    makeActiveMarker(queuePaths, taskId);
    makeTaskJson(taskId, repoRoot, []);
    makeTaskRuntime(repoRoot, taskId);

    // Create a pipeline.lock directory inside the task runtime
    const lockDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'pipeline.lock');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(path.join(lockDir, 'owner.json'), '{"pid":9999}', 'utf-8');

    // Capture whether lock existed when finalizeTaskWorktrees runs
    let lockExistedAtFinalize = true;
    mockFinalizeTaskWorktrees.mockImplementation(async () => {
      lockExistedAtFinalize = existsSync(lockDir);
    });

    await moveFailedItemToErrorItems({ repoRoot, taskId });

    // Pipeline lock must have been removed BEFORE finalizeTaskWorktrees
    expect(lockExistedAtFinalize).toBe(false);
    // And still gone after
    expect(existsSync(lockDir)).toBe(false);
  });
});
