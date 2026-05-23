import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { writeChildTaskChains, type ChildTaskChainsState, type ChildTaskContextSnapshot } from '../childTaskChains.js';
import {
  advanceCompletedChildTaskChain,
  attachCompletedBranchHandoffs,
  parseRecoveredChildTaskChainCloseout,
  prepareChildTaskChainCloseout,
  resolveArchiveArtifactDir,
  type BranchHandoffForChildChainCloseout,
} from '../childTaskChainCloseout.js';
import { formatBranchChainSection, type TaskBranchChainBinding } from '../markdown.js';

const now = '2026-05-19T12:00:00.000Z';
let repoRoot = '';
let gitRoot = '';

const snapshot: ChildTaskContextSnapshot = {
  contextPackDir: '/repo/contextpacks/demo',
  contextPackId: 'demo-pack',
  scopeMode: 'deep-focus',
  primaryRepoId: null,
  primaryFocusId: null,
  selectedRepoIds: ['repo'],
  selectedFocusIds: [],
  deepFocusEnabled: true,
  deepFocusPrimaryRepoId: 'repo',
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

describe('child task chain closeout helper', () => {
  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), 'child-chain-closeout-'));
    gitRoot = path.join(repoRoot, 'repo');
    await mkdir(gitRoot, { recursive: true });
    await writeChildTaskChains(repoRoot, stateFixture(branchChain(gitRoot)));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('returns null for standard tasks and legacy child tasks without Branch Chain', async () => {
    expect(await prepareChildTaskChainCloseout({
      repoRoot,
      taskId: 'standard',
      content: markdown({ taskKind: 'standard-task', branchChainSection: '' }),
    })).toBeNull();

    expect(await prepareChildTaskChainCloseout({
      repoRoot,
      taskId: 'child',
      content: markdown({ branchChainSection: '' }),
    })).toBeNull();
  });

  it('fails closed for invalid Branch Chain and lineage mismatches', async () => {
    await expect(prepareChildTaskChainCloseout({
      repoRoot,
      taskId: 'child',
      content: `${markdown({ branchChainSection: '' })}\n\n## Branch Chain\n\nnot-json`,
    })).rejects.toThrow('child-task-chain-closeout-branch-chain-invalid');

    await expect(prepareChildTaskChainCloseout({
      repoRoot,
      taskId: 'child',
      content: markdown({ depth: 2 }),
    })).rejects.toThrow('child-task-chain-closeout-lineage-mismatch');
  });

  it('requires the completing child to be the reserved current tip', async () => {
    const state = stateFixture(branchChain(gitRoot));
    state.chains.root.currentTipTaskId = 'root';
    await writeChildTaskChains(repoRoot, state);

    await expect(prepareChildTaskChainCloseout({
      repoRoot,
      taskId: 'child',
      content: markdown(),
    })).rejects.toThrow('child-task-chain-closeout-not-current-tip');
  });

  it('accepts Branch Chain child tasks that were generated before lineage depth was written', async () => {
    const prepared = await prepareChildTaskChainCloseout({
      repoRoot,
      taskId: 'child',
      content: markdown({ includeDepth: false }),
    });

    expect(prepared).toEqual(expect.objectContaining({ depth: 1 }));
  });

  it('requires state previousTaskId to match the immediate Branch Chain parent', async () => {
    const state = stateFixture(branchChain(gitRoot));
    state.tasks.child.previousTaskId = 'other-parent';
    await writeChildTaskChains(repoRoot, state);

    await expect(prepareChildTaskChainCloseout({
      repoRoot,
      taskId: 'child',
      content: markdown(),
    })).rejects.toThrow('child-task-chain-closeout-state-invalid');
  });

  it('validates completed handoffs by repo root and chainSourceBranch', async () => {
    const prepared = await prepareChildTaskChainCloseout({ repoRoot, taskId: 'child', content: markdown() });
    expect(prepared).not.toBeNull();

    const attached = attachCompletedBranchHandoffs(prepared!, [handoff({ repoRoot: gitRoot, branch: 'task/root' })]);

    expect(attached.completedBranchHandoffs).toEqual([
      expect.objectContaining({
        repoRoot: gitRoot,
        chainSourceBranch: 'task/root',
        targetBranch: 'main',
      }),
    ]);
  });

  it('rejects targetBranch as the source branch and extra handoffs', async () => {
    const prepared = await prepareChildTaskChainCloseout({ repoRoot, taskId: 'child', content: markdown() });

    expect(() => attachCompletedBranchHandoffs(prepared!, [handoff({ branch: 'main' })]))
      .toThrow('child-task-chain-closeout-branch-handoff-mismatch');
    expect(() => attachCompletedBranchHandoffs(prepared!, [
      handoff({ branch: 'task/root' }),
      handoff({ repoRoot: path.join(repoRoot, 'extra'), branch: 'task/extra' }),
    ])).toThrow('child-task-chain-closeout-branch-handoff-mismatch');
  });

  it('marks the reserved current tip completed and preserves currentTipTaskId', async () => {
    const prepared = attachCompletedBranchHandoffs(
      (await prepareChildTaskChainCloseout({ repoRoot, taskId: 'child', content: markdown() }))!,
      [handoff({ branch: 'task/root' })],
    );
    const completed = {
      ...prepared,
      archivePath: path.join(repoRoot, 'contextpacks/demo/archive/tasks/2026/child/archive.md'),
      archiveArtifactDir: resolveArchiveArtifactDir(path.join(repoRoot, 'contextpacks/demo/archive/tasks/2026/child/archive.md')),
    };

    const updated = await advanceCompletedChildTaskChain(repoRoot, completed, { now });

    expect(updated.chains.root.currentTipTaskId).toBe('child');
    expect(updated.tasks.child.state).toBe('completed');
    expect(updated.tasks.child.completedAt).toBe(now);
    expect(updated.tasks.child.archiveArtifactDir).toContain('/child');
    expect(updated.tasks.child.completedBranchHandoffs?.[0]?.headCommitSha).toBe('head');
  });

  it('is idempotent when completed state already matches', async () => {
    const prepared = attachCompletedBranchHandoffs(
      (await prepareChildTaskChainCloseout({ repoRoot, taskId: 'child', content: markdown() }))!,
      [handoff({ branch: 'task/root' })],
    );
    const completed = { ...prepared, archivePath: 'archive.md', archiveArtifactDir: null };

    await advanceCompletedChildTaskChain(repoRoot, completed, { now });
    const again = await advanceCompletedChildTaskChain(repoRoot, completed, { now: '2026-05-19T13:00:00.000Z' });

    expect(again.tasks.child.completedAt).toBe(now);
  });

  it('validates recovered sentinel payload shape and completed handoff identity', () => {
    const payload = recoveredPayload();

    expect(parseRecoveredChildTaskChainCloseout(payload)).toEqual(expect.objectContaining({
      source: 'recovered',
      taskId: 'child',
      completedBranchHandoffs: [expect.objectContaining({ chainSourceBranch: 'task/root' })],
    }));

    expect(() => parseRecoveredChildTaskChainCloseout({ ...payload, source: undefined }))
      .toThrow('child-task-chain-closeout-sentinel-invalid');
    expect(() => parseRecoveredChildTaskChainCloseout({ ...payload, rootTaskId: 'other-root' }))
      .toThrow('child-task-chain-closeout-sentinel-invalid');
    expect(() => parseRecoveredChildTaskChainCloseout({ ...payload, completedBranchHandoffs: [
      { ...payload.completedBranchHandoffs[0], chainSourceBranch: 'main' },
    ] })).toThrow('child-task-chain-closeout-sentinel-invalid');
  });
});

function branchChain(repoRootForChain = gitRoot): TaskBranchChainBinding {
  return {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId: 'root',
    parentTaskId: 'root',
    depth: 1,
    repos: [{
      repoRoot: repoRootForChain,
      repoLabel: 'repo',
      chainSourceBranch: 'task/root',
      parentSourceBranch: 'task/root',
      parentBranchHead: 'base',
      targetBranch: 'main',
    }],
  };
}

function stateFixture(binding: TaskBranchChainBinding): ChildTaskChainsState {
  return {
    schemaVersion: 1,
    updatedAt: now,
    chains: {
      root: {
        rootTaskId: 'root',
        currentTipTaskId: 'child',
        contextPackId: 'demo-pack',
        contextPackDir: '/repo/contextpacks/demo',
        taskIds: ['root', 'child'],
        createdAt: now,
        updatedAt: now,
      },
    },
    tasks: {
      root: taskRecord('root', null, null, 0, 'completed', null),
      child: taskRecord('child', 'root', 'root', 1, 'active', binding),
    },
  };
}

function taskRecord(
  taskId: string,
  parentTaskId: string | null,
  previousTaskId: string | null,
  depth: number,
  state: ChildTaskChainsState['tasks'][string]['state'],
  binding: TaskBranchChainBinding | null,
): ChildTaskChainsState['tasks'][string] {
  return {
    taskId,
    rootTaskId: 'root',
    parentTaskId,
    previousTaskId,
    depth,
    state,
    archivePath: state === 'completed' ? 'archive.md' : null,
    archiveArtifactDir: null,
    parentArchivePath: null,
    parentArchiveArtifactDir: null,
    parentContextSnapshot: snapshot,
    childExecutionScope: snapshot,
    branchChain: binding,
    completedBranchHandoffs: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function markdown(options: {
  taskKind?: string;
  depth?: number;
  includeDepth?: boolean;
  branchChainSection?: string;
} = {}): string {
  return [
    '# child',
    '',
    '## Task Lineage',
    '',
    `- Task Kind: ${options.taskKind ?? 'child-task'}`,
    '- Parent Task ID: root',
    '- Root Task ID: root',
    options.includeDepth === false ? null : `- Depth: ${options.depth ?? 1}`,
    '',
    options.branchChainSection ?? formatBranchChainSection(branchChain()),
  ].filter((line) => line !== null).join('\n');
}

function handoff(options: { repoRoot?: string; branch?: string } = {}): BranchHandoffForChildChainCloseout {
  return {
    repo_root: options.repoRoot ?? gitRoot,
    repo_label: 'repo',
    branch: options.branch ?? 'task/root',
    base_commit_sha: 'base',
    head_commit_sha: 'head',
    commits_ahead: 1,
    status: 'ready-for-operator-review',
    auto_merge: {
      target_branch: 'main',
    },
  };
}

function recoveredPayload() {
  return {
    schemaVersion: 1 as const,
    source: 'fresh' as const,
    taskId: 'child',
    rootTaskId: 'root',
    parentTaskId: 'root',
    previousTaskId: 'root',
    depth: 1,
    branchChain: branchChain(),
    archivePath: path.join(repoRoot, 'contextpacks/demo/archive/tasks/2026/child/archive.md'),
    archiveArtifactDir: path.join(repoRoot, 'contextpacks/demo/archive/tasks/2026/child'),
    completedBranchHandoffs: [{
      repoRoot: gitRoot,
      repoLabel: 'repo',
      chainSourceBranch: 'task/root',
      baseCommitSha: 'base',
      headCommitSha: 'head',
      commitsAhead: 1,
      status: 'ready-for-operator-review' as const,
      targetBranch: 'main',
    }],
    preparedAt: now,
  };
}
