import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { FIXED_TMP_SUFFIX } = vi.hoisted(() => ({ FIXED_TMP_SUFFIX: '0011223344556677' }));

// Pin writeTextFileAtomic's random temp suffix so the "propagates write
// failures" test can occupy that temp path with a directory and force the write
// (and its retries) to fail. Other tests are unaffected — their writes still
// create-and-rename the temp normally.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: () => Buffer.from(FIXED_TMP_SUFFIX, 'hex') };
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
    const tempStatePath = `${statePath}.tmp-${process.pid}-${FIXED_TMP_SUFFIX}`;
    await mkdir(tempStatePath, { recursive: true });
    let deleted = false;

    await expect(cleanupDeletedChildTaskChainTask(repoRoot, 'child', async () => { deleted = true; })).rejects.toThrow();

    expect(deleted).toBe(true);
    expect((await readFile(statePath, 'utf-8')).includes('"child"')).toBe(true);
    expect(await readChildTaskChains(repoRoot)).toEqual(before);
    await rm(tempStatePath, { recursive: true, force: true });
    expect((await readFile(statePath, 'utf-8')).includes('child')).toBe(true);
  });
});
