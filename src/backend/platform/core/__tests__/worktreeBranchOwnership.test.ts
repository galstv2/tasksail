import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  discardTaskBindingsWithOwnership,
  finalizeFailedTaskBindingsWithOwnership,
  isChildChainSourceBranchProtected,
  resolveTaskRepoBindingBranchOwnership,
} from '../worktreeBranchOwnership.js';
import { discardRetainedTaskWorktrees, finalizeTaskWorktreesWithReport } from '../worktreeFinalize.js';
import { _clearPlatformConfigCache } from '../../platform-config/get.js';
import { writeChildTaskChains, type ChildTaskChainsState } from '../../queue/childTaskChains.js';
import type { TaskRepoBinding } from '../../queue/taskJson.js';

const now = '2026-05-22T12:00:00.000Z';

function git(repo: string, args: string[]): string {
  return execSync(['git', ...args.map((arg) => JSON.stringify(arg))].join(' '), {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo(repo: string): string {
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeFileSync(path.join(repo, 'README.md'), '# repo\n', 'utf-8');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  return git(repo, ['rev-parse', 'HEAD']);
}

function taskBinding(repoRoot: string, taskId: string, overrides: Partial<TaskRepoBinding> = {}): TaskRepoBinding {
  return {
    originalRoot: repoRoot,
    worktreeRoot: path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo'),
    worktreeBranch: `task/${taskId}`,
    baseCommitSha: git(repoRoot, ['rev-parse', 'HEAD']),
    ...overrides,
  };
}

function writeSidecar(repoRoot: string, taskId: string, bindings: TaskRepoBinding[]): void {
  const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({
    schema_version: 2,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: bindings,
    },
    materialization: { strategy: 'copy', cloned: [], skipped: [] },
    frozenAt: now,
    finalizedAt: null,
    state: 'active',
  }, null, 2) + '\n');
}

function chainState(repoRoot: string, taskId = 'child'): ChildTaskChainsState {
  return {
    schemaVersion: 1,
    updatedAt: now,
    chains: {
      root: {
        rootTaskId: 'root',
        currentTipTaskId: taskId,
        contextPackId: null,
        contextPackDir: null,
        taskIds: ['root', taskId],
        createdAt: now,
        updatedAt: now,
      },
    },
    tasks: {
      root: {
        taskId: 'root',
        rootTaskId: 'root',
        parentTaskId: null,
        previousTaskId: null,
        depth: 0,
        state: 'completed',
        archivePath: 'archive.md',
        archiveArtifactDir: null,
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
        parentContextSnapshot: null,
        childExecutionScope: null,
        branchChain: null,
        completedBranchHandoffs: null,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      [taskId]: {
        taskId,
        rootTaskId: 'root',
        parentTaskId: 'root',
        previousTaskId: 'root',
        depth: 1,
        state: 'active',
        archivePath: null,
        archiveArtifactDir: null,
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
        parentContextSnapshot: null,
        childExecutionScope: null,
        branchChain: {
          schemaVersion: 1,
          mode: 'continuation',
          rootTaskId: 'root',
          parentTaskId: 'root',
          depth: 1,
          repos: [{
            repoRoot,
            repoLabel: 'repo',
            chainSourceBranch: 'task/root',
            parentSourceBranch: 'task/root',
            parentBranchHead: 'base',
            targetBranch: 'main',
          }],
        },
        completedBranchHandoffs: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
}

describe('worktree branch ownership helper', () => {
  let tmp: string;
  let repoRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'branch-ownership-'));
    repoRoot = path.join(tmp, 'repo');
    initRepo(repoRoot);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves sidecar ownership, legacy task branch fallback, and legacy child-chain fallback', async () => {
    const taskOwned = taskBinding(repoRoot, 'standard', { branchOwnership: 'task-owned' });
    await expect(resolveTaskRepoBindingBranchOwnership({ repoRoot, taskId: 'standard', binding: taskOwned }))
      .resolves.toMatchObject({ ownership: 'task-owned', source: 'sidecar' });

    const legacyTask = taskBinding(repoRoot, 'legacy');
    await expect(resolveTaskRepoBindingBranchOwnership({ repoRoot, taskId: 'legacy', binding: legacyTask }))
      .resolves.toMatchObject({ ownership: 'task-owned', source: 'legacy-task-branch' });

    await writeChildTaskChains(repoRoot, chainState(repoRoot));
    const legacyChain = taskBinding(repoRoot, 'child', { worktreeBranch: 'task/root' });
    await expect(resolveTaskRepoBindingBranchOwnership({ repoRoot, taskId: 'child', binding: legacyChain }))
      .resolves.toMatchObject({ ownership: 'chain-owned', source: 'legacy-child-chain-state', rootTaskId: 'root' });
  });

  it('fails closed when ownership evidence is unresolved or contradictory', async () => {
    const unresolved = taskBinding(repoRoot, 'child', { worktreeBranch: 'task/root' });
    await expect(resolveTaskRepoBindingBranchOwnership({ repoRoot, taskId: 'child', binding: unresolved }))
      .rejects.toThrow('task-branch-ownership-unresolved');

    const contradictory = taskBinding(repoRoot, 'child', {
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: 'other',
    });
    await expect(resolveTaskRepoBindingBranchOwnership({ repoRoot, taskId: 'child', binding: contradictory }))
      .rejects.toThrow('task-branch-ownership-unresolved');
  });

  it('hard-rolls back a chain-owned failed worktree and preserves the chain branch', async () => {
    const base = git(repoRoot, ['rev-parse', 'HEAD']);
    git(repoRoot, ['branch', 'task/root']);
    const binding = taskBinding(repoRoot, 'child', {
      worktreeBranch: 'task/root',
      baseCommitSha: base,
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: 'child',
    });
    mkdirSync(path.dirname(binding.worktreeRoot), { recursive: true });
    git(repoRoot, ['worktree', 'add', binding.worktreeRoot, 'task/root']);
    writeFileSync(path.join(binding.worktreeRoot, 'failed.txt'), 'failed\n', 'utf-8');
    git(binding.worktreeRoot, ['add', 'failed.txt']);
    git(binding.worktreeRoot, ['commit', '-m', 'failed child']);

    const report = await finalizeFailedTaskBindingsWithOwnership({
      repoRoot,
      taskId: 'child',
      bindings: [binding],
      retainFailedWorktree: false,
    });

    expect(report.chainRollbackReport?.status).toBe('completed');
    expect(existsSync(binding.worktreeRoot)).toBe(false);
    expect(git(repoRoot, ['rev-parse', 'task/root'])).toBe(base);
    expect(git(repoRoot, ['branch', '--list', 'task/root'])).toContain('task/root');
  });

  it('mixed-resets retained chain worktrees and preserves dirty failed files', async () => {
    const base = git(repoRoot, ['rev-parse', 'HEAD']);
    git(repoRoot, ['branch', 'task/root']);
    const binding = taskBinding(repoRoot, 'child', {
      worktreeBranch: 'task/root',
      baseCommitSha: base,
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: 'child',
    });
    mkdirSync(path.dirname(binding.worktreeRoot), { recursive: true });
    git(repoRoot, ['worktree', 'add', binding.worktreeRoot, 'task/root']);
    writeFileSync(path.join(binding.worktreeRoot, 'failed.txt'), 'failed\n', 'utf-8');
    git(binding.worktreeRoot, ['add', 'failed.txt']);
    git(binding.worktreeRoot, ['commit', '-m', 'failed child']);

    await finalizeFailedTaskBindingsWithOwnership({
      repoRoot,
      taskId: 'child',
      bindings: [binding],
      retainFailedWorktree: true,
    });

    expect(existsSync(binding.worktreeRoot)).toBe(true);
    expect(git(repoRoot, ['rev-parse', 'task/root'])).toBe(base);
    expect(readFileSync(path.join(binding.worktreeRoot, 'failed.txt'), 'utf-8')).toBe('failed\n');
    expect(git(binding.worktreeRoot, ['status', '--short'])).toContain('failed.txt');
  });

  it('preflight failure resets no repo in a multi-repo chain', async () => {
    const otherRepo = path.join(tmp, 'other');
    const baseA = git(repoRoot, ['rev-parse', 'HEAD']);
    const baseB = initRepo(otherRepo);
    git(repoRoot, ['branch', 'task/root']);
    git(otherRepo, ['branch', 'task/root']);
    const good = taskBinding(repoRoot, 'child', {
      worktreeBranch: 'task/root',
      baseCommitSha: baseA,
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: 'child',
    });
    const bad = taskBinding(otherRepo, 'child', {
      worktreeBranch: 'task/root',
      worktreeRoot: path.join(otherRepo, 'missing-worktree'),
      baseCommitSha: baseB,
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: 'child',
    });
    mkdirSync(path.dirname(good.worktreeRoot), { recursive: true });
    git(repoRoot, ['worktree', 'add', good.worktreeRoot, 'task/root']);
    writeFileSync(path.join(good.worktreeRoot, 'failed.txt'), 'failed\n', 'utf-8');
    git(good.worktreeRoot, ['add', 'failed.txt']);
    git(good.worktreeRoot, ['commit', '-m', 'failed child']);
    const failedHead = git(repoRoot, ['rev-parse', 'task/root']);

    const report = await finalizeFailedTaskBindingsWithOwnership({
      repoRoot,
      taskId: 'child',
      bindings: [good, bad],
      retainFailedWorktree: false,
    });

    expect(report.chainRollbackReport?.status).toBe('preflight-failed');
    expect(git(repoRoot, ['rev-parse', 'task/root'])).toBe(failedHead);
    expect(existsSync(good.worktreeRoot)).toBe(true);
  });

  it('reports partial failure when a later reset fails after all preflight checks pass', async () => {
    const otherRepo = path.join(tmp, 'other-partial');
    const baseA = git(repoRoot, ['rev-parse', 'HEAD']);
    const baseB = initRepo(otherRepo);
    git(repoRoot, ['branch', 'task/root']);
    git(otherRepo, ['branch', 'task/root']);
    const first = taskBinding(repoRoot, 'child', {
      worktreeBranch: 'task/root',
      baseCommitSha: baseA,
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: 'child',
    });
    const second = taskBinding(otherRepo, 'child', {
      worktreeBranch: 'task/root',
      baseCommitSha: baseB,
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: 'child',
    });
    for (const binding of [first, second]) {
      mkdirSync(path.dirname(binding.worktreeRoot), { recursive: true });
      git(binding.originalRoot, ['worktree', 'add', binding.worktreeRoot, 'task/root']);
      writeFileSync(path.join(binding.worktreeRoot, 'failed.txt'), 'failed\n', 'utf-8');
      git(binding.worktreeRoot, ['add', 'failed.txt']);
      git(binding.worktreeRoot, ['commit', '-m', 'failed child']);
    }
    chmodSync(second.worktreeRoot, 0o555);
    try {
      const report = await finalizeFailedTaskBindingsWithOwnership({
        repoRoot,
        taskId: 'child',
        bindings: [first, second],
        retainFailedWorktree: false,
      });

      expect(report.chainRollbackReport?.status).toBe('partial-failed');
      expect(report.chainRollbackReport?.rolledBackBindings).toBe(1);
      expect(git(repoRoot, ['rev-parse', 'task/root'])).toBe(baseA);
      expect(git(otherRepo, ['branch', '--list', 'task/root'])).toContain('task/root');
      expect(existsSync(second.worktreeRoot)).toBe(true);
    } finally {
      chmodSync(second.worktreeRoot, 0o755);
    }
  });

  it('protects child-chain source branches during startup sweep checks', async () => {
    await writeChildTaskChains(repoRoot, chainState(repoRoot));

    await expect(isChildChainSourceBranchProtected({ repoRoot, branch: 'task/root' }))
      .resolves.toEqual({ protected: true, unreadable: false });
    await expect(isChildChainSourceBranchProtected({ repoRoot, branch: 'task/unrelated' }))
      .resolves.toEqual({ protected: false, unreadable: false });
  });

  it('discard removes chain-owned retained worktrees without deleting chain branch', async () => {
    git(repoRoot, ['branch', 'task/root']);
    const binding = taskBinding(repoRoot, 'child', {
      worktreeBranch: 'task/root',
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: 'child',
    });
    mkdirSync(path.dirname(binding.worktreeRoot), { recursive: true });
    git(repoRoot, ['worktree', 'add', binding.worktreeRoot, 'task/root']);
    writeSidecar(repoRoot, 'child', [binding]);

    await discardTaskBindingsWithOwnership({ repoRoot, taskId: 'child', bindings: [binding] });

    expect(existsSync(binding.worktreeRoot)).toBe(false);
    expect(git(repoRoot, ['branch', '--list', 'task/root'])).toContain('task/root');
  });
});

function writePlatformState(repoRoot: string, retain: boolean): void {
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

function writeSidecarSingle(repoRoot: string, taskId: string, binding: Record<string, unknown>): void {
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

describe('worktree finalize branch ownership (orchestrator integration)', () => {
  let tmp: string;
  let repoRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'finalize-ownership-'));
    repoRoot = path.join(tmp, 'repo');
    mkdirSync(repoRoot, { recursive: true });
    execSync('git init -b main', { cwd: repoRoot, encoding: 'utf-8' });
    execSync('git config user.email test@example.com', { cwd: repoRoot, encoding: 'utf-8' });
    execSync('git config user.name "Test User"', { cwd: repoRoot, encoding: 'utf-8' });
    writeFileSync(path.join(repoRoot, 'README.md'), '# repo\n', 'utf-8');
    execSync('git add README.md', { cwd: repoRoot, encoding: 'utf-8' });
    execSync('git commit -m initial', { cwd: repoRoot, encoding: 'utf-8' });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('standard failed task with retention disabled still deletes task-owned branch', async () => {
    writePlatformState(repoRoot, false);
    const taskId = 'standard';
    const branch = `task/${taskId}`;
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreeRoot), { recursive: true });
    execSync(`git worktree add -b ${branch} ${worktreeRoot}`, { cwd: repoRoot, encoding: 'utf-8' });
    writeSidecarSingle(repoRoot, taskId, {
      originalRoot: repoRoot,
      worktreeRoot,
      worktreeBranch: branch,
      baseCommitSha: execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim(),
      branchOwnership: 'task-owned',
    });

    await finalizeTaskWorktreesWithReport(taskId, 'failed', repoRoot);

    expect(existsSync(worktreeRoot)).toBe(false);
    expect(execSync(`git branch --list ${branch}`, { cwd: repoRoot, encoding: 'utf-8' }).trim()).toBe('');
  });

  it('chain-owned failed task rolls back and preserves the chain branch', async () => {
    writePlatformState(repoRoot, false);
    const base = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim();
    execSync('git branch task/root', { cwd: repoRoot, encoding: 'utf-8' });
    const taskId = 'child';
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreeRoot), { recursive: true });
    execSync(`git worktree add ${worktreeRoot} task/root`, { cwd: repoRoot, encoding: 'utf-8' });
    writeFileSync(path.join(worktreeRoot, 'failed.txt'), 'failed\n', 'utf-8');
    execSync('git add failed.txt', { cwd: worktreeRoot, encoding: 'utf-8' });
    execSync('git commit -m failed', { cwd: worktreeRoot, encoding: 'utf-8' });
    writeSidecarSingle(repoRoot, taskId, {
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
    expect(execSync('git rev-parse task/root', { cwd: repoRoot, encoding: 'utf-8' }).trim()).toBe(base);
    expect(execSync('git branch --list task/root', { cwd: repoRoot, encoding: 'utf-8' })).toContain('task/root');
  });

  it('retained discard removes chain-owned worktree without deleting the branch', async () => {
    writePlatformState(repoRoot, true);
    execSync('git branch task/root', { cwd: repoRoot, encoding: 'utf-8' });
    const taskId = 'child';
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    mkdirSync(path.dirname(worktreeRoot), { recursive: true });
    execSync(`git worktree add ${worktreeRoot} task/root`, { cwd: repoRoot, encoding: 'utf-8' });
    writeSidecarSingle(repoRoot, taskId, {
      originalRoot: repoRoot,
      worktreeRoot,
      worktreeBranch: 'task/root',
      baseCommitSha: execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim(),
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root',
      branchChainTaskId: taskId,
    });

    await discardRetainedTaskWorktrees(taskId, repoRoot);

    expect(existsSync(worktreeRoot)).toBe(false);
    expect(execSync('git branch --list task/root', { cwd: repoRoot, encoding: 'utf-8' })).toContain('task/root');
  });
});
