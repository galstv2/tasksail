import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Toggle to force the atomic state write to fail mid-test (after setup) so the
// post-queue-delete write-failure path is exercised without coupling to the
// atomic writer's internal temp naming or the dir-lock.
const { failStateWrite } = vi.hoisted(() => ({ failStateWrite: { value: false } }));
vi.mock('../../core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/index.js')>();
  return {
    ...actual,
    writeTextFileAtomic: async (...args: Parameters<typeof actual.writeTextFileAtomic>) => {
      if (failStateWrite.value && args[0].endsWith('child-task-chains.json')) {
        throw new Error('simulated write failure');
      }
      return actual.writeTextFileAtomic(...args);
    },
  };
});

import { cleanupDeletedChildTaskChainTask } from '../childTaskChainDeletion.js';
import { readChildTaskChains, writeChildTaskChains, type ChildTaskChainsState, type ChildTaskChainTaskState } from '../childTaskChains.js';

const now = '2026-05-22T12:00:00.000Z';

function task(taskId: string, state: ChildTaskChainTaskState, depth: number, parentTaskId: string | null = depth === 0 ? null : 'root') {
  return {
    taskId,
    rootTaskId: 'root',
    parentTaskId,
    previousTaskId: parentTaskId,
    depth,
    state,
    archivePath: state === 'completed' ? `/archive/${taskId}.md` : null,
    archiveArtifactDir: null,
    parentArchivePath: parentTaskId ? '/archive/root.md' : null,
    parentArchiveArtifactDir: null,
    parentContextSnapshot: null,
    childExecutionScope: null,
    branchChain: null,
    completedBranchHandoffs: null,
    completedAt: state === 'completed' ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

function state(tipState: ChildTaskChainTaskState = 'planned', extra = false): ChildTaskChainsState {
  return {
    schemaVersion: 1,
    updatedAt: now,
    chains: {
      root: {
        rootTaskId: 'root',
        currentTipTaskId: 'child',
        contextPackId: 'pack',
        contextPackDir: '/pack',
        taskIds: extra ? ['root', 'middle', 'child'] : ['root', 'child'],
        createdAt: now,
        updatedAt: now,
      },
    },
    tasks: extra
      ? { root: task('root', 'completed', 0), middle: task('middle', 'completed', 1, 'root'), child: task('child', tipState, 2, 'middle') }
      : { root: task('root', 'completed', 0), child: task('child', tipState, 1, 'root') },
  };
}

describe('cleanupDeletedChildTaskChainTask', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), 'child-chain-delete-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('does not write child-chain state for standard task ids', async () => {
    let deleted = false;
    await cleanupDeletedChildTaskChainTask(repoRoot, 'standard', async () => { deleted = true; }, { now });

    expect(deleted).toBe(true);
    expect(await readChildTaskChains(repoRoot)).toEqual(expect.objectContaining({ chains: {}, tasks: {} }));
  });

  it('deleting the first planned child removes the synthetic root-only chain', async () => {
    await writeChildTaskChains(repoRoot, state('planned'));

    const result = await cleanupDeletedChildTaskChainTask(repoRoot, 'child', async () => undefined, { now });
    const next = await readChildTaskChains(repoRoot);

    expect(result.mode).toBe('removed-chain');
    expect(next.chains).toEqual({});
    expect(next.tasks).toEqual({});
  });

  it.each(['planned', 'pending', 'active', 'failed'] as const)('rolls a %s current tip back to the completed parent', async (tipState) => {
    await writeChildTaskChains(repoRoot, state(tipState, true));

    const result = await cleanupDeletedChildTaskChainTask(repoRoot, 'child', async () => undefined, { now });
    const next = await readChildTaskChains(repoRoot);

    expect(result).toEqual(expect.objectContaining({ mode: 'rolled-back-to-parent', parentTaskId: 'middle' }));
    expect(next.chains.root.currentTipTaskId).toBe('middle');
    expect(next.tasks.child).toBeUndefined();
    expect(next.tasks.root).toEqual(state(tipState, true).tasks.root);
  });

  it('blocks completed and non-tip task deletion before queue delete', async () => {
    await writeChildTaskChains(repoRoot, state('completed'));
    let called = false;

    await expect(cleanupDeletedChildTaskChainTask(repoRoot, 'child', async () => { called = true; })).rejects.toThrow(
      'child-task-chain-delete-cleanup-blocked-completed-task',
    );
    const nonTipState = state('planned', true);
    nonTipState.tasks.middle.state = 'planned';
    await writeChildTaskChains(repoRoot, nonTipState);
    await expect(cleanupDeletedChildTaskChainTask(repoRoot, 'middle', async () => { called = true; })).rejects.toThrow(
      'child-task-chain-delete-cleanup-blocked-non-tip-task',
    );
    expect(called).toBe(false);
  });

  it('blocks invalid parent state and leaves queue delete uncalled', async () => {
    const invalid = state('planned', true);
    invalid.tasks.middle.state = 'failed';
    await writeChildTaskChains(repoRoot, invalid);
    let called = false;

    await expect(cleanupDeletedChildTaskChainTask(repoRoot, 'child', async () => { called = true; })).rejects.toThrow(
      'child-task-chain-delete-cleanup-invalid-parent-state',
    );
    expect(called).toBe(false);
  });

  it('does not write child-chain state when queue deletion fails', async () => {
    const before = state('pending', true);
    await writeChildTaskChains(repoRoot, before);

    await expect(cleanupDeletedChildTaskChainTask(repoRoot, 'child', async () => { throw new Error('unlink failed'); })).rejects.toThrow('unlink failed');

    expect(await readChildTaskChains(repoRoot)).toEqual(before);
  });

  it('does not write child-chain state when queue order cleanup fails', async () => {
    const before = state('pending', true);
    await writeChildTaskChains(repoRoot, before);
    let deleted = false;

    await expect(cleanupDeletedChildTaskChainTask(repoRoot, 'child', async () => {
      deleted = true;
      throw new Error('queue order cleanup failed');
    })).rejects.toThrow('queue order cleanup failed');

    expect(deleted).toBe(true);
    expect(await readChildTaskChains(repoRoot)).toEqual(before);
  });

  it('propagates write failures after queue delete succeeds', async () => {
    const before = state('pending', true);
    await writeChildTaskChains(repoRoot, before);
    const statePath = path.join(repoRoot, '.platform-state', 'child-task-chains.json');
    failStateWrite.value = true;
    let deleted = false;
    try {
      await expect(cleanupDeletedChildTaskChainTask(repoRoot, 'child', async () => { deleted = true; })).rejects.toThrow();

      expect(deleted).toBe(true);
      expect((await readFile(statePath, 'utf-8')).includes('"child"')).toBe(true);
      expect(await readChildTaskChains(repoRoot)).toEqual(before);
    } finally {
      failStateWrite.value = false;
    }
    expect((await readFile(statePath, 'utf-8')).includes('child')).toBe(true);
  });
});
