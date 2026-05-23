import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PreparedChildTaskChainCloseout } from '../childTaskChainCloseout.js';
import {
  CHILD_CHAIN_AUTO_MERGE_SKIP_MESSAGE,
  buildChildTaskChainCloseoutPolicy,
  verifyChildChainSourceBranchesExist,
} from '../childTaskChainCloseoutValidation.js';
import type { TaskRepoBinding } from '../taskJson.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('buildChildTaskChainCloseoutPolicy', () => {
  it('preserves platform auto-merge for standard or legacy child closeout', () => {
    expect(buildChildTaskChainCloseoutPolicy({
      childChainCloseout: null,
      platformAutoMergeEnabled: true,
    })).toEqual({
      isChainedChild: false,
      platformAutoMergeEnabled: true,
      effectiveAutoMergeEnabled: true,
      emitChildChainAutoMergeSkip: false,
      autoMergeDetailOverride: null,
    });
    expect(buildChildTaskChainCloseoutPolicy({
      childChainCloseout: null,
      platformAutoMergeEnabled: false,
    }).effectiveAutoMergeEnabled).toBe(false);
  });

  it('forces auto-merge disabled for chained child closeout and emits skip only when globally enabled', () => {
    expect(buildChildTaskChainCloseoutPolicy({
      childChainCloseout: preparedCloseout('/repo/platform'),
      platformAutoMergeEnabled: true,
    })).toEqual({
      isChainedChild: true,
      platformAutoMergeEnabled: true,
      effectiveAutoMergeEnabled: false,
      emitChildChainAutoMergeSkip: true,
      autoMergeDetailOverride: CHILD_CHAIN_AUTO_MERGE_SKIP_MESSAGE,
    });
    expect(buildChildTaskChainCloseoutPolicy({
      childChainCloseout: preparedCloseout('/repo/platform'),
      platformAutoMergeEnabled: false,
    })).toEqual(expect.objectContaining({
      effectiveAutoMergeEnabled: false,
      emitChildChainAutoMergeSkip: false,
      autoMergeDetailOverride: null,
    }));
  });
});

describe('verifyChildChainSourceBranchesExist', () => {
  it('matches by normalized absolute root and allows repo label differences', async () => {
    const repo = createRepo('normalized');
    const nestedRoot = path.join(repo, 'nested', '..');
    mkdirSync(path.join(repo, 'nested'), { recursive: true });
    const execFileAsync = callbackExec();

    await verifyChildChainSourceBranchesExist({
      taskId: 'child',
      prepared: preparedCloseout(nestedRoot),
      repoBindings: [binding(repo, 'task/root')],
      execFileAsync,
    });

    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['-C', realpathSync(repo), 'rev-parse', '--verify', 'refs/heads/task/root'],
      expect.any(Function),
    );
  });

  it('fails when a matching binding is missing or duplicated', async () => {
    const repo = createRepo('missing-binding');
    await expect(verifyChildChainSourceBranchesExist({
      taskId: 'child',
      prepared: preparedCloseout(repo),
      repoBindings: [],
      execFileAsync: callbackExec(),
    })).rejects.toThrow('child-task-chain-closeout-source-branch-mismatch for task "child":');

    await expect(verifyChildChainSourceBranchesExist({
      taskId: 'child',
      prepared: preparedCloseout(repo),
      repoBindings: [binding(repo, 'task/root'), binding(repo, 'task/root')],
      execFileAsync: callbackExec(),
    })).rejects.toThrow('matched 2 repo bindings');
  });

  it('fails when binding branch differs from chainSourceBranch', async () => {
    const repo = createRepo('branch-mismatch');
    await expect(verifyChildChainSourceBranchesExist({
      taskId: 'child',
      prepared: preparedCloseout(repo),
      repoBindings: [binding(repo, 'main')],
      execFileAsync: callbackExec(),
    })).rejects.toThrow(`${repo} expected task/root but .task.json has main`);
  });

  it('fails missing refs/heads chain source branch without accepting target branch', async () => {
    const repo = createRepo('missing-ref');
    const execFileAsync = callbackExec({ failBranch: 'task/root' });

    await expect(verifyChildChainSourceBranchesExist({
      taskId: 'child',
      prepared: preparedCloseout(repo, { chainSourceBranch: 'task/root', targetBranch: 'main' }),
      repoBindings: [binding(repo, 'task/root')],
      execFileAsync,
    })).rejects.toThrow(
      `Completion blocked: child task chain source branch task/root is missing in ${realpathSync(repo)}. ` +
      `Restore the chain branch or resolve the child task manually. child-task-chain-closeout-source-branch-missing for task "child":`,
    );
  });
});

function preparedCloseout(
  repoRoot: string,
  branches: { chainSourceBranch?: string; targetBranch?: string } = {},
): PreparedChildTaskChainCloseout {
  return {
    schemaVersion: 1,
    source: 'fresh',
    taskId: 'child',
    rootTaskId: 'root',
    parentTaskId: 'parent',
    previousTaskId: 'parent',
    depth: 1,
    branchChain: {
      schemaVersion: 1,
      mode: 'continuation',
      rootTaskId: 'root',
      parentTaskId: 'parent',
      depth: 1,
      repos: [{
        repoRoot,
        repoLabel: 'platform',
        chainSourceBranch: branches.chainSourceBranch ?? 'task/root',
        parentSourceBranch: 'task/parent',
        parentBranchHead: 'parent-head',
        targetBranch: branches.targetBranch ?? 'main',
      }],
    },
    archivePath: null,
    archiveArtifactDir: null,
    completedBranchHandoffs: [],
    preparedAt: '2026-05-22T12:00:00.000Z',
  };
}

function binding(repoRoot: string, worktreeBranch: string): TaskRepoBinding {
  return {
    originalRoot: repoRoot,
    worktreeRoot: path.join(repoRoot, '.task-worktree'),
    worktreeBranch,
    baseCommitSha: 'base',
  };
}

function createRepo(label: string): string {
  const repo = mkdtempSync(path.join(tmpdir(), `chain-closeout-validation-${label}-`));
  tempRoots.push(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['checkout', '-q', '-b', 'task/root'], { cwd: repo });
  return repo;
}

function callbackExec(options: { failBranch?: string } = {}): typeof import('node:child_process').execFile {
  return vi.fn((command, args, callback) => {
    const branchRef = Array.isArray(args) ? String(args.at(-1)) : '';
    const error = options.failBranch && branchRef === `refs/heads/${options.failBranch}`
      ? new Error('missing ref')
      : null;
    callback?.(error, '', '');
    return {} as ReturnType<typeof import('node:child_process').execFile>;
  }) as unknown as typeof import('node:child_process').execFile;
}
