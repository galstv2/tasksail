import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { markChildTaskChainTaskFailed, resetFailedChildTaskChainTaskToPlanned } from '../childTaskChainFailure.js';
import { readChildTaskChains, writeChildTaskChains, type ChildTaskChainsState } from '../childTaskChains.js';

const now = '2026-05-22T12:00:00.000Z';
let repoRoot = '';

describe('markChildTaskChainTaskFailed', () => {
  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'child-chain-failure-'));
    await mkdir(path.join(repoRoot, '.platform-state'), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('marks the current tip failed and does not advance currentTipTaskId', async () => {
    await writeChildTaskChains(repoRoot, stateFixture('active'));

    const result = await markChildTaskChainTaskFailed({ repoRoot, taskId: 'child', now });
    const state = await readChildTaskChains(repoRoot);

    expect(result).toEqual({ marked: true, rootTaskId: 'root', currentTipTaskId: 'child' });
    expect(state.tasks.child.state).toBe('failed');
    expect(state.chains.root.currentTipTaskId).toBe('child');
  });

  it('is idempotent for an already-failed current tip', async () => {
    await writeChildTaskChains(repoRoot, stateFixture('failed'));

    await expect(markChildTaskChainTaskFailed({ repoRoot, taskId: 'child', now }))
      .resolves.toEqual({ marked: true, rootTaskId: 'root', currentTipTaskId: 'child' });
  });

  it('returns marked false for standard tasks absent from child-chain state', async () => {
    await writeChildTaskChains(repoRoot, stateFixture('active'));

    await expect(markChildTaskChainTaskFailed({ repoRoot, taskId: 'standard', now }))
      .resolves.toEqual({ marked: false, rootTaskId: null, currentTipTaskId: null });
  });

  it('fails closed for non-tip and completed child-chain tasks', async () => {
    const nonTip = stateFixture('active');
    nonTip.chains.root.currentTipTaskId = 'root';
    await writeChildTaskChains(repoRoot, nonTip);
    await expect(markChildTaskChainTaskFailed({ repoRoot, taskId: 'child', now }))
      .rejects.toThrow('child-task-chain-failure-not-current-tip');

    await writeChildTaskChains(repoRoot, stateFixture('completed'));
    await expect(markChildTaskChainTaskFailed({ repoRoot, taskId: 'child', now }))
      .rejects.toThrow('child-task-chain-failure-completed-task');
  });

  it('resets a failed current tip back to planned when reopened', async () => {
    await writeChildTaskChains(repoRoot, stateFixture('failed'));

    const result = await resetFailedChildTaskChainTaskToPlanned({ repoRoot, taskId: 'child', now });
    const state = await readChildTaskChains(repoRoot);

    expect(result).toEqual({ reset: true, rootTaskId: 'root', currentTipTaskId: 'child' });
    expect(state.tasks.child.state).toBe('planned');
    expect(state.chains.root.currentTipTaskId).toBe('child');
  });

  it('fails closed when reopening a non-tip or completed child-chain task', async () => {
    const nonTip = stateFixture('failed');
    nonTip.chains.root.currentTipTaskId = 'root';
    await writeChildTaskChains(repoRoot, nonTip);
    await expect(resetFailedChildTaskChainTaskToPlanned({ repoRoot, taskId: 'child', now }))
      .rejects.toThrow('child-task-chain-reopen-not-current-tip');

    await writeChildTaskChains(repoRoot, stateFixture('completed'));
    await expect(resetFailedChildTaskChainTaskToPlanned({ repoRoot, taskId: 'child', now }))
      .rejects.toThrow('child-task-chain-reopen-completed-task');
  });
});

function stateFixture(state: ChildTaskChainsState['tasks'][string]['state']): ChildTaskChainsState {
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
        state,
        archivePath: state === 'completed' ? 'archive.md' : null,
        archiveArtifactDir: null,
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
        parentContextSnapshot: null,
        childExecutionScope: null,
        branchChain: null,
        completedBranchHandoffs: null,
        completedAt: state === 'completed' ? now : null,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
}
