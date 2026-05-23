import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { writeChildTaskChains, type ChildTaskChainsState } from '../../queue/childTaskChains.js';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../../queue/errorItems.js', () => ({
  moveFailedItemToErrorItems: vi.fn().mockResolvedValue({
    movedItem: 'x.md',
    errorItemPath: 'error',
    nextActiveItem: null,
  }),
}));

vi.mock('../../queue/resumeCloseout.js', () => ({
  resumeCloseoutFromSentinel: vi.fn().mockResolvedValue({ status: 'no-sentinel', drove: [] }),
}));

import { recoverOnStartup } from '../pipelineSupervisor.js';

const now = '2026-05-22T12:00:00.000Z';

describe('recoverOnStartup child-chain branch protection', () => {
  let repoRoot: string;

  beforeEach(async () => {
    execFileMock.mockReset();
    repoRoot = await mkdtemp(path.join(tmpdir(), 'recover-child-chain-'));
    await mkdir(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('skips orphan task-like branches referenced by child-chain branch state', async () => {
    await writeChildTaskChains(repoRoot, stateFixture(repoRoot));
    execFileMock.mockImplementation((_cmd: string, args: string[], _options: unknown, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (args[0] === 'worktree') return callback(null, { stdout: '', stderr: '' });
      if (args[0] === 'for-each-ref') return callback(null, { stdout: 'task/root\n', stderr: '' });
      if (args[0] === 'branch') return callback(null, { stdout: '', stderr: '' });
      return callback(null, { stdout: '', stderr: '' });
    });

    await recoverOnStartup(repoRoot);

    expect(execFileMock).not.toHaveBeenCalledWith(
      'git',
      ['branch', '-D', 'task/root'],
      { cwd: repoRoot },
      expect.any(Function),
    );
  });

  it('fails closed when child-chain state is corrupt', async () => {
    await mkdir(path.join(repoRoot, '.platform-state'), { recursive: true });
    await writeFile(path.join(repoRoot, '.platform-state', 'child-task-chains.json'), '{bad-json', 'utf-8');
    execFileMock.mockImplementation((_cmd: string, args: string[], _options: unknown, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (args[0] === 'worktree') return callback(null, { stdout: '', stderr: '' });
      if (args[0] === 'for-each-ref') return callback(null, { stdout: 'task/orphan\n', stderr: '' });
      if (args[0] === 'branch') return callback(null, { stdout: '', stderr: '' });
      return callback(null, { stdout: '', stderr: '' });
    });

    await recoverOnStartup(repoRoot);

    expect(execFileMock).not.toHaveBeenCalledWith(
      'git',
      ['branch', '-D', 'task/orphan'],
      { cwd: repoRoot },
      expect.any(Function),
    );
  });
});

function stateFixture(repoRoot: string): ChildTaskChainsState {
  return {
    schemaVersion: 1,
    updatedAt: now,
    chains: {
      root: {
        rootTaskId: 'root',
        currentTipTaskId: 'child',
        contextPackId: null,
        contextPackDir: null,
        taskIds: ['root', 'child'],
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
      child: {
        taskId: 'child',
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
