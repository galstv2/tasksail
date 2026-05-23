import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  advanceChildTaskChainTip,
  emptyChildTaskChainsState,
  findChainForTask,
  isCurrentChainTip,
  readChildTaskChains,
  resolveChildTaskChainsPath,
  writeChildTaskChains,
  type ChildTaskChainsState,
  type ChildTaskContextSnapshot,
} from '../childTaskChains.js';

const now = '2026-05-19T12:00:00.000Z';

const snapshot: ChildTaskContextSnapshot = {
  contextPackDir: '/repo/contextpacks/demo',
  contextPackId: 'demo-pack',
  scopeMode: 'deep-focus',
  primaryRepoId: null,
  primaryFocusId: null,
  selectedRepoIds: ['tools'],
  selectedFocusIds: [],
  deepFocusEnabled: true,
  deepFocusPrimaryRepoId: 'tools',
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [{ path: 'src', kind: 'directory' }],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

function cloneSnapshot(): ChildTaskContextSnapshot {
  return {
    ...snapshot,
    selectedRepoIds: [...snapshot.selectedRepoIds],
    selectedFocusIds: [...snapshot.selectedFocusIds],
    selectedFocusTargets: snapshot.selectedFocusTargets.map((target) => ({ ...(target as Record<string, unknown>) })),
    selectedTestTarget: snapshot.selectedTestTarget,
    selectedSupportTargets: snapshot.selectedSupportTargets.map((target) => ({ ...(target as Record<string, unknown>) })),
    ...(snapshot.repositoryTypes ? { repositoryTypes: { ...snapshot.repositoryTypes } } : {}),
  };
}

function stateFixture(): ChildTaskChainsState {
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
      root: {
        taskId: 'root',
        rootTaskId: 'root',
        parentTaskId: null,
        previousTaskId: null,
        depth: 0,
        state: 'completed',
        archivePath: 'AgentWorkSpace/archive/root.md',
        archiveArtifactDir: 'AgentWorkSpace/archive/root',
        parentArchivePath: null,
        parentArchiveArtifactDir: null,
        parentContextSnapshot: cloneSnapshot(),
        childExecutionScope: cloneSnapshot(),
        branchChain: null,
        completedBranchHandoffs: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      child: {
        taskId: 'child',
        rootTaskId: 'root',
        parentTaskId: 'root',
        previousTaskId: 'root',
        depth: 1,
        state: 'pending',
        archivePath: null,
        archiveArtifactDir: null,
        parentArchivePath: 'AgentWorkSpace/archive/root.md',
        parentArchiveArtifactDir: 'AgentWorkSpace/archive/root',
        parentContextSnapshot: cloneSnapshot(),
        childExecutionScope: cloneSnapshot(),
        branchChain: {
          schemaVersion: 1,
          mode: 'continuation',
          rootTaskId: 'root',
          parentTaskId: 'root',
          depth: 1,
          repos: [
            {
              repoRoot: '/repo/tools',
              repoLabel: 'tools',
              chainSourceBranch: 'task/root',
              parentSourceBranch: 'task/root',
              parentBranchHead: '0123456789abcdef0123456789abcdef01234567',
              targetBranch: null,
            },
          ],
        },
        completedBranchHandoffs: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
}

describe('child task chain state helper', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'child-task-chains-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty schemaVersion 1 state when the file is missing', async () => {
    const state = await readChildTaskChains(tmpDir);

    expect(state.schemaVersion).toBe(1);
    expect(state.chains).toEqual({});
    expect(state.tasks).toEqual({});
  });

  it('writes and reads a complete chain state', async () => {
    const state = stateFixture();

    await writeChildTaskChains(tmpDir, state);

    expect(await readChildTaskChains(tmpDir)).toEqual(state);
    expect(findChainForTask(state, 'child')?.rootTaskId).toBe('root');
  });

  it('preserves valid repositoryTypes in context snapshots', async () => {
    const state = stateFixture();
    state.tasks.child.childExecutionScope = {
      ...snapshot,
      deepFocusEnabled: false,
      repositoryTypes: { tools: 'primary', platform: 'support' },
    };

    await writeChildTaskChains(tmpDir, state);

    expect((await readChildTaskChains(tmpDir)).tasks.child.childExecutionScope?.repositoryTypes)
      .toEqual({ tools: 'primary', platform: 'support' });
  });

  it('fails closed for malformed present repositoryTypes in context snapshots', async () => {
    const state = stateFixture() as unknown as Record<string, unknown>;
    (((state.tasks as Record<string, unknown>).child as Record<string, unknown>).childExecutionScope as Record<string, unknown>)
      .repositoryTypes = { tools: 'writer' };

    await expect(writeChildTaskChains(tmpDir, state as unknown as ChildTaskChainsState))
      .rejects.toThrow('child-task-chains-invalid-schema');
  });

  it('normalizes legacy snapshots without selected focus path fields', async () => {
    const state = stateFixture();
    delete (state.tasks.root.parentContextSnapshot as Partial<ChildTaskContextSnapshot>).selectedFocusPath;
    delete (state.tasks.root.parentContextSnapshot as Partial<ChildTaskContextSnapshot>).selectedFocusTargetKind;
    await mkdir(path.dirname(resolveChildTaskChainsPath(tmpDir)), { recursive: true });
    await writeFile(resolveChildTaskChainsPath(tmpDir), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');

    const read = await readChildTaskChains(tmpDir);
    expect(read.tasks.root.parentContextSnapshot?.selectedFocusPath).toBeNull();
    expect(read.tasks.root.parentContextSnapshot?.selectedFocusTargetKind).toBeNull();
  });

  it('normalizes legacy task records without completed closeout fields', async () => {
    const state = stateFixture();
    delete (state.tasks.child as Partial<typeof state.tasks.child>).completedBranchHandoffs;
    delete (state.tasks.child as Partial<typeof state.tasks.child>).completedAt;
    await mkdir(path.dirname(resolveChildTaskChainsPath(tmpDir)), { recursive: true });
    await writeFile(resolveChildTaskChainsPath(tmpDir), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');

    const read = await readChildTaskChains(tmpDir);
    expect(read.tasks.child.completedBranchHandoffs).toBeNull();
    expect(read.tasks.child.completedAt).toBeNull();
  });

  it('throws contextual Invalid JSON for malformed state JSON', async () => {
    const statePath = resolveChildTaskChainsPath(tmpDir);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{bad', 'utf-8');

    await expect(readChildTaskChains(tmpDir)).rejects.toThrow(
      `Invalid JSON in ${statePath}`,
    );
  });

  it('throws child-task-chains-stale-schema for unsupported schemaVersion', async () => {
    const statePath = resolveChildTaskChainsPath(tmpDir);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ ...emptyChildTaskChainsState(now), schemaVersion: 2 }), 'utf-8');

    await expect(readChildTaskChains(tmpDir)).rejects.toThrow('child-task-chains-stale-schema');
  });

  it('throws child-task-chains-invalid-schema for invalid shape', async () => {
    await expect(writeChildTaskChains(tmpDir, {
      ...emptyChildTaskChainsState(now),
      chains: [] as unknown as ChildTaskChainsState['chains'],
    })).rejects.toThrow('child-task-chains-invalid-schema');
  });

  it('rejects index inconsistencies', async () => {
    const missingTip = stateFixture();
    missingTip.chains.root.currentTipTaskId = 'missing';
    await expect(writeChildTaskChains(tmpDir, missingTip)).rejects.toThrow('child-task-chains-invalid-schema');

    const missingChain = stateFixture();
    missingChain.tasks.child.rootTaskId = 'missing';
    await expect(writeChildTaskChains(tmpDir, missingChain)).rejects.toThrow('child-task-chains-invalid-schema');

    const unlistedTask = stateFixture();
    unlistedTask.chains.root.taskIds = ['root'];
    await expect(writeChildTaskChains(tmpDir, unlistedTask)).rejects.toThrow('child-task-chains-invalid-schema');

    const depthMismatch = stateFixture();
    depthMismatch.tasks.child.branchChain!.depth = 2;
    await expect(writeChildTaskChains(tmpDir, depthMismatch)).rejects.toThrow('child-task-chains-invalid-schema');
  });

  it('rejects malformed completed branch handoffs', async () => {
    const state = stateFixture();
    state.tasks.child.completedBranchHandoffs = [];
    await expect(writeChildTaskChains(tmpDir, state)).rejects.toThrow('child-task-chains-invalid-schema');

    state.tasks.child.completedBranchHandoffs = [{
      repoRoot: '/repo/tools',
      repoLabel: 'tools',
      chainSourceBranch: 'task/root',
      baseCommitSha: 'base',
      headCommitSha: 'head',
      commitsAhead: -1,
      status: 'ready-for-operator-review',
      targetBranch: null,
    }];
    await expect(writeChildTaskChains(tmpDir, state)).rejects.toThrow('child-task-chains-invalid-schema');
  });

  it('rejects non-JSON selectedTestTarget values', async () => {
    const state = stateFixture();
    state.tasks.child.childExecutionScope = {
      ...snapshot,
      selectedTestTarget: () => undefined,
    };

    await expect(writeChildTaskChains(tmpDir, state)).rejects.toThrow('child-task-chains-invalid-schema');
  });

  it('rejects runtime object instances in selectedTestTarget', async () => {
    const state = stateFixture();
    state.tasks.child.childExecutionScope = {
      ...snapshot,
      selectedTestTarget: new Date(now),
    };

    await expect(writeChildTaskChains(tmpDir, state)).rejects.toThrow('child-task-chains-invalid-schema');
  });

  it('ignores unknown JSON keys and does not write them back', async () => {
    const state = stateFixture() as ChildTaskChainsState & {
      extra?: string;
      chains: ChildTaskChainsState['chains'] & { root: ChildTaskChainsState['chains']['root'] & { extra?: string } };
    };
    state.extra = 'ignored';
    state.chains.root.extra = 'ignored';
    state.tasks.child.completedBranchHandoffs = [{
      repoRoot: '/repo/tools',
      repoLabel: 'tools',
      chainSourceBranch: 'task/root',
      baseCommitSha: 'base',
      headCommitSha: 'head',
      commitsAhead: 1,
      status: 'ready-for-operator-review',
      targetBranch: null,
      extra: 'ignored',
    } as typeof state.tasks.child.completedBranchHandoffs extends Array<infer T> ? T & { extra: string } : never];

    await writeChildTaskChains(tmpDir, state);

    const raw = await readFile(resolveChildTaskChainsPath(tmpDir), 'utf-8');
    expect(raw).not.toContain('extra');
  });

  it('identifies current chain tips', () => {
    const state = stateFixture();

    expect(isCurrentChainTip(state, 'child')).toBe(true);
    expect(isCurrentChainTip(state, 'root')).toBe(false);
  });

  it('advances and persists only the requested chain tip', async () => {
    const state = stateFixture();
    state.chains.root.currentTipTaskId = 'root';
    await writeChildTaskChains(tmpDir, state);

    const updated = await advanceChildTaskChainTip(tmpDir, 'root', 'child');

    expect(updated.chains.root.currentTipTaskId).toBe('child');
    expect((await readChildTaskChains(tmpDir)).chains.root.currentTipTaskId).toBe('child');
  });

  it('uses explicit repoRoot rather than cwd', async () => {
    const nested = path.join(tmpDir, 'nested');
    await mkdir(nested);
    const originalCwd = process.cwd();
    process.chdir(nested);
    try {
      await writeChildTaskChains(tmpDir, emptyChildTaskChainsState(now));
      expect(existsSync(resolveChildTaskChainsPath(tmpDir))).toBe(true);
      expect(existsSync(path.join(nested, '.platform-state', 'child-task-chains.json'))).toBe(false);
      expect((await readChildTaskChains(tmpDir)).updatedAt).toBe(now);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
