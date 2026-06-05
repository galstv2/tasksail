import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Toggle to force only the child-chains atomic write to fail mid-test (after
// setup) so the post-queue-delete write-failure path is exercised without
// coupling to the atomic writer's internal temp naming or the dir-lock.
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

import { deleteDropboxItem } from '../deleteDropboxItem.js';
import { deletePendingItem } from '../deletePendingItem.js';
import { deleteErrorItem } from '../deleteErrorItem.js';
import { readChildTaskChains, writeChildTaskChains, type ChildTaskChainsState, type ChildTaskChainTaskState } from '../childTaskChains.js';
import { loadTaskRegistry, saveTaskRegistry, type TaskRegistryEntry } from '../taskRegistry.js';

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

function chain(tipState: ChildTaskChainTaskState, long = false): ChildTaskChainsState {
  return {
    schemaVersion: 1,
    updatedAt: now,
    chains: {
      root: { rootTaskId: 'root', currentTipTaskId: 'child', contextPackId: 'pack', contextPackDir: '/pack', taskIds: long ? ['root', 'middle', 'child'] : ['root', 'child'], createdAt: now, updatedAt: now },
    },
    tasks: long
      ? { root: task('root', 'completed', 0), middle: task('middle', 'completed', 1, 'root'), child: task('child', tipState, 2, 'middle') }
      : { root: task('root', 'completed', 0), child: task('child', tipState, 1, 'root') },
  };
}

function registryEntry(state: TaskRegistryEntry['state'], fileName = 'child.md'): TaskRegistryEntry {
  return {
    taskId: 'child',
    fileName,
    title: 'Child',
    state,
    contextPackId: 'pack',
    contextPackDir: '/pack',
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    createdAt: now,
    completedAt: null,
    archivePath: null,
  };
}

describe('delete helpers child-chain cleanup', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'delete-child-chain-'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'dropbox'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'error-items'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('deleteDropboxItem removes a first-child reservation after unlink', async () => {
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'dropbox', 'child.md'), '# Child\n');
    await writeChildTaskChains(repoRoot, chain('planned'));

    await deleteDropboxItem({ repoRoot, queueName: 'child.md' });

    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'dropbox', 'child.md'))).toBe(false);
    expect((await readChildTaskChains(repoRoot)).chains).toEqual({});
  });

  it('deletePendingItem rolls back the chain after pending unlink and order cleanup', async () => {
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'child.md'), '# Child\n');
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'queue-order.json'), '["child.md"]\n');
    await writeChildTaskChains(repoRoot, chain('pending', true));

    await deletePendingItem({ repoRoot, queueName: 'child.md' });

    expect((await readChildTaskChains(repoRoot)).chains.root.currentTipTaskId).toBe('middle');
  });

  it('deleteErrorItem rolls back the chain after error unlink', async () => {
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'error-items', 'child.md'), '# Child\n');
    await writeChildTaskChains(repoRoot, chain('failed', true));

    await deleteErrorItem({ repoRoot, queueName: 'child.md' });

    expect((await readChildTaskChains(repoRoot)).chains.root.currentTipTaskId).toBe('middle');
  });

  it('cleanup preflight errors block queue unlink and registry removal', async () => {
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'child.md'), '# Child\n');
    await writeChildTaskChains(repoRoot, chain('completed', true));
    await saveTaskRegistry(repoRoot, { schema_version: 2, tasks: { pack: { open: [], pending: [registryEntry('pending')], active: [], failed: [], completed: [] } } });

    await expect(deletePendingItem({ repoRoot, queueName: 'child.md' })).rejects.toThrow('blocked-completed-task');

    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'child.md'))).toBe(true);
    await expect(loadTaskRegistry(repoRoot)).resolves.toEqual(expect.objectContaining({
      tasks: expect.objectContaining({ pack: expect.objectContaining({ pending: expect.arrayContaining([expect.objectContaining({ taskId: 'child' })]) }) }),
    }));
  });

  it('queue unlink failures write no child-chain state', async () => {
    const before = chain('planned');
    await writeChildTaskChains(repoRoot, before);

    await expect(deleteDropboxItem({ repoRoot, queueName: 'child.md' })).rejects.toThrow('does not exist in dropbox');

    expect(await readChildTaskChains(repoRoot)).toEqual(before);
  });

  it('child-chain write failures after queue delete keep the registry row', async () => {
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'child.md'), '# Child\n');
    const before = chain('pending', true);
    await writeChildTaskChains(repoRoot, before);
    await saveTaskRegistry(repoRoot, { schema_version: 2, tasks: { pack: { open: [], pending: [registryEntry('pending')], active: [], failed: [], completed: [] } } });
    failStateWrite.value = true;
    try {
      await expect(deletePendingItem({ repoRoot, queueName: 'child.md' })).rejects.toThrow();

      expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'child.md'))).toBe(false);
      expect(await readChildTaskChains(repoRoot)).toEqual(before);
      await expect(loadTaskRegistry(repoRoot)).resolves.toEqual(expect.objectContaining({
        tasks: expect.objectContaining({ pack: expect.objectContaining({ pending: expect.arrayContaining([expect.objectContaining({ taskId: 'child' })]) }) }),
      }));
    } finally {
      failStateWrite.value = false;
    }
  });

  it('standard task deletes remain unchanged and do not write child-chain state', async () => {
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'dropbox', 'standard.md'), '# Standard\n');

    await deleteDropboxItem({ repoRoot, queueName: 'standard.md' });

    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'dropbox', 'standard.md'))).toBe(false);
    expect((await readChildTaskChains(repoRoot)).chains).toEqual({});
  });
});
