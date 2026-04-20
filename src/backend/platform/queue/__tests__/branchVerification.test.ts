/**
 * §B5 Post-completion branch verification — unit tests.
 *
 * Five scenarios per spec §3.3 plus retry-suffix risk 5.2:
 *   1. All bindings have commits beyond base → ok:true
 *   2. One binding has no new commits → no-commits-beyond-base
 *   3. Branch ref deleted out-of-band → branch-missing
 *   4. Sidecar absent (legacy path) → ok:true (no-op)
 *   5. Retry-suffixed taskId verifies the retry's branch (NOT the slug's)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyTaskBranches } from '../branchVerification.js';
import type { TaskRepoBinding } from '../taskJson.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

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
  execFileSync('git', ['worktree', 'add', '-b', branch, worktreeRoot, baseSha], {
    cwd: originalRoot, stdio: 'pipe',
  });
}

function commitInWorktree(worktreeRoot: string, fileName: string): void {
  writeFileSync(path.join(worktreeRoot, fileName), 'x\n');
  git(worktreeRoot, ['add', fileName]);
  git(worktreeRoot, ['commit', '-q', '-m', `add ${fileName}`]);
}

function writeTaskJson(
  platformRoot: string,
  taskId: string,
  bindings: TaskRepoBinding[],
): void {
  const dir = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, '.task.json'),
    JSON.stringify({
      schema_version: 1,
      taskId,
      contextPackBinding: {
        contextPackPath: null,
        dataHostDir: null,
        dataContainerDir: null,
        repoBindings: bindings,
      },
      materialization: {
        strategy: 'copy',
        cloned: [],
        skipped: [],
        composeProjectName: `tasksail-${taskId}`,
      },
      frozenAt: new Date().toISOString(),
      finalizedAt: null,
      state: 'active',
    }, null, 2) + '\n',
    'utf-8',
  );
}

describe('verifyTaskBranches', () => {
  let platformRoot: string;

  beforeEach(() => {
    platformRoot = mkdtempSync(path.join(tmpdir(), 'ts-branch-verify-'));
  });

  afterEach(() => {
    rmSync(platformRoot, { recursive: true, force: true });
  });

  it('returns ok:true when every binding has at least one commit beyond base', async () => {
    const taskId = 'verify-happy';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo',
    );
    const baseSha = initRepo(originalRoot);
    addWorktree(originalRoot, worktreeRoot, `task/${taskId}`, baseSha);
    commitInWorktree(worktreeRoot, 'feature.ts');
    writeTaskJson(platformRoot, taskId, [{
      originalRoot,
      worktreeRoot,
      worktreeBranch: `task/${taskId}`,
      baseCommitSha: baseSha,
    }]);

    const result = await verifyTaskBranches(platformRoot, taskId);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('flags no-commits-beyond-base when worktree never advanced', async () => {
    const taskId = 'verify-empty';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo',
    );
    const baseSha = initRepo(originalRoot);
    addWorktree(originalRoot, worktreeRoot, `task/${taskId}`, baseSha);
    // Note: no commitInWorktree() — the branch HEAD remains at baseSha.
    writeTaskJson(platformRoot, taskId, [{
      originalRoot,
      worktreeRoot,
      worktreeBranch: `task/${taskId}`,
      baseCommitSha: baseSha,
    }]);

    const result = await verifyTaskBranches(platformRoot, taskId);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toBe('no-commits-beyond-base');
    expect(result.failures[0]!.branch).toBe(`task/${taskId}`);
  });

  it('flags branch-missing when the ref was deleted out-of-band', async () => {
    const taskId = 'verify-missing';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo',
    );
    const baseSha = initRepo(originalRoot);
    addWorktree(originalRoot, worktreeRoot, `task/${taskId}`, baseSha);
    commitInWorktree(worktreeRoot, 'feature.ts');
    writeTaskJson(platformRoot, taskId, [{
      originalRoot,
      worktreeRoot,
      worktreeBranch: `task/${taskId}`,
      baseCommitSha: baseSha,
    }]);

    // Forcibly remove the worktree first (cannot delete a branch that has a
    // checked-out worktree), then delete the ref.
    execFileSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
      cwd: originalRoot, stdio: 'pipe',
    });
    execFileSync('git', ['branch', '-D', `task/${taskId}`], {
      cwd: originalRoot, stdio: 'pipe',
    });

    const result = await verifyTaskBranches(platformRoot, taskId);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toBe('branch-missing');
  });

  it('returns ok:true when sidecar is absent (legacy/recovery path)', async () => {
    const result = await verifyTaskBranches(platformRoot, 'no-such-task');
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('verifies the retry branch (NOT the slug branch) for retry-suffixed taskIds', async () => {
    // Risk 5.2 from the plan: a retry's sidecar lists worktreeBranch with the
    // retry suffix. verifyTaskBranches must consult that field, not derive a
    // branch name from the taskId. We make this concrete by leaving the
    // un-suffixed slug's branch deliberately broken/missing.
    const slug = 'verify-retry';
    const retryTaskId = `${slug}-retry2`;

    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const baseSha = initRepo(originalRoot);

    // Create the original slug's branch with NO commits beyond base — this is
    // the "wrong" branch verifyTaskBranches must NOT verify against.
    const slugWorktree = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', slug, 'worktrees', 'repo',
    );
    addWorktree(originalRoot, slugWorktree, `task/${slug}`, baseSha);

    // Create the retry branch with commits beyond base — this IS what we
    // expect verifyTaskBranches to confirm.
    const retryWorktree = path.join(
      platformRoot, 'AgentWorkSpace', 'tasks', retryTaskId, 'worktrees', 'repo',
    );
    addWorktree(originalRoot, retryWorktree, `task/${retryTaskId}`, baseSha);
    commitInWorktree(retryWorktree, 'retry.ts');

    // Sidecar for the RETRY taskId points at the retry branch.
    writeTaskJson(platformRoot, retryTaskId, [{
      originalRoot,
      worktreeRoot: retryWorktree,
      worktreeBranch: `task/${retryTaskId}`,
      baseCommitSha: baseSha,
    }]);

    const result = await verifyTaskBranches(platformRoot, retryTaskId);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });
});
