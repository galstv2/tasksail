/**
 * §B2 Commit-routing integration test.
 *
 * Validates the full per-task worktree split end-to-end:
 *   - prepareDaltonBoundary points the agent CWD at the worktreeRoot, not the
 *     originalRoot.
 *   - commitTaskSnapshot lands the snapshot on `task/<id>` inside the worktree;
 *     the originalRoot's `main` head MUST NOT advance.
 *   - finalizeTaskWorktrees on outcome='completed' tears down the worktree dir
 *     but the `task/<id>` ref persists inside the originalRoot's `.git` so the
 *     operator can merge or open a PR.
 *   - Distributed estate: two bindings → two worktrees → two independent task
 *     branches that do not collide.
 *
 * Real `git`, real `git worktree add`, real tmp dirs. No mocks for the things
 * under test; we deliberately exercise the same code paths as production.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commitTaskSnapshot } from '../../queue/errorItems.js';
import { finalizeTaskWorktrees } from '../../core/worktreeFinalize.js';
import { prepareDaltonBoundary } from '../daltonLaunchPrep.js';
import { _clearPlatformConfigCache } from '../../platform-config/get.js';
import type { FocusedRepoResult } from '../../context-pack/focusedRepo.js';
import type { AutonomyIntent } from '../types.js';
import type { TaskRepoBinding } from '../../queue/taskJson.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/** Initialize a git repo with a single baseline commit. Returns the baseline SHA. */
function initRepo(repoPath: string): string {
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, ['init', '-q', '-b', 'main']);
  git(repoPath, ['config', 'user.email', 'test@example.com']);
  git(repoPath, ['config', 'user.name', 'Test']);
  git(repoPath, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(path.join(repoPath, 'README.md'), '# baseline\n');
  git(repoPath, ['add', 'README.md']);
  git(repoPath, ['commit', '-q', '-m', 'baseline']);
  return git(repoPath, ['rev-parse', 'HEAD']);
}

function addWorktree(
  originalRoot: string,
  worktreeRoot: string,
  branch: string,
  baseSha: string,
): void {
  mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  execFileSync(
    'git',
    ['worktree', 'add', '-b', branch, worktreeRoot, baseSha],
    { cwd: originalRoot, stdio: 'pipe' },
  );
}

function writeTaskJson(
  platformRoot: string,
  taskId: string,
  bindings: TaskRepoBinding[],
): void {
  const dir = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(dir, { recursive: true });
  // schema_version: 1 today; B7-data bumps to 2.
  const json = {
    schema_version: 1,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: bindings,
    },
    materialization: {
      strategy: 'copy' as const,
      cloned: [],
      skipped: [],
      composeProjectName: `tasksail-${taskId}`,
    },
    frozenAt: new Date().toISOString(),
    finalizedAt: null,
    state: 'active' as const,
  };
  writeFileSync(
    path.join(dir, '.task.json'),
    JSON.stringify(json, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * `finalizeTaskWorktrees` always reads `getPlatformConfig(repoRoot)` (even on
 * the success path, to decide parent-dir cleanup). Without a real
 * `.platform-state/platform.json` in the tmp root the call would throw and
 * mask the actual assertions under test.
 */
function writePlatformJson(platformRoot: string): void {
  const dir = path.join(platformRoot, '.platform-state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'platform.json'),
    JSON.stringify({
      schema_version: 1,
      container_runtime: 'docker',
      max_parallel_tasks: 10,
      retain_failed_task_worktrees: true,
      max_retained_failed_task_worktrees: 5,
      max_retry_generations_per_slug: 5,
      completed_task_runtime_retention_ms: 3600000,
      mcp_port_range: { min: 8811, max: 8820 },
    }, null, 2) + '\n',
    'utf-8',
  );
}

function makeFocused(overrides: Partial<FocusedRepoResult>): FocusedRepoResult {
  return {
    primaryRepoRoot: '/unset',
    visibleRepoRoots: [],
    declaredRepoRoots: [],
    estateType: 'distributed-platform',
    primaryRepoId: 'crud-app',
    selectedRepoIds: ['crud-app'],
    selectedFocusIds: [],
    authoritySource: 'active-task-sidecar',
    ...overrides,
  };
}

function makeAutonomyArgs(): AutonomyIntent {
  return {
    model: 'claude-sonnet-4.6',
    autonomyProfile: 'repo-executor',
    allowedDirs: [],
    disallowTempDir: false,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

describe('§B2 commit-routing integration', () => {
  let platformRoot: string;

  beforeEach(() => {
    platformRoot = mkdtempSync(path.join(tmpdir(), 'ts-commit-routing-'));
    // prepareDaltonBoundary still uses git snapshots, so the platform root is
    // initialized as a real repo for the surrounding commit-routing flow.
    initRepo(platformRoot);
    writePlatformJson(platformRoot);
    // Clear memoized config so prior tests with a different platformRoot
    // do not poison the lookup. (cache key is repoRoot, but mtime-based
    // invalidation still benefits from an explicit clear in test setup.)
    _clearPlatformConfigCache();
  });

  afterEach(() => {
    rmSync(platformRoot, { recursive: true, force: true });
    _clearPlatformConfigCache();
  });

  it('monolith: agent CWD is worktreeRoot and commit lands on task/<id> only', async () => {
    const taskId = 'commit-route-mono';
    const originalRoot = path.join(platformRoot, 'origin', 'crud-app');
    const worktreeRoot = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'crud-app',
    );
    const baseSha = initRepo(originalRoot);
    addWorktree(originalRoot, worktreeRoot, `task/${taskId}`, baseSha);

    writeTaskJson(platformRoot, taskId, [{
      originalRoot,
      worktreeRoot,
      worktreeBranch: `task/${taskId}`,
      baseCommitSha: baseSha,
    }]);

    // Construct focused as if B1's worktreeInjection already ran. This is the
    // shape downstream consumers (prepareDaltonBoundary) actually see at runtime.
    const focused = makeFocused({
      primaryRepoRoot: worktreeRoot,
      visibleRepoRoots: [worktreeRoot],
      declaredRepoRoots: [worktreeRoot],
    });
    const autonomyArgs = makeAutonomyArgs();
    const boundary = await prepareDaltonBoundary(
      focused,
      { agentId: 'dalton', repoRoot: platformRoot, taskId, usesFocusedRepoLaunch: true },
      autonomyArgs,
    );

    // Boundary assertions — the heart of B2.
    expect(boundary.agentCwd).toBe(worktreeRoot);
    expect(autonomyArgs.allowedDirs).toContain(worktreeRoot);

    // Simulate Dalton's edit landing inside the worktree.
    writeFileSync(path.join(worktreeRoot, 'feature.ts'), 'export const x = 1;\n');

    const ok = await commitTaskSnapshot(platformRoot, taskId, 'completed');
    expect(ok).toBe(true);

    // Task branch advanced; main untouched.
    const taskBranchSha = git(originalRoot, ['rev-parse', `refs/heads/task/${taskId}`]);
    expect(taskBranchSha).not.toBe(baseSha);
    expect(git(originalRoot, ['rev-parse', 'refs/heads/main'])).toBe(baseSha);

    // The new commit's parent must be the baseline — single-parent task branch.
    const taskParent = git(originalRoot, ['rev-parse', `${taskBranchSha}^`]);
    expect(taskParent).toBe(baseSha);

    // Commit message follows the [tasksail] convention.
    const subject = git(originalRoot, ['log', '-1', '--format=%s', taskBranchSha]);
    expect(subject).toBe(`[tasksail] ${taskId}: completed`);
  });

  it('finalize: removes worktree dir but retains task/<id> ref in originalRoot', async () => {
    const taskId = 'commit-route-finalize';
    const originalRoot = path.join(platformRoot, 'origin', 'crud-app');
    const worktreeRoot = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'crud-app',
    );
    const baseSha = initRepo(originalRoot);
    addWorktree(originalRoot, worktreeRoot, `task/${taskId}`, baseSha);

    writeTaskJson(platformRoot, taskId, [{
      originalRoot,
      worktreeRoot,
      worktreeBranch: `task/${taskId}`,
      baseCommitSha: baseSha,
    }]);

    writeFileSync(path.join(worktreeRoot, 'feature.ts'), 'export const x = 1;\n');
    await commitTaskSnapshot(platformRoot, taskId, 'completed');
    const branchShaBefore = git(originalRoot, ['rev-parse', `refs/heads/task/${taskId}`]);

    await finalizeTaskWorktrees(taskId, 'completed', platformRoot);

    expect(existsSync(worktreeRoot)).toBe(false);
    // The branch ref must still be reachable from the originalRoot's .git.
    const branchShaAfter = git(originalRoot, ['rev-parse', `refs/heads/task/${taskId}`]);
    expect(branchShaAfter).toBe(branchShaBefore);
  });

  it('distributed: two bindings produce two independent task branches', async () => {
    const taskId = 'commit-route-distributed';
    const originalRootA = path.join(platformRoot, 'origin', 'app-a');
    const originalRootB = path.join(platformRoot, 'origin', 'app-b');
    const worktreeRootA = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'app-a',
    );
    const worktreeRootB = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'app-b',
    );
    const baseShaA = initRepo(originalRootA);
    const baseShaB = initRepo(originalRootB);
    addWorktree(originalRootA, worktreeRootA, `task/${taskId}`, baseShaA);
    addWorktree(originalRootB, worktreeRootB, `task/${taskId}`, baseShaB);

    writeTaskJson(platformRoot, taskId, [
      {
        originalRoot: originalRootA,
        worktreeRoot: worktreeRootA,
        worktreeBranch: `task/${taskId}`,
        baseCommitSha: baseShaA,
      },
      {
        originalRoot: originalRootB,
        worktreeRoot: worktreeRootB,
        worktreeBranch: `task/${taskId}`,
        baseCommitSha: baseShaB,
      },
    ]);

    writeFileSync(path.join(worktreeRootA, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(path.join(worktreeRootB, 'b.ts'), 'export const b = 2;\n');

    const ok = await commitTaskSnapshot(platformRoot, taskId, 'completed');
    expect(ok).toBe(true);

    const taskShaA = git(originalRootA, ['rev-parse', `refs/heads/task/${taskId}`]);
    const taskShaB = git(originalRootB, ['rev-parse', `refs/heads/task/${taskId}`]);
    // Each branch advanced past its own baseline, independently.
    expect(taskShaA).not.toBe(baseShaA);
    expect(taskShaB).not.toBe(baseShaB);
    expect(taskShaA).not.toBe(taskShaB);
    // Each origin's main ref is unchanged.
    expect(git(originalRootA, ['rev-parse', 'refs/heads/main'])).toBe(baseShaA);
    expect(git(originalRootB, ['rev-parse', 'refs/heads/main'])).toBe(baseShaB);
  });
});
