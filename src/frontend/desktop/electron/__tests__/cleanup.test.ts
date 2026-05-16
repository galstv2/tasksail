// @vitest-environment node
/**
 * §4.10 cleanup-on-quit test suite.
 *
 * Five test cases mandated by the Done-when contract:
 * 1. 2-parallel-task SIGKILL-restart (worktrees torn down, dropbox restored)
 * 2. Sync-contract (void return type, no Promise)
 * 3. Retention-ignored (retain_failed_task_worktrees=true still tears down)
 * 4. Active task branches are removed while legacy completed branches survive
 * 5. Corrupt-sidecar resilience
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Test repo root fixture (isolated per-test) ───────────────────────────────

let TEST_REPO_ROOT: string;

vi.mock('../paths', () => ({
  get REPO_ROOT() {
    return TEST_REPO_ROOT;
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal git repo with one commit so branches can be created/deleted.
 */
function createGitRepo(parentDir: string): string {
  const dir = mkdtempSync(join(parentDir, 'repo-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

/**
 * Create a git worktree in originalRoot at worktreePath on branchName.
 */
function createWorktree(originalRoot: string, worktreePath: string, branchName: string): void {
  mkdirSync(join(worktreePath, '..'), { recursive: true });
  execFileSync('git', ['-C', originalRoot, 'worktree', 'add', worktreePath, '-b', branchName], { stdio: 'pipe' });
}

/**
 * Write a .task.json sidecar into AgentWorkSpace/tasks/<taskId>/.task.json.
 */
function writeTaskJson(
  repoRoot: string,
  taskId: string,
  originalRoot: string,
  worktreeRoot: string,
  worktreeBranch: string,
  state = 'active',
): void {
  const taskDir = join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(taskDir, { recursive: true });
  const sidecar = {
    schema_version: 1,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: [
        {
          originalRoot,
          worktreeRoot,
          worktreeBranch,
          baseCommitSha: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
        },
      ],
    },
    state,
    frozenAt: new Date().toISOString(),
    finalizedAt: null,
  };
  writeFileSync(join(taskDir, '.task.json'), JSON.stringify(sidecar, null, 2) + '\n');
}

/**
 * Write a task entry .md file into pendingitems/ with a timestamp prefix.
 */
function writePendingMd(repoRoot: string, filename: string, content = '# Task\n'): void {
  const pendingDir = join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  mkdirSync(pendingDir, { recursive: true });
  writeFileSync(join(pendingDir, filename), content);
}

/**
 * Write a minimal task-registry.json with one active entry per taskId.
 */
function writeTaskRegistry(repoRoot: string, activeTaskIds: string[]): void {
  const platformState = join(repoRoot, '.platform-state');
  mkdirSync(platformState, { recursive: true });
  const tasks: Record<string, unknown> = {};
  for (const taskId of activeTaskIds) {
    tasks[`cp-${taskId}`] = {
      open: [],
      pending: [],
      active: [
        {
          taskId,
          fileName: `20240101T000000Z-${taskId}.md`,
          state: 'active',
        },
      ],
      failed: [],
    };
  }
  writeFileSync(
    join(platformState, 'task-registry.json'),
    JSON.stringify({ schema_version: 2, tasks }, null, 2),
  );
}

/**
 * Set up the required directory skeleton for cleanupWorkspaceOnQuit to operate.
 */
function setupWorkspaceScaffold(repoRoot: string): void {
  mkdirSync(join(repoRoot, 'AgentWorkSpace', 'dropbox'), { recursive: true });
  mkdirSync(join(repoRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true });
  mkdirSync(join(repoRoot, 'AgentWorkSpace', 'tasks'), { recursive: true });
  mkdirSync(join(repoRoot, '.platform-state', 'queue'), { recursive: true });
  mkdirSync(join(repoRoot, '.platform-state', 'runtime', 'role-sessions'), { recursive: true });
  mkdirSync(join(repoRoot, '.platform-state', 'runtime', 'test-provider-home'), { recursive: true });
  // Write a starter queue-order.json
  writeFileSync(
    join(repoRoot, '.platform-state', 'queue', 'queue-order.json'),
    '{"order":["task-a","task-b"]}',
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('§4.10 cleanupWorkspaceOnQuit', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
    TEST_REPO_ROOT = mkdtempSync(join(tmpRoot, 'repo-root-'));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ── Test 1: 2-parallel-task teardown ────────────────────────────────────

  it('tears down two parallel tasks: worktrees gone, dropbox restored, registry reset', async () => {
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    // Task A
    const taskAId = 'task-a';
    const taskABranch = `task/${taskAId}`;
    const taskAWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskAId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, taskAWorktree, taskABranch);
    writeTaskJson(TEST_REPO_ROOT, taskAId, gitRepoRoot, taskAWorktree, taskABranch);
    writePendingMd(TEST_REPO_ROOT, `20240101T000000Z-${taskAId}.md`);

    // Task B
    const taskBId = 'task-b';
    const taskBBranch = `task/${taskBId}`;
    const taskBWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskBId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, taskBWorktree, taskBBranch);
    writeTaskJson(TEST_REPO_ROOT, taskBId, gitRepoRoot, taskBWorktree, taskBBranch);
    writePendingMd(TEST_REPO_ROOT, `20240101T000001Z-${taskBId}.md`);

    writeTaskRegistry(TEST_REPO_ROOT, [taskAId, taskBId]);

    cleanupWorkspaceOnQuit();

    // (a) Both task dirs gone
    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskAId))).toBe(false);
    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskBId))).toBe(false);

    // (b) Both branches gone from originalRoot
    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(taskABranch);
    expect(branches).not.toContain(taskBBranch);

    // (c) .active-items/ is an empty directory (exists, no entries)
    const activeItemsDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');
    expect(existsSync(activeItemsDir)).toBe(true);
    expect(readdirSync(activeItemsDir)).toHaveLength(0);

    // (d) task-registry.json shows set.active === [] for every key after cleanup
    const registry = JSON.parse(readFileSync(join(TEST_REPO_ROOT, '.platform-state', 'task-registry.json'), 'utf-8'));
    for (const key of Object.keys(registry.tasks)) {
      expect(Array.isArray(registry.tasks[key].active)).toBe(true);
      expect(registry.tasks[key].active).toHaveLength(0);
    }

    // (e) Both tasks' original .md files present in dropbox/ with original filenames
    const dropboxDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'dropbox');
    const dropboxFiles = readdirSync(dropboxDir);
    expect(dropboxFiles).toContain(`${taskAId}.md`);
    expect(dropboxFiles).toContain(`${taskBId}.md`);
  });

  // ── Test 2: Sync-contract ────────────────────────────────────────────────

  it('returns void synchronously (compile-time contract)', async () => {
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    writeTaskRegistry(TEST_REPO_ROOT, []);

    // Compile-time assertion: the type of the return value must be void
    const returned: void = cleanupWorkspaceOnQuit();
    expect(returned).toBeUndefined();
  });

  // ── Test 3: Retention-ignored ────────────────────────────────────────────

  it('ignores retain_failed_task_worktrees=true — worktree torn down unconditionally', async () => {
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);

    // Write platform-config with retention enabled — cleanup must ignore it
    const platformState = join(TEST_REPO_ROOT, '.platform-state');
    mkdirSync(platformState, { recursive: true });
    writeFileSync(
      join(platformState, 'platform.json'),
      JSON.stringify({ retain_failed_task_worktrees: true }, null, 2),
    );

    const gitRepoRoot = createGitRepo(tmpRoot);

    const taskId = 'task-retained';
    const branch = `task/${taskId}`;
    const worktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, worktree, branch);
    writeTaskJson(TEST_REPO_ROOT, taskId, gitRepoRoot, worktree, branch);
    writeTaskRegistry(TEST_REPO_ROOT, [taskId]);

    cleanupWorkspaceOnQuit();

    // Worktree dir must be gone despite retention flag
    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskId))).toBe(false);

    // Branch must be gone despite retention flag
    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(branch);
  });

  // ── Test 4: Legacy completed sidecar safety ─────────────────────────────

  it('preserves legacy completed sidecars and completed task branches', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../log/logger', () => ({
      createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
        child: vi.fn(),
      }),
    }));
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    const taskId = 'task-completed';
    const branch = `task/${taskId}`;
    const worktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, worktree, branch);
    writeTaskJson(TEST_REPO_ROOT, taskId, gitRepoRoot, worktree, branch, 'completed');

    writeTaskRegistry(TEST_REPO_ROOT, [taskId]);

    cleanupWorkspaceOnQuit();

    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskId, '.task.json'))).toBe(true);
    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).toContain(branch);
    expect(warnSpy).toHaveBeenCalledWith('cleanup.completed-sidecar.preserved', {
      taskId,
      sidecar: join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskId, '.task.json'),
    });
    vi.doUnmock('../log/logger');
  });

  it('removes active branches while preserving completed branches in mixed cleanup', async () => {
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    const activeTaskId = 'task-active';
    const activeBranch = `task/${activeTaskId}`;
    const activeWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', activeTaskId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, activeWorktree, activeBranch);
    writeTaskJson(TEST_REPO_ROOT, activeTaskId, gitRepoRoot, activeWorktree, activeBranch);

    const completedTaskId = 'task-completed';
    const completedBranch = `task/${completedTaskId}`;
    const completedWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', completedTaskId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, completedWorktree, completedBranch);
    writeTaskJson(TEST_REPO_ROOT, completedTaskId, gitRepoRoot, completedWorktree, completedBranch, 'completed');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeTaskRegistry(TEST_REPO_ROOT, [activeTaskId, completedTaskId]);

    cleanupWorkspaceOnQuit();

    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(activeBranch);
    expect(branches).toContain(completedBranch);
    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', activeTaskId))).toBe(false);
    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', completedTaskId, '.task.json'))).toBe(true);
    warnSpy.mockRestore();
  });

  // ── Test 5: Corrupt-sidecar resilience ──────────────────────────────────

  it('handles corrupt .task.json gracefully: valid task torn down, corrupt task dir still removed, subsequent steps run', async () => {
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    // Valid task
    const validTaskId = 'task-valid';
    const validBranch = `task/${validTaskId}`;
    const validWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', validTaskId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, validWorktree, validBranch);
    writeTaskJson(TEST_REPO_ROOT, validTaskId, gitRepoRoot, validWorktree, validBranch);

    // Corrupt task — dir exists but .task.json is truncated JSON
    const corruptTaskId = 'task-corrupt';
    const corruptTaskDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', corruptTaskId);
    mkdirSync(corruptTaskDir, { recursive: true });
    writeFileSync(join(corruptTaskDir, '.task.json'), '{broken json');

    writeTaskRegistry(TEST_REPO_ROOT, [validTaskId, corruptTaskId]);

    // cleanupWorkspaceOnQuit must NOT throw
    expect(() => cleanupWorkspaceOnQuit()).not.toThrow();

    // (a) Valid task's worktree + branch torn down
    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', validTaskId))).toBe(false);
    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(validBranch);

    // (b) Corrupt task's directory still rmSync-ed
    expect(existsSync(corruptTaskDir)).toBe(false);

    // (c) No exception propagated (already asserted above)

    // (d) Subsequent cleanup steps all ran — check side-effects:
    //   queue-order.json contains {"order":[]}
    const queueOrder = readFileSync(
      join(TEST_REPO_ROOT, '.platform-state', 'queue', 'queue-order.json'),
      'utf-8',
    );
    expect(JSON.parse(queueOrder)).toEqual({ order: [] });

    //   .active-items/ exists and is empty
    const activeItemsDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');
    expect(existsSync(activeItemsDir)).toBe(true);
    expect(readdirSync(activeItemsDir)).toHaveLength(0);

  });

  // ── Test 6: §4.16 SIGKILL-and-restart orphaned worktree reap ────────────

  it('§4.16 SIGKILL-restart: cleanup reaps orphaned worktree runtime dir, .active-items marker, and agent PID receipt', async () => {
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    // ── Simulate orphaned state left by a mid-task SIGKILL ──

    const orphanTaskId = 'orphan-task';
    const orphanBranch = `task/${orphanTaskId}`;
    const orphanWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', orphanTaskId, 'worktrees', 'repo');

    // (a) Real git worktree so the branch + admin entry exist
    createWorktree(gitRepoRoot, orphanWorktree, orphanBranch);

    // (b) .task.json sidecar pointing at the worktree
    writeTaskJson(TEST_REPO_ROOT, orphanTaskId, gitRepoRoot, orphanWorktree, orphanBranch);

    // (c) .platform-state/runtime/tasks/orphan-task/ with guardrails + role-sessions files
    const taskRuntimeDir = join(TEST_REPO_ROOT, '.platform-state', 'runtime', 'tasks', orphanTaskId);
    const guardrailsDir = join(taskRuntimeDir, 'guardrails');
    const roleSessionsDir = join(taskRuntimeDir, 'role-sessions');
    mkdirSync(guardrailsDir, { recursive: true });
    mkdirSync(roleSessionsDir, { recursive: true });
    // Seed a guardrails receipt
    writeFileSync(join(guardrailsDir, 'activation.json'), JSON.stringify({ ok: true }));
    // Seed a role-session receipt with a non-existent PID (so kill is a no-op, not a test failure)
    writeFileSync(
      join(roleSessionsDir, 'dalton.json'),
      JSON.stringify({ launch: { pid: 999999999 }, terminal: false }),
    );

    // (d) .active-items/<taskId> marker — canonical path is pendingitems/.active-items/
    // and markers are FILES (per operations.ts:470 writeFile), not directories.
    const activeItemsDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(join(activeItemsDir, orphanTaskId), `${orphanTaskId}.md`);

    // (e) Task registry with the orphan in active state (so cleanup moves it to open)
    writeTaskRegistry(TEST_REPO_ROOT, [orphanTaskId]);

    // ── Simulate cold restart: call cleanupWorkspaceOnQuit with no prior setup ──
    // Must not throw — resilience is part of the contract
    expect(() => cleanupWorkspaceOnQuit()).not.toThrow();

    // ── Assertions ───────────────────────────────────────────────────────────

    // (1) Worktree dir must be gone (tearDownAllWorktrees ran)
    expect(existsSync(orphanWorktree)).toBe(false);

    // (2) Task dir entirely removed
    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', orphanTaskId))).toBe(false);

    // (3) Runtime tasks dir for orphan-task must be gone (clearEphemeralRuntime wipes runtime/tasks/)
    expect(existsSync(taskRuntimeDir)).toBe(false);

    // (4) .active-items/ must exist and be empty (removeActiveItemMarker ran)
    expect(existsSync(activeItemsDir)).toBe(true);
    expect(readdirSync(activeItemsDir)).toHaveLength(0);

    // (5) Branch must be deleted from original repo
    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(orphanBranch);

    // (6) task-registry.json must show active[] empty (orphan moved to open)
    const registry = JSON.parse(readFileSync(join(TEST_REPO_ROOT, '.platform-state', 'task-registry.json'), 'utf-8'));
    for (const key of Object.keys(registry.tasks)) {
      expect(Array.isArray(registry.tasks[key].active)).toBe(true);
      expect(registry.tasks[key].active).toHaveLength(0);
    }
  });

  // ── Test 7: dotfiles in AgentWorkSpace/tasks/ are not treated as task IDs ──

  it('preserves dotfiles in AgentWorkSpace/tasks/ (.gitkeep, .DS_Store) — does not treat them as task dirs', async () => {
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    // Real task that should be torn down
    const taskId = 'real-task';
    const branch = `task/${taskId}`;
    const worktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, worktree, branch);
    writeTaskJson(TEST_REPO_ROOT, taskId, gitRepoRoot, worktree, branch);
    writeTaskRegistry(TEST_REPO_ROOT, [taskId]);

    // Dotfiles that must survive — they are not task IDs.
    const tasksDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks');
    const gitkeepPath = join(tasksDir, '.gitkeep');
    const dsStorePath = join(tasksDir, '.DS_Store');
    writeFileSync(gitkeepPath, '');
    writeFileSync(dsStorePath, '');

    cleanupWorkspaceOnQuit();

    // Real task dir is gone
    expect(existsSync(join(tasksDir, taskId))).toBe(false);

    // Dotfiles survive
    expect(existsSync(gitkeepPath)).toBe(true);
    expect(existsSync(dsStorePath)).toBe(true);
  });

  // ── Test 8: corrupt task-registry.json is logged, cleanup still completes ──

  it('logs a structured warning when the task registry is corrupt and continues cleanup', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../log/logger', () => ({
      createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
        child: vi.fn(),
      }),
    }));
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    // Corrupt task-registry.json — JSON.parse inside resetTaskRegistry throws.
    writeFileSync(
      join(TEST_REPO_ROOT, '.platform-state', 'task-registry.json'),
      '{ "schema_version": 2, "tasks": truncated',
    );

    expect(() => cleanupWorkspaceOnQuit()).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith('cleanup.task-registry.reset.failed', {
      reason: expect.any(String),
    });

    // Subsequent cleanup steps still ran — queue-order.json reset to empty.
    const queueOrder = readFileSync(
      join(TEST_REPO_ROOT, '.platform-state', 'queue', 'queue-order.json'),
      'utf-8',
    );
    expect(JSON.parse(queueOrder)).toEqual({ order: [] });
    vi.doUnmock('../log/logger');
  });
});
