import { beforeEach, describe, expect, it, vi } from 'vitest';

const listArchivedTasksAction = vi.fn();
const readChildTaskChains = vi.fn();

vi.mock('./main.archivedTasks', () => ({ listArchivedTasksAction }));
vi.mock('../../../backend/platform/queue/childTaskChains.js', () => ({ readChildTaskChains }));

const { resolveChildTaskChainCreationContext } = await import('./main.childTaskChain');

const binding = {
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  scopeMode: 'repo-selection',
  primaryRepoId: 'orders-api',
  selectedRepoIds: ['orders-api'],
  selectedFocusIds: [],
  deepFocusEnabled: false,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

const parent = {
  taskId: 'PARENT-1',
  archivePath: '/archive/PARENT-1.md',
  archiveArtifactDir: '/archive/PARENT-1',
  branchChainAvailability: { status: 'ready', message: 'ready' },
  branchHandoffs: [{
    repoRoot: '/repo/orders-api',
    repoLabel: 'Orders API',
    branch: 'task/PARENT-1',
    baseCommitSha: 'base',
    headCommitSha: 'head',
    commitsAhead: 1,
    status: 'committed',
    autoMerge: { enabled: true, status: 'ready', targetBranch: 'main', detail: 'ok' },
  }],
  plannerFocusSnapshot: { contextPackBinding: binding },
};

describe('resolveChildTaskChainCreationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [parent] },
    });
    readChildTaskChains.mockResolvedValue({ chains: {}, tasks: {} });
  });

  it('derives first-child Branch Chain from archived parent handoffs', async () => {
    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'PARENT-1',
      childExecutionScope: binding,
    });

    expect(listArchivedTasksAction).toHaveBeenCalledWith(expect.any(Function), {
      scope: { contextPackDir: '/packs/orders', contextPackId: 'orders', contextPackName: 'orders' },
    });
    expect(result.branchChain.repos[0]).toEqual(expect.objectContaining({
      chainSourceBranch: 'task/PARENT-1',
      parentSourceBranch: 'task/PARENT-1',
      targetBranch: 'main',
    }));
  });

  it('preserves descendant chainSourceBranch and targetBranch from parent state', async () => {
    readChildTaskChains.mockResolvedValue({
      chains: { ROOT: { currentTipTaskId: 'PARENT-1', taskIds: ['ROOT', 'PARENT-1'] } },
      tasks: {
        'PARENT-1': {
          rootTaskId: 'ROOT',
          depth: 1,
          state: 'completed',
          branchChain: {
            repos: [{
              repoRoot: '/repo/orders-api',
              chainSourceBranch: 'task/ROOT',
              targetBranch: 'release',
            }],
          },
        },
      },
    });

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: binding,
    });

    expect(result.branchChain.rootTaskId).toBe('ROOT');
    expect(result.branchChain.depth).toBe(2);
    expect(result.branchChain.repos[0]?.chainSourceBranch).toBe('task/ROOT');
    expect(result.branchChain.repos[0]?.targetBranch).toBe('release');
  });

  it('rejects non-tip parents before child creation', async () => {
    readChildTaskChains.mockResolvedValue({
      chains: { ROOT: { currentTipTaskId: 'OTHER', taskIds: ['ROOT', 'PARENT-1', 'OTHER'] } },
      tasks: { 'PARENT-1': { rootTaskId: 'ROOT', depth: 1, state: 'completed', branchChain: { repos: [] } } },
    });

    await expect(resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: binding,
    })).rejects.toThrow('child-task-chain-creation-blocked');
  });

  it('accepts completed current-tip child parents', async () => {
    readChildTaskChains.mockResolvedValue({
      chains: { ROOT: { currentTipTaskId: 'PARENT-1', taskIds: ['ROOT', 'PARENT-1'] } },
      tasks: {
        'PARENT-1': {
          rootTaskId: 'ROOT',
          depth: 1,
          state: 'completed',
          branchChain: {
            repos: [{
              repoRoot: '/repo/orders-api',
              chainSourceBranch: 'task/ROOT',
              targetBranch: 'main',
            }],
          },
        },
      },
    });

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: binding,
    });

    expect(result.rootTaskId).toBe('ROOT');
    expect(result.depth).toBe(2);
  });

  it.each(['planned', 'pending', 'active', 'failed'])('rejects a %s current-tip parent before child creation', async (state) => {
    readChildTaskChains.mockResolvedValue({
      chains: { ROOT: { currentTipTaskId: 'PARENT-1', taskIds: ['ROOT', 'PARENT-1'] } },
      tasks: {
        'PARENT-1': {
          rootTaskId: 'ROOT',
          depth: 1,
          state,
          branchChain: { repos: [] },
        },
      },
    });

    await expect(resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: binding,
    })).rejects.toThrow('selected parent current child chain tip is not completed');
  });

  it('rejects missing branch handoffs and absent non-root parent state', async () => {
    listArchivedTasksAction.mockResolvedValueOnce({
      ok: true,
      response: {
        mode: 'found',
        tasks: [{
          ...parent,
          branchHandoffs: undefined,
        }],
      },
    });

    await expect(resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'PARENT-1',
      childExecutionScope: binding,
    })).rejects.toThrow('parent archive is missing branch handoffs');

    await expect(resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT-1',
      childExecutionScope: binding,
    })).rejects.toThrow('parent is missing from child-chain state and is not a root parent');
  });

  it('wraps invalid child-chain state read failures as creation blockers', async () => {
    readChildTaskChains.mockRejectedValueOnce(new Error('child-task-chains-invalid-schema: invalid state'));

    await expect(resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'PARENT-1',
      childExecutionScope: binding,
    })).rejects.toThrow('child-task-chain-creation-blocked: child-task-chains-invalid-schema');
  });

  it('converts monolith child execution scope without selected repos', async () => {
    const monolithBinding = {
      ...binding,
      contextPackDir: '/packs/monolith',
      contextPackId: 'monolith',
      scopeMode: 'focus-selection',
      primaryRepoId: undefined,
      primaryFocusId: 'checkout',
      selectedRepoIds: [],
      selectedFocusIds: ['checkout'],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: undefined,
      deepFocusPrimaryFocusId: 'checkout',
      selectedFocusPath: 'apps/checkout',
      selectedFocusTargetKind: 'directory' as const,
    };

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'PARENT-1',
      childExecutionScope: monolithBinding,
    });

    expect(result.childExecutionScope).toEqual(expect.objectContaining({
      selectedRepoIds: [],
      selectedFocusIds: ['checkout'],
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: 'checkout',
      selectedFocusPath: 'apps/checkout',
      selectedFocusTargetKind: 'directory',
    }));
  });
});
