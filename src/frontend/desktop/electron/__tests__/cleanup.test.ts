// @vitest-environment node
/**
 * §4.10 cleanup-on-quit test suite.
 *
 * Five test cases mandated by the Done-when contract:
 * 1. 2-parallel-task SIGKILL-restart (worktrees torn down, dropbox restored)
 * 2. Sync-contract (void return type, no Promise)
 * 3. Retention-ignored (retain_failed_task_worktrees=true still tears down)
 * 4. No task/* branches remain after cleanup
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
    state: 'active',
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
  mkdirSync(join(repoRoot, '.platform-state', 'runtime', 'copilot-home'), { recursive: true });
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

  // ── Test 4: No task/* branches remain ───────────────────────────────────

  it('no task/* branches remain after cleanup', async () => {
    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    const taskAId = 'task-alpha';
    const taskABranch = `task/${taskAId}`;
    const taskAWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskAId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, taskAWorktree, taskABranch);
    writeTaskJson(TEST_REPO_ROOT, taskAId, gitRepoRoot, taskAWorktree, taskABranch);

    const taskBId = 'task-beta';
    const taskBBranch = `task/${taskBId}`;
    const taskBWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskBId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, taskBWorktree, taskBBranch);
    writeTaskJson(TEST_REPO_ROOT, taskBId, gitRepoRoot, taskBWorktree, taskBBranch);

    writeTaskRegistry(TEST_REPO_ROOT, [taskAId, taskBId]);

    cleanupWorkspaceOnQuit();

    // No task/* branches remain
    const taskBranchList = execFileSync(
      'git',
      ['-C', gitRepoRoot, 'branch', '--list', 'task/*'],
      { encoding: 'utf-8' },
    );
    expect(taskBranchList.trim()).toBe('');
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

    // (d) Subsequent steps 3–9 all ran — check side-effects:
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

    //   port-allocations.json absent (clearPortAllocations ran)
    expect(existsSync(join(TEST_REPO_ROOT, '.platform-state', 'runtime', 'port-allocations.json'))).toBe(false);
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

  // ── Test 7: §6.3B container-enumeration assertion ───────────────────────
  //
  // Verifies the quit-path prefix scan: composeDownTaskScopedProjects calls
  // `<backend> compose ls --all --format json`, filters the returned project
  // list by the `tasksail-` prefix, and runs `<backend> compose -p <name> down`
  // on each match — never on non-tasksail projects.
  //
  // Approach: mock `node:child_process.execFileSync` to (a) serve a canned
  // project list for `docker compose ls` and (b) record `docker compose -p
  // <name> down` calls, while passing every other command (git teardown,
  // worktree prune) through to the real implementation.

  it('§6.3B composeDownTaskScopedProjects: enumerates tasksail-* projects and runs compose -p <name> down on each', async () => {
    setupWorkspaceScaffold(TEST_REPO_ROOT);
    writeTaskRegistry(TEST_REPO_ROOT, []);

    // Seed platform.json so readContainerBackendSync returns 'docker' (deterministic).
    writeFileSync(
      join(TEST_REPO_ROOT, '.platform-state', 'platform.json'),
      JSON.stringify({ container_runtime: 'docker' }, null, 2),
    );

    // Record every observed call so we can assert both presence and absence.
    const downCalls: string[] = [];
    let lsCalled = false;

    // Project list the mock serves for `docker compose ls` — mixes two
    // `tasksail-*` projects with one unrelated project to prove the prefix
    // filter is enforced.
    const fakeProjects = JSON.stringify([
      { Name: 'tasksail-task-a', Status: 'running' },
      { Name: 'tasksail-task-b', Status: 'running' },
      { Name: 'some-unrelated-project', Status: 'running' },
    ]);

    vi.resetModules();
    vi.doMock('node:child_process', async () => {
      const real = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...real,
        execFileSync: (
          file: string,
          args?: readonly string[],
          _options?: unknown,
        ): Buffer | string => {
          const argList = args ?? [];
          if (file === 'docker' && argList[0] === 'compose' && argList[1] === 'ls') {
            lsCalled = true;
            return fakeProjects;
          }
          if (
            file === 'docker' &&
            argList[0] === 'compose' &&
            argList[1] === '-p' &&
            argList[3] === 'down'
          ) {
            // Record project name (argList[2]); return empty stdout.
            downCalls.push(argList[2] as string);
            return '';
          }
          // Fall through to real execFileSync for git + anything else. Cast
          // via Reflect so we preserve the overloaded signature.
          return Reflect.apply(real.execFileSync, undefined, [file, args, _options]);
        },
      };
    });

    const { cleanupWorkspaceOnQuit } = await import('../main.cleanup');
    cleanupWorkspaceOnQuit();

    // Unmock so later tests in this file re-import the real module.
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(lsCalled).toBe(true);
    expect(downCalls).toContain('tasksail-task-a');
    expect(downCalls).toContain('tasksail-task-b');
    expect(downCalls).not.toContain('some-unrelated-project');
    // And no accidental double-downs of the same project.
    expect(downCalls.length).toBe(2);
  });

  // ── Test 8: dotfiles in AgentWorkSpace/tasks/ are not treated as task IDs ──

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
});
