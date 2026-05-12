import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { stageAutoMergeCloseout } from '../autoMerge.js';
import type { TaskRepoBinding } from '../taskJson.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('stageAutoMergeCloseout', () => {
  it('returns disabled without touching bindings when config is disabled', async () => {
    const repo = createRepo('disabled');
    const result = await stageAutoMergeCloseout({ enabled: false, bindings: [repo.binding] });

    expect(result).toEqual({
      enabled: false,
      applied: false,
      results: [expect.objectContaining({ status: 'disabled' })],
    });
  });

  it('stages a clean non-conflicting task patch and leaves source branch intact', async () => {
    const repo = createRepo('clean');

    const result = await stageAutoMergeCloseout({ enabled: true, bindings: [repo.binding] });

    expect(result.applied).toBe(true);
    expect(result.results[0]).toEqual(expect.objectContaining({
      status: 'applied',
      targetBranch: 'main',
      sourceBranch: repo.binding.worktreeBranch,
    }));
    expect(git(repo.repoRoot, ['diff', '--cached', '--name-only'])).toBe('clean.txt');
    expectNoGitOperationState(repo.repoRoot);
    expect(git(repo.repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${repo.binding.worktreeBranch}`], { allowFailure: true }).status).toBe(0);
  });

  it('skips all bindings when any target repo is dirty', async () => {
    const clean = createRepo('dirty-clean');
    const dirty = createRepo('dirty');
    writeFileSync(path.join(dirty.repoRoot, 'untracked.txt'), 'dirty\n');

    const result = await stageAutoMergeCloseout({ enabled: true, bindings: [clean.binding, dirty.binding] });

    expect(result.applied).toBe(false);
    expect(result.results.every((item) => item.status === 'skipped-target-dirty')).toBe(true);
    expectNoGitOperationState(clean.repoRoot);
  });

  it('skips cleanly when the source branch is already merged', async () => {
    const repo = createRepo('already-merged', { alreadyMerged: true });

    const result = await stageAutoMergeCloseout({ enabled: true, bindings: [repo.binding] });

    expect(result.applied).toBe(false);
    expect(result.results[0]).toEqual(expect.objectContaining({
      status: 'skipped-merge-not-needed',
      targetBranch: 'main',
    }));
    expect(git(repo.repoRoot, ['status', '--porcelain=v1', '--untracked-files=normal'])).toBe('');
    expectNoGitOperationState(repo.repoRoot);
  });

  it('rolls back a staging conflict and leaves the target clean', async () => {
    const repo = createRepo('conflict', { conflict: true });

    const result = await stageAutoMergeCloseout({ enabled: true, bindings: [repo.binding] });

    expect(result.applied).toBe(false);
    expect(result.results[0].status).toBe('skipped-merge-conflict');
    expect(git(repo.repoRoot, ['status', '--porcelain=v1', '--untracked-files=normal'])).toBe('');
    expectNoGitOperationState(repo.repoRoot);
  });

  it('rolls back previously successful staged patches when a later repo conflicts', async () => {
    const first = createRepo('multi-first');
    const second = createRepo('multi-second', { conflict: true });

    const result = await stageAutoMergeCloseout({ enabled: true, bindings: [first.binding, second.binding] });

    expect(result.applied).toBe(false);
    expect(result.results.every((item) => item.status === 'skipped-merge-conflict')).toBe(true);
    expect(git(first.repoRoot, ['status', '--porcelain=v1', '--untracked-files=normal'])).toBe('');
    expectNoGitOperationState(first.repoRoot);
  });

  it('keeps successful staged patches when a later repo needs no changes', async () => {
    const first = createRepo('multi-first-noop');
    const second = createRepo('multi-second-noop', { alreadyMerged: true });

    const result = await stageAutoMergeCloseout({ enabled: true, bindings: [first.binding, second.binding] });

    expect(result.applied).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({
        originalRoot: first.repoRoot,
        status: 'applied',
      }),
      expect.objectContaining({
        originalRoot: second.repoRoot,
        status: 'skipped-merge-not-needed',
      }),
    ]);
    expect(git(first.repoRoot, ['diff', '--cached', '--name-only'])).toBe('multi-first-noop.txt');
    expectNoGitOperationState(first.repoRoot);
    expect(git(second.repoRoot, ['status', '--porcelain=v1', '--untracked-files=normal'])).toBe('');
    expectNoGitOperationState(second.repoRoot);
  });
});

function expectNoGitOperationState(repoRoot: string): void {
  for (const stateFile of ['MERGE_HEAD', 'MERGE_MSG', 'CHERRY_PICK_HEAD']) {
    expect(existsSync(path.join(repoRoot, '.git', stateFile))).toBe(false);
  }
}

function createRepo(
  label: string,
  options: { conflict?: boolean; alreadyMerged?: boolean } = {},
): { repoRoot: string; binding: TaskRepoBinding } {
  const repoRoot = mkdtempSync(path.join(tmpdir(), `tasksail-auto-merge-${label}-`));
  tempRoots.push(repoRoot);
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'Test User']);
  git(repoRoot, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(path.join(repoRoot, 'README.md'), '# base\n');
  if (options.conflict) {
    writeFileSync(path.join(repoRoot, 'conflict.txt'), 'base\n');
  }
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-q', '-m', 'base']);
  const baseCommitSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const worktreeBranch = `task/${label}`;
  git(repoRoot, ['checkout', '-q', '-b', worktreeBranch]);
  if (options.conflict) {
    writeFileSync(path.join(repoRoot, 'conflict.txt'), 'task\n');
  } else {
    writeFileSync(path.join(repoRoot, `${label}.txt`), 'task\n');
  }
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-q', '-m', 'task']);
  git(repoRoot, ['checkout', '-q', 'main']);
  if (options.conflict) {
    writeFileSync(path.join(repoRoot, 'conflict.txt'), 'main\n');
    git(repoRoot, ['add', 'conflict.txt']);
    git(repoRoot, ['commit', '-q', '-m', 'main conflict']);
  } else if (options.alreadyMerged) {
    git(repoRoot, ['merge', '-q', '--no-ff', worktreeBranch, '-m', 'manual merge']);
  }
  return {
    repoRoot,
    binding: {
      originalRoot: repoRoot,
      worktreeRoot: path.join(repoRoot, '.task-worktree'),
      worktreeBranch,
      baseCommitSha,
    },
  };
}

function git(cwd: string, args: string[], options?: { allowFailure?: false }): string;
function git(cwd: string, args: string[], options: { allowFailure: true }): { status: number; stdout: string; stderr: string };
function git(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): string | { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (options.allowFailure) return { status: 0, stdout, stderr: '' };
    return stdout;
  } catch (err) {
    if (!options.allowFailure) throw err;
    const error = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: error.status ?? 1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? '').trim(),
    };
  }
}
