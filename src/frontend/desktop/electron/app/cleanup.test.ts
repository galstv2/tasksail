// @vitest-environment node
/**
 * Cleanup-on-quit coverage for task shutdown, sync return behavior, retention
 * handling, active branch removal, legacy branch preservation, and corrupt
 * sidecar resilience.
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

let TEST_REPO_ROOT: string;

vi.mock('../paths', () => ({
  get REPO_ROOT() {
    return TEST_REPO_ROOT;
  },
}));

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
 * Write a timestamp-prefixed task entry into pendingitems/.
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
  writeFileSync(
    join(repoRoot, '.platform-state', 'queue', 'queue-order.json'),
    '{"order":["task-a","task-b"]}',
  );
}

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

  it('tears down two parallel tasks: worktrees gone, dropbox restored, registry reset', async () => {
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    const taskAId = 'task-a';
    const taskABranch = `task/${taskAId}`;
    const taskAWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskAId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, taskAWorktree, taskABranch);
    writeTaskJson(TEST_REPO_ROOT, taskAId, gitRepoRoot, taskAWorktree, taskABranch);
    writePendingMd(TEST_REPO_ROOT, `20240101T000000Z-${taskAId}.md`);

    const taskBId = 'task-b';
    const taskBBranch = `task/${taskBId}`;
    const taskBWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskBId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, taskBWorktree, taskBBranch);
    writeTaskJson(TEST_REPO_ROOT, taskBId, gitRepoRoot, taskBWorktree, taskBBranch);
    writePendingMd(TEST_REPO_ROOT, `20240101T000001Z-${taskBId}.md`);

    writeTaskRegistry(TEST_REPO_ROOT, [taskAId, taskBId]);

    cleanupWorkspaceOnQuit();

    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskAId))).toBe(false);
    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskBId))).toBe(false);

    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(taskABranch);
    expect(branches).not.toContain(taskBBranch);

    const activeItemsDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');
    expect(existsSync(activeItemsDir)).toBe(true);
    expect(readdirSync(activeItemsDir)).toHaveLength(0);

    const registry = JSON.parse(readFileSync(join(TEST_REPO_ROOT, '.platform-state', 'task-registry.json'), 'utf-8'));
    for (const key of Object.keys(registry.tasks)) {
      expect(Array.isArray(registry.tasks[key].active)).toBe(true);
      expect(registry.tasks[key].active).toHaveLength(0);
    }

    const dropboxDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'dropbox');
    const dropboxFiles = readdirSync(dropboxDir);
    expect(dropboxFiles).toContain(`${taskAId}.md`);
    expect(dropboxFiles).toContain(`${taskBId}.md`);
  });

  it('returns void synchronously (compile-time contract)', async () => {
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    writeTaskRegistry(TEST_REPO_ROOT, []);

    const returned: void = cleanupWorkspaceOnQuit();
    expect(returned).toBeUndefined();
  });

  it('ignores retain_failed_task_worktrees=true — worktree torn down unconditionally', async () => {
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);

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

    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskId))).toBe(false);

    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(branch);
  });

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
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

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
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

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

  it('handles corrupt .task.json gracefully: valid task torn down, corrupt task dir still removed, subsequent steps run', async () => {
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    const validTaskId = 'task-valid';
    const validBranch = `task/${validTaskId}`;
    const validWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', validTaskId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, validWorktree, validBranch);
    writeTaskJson(TEST_REPO_ROOT, validTaskId, gitRepoRoot, validWorktree, validBranch);

    // Corrupt task dir exists, but .task.json is truncated JSON.
    const corruptTaskId = 'task-corrupt';
    const corruptTaskDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', corruptTaskId);
    mkdirSync(corruptTaskDir, { recursive: true });
    writeFileSync(join(corruptTaskDir, '.task.json'), '{broken json');

    writeTaskRegistry(TEST_REPO_ROOT, [validTaskId, corruptTaskId]);

    expect(() => cleanupWorkspaceOnQuit()).not.toThrow();

    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', validTaskId))).toBe(false);
    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(validBranch);

    expect(existsSync(corruptTaskDir)).toBe(false);

    const queueOrder = readFileSync(
      join(TEST_REPO_ROOT, '.platform-state', 'queue', 'queue-order.json'),
      'utf-8',
    );
    expect(JSON.parse(queueOrder)).toEqual({ order: [] });

    const activeItemsDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');
    expect(existsSync(activeItemsDir)).toBe(true);
    expect(readdirSync(activeItemsDir)).toHaveLength(0);

  });

  it('§4.16 SIGKILL-restart: cleanup reaps orphaned worktree runtime dir, .active-items marker, and agent PID receipt', async () => {
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    // Simulate orphaned state left by a mid-task SIGKILL.

    const orphanTaskId = 'orphan-task';
    const orphanBranch = `task/${orphanTaskId}`;
    const orphanWorktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', orphanTaskId, 'worktrees', 'repo');

    // Real git worktree so the branch and admin entry exist.
    createWorktree(gitRepoRoot, orphanWorktree, orphanBranch);

    writeTaskJson(TEST_REPO_ROOT, orphanTaskId, gitRepoRoot, orphanWorktree, orphanBranch);

    // Runtime receipts simulate state left behind by a killed agent process.
    const taskRuntimeDir = join(TEST_REPO_ROOT, '.platform-state', 'runtime', 'tasks', orphanTaskId);
    const guardrailsDir = join(taskRuntimeDir, 'guardrails');
    const roleSessionsDir = join(taskRuntimeDir, 'role-sessions');
    mkdirSync(guardrailsDir, { recursive: true });
    mkdirSync(roleSessionsDir, { recursive: true });
    writeFileSync(join(guardrailsDir, 'activation.json'), JSON.stringify({ ok: true }));
    // Use a non-existent PID so process cleanup is a no-op, not a test failure.
    writeFileSync(
      join(roleSessionsDir, 'dalton.json'),
      JSON.stringify({ launch: { pid: 999999999 }, terminal: false }),
    );

    // Active-item markers are files under pendingitems/.active-items, not directories.
    const activeItemsDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');
    mkdirSync(activeItemsDir, { recursive: true });
    writeFileSync(join(activeItemsDir, orphanTaskId), `${orphanTaskId}.md`);

    // Active registry state ensures cleanup moves the orphan back to open.
    writeTaskRegistry(TEST_REPO_ROOT, [orphanTaskId]);

    // Cold restart cleanup must not throw with no prior in-process setup.
    expect(() => cleanupWorkspaceOnQuit()).not.toThrow();

    expect(existsSync(orphanWorktree)).toBe(false);

    expect(existsSync(join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', orphanTaskId))).toBe(false);

    expect(existsSync(taskRuntimeDir)).toBe(false);

    expect(existsSync(activeItemsDir)).toBe(true);
    expect(readdirSync(activeItemsDir)).toHaveLength(0);

    const branches = execFileSync('git', ['-C', gitRepoRoot, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).not.toContain(orphanBranch);

    const registry = JSON.parse(readFileSync(join(TEST_REPO_ROOT, '.platform-state', 'task-registry.json'), 'utf-8'));
    for (const key of Object.keys(registry.tasks)) {
      expect(Array.isArray(registry.tasks[key].active)).toBe(true);
      expect(registry.tasks[key].active).toHaveLength(0);
    }
  });

  it('preserves dotfiles in AgentWorkSpace/tasks/ (.gitkeep, .DS_Store) — does not treat them as task dirs', async () => {
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    const gitRepoRoot = createGitRepo(tmpRoot);

    const taskId = 'real-task';
    const branch = `task/${taskId}`;
    const worktree = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    createWorktree(gitRepoRoot, worktree, branch);
    writeTaskJson(TEST_REPO_ROOT, taskId, gitRepoRoot, worktree, branch);
    writeTaskRegistry(TEST_REPO_ROOT, [taskId]);

    // Dotfiles are not task IDs and must survive.
    const tasksDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'tasks');
    const gitkeepPath = join(tasksDir, '.gitkeep');
    const dsStorePath = join(tasksDir, '.DS_Store');
    writeFileSync(gitkeepPath, '');
    writeFileSync(dsStorePath, '');

    cleanupWorkspaceOnQuit();

    expect(existsSync(join(tasksDir, taskId))).toBe(false);

    expect(existsSync(gitkeepPath)).toBe(true);
    expect(existsSync(dsStorePath)).toBe(true);
  });

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
    const { cleanupWorkspaceOnQuit } = await import('./cleanup');

    setupWorkspaceScaffold(TEST_REPO_ROOT);
    // Corrupt task-registry.json exercises the reset failure path.
    writeFileSync(
      join(TEST_REPO_ROOT, '.platform-state', 'task-registry.json'),
      '{ "schema_version": 2, "tasks": truncated',
    );

    expect(() => cleanupWorkspaceOnQuit()).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith('cleanup.task-registry.reset.failed', {
      reason: expect.any(String),
    });

    const queueOrder = readFileSync(
      join(TEST_REPO_ROOT, '.platform-state', 'queue', 'queue-order.json'),
      'utf-8',
    );
    expect(JSON.parse(queueOrder)).toEqual({ order: [] });
    vi.doUnmock('../log/logger');
  });
});
