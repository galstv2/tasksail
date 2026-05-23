import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { recordPlannedChildTask } from '../childTaskChainPlanning.js';
import { readChildTaskChains, writeChildTaskChains, type ChildTaskContextSnapshot } from '../childTaskChains.js';
import type { TaskBranchChainBinding } from '../markdown.js';

const roots: string[] = [];

function snapshot(id = 'pack'): ChildTaskContextSnapshot {
  return {
    contextPackDir: `/packs/${id}`,
    contextPackId: id,
    scopeMode: 'repo-selection',
    primaryRepoId: 'repo',
    primaryFocusId: null,
    selectedRepoIds: ['repo'],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  };
}

function branchChain(parentTaskId: string, rootTaskId = parentTaskId, depth = 1): TaskBranchChainBinding {
  return {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId,
    parentTaskId,
    depth,
    repos: [{
      repoRoot: '/repo',
      repoLabel: 'Repo',
      chainSourceBranch: 'root-branch',
      parentSourceBranch: 'parent-branch',
      parentBranchHead: 'abc123',
      targetBranch: 'main',
    }],
  };
}

async function tempRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'chain-planning-'));
  roots.push(root);
  return root;
}

describe('recordPlannedChildTask', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('seeds a root parent and records the first planned child', async () => {
    const repoRoot = await tempRepo();
    const state = await recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-1',
      rootTaskId: 'PARENT-1',
      parentTaskId: 'PARENT-1',
      previousTaskId: 'PARENT-1',
      branchChain: branchChain('PARENT-1'),
      parentArchivePath: '/archive/PARENT-1.md',
      parentArchiveArtifactDir: '/archive/PARENT-1',
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
      now: new Date('2026-05-19T00:00:00Z'),
    });

    expect(state.chains['PARENT-1']?.taskIds).toEqual(['PARENT-1', 'CHILD-1']);
    expect(state.chains['PARENT-1']?.currentTipTaskId).toBe('CHILD-1');
    expect(state.tasks['PARENT-1']?.state).toBe('completed');
    expect(state.tasks['CHILD-1']?.state).toBe('planned');
  });

  it('appends a grandchild only from the current tip', async () => {
    const repoRoot = await tempRepo();
    await recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-1',
      rootTaskId: 'PARENT-1',
      parentTaskId: 'PARENT-1',
      previousTaskId: 'PARENT-1',
      branchChain: branchChain('PARENT-1'),
      parentArchivePath: '/archive/PARENT-1.md',
      parentArchiveArtifactDir: null,
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
    });
    const afterFirst = await readChildTaskChains(repoRoot);
    await writeChildTaskChains(repoRoot, {
      ...afterFirst,
      tasks: {
        ...afterFirst.tasks,
        'CHILD-1': {
          ...afterFirst.tasks['CHILD-1']!,
          state: 'completed',
          completedAt: '2026-05-19T00:00:00.000Z',
        },
      },
    });
    const state = await recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-2',
      rootTaskId: 'PARENT-1',
      parentTaskId: 'CHILD-1',
      previousTaskId: 'CHILD-1',
      branchChain: branchChain('CHILD-1', 'PARENT-1', 2),
      parentArchivePath: '/archive/CHILD-1.md',
      parentArchiveArtifactDir: null,
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
    });

    expect(state.chains['PARENT-1']?.taskIds).toEqual(['PARENT-1', 'CHILD-1', 'CHILD-2']);
    await expect(recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-3',
      rootTaskId: 'PARENT-1',
      parentTaskId: 'CHILD-1',
      previousTaskId: 'CHILD-1',
      branchChain: branchChain('CHILD-1', 'PARENT-1', 2),
      parentArchivePath: null,
      parentArchiveArtifactDir: null,
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
    })).rejects.toThrow('child-task-chain-parent-not-current-tip');
  });

  it('rejects missing non-root parents, duplicate children, and concurrent siblings', async () => {
    const repoRoot = await tempRepo();
    await expect(recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-1',
      rootTaskId: 'ROOT-1',
      parentTaskId: 'PARENT-1',
      previousTaskId: 'PARENT-1',
      branchChain: branchChain('PARENT-1', 'ROOT-1', 1),
      parentArchivePath: null,
      parentArchiveArtifactDir: null,
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
    })).rejects.toThrow('child-task-chain-parent-state-missing');

    await recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-1',
      rootTaskId: 'PARENT-1',
      parentTaskId: 'PARENT-1',
      previousTaskId: 'PARENT-1',
      branchChain: branchChain('PARENT-1'),
      parentArchivePath: null,
      parentArchiveArtifactDir: null,
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
    });
    const afterFirst = await readChildTaskChains(repoRoot);
    await writeChildTaskChains(repoRoot, {
      ...afterFirst,
      tasks: {
        ...afterFirst.tasks,
        'CHILD-1': {
          ...afterFirst.tasks['CHILD-1']!,
          state: 'completed',
          completedAt: '2026-05-19T00:00:00.000Z',
        },
      },
    });
    await expect(recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-1',
      rootTaskId: 'PARENT-1',
      parentTaskId: 'CHILD-1',
      previousTaskId: 'CHILD-1',
      branchChain: branchChain('CHILD-1', 'PARENT-1', 2),
      parentArchivePath: null,
      parentArchiveArtifactDir: null,
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
    })).rejects.toThrow('child-task-chain-task-exists');

    const attempts = await Promise.allSettled([
      recordPlannedChildTask(repoRoot, {
        taskId: 'CHILD-2',
        rootTaskId: 'PARENT-1',
        parentTaskId: 'CHILD-1',
        previousTaskId: 'CHILD-1',
        branchChain: branchChain('CHILD-1', 'PARENT-1', 2),
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
        parentContextSnapshot: snapshot(),
        childExecutionScope: snapshot(),
      }),
      recordPlannedChildTask(repoRoot, {
        taskId: 'CHILD-3',
        rootTaskId: 'PARENT-1',
        parentTaskId: 'CHILD-1',
        previousTaskId: 'CHILD-1',
        branchChain: branchChain('CHILD-1', 'PARENT-1', 2),
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
        parentContextSnapshot: snapshot(),
        childExecutionScope: snapshot(),
      }),
    ]);

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const persisted = await readChildTaskChains(repoRoot);
    expect(persisted.chains['PARENT-1']?.taskIds).toHaveLength(3);
  });

  it.each(['planned', 'pending', 'active', 'failed'] as const)('rejects a %s current-tip parent', async (parentState) => {
    const repoRoot = await tempRepo();
    await recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-1',
      rootTaskId: 'PARENT-1',
      parentTaskId: 'PARENT-1',
      previousTaskId: 'PARENT-1',
      branchChain: branchChain('PARENT-1'),
      parentArchivePath: null,
      parentArchiveArtifactDir: null,
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
    });
    const state = await readChildTaskChains(repoRoot);
    await writeChildTaskChains(repoRoot, {
      ...state,
      tasks: {
        ...state.tasks,
        'CHILD-1': {
          ...state.tasks['CHILD-1']!,
          state: parentState,
          completedAt: null,
        },
      },
    });

    await expect(recordPlannedChildTask(repoRoot, {
      taskId: 'CHILD-2',
      rootTaskId: 'PARENT-1',
      parentTaskId: 'CHILD-1',
      previousTaskId: 'CHILD-1',
      branchChain: branchChain('CHILD-1', 'PARENT-1', 2),
      parentArchivePath: null,
      parentArchiveArtifactDir: null,
      parentContextSnapshot: snapshot(),
      childExecutionScope: snapshot(),
    })).rejects.toThrow('child-task-chain-parent-tip-not-completed');
  });
});
