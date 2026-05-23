import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { discardRetainedTaskWorktrees, finalizeTaskWorktreesWithReport } from '../worktreeFinalize.js';
import { _clearPlatformConfigCache } from '../../platform-config/get.js';

function git(repo: string, command: string): string {
  return execSync(`git ${command}`, { cwd: repo, encoding: 'utf-8' }).trim();
}

function initRepo(repo: string): string {
  mkdirSync(repo, { recursive: true });
  git(repo, 'init -b main');
  git(repo, 'config user.email test@example.com');
  git(repo, 'config user.name "Test User"');
  writeFileSync(path.join(repo, 'README.md'), '# repo\n', 'utf-8');
  git(repo, 'add README.md');
  git(repo, 'commit -m initial');
  return git(repo, 'rev-parse HEAD');
}

function writePlatform(repoRoot: string, retain: boolean): void {
  mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
  writeFileSync(path.join(repoRoot, '.platform-state', 'platform.json'), JSON.stringify({
    schema_version: 1,
    container_runtime: 'docker',
    max_parallel_tasks: 10,
    retain_failed_task_worktrees: retain,
    max_retained_failed_task_worktrees: 1,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  }, null, 2) + '\n');
  _clearPlatformConfigCache();
}

function writeSidecar(repoRoot: string, taskId: string, binding: Record<string, unknown>): void {
  const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({
    schema_version: 2,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: [binding],
    },
    materialization: { strategy: 'copy', cloned: [], skipped: [] },
    frozenAt: '2026-05-22T12:00:00.000Z',
    finalizedAt: null,
    state: 'active',
  }, null, 2) + '\n');
}

describe('worktree finalize branch ownership', () => {
  let tmp: string;
  let repoRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'finalize-ownership-'));
    repoRoot = path.join(tmp, 'repo');
    initRepo(repoRoot);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('standard failed task with retention disabled still deletes task-owned branch', async () => {
    writePlatform(repoRoot, false);
    const taskId = 'standard';
    const branch = `task/${taskId}`;
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreeRoot), { recursive: true });
    git(repoRoot, `worktree add -b ${branch} ${worktreeRoot}`);
    writeSidecar(repoRoot, taskId, {
      originalRoot: repoRoot,
      worktreeRoot,
      worktreeBranch: branch,
      baseCommitSha: git(repoRoot, 'rev-parse HEAD'),
      branchOwnership: 'task-owned',
    });

    await finalizeTaskWorktreesWithReport(taskId, 'failed', repoRoot);

    expect(existsSync(worktreeRoot)).toBe(false);
    expect(git(repoRoot, `branch --list ${branch}`)).toBe('');
  });

  it('chain-owned failed task rolls back and preserves the chain branch', async () => {
    writePlatform(repoRoot, false);
    const base = git(repoRoot, 'rev-parse HEAD');
    git(repoRoot, 'branch task/root');
    const taskId = 'child';
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreeRoot), { recursive: true });
    git(repoRoot, `worktree add ${worktreeRoot} task/root`);
    writeFileSync(path.join(worktreeRoot, 'failed.txt'), 'failed\n', 'utf-8');
    git(worktreeRoot, 'add failed.txt');
    git(worktreeRoot, 'commit -m failed');
    writeSidecar(repoRoot, taskId, {
      originalRoot: repoRoot,
      worktreeRoot,
      worktreeBranch: 'task/root',
      baseCommitSha: base,
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: taskId,
    });

    const result = await finalizeTaskWorktreesWithReport(taskId, 'failed', repoRoot);

    expect(result.chainRollbackReport?.status).toBe('completed');
    expect(existsSync(worktreeRoot)).toBe(false);
    expect(git(repoRoot, 'rev-parse task/root')).toBe(base);
    expect(git(repoRoot, 'branch --list task/root')).toContain('task/root');
  });

  it('retained discard removes chain-owned worktree without deleting the branch', async () => {
    writePlatform(repoRoot, true);
    git(repoRoot, 'branch task/root');
    const taskId = 'child';
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreeRoot), { recursive: true });
    git(repoRoot, `worktree add ${worktreeRoot} task/root`);
    writeSidecar(repoRoot, taskId, {
      originalRoot: repoRoot,
      worktreeRoot,
      worktreeBranch: 'task/root',
      baseCommitSha: git(repoRoot, 'rev-parse HEAD'),
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: taskId,
    });

    await discardRetainedTaskWorktrees(taskId, repoRoot);

    expect(existsSync(worktreeRoot)).toBe(false);
    expect(git(repoRoot, 'branch --list task/root')).toContain('task/root');
  });
});
