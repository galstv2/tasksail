import { describe, expect, it, vi, beforeEach } from 'vitest';

import type {
  DesktopInvokeResult,
  TaskBoardChildChainBranchInventory,
  TaskBoardReadChildChainBranchInventoryResponse,
} from '../../src/shared/desktopContract';

const { readChildTaskChainsMock } = vi.hoisted(() => ({ readChildTaskChainsMock: vi.fn() }));

vi.mock('../../../../backend/platform/queue/childTaskChains.js', () => ({
  readChildTaskChains: readChildTaskChainsMock,
}));

import { readChildTaskChainBranchInventoryAction } from './childTaskChainBranchInventory';

type AnyRecord = Record<string, unknown>;

function res(result: DesktopInvokeResult): TaskBoardReadChildChainBranchInventoryResponse {
  if (!result.ok) throw new Error('expected an ok invoke result');
  return result.response as TaskBoardReadChildChainBranchInventoryResponse;
}

function inventoryOf(result: DesktopInvokeResult): TaskBoardChildChainBranchInventory {
  const response = res(result);
  if (!response.inventory) throw new Error('expected a loaded inventory');
  return response.inventory;
}

function repo(over: AnyRecord = {}): AnyRecord {
  return {
    repoRoot: '/repos/app',
    repoLabel: 'app',
    chainSourceBranch: 'feature/app',
    parentSourceBranch: 'main',
    parentBranchHead: 'abc',
    targetBranch: null,
    ...over,
  };
}

function handoff(over: AnyRecord = {}): AnyRecord {
  return {
    repoRoot: '/repos/legacy',
    repoLabel: 'legacy',
    chainSourceBranch: 'feature/legacy',
    baseCommitSha: 'aaa',
    headCommitSha: 'bbb',
    commitsAhead: 1,
    status: 'ready-for-operator-review',
    targetBranch: 'main',
    ...over,
  };
}

function task(over: AnyRecord = {}): AnyRecord {
  return {
    taskId: 'task-1',
    rootTaskId: 'root-1',
    depth: 0,
    branchChain: null,
    completedBranchHandoffs: null,
    ...over,
  };
}

function state(tasks: AnyRecord, chains: AnyRecord): AnyRecord {
  return { schemaVersion: 1, updatedAt: '2026-05-30T00:00:00.000Z', tasks, chains };
}

beforeEach(() => {
  readChildTaskChainsMock.mockReset();
});

describe('readChildTaskChainBranchInventoryAction', () => {
  it('returns not-chain-task for a standalone task with no expected root', async () => {
    readChildTaskChainsMock.mockResolvedValue(state({}, {}));
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-x' });
    expect(result.ok).toBe(true);
    expect(res(result).mode).toBe('not-chain-task');
    expect(res(result).inventory).toBeUndefined();
  });

  it('returns invalid-state when an expected root is given but the task is missing', async () => {
    readChildTaskChainsMock.mockResolvedValue(state({}, {}));
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-x', expectedRootTaskId: 'root-1' });
    expect(res(result).mode).toBe('invalid-state');
  });

  it('returns invalid-state when the task root does not match the expected root', async () => {
    readChildTaskChainsMock.mockResolvedValue(
      state(
        { 'task-1': task({ rootTaskId: 'root-1' }) },
        { 'root-1': { rootTaskId: 'root-1', currentTipTaskId: 'task-1', taskIds: ['task-1'] } },
      ),
    );
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-1', expectedRootTaskId: 'other-root' });
    expect(res(result).mode).toBe('invalid-state');
  });

  it('returns invalid-state when readChildTaskChains throws', async () => {
    readChildTaskChainsMock.mockRejectedValue(new Error('corrupt state'));
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-1', expectedRootTaskId: 'root-1' });
    expect(res(result).mode).toBe('invalid-state');
    expect(res(result).message).not.toContain('corrupt state');
  });

  it('returns invalid-state when the task exists but its chain record is absent', async () => {
    readChildTaskChainsMock.mockResolvedValue(state({ 'task-1': task({ rootTaskId: 'root-1' }) }, {}));
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-1' });
    expect(res(result).mode).toBe('invalid-state');
  });

  it('returns invalid-state for an empty taskId without reading chain state', async () => {
    const result = await readChildTaskChainBranchInventoryAction({ taskId: '' });
    expect(res(result).mode).toBe('invalid-state');
    expect(readChildTaskChainsMock).not.toHaveBeenCalled();
  });

  it('loads a simple one-repo chain', async () => {
    readChildTaskChainsMock.mockResolvedValue(
      state(
        { 'task-1': task({ branchChain: { repos: [repo({ targetBranch: 'main' })] } }) },
        { 'root-1': { rootTaskId: 'root-1', currentTipTaskId: 'task-1', taskIds: ['task-1'] } },
      ),
    );
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-1', expectedRootTaskId: 'root-1' });
    expect(res(result).mode).toBe('loaded');
    const inv = inventoryOf(result);
    expect(inv.rootTaskId).toBe('root-1');
    expect(inv.currentTipTaskId).toBe('task-1');
    expect(inv.taskCount).toBe(1);
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0]).toMatchObject({
      repoRoot: '/repos/app',
      repoLabel: 'app',
      chainSourceBranch: 'feature/app',
      sourceKind: 'parent-handoff',
      introducedAtTaskId: 'task-1',
      introducedAtDepth: 0,
      targetBranch: 'main',
    });
  });

  it('aggregates a multi-repo chain and sorts deterministically', async () => {
    readChildTaskChainsMock.mockResolvedValue(
      state(
        {
          'task-1': task({
            branchChain: {
              repos: [
                repo({ repoRoot: '/repos/zeta', repoLabel: 'zeta', chainSourceBranch: 'feature/z' }),
                repo({ repoRoot: '/repos/Alpha', repoLabel: 'Alpha', chainSourceBranch: 'feature/a' }),
              ],
            },
          }),
        },
        { 'root-1': { rootTaskId: 'root-1', currentTipTaskId: 'task-1', taskIds: ['task-1'] } },
      ),
    );
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-1', expectedRootTaskId: 'root-1' });
    const labels = inventoryOf(result).rows.map((r) => r.repoLabel);
    expect(labels).toEqual(['Alpha', 'zeta']);
  });

  it('keeps historical repos recorded by earlier tasks even when the current tip omits them', async () => {
    readChildTaskChainsMock.mockResolvedValue(
      state(
        {
          'task-1': task({
            taskId: 'task-1',
            depth: 0,
            branchChain: { repos: [repo({ repoRoot: '/repos/historical', repoLabel: 'historical', chainSourceBranch: 'feature/old' })] },
          }),
          'task-2': task({
            taskId: 'task-2',
            depth: 1,
            branchChain: { repos: [repo({ repoRoot: '/repos/current', repoLabel: 'current', chainSourceBranch: 'feature/new' })] },
          }),
        },
        { 'root-1': { rootTaskId: 'root-1', currentTipTaskId: 'task-2', taskIds: ['task-1', 'task-2'] } },
      ),
    );
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-2', expectedRootTaskId: 'root-1' });
    const rows = inventoryOf(result).rows;
    const roots = rows.map((r) => r.repoRoot);
    expect(roots).toContain('/repos/historical');
    expect(roots).toContain('/repos/current');
    const historicalRow = rows.find((r) => r.repoRoot === '/repos/historical');
    expect(historicalRow?.introducedAtTaskId).toBe('task-1');
    expect(historicalRow?.introducedAtDepth).toBe(0);
  });

  it('falls back to completed branch handoffs with legacy-root source kind', async () => {
    readChildTaskChainsMock.mockResolvedValue(
      state(
        { 'task-1': task({ branchChain: null, completedBranchHandoffs: [handoff()] }) },
        { 'root-1': { rootTaskId: 'root-1', currentTipTaskId: 'task-1', taskIds: ['task-1'] } },
      ),
    );
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-1', expectedRootTaskId: 'root-1' });
    const rows = inventoryOf(result).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      repoRoot: '/repos/legacy',
      chainSourceBranch: 'feature/legacy',
      sourceKind: 'legacy-root',
      targetBranch: 'main',
    });
  });

  it('reports recorded branches verbatim without consulting live git', async () => {
    readChildTaskChainsMock.mockResolvedValue(
      state(
        { 'task-1': task({ branchChain: { repos: [repo({ chainSourceBranch: 'feature/branch-that-was-deleted' })] } }) },
        { 'root-1': { rootTaskId: 'root-1', currentTipTaskId: 'task-1', taskIds: ['task-1'] } },
      ),
    );
    const result = await readChildTaskChainBranchInventoryAction({ taskId: 'task-1', expectedRootTaskId: 'root-1' });
    // A branch that may no longer exist on disk is still reported as recorded — no git check happens.
    expect(inventoryOf(result).rows[0].chainSourceBranch).toBe('feature/branch-that-was-deleted');
  });
});
