import { beforeEach, describe, expect, it, vi } from 'vitest';

const listArchivedTasksAction = vi.fn();
const readChildTaskChains = vi.fn();
const resolveSelectedMaterializationRoots = vi.fn();

vi.mock('./archivedTasks', () => ({ listArchivedTasksAction }));
vi.mock('../../../../backend/platform/queue/childTaskChains.js', () => ({ readChildTaskChains }));
vi.mock('../../../../backend/platform/context-pack/taskWorktreeSelection.js', () => ({ resolveSelectedMaterializationRoots }));

const { resolveChildTaskChainCreationContext } = await import('./childTaskChain');

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

const platformRoot = '/repo/platform';
const toolsRoot = '/repo/tools';
const frontendDesktopRoot = process.cwd();

function selectedRoot(repoId: string, gitRoot: string, role: 'primary' | 'support' = 'primary') {
  return { repoId, role, originalRoot: gitRoot, gitRoot };
}

function handoff(repoRoot: string, repoLabel: string, branch: string, targetBranch: string | null = 'main') {
  return {
    repoRoot,
    repoLabel,
    branch,
    baseCommitSha: `${branch}-base`,
    headCommitSha: `${branch}-head`,
    commitsAhead: 1,
    status: 'committed',
    autoMerge: { enabled: true, status: 'ready', targetBranch, detail: 'ok' },
  };
}

function completedHandoff(repoRoot: string, repoLabel: string, chainSourceBranch: string, targetBranch: string | null = 'main') {
  return {
    repoRoot,
    repoLabel,
    chainSourceBranch,
    baseCommitSha: `${chainSourceBranch}-base`,
    headCommitSha: `${chainSourceBranch}-head`,
    commitsAhead: 1,
    status: 'ready-for-operator-review',
    targetBranch,
  };
}

function branchChainRepo(repoRoot: string, chainSourceBranch: string, targetBranch: string | null = 'main') {
  return {
    repoRoot,
    repoLabel: repoRoot.split('/').pop() ?? repoRoot,
    chainSourceBranch,
    parentSourceBranch: chainSourceBranch,
    parentBranchHead: `${chainSourceBranch}-head`,
    targetBranch,
  };
}

function completedParentState(options: {
  taskIds?: string[];
  parentBranchChainRepos?: ReturnType<typeof branchChainRepo>[];
  completedTasks?: Record<string, unknown>;
} = {}) {
  return {
    chains: {
      ROOT: {
        currentTipTaskId: 'PARENT-1',
        taskIds: options.taskIds ?? ['ROOT', 'PARENT-1'],
      },
    },
    tasks: {
      ...(options.completedTasks ?? {}),
      'PARENT-1': {
        rootTaskId: 'ROOT',
        depth: 1,
        state: 'completed',
        branchChain: {
          schemaVersion: 1,
          mode: 'continuation',
          rootTaskId: 'ROOT',
          parentTaskId: 'ROOT',
          depth: 1,
          repos: options.parentBranchChainRepos ?? [branchChainRepo(platformRoot, 'task/ROOT')],
        },
        completedBranchHandoffs: [completedHandoff(platformRoot, 'Platform', 'task/ROOT')],
      },
    },
  };
}

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
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('orders-api', '/repo/orders-api')]);
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
    expect(result.branchChain.repos[0]).not.toHaveProperty('sourceKind');
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

  it('keeps matching parent repos as legacy parent-handoff Branch Chain entries', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('platform', platformRoot)]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        mode: 'found',
        tasks: [{ ...parent, taskId: 'PARENT-1', branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }],
      },
    });

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'PARENT-1',
      childExecutionScope: { ...binding, selectedRepoIds: ['platform'] },
    });

    expect(result.branchChain.repos).toEqual([{
      repoRoot: platformRoot,
      repoLabel: 'Platform',
      chainSourceBranch: 'task/PARENT-1',
      parentSourceBranch: 'task/PARENT-1',
      parentBranchHead: 'task/PARENT-1-head',
      targetBranch: 'main',
    }]);
  });

  it('projects partial divergence as immediate parent plus historical handoff', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([
      selectedRoot('platform', platformRoot),
      selectedRoot('tools', toolsRoot),
    ]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState({
      taskIds: ['ROOT', 'TOOLS-1', 'PARENT-1'],
      completedTasks: {
        'TOOLS-1': {
          rootTaskId: 'ROOT',
          depth: 1,
          state: 'completed',
          branchChain: { repos: [branchChainRepo(toolsRoot, 'task/ROOT', 'release/tools')] },
          completedBranchHandoffs: [completedHandoff(toolsRoot, 'Tools', 'task/ROOT', 'release/tools')],
        },
      },
    }));

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['platform', 'tools'] },
    });

    expect(result.branchChain.repos).toEqual([
      expect.objectContaining({ repoRoot: platformRoot, chainSourceBranch: 'task/ROOT' }),
      expect.objectContaining({
        repoRoot: toolsRoot,
        sourceKind: 'chain-history-handoff',
        chainSourceBranch: 'task/ROOT',
        parentSourceBranch: 'task/ROOT',
        parentBranchHead: 'task/ROOT-head',
        targetBranch: 'release/tools',
      }),
    ]);
    expect(result.branchChain.repos[0]).not.toHaveProperty('sourceKind');
  });

  it('projects partial divergence as immediate parent plus introduced repo when absent from history', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([
      selectedRoot('platform', platformRoot),
      selectedRoot('tools', frontendDesktopRoot),
    ]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState());

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['platform', 'tools'] },
    });

    expect(result.branchChain.repos).toEqual([
      expect.objectContaining({ repoRoot: platformRoot }),
      expect.objectContaining({
        repoRoot: frontendDesktopRoot,
        repoLabel: 'tools',
        sourceKind: 'introduced-by-child',
        chainSourceBranch: 'task/ROOT',
        targetBranch: null,
      }),
    ]);
    expect(result.branchChain.repos[0]).not.toHaveProperty('sourceKind');
    expect(result.branchChain.repos[1]?.parentBranchHead).toMatch(/^[0-9a-f]{40}$/);
  });

  it('uses the parent branch name for repos introduced by the first child', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('tools', frontendDesktopRoot)]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        mode: 'found',
        tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/custom-parent')] }],
      },
    });
    readChildTaskChains.mockResolvedValue({ chains: {}, tasks: {} });

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'PARENT-1',
      childExecutionScope: { ...binding, selectedRepoIds: ['tools'] },
    });

    expect(result.branchChain.repos).toEqual([
      expect.objectContaining({
        repoRoot: frontendDesktopRoot,
        sourceKind: 'introduced-by-child',
        chainSourceBranch: 'task/custom-parent',
      }),
    ]);
  });

  it('uses the first recorded chain branch for repos introduced later in the chain', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([
      selectedRoot('platform', platformRoot),
      selectedRoot('tools', frontendDesktopRoot),
    ]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState({
      parentBranchChainRepos: [branchChainRepo(platformRoot, 'task/custom-root')],
    }));

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['platform', 'tools'] },
    });

    expect(result.branchChain.repos).toEqual([
      expect.objectContaining({
        repoRoot: platformRoot,
        chainSourceBranch: 'task/custom-root',
      }),
      expect.objectContaining({
        repoRoot: frontendDesktopRoot,
        sourceKind: 'introduced-by-child',
        chainSourceBranch: 'task/custom-root',
      }),
    ]);
  });

  it('projects full divergence as historical handoff only', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('tools', toolsRoot)]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState({
      taskIds: ['ROOT', 'TOOLS-1', 'PARENT-1'],
      completedTasks: {
        'TOOLS-1': {
          rootTaskId: 'ROOT',
          depth: 1,
          state: 'completed',
          branchChain: { repos: [branchChainRepo(toolsRoot, 'task/ROOT')] },
          completedBranchHandoffs: [completedHandoff(toolsRoot, 'Tools', 'task/ROOT')],
        },
      },
    }));

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['tools'] },
    });

    expect(result.branchChain.repos).toEqual([
      expect.objectContaining({ repoRoot: toolsRoot, sourceKind: 'chain-history-handoff' }),
    ]);
  });

  it('projects full divergence as introduced repo when absent from history', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('tools', frontendDesktopRoot)]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState());

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['tools'] },
    });

    expect(result.branchChain.repos).toEqual([
      expect.objectContaining({ repoRoot: frontendDesktopRoot, sourceKind: 'introduced-by-child' }),
    ]);
  });

  it('uses the latest completed historical handoff before the selected parent', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('tools', toolsRoot)]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState({
      taskIds: ['ROOT', 'TOOLS-OLD', 'TOOLS-NEW', 'PARENT-1'],
      completedTasks: {
        'TOOLS-OLD': {
          rootTaskId: 'ROOT',
          depth: 1,
          state: 'completed',
          branchChain: { repos: [branchChainRepo(toolsRoot, 'task/OLD')] },
          completedBranchHandoffs: [completedHandoff(toolsRoot, 'Tools', 'task/OLD')],
        },
        'TOOLS-NEW': {
          rootTaskId: 'ROOT',
          depth: 2,
          state: 'completed',
          branchChain: { repos: [branchChainRepo(toolsRoot, 'task/NEW')] },
          completedBranchHandoffs: [completedHandoff(toolsRoot, 'Tools', 'task/NEW')],
        },
      },
    }));

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['tools'] },
    });

    expect(result.branchChain.repos[0]).toEqual(expect.objectContaining({
      chainSourceBranch: 'task/NEW',
      parentBranchHead: 'task/NEW-head',
    }));
  });

  it('fails when an ancestor Branch Chain repo has no completed handoff source', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('tools', toolsRoot)]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState({
      taskIds: ['ROOT', 'TOOLS-STALE', 'PARENT-1'],
      completedTasks: {
        'TOOLS-STALE': {
          rootTaskId: 'ROOT',
          depth: 1,
          state: 'completed',
          branchChain: { repos: [branchChainRepo(toolsRoot, 'task/STALE')] },
          completedBranchHandoffs: null,
        },
      },
    }));

    await expect(resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['tools'] },
    })).rejects.toThrow('child-task-chain-history-handoff-missing');
  });

  it('ignores stale older Branch Chain records when a later completed handoff exists', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('tools', toolsRoot)]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState({
      taskIds: ['ROOT', 'TOOLS-STALE', 'TOOLS-VALID', 'PARENT-1'],
      completedTasks: {
        'TOOLS-STALE': {
          rootTaskId: 'ROOT',
          depth: 1,
          state: 'completed',
          branchChain: { repos: [branchChainRepo(toolsRoot, 'task/STALE')] },
          completedBranchHandoffs: null,
        },
        'TOOLS-VALID': {
          rootTaskId: 'ROOT',
          depth: 2,
          state: 'completed',
          branchChain: { repos: [branchChainRepo(toolsRoot, 'task/VALID')] },
          completedBranchHandoffs: [completedHandoff(toolsRoot, 'Tools', 'task/VALID')],
        },
      },
    }));

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['tools'] },
    });

    expect(result.branchChain.repos[0]).toEqual(expect.objectContaining({
      sourceKind: 'chain-history-handoff',
      chainSourceBranch: 'task/VALID',
    }));
  });

  it('requires only the contracted selected repo', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('platform', platformRoot)]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        mode: 'found',
        tasks: [{
          ...parent,
          branchHandoffs: [
            handoff(platformRoot, 'Platform', 'task/PARENT-1'),
            handoff(toolsRoot, 'Tools', 'task/PARENT-1-tools'),
          ],
        }],
      },
    });
    readChildTaskChains.mockResolvedValue(completedParentState({
      parentBranchChainRepos: [
        branchChainRepo(platformRoot, 'task/ROOT'),
        branchChainRepo(toolsRoot, 'task/ROOT-tools'),
      ],
    }));

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['platform'] },
    });

    expect(result.branchChain.repos).toHaveLength(1);
    expect(result.branchChain.repos[0]?.repoRoot).toBe(platformRoot);
  });

  it('keeps Deep Focus primary roots and excludes support roots', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([
      selectedRoot('platform-focus', platformRoot),
      selectedRoot('tools-focus', toolsRoot),
      selectedRoot('docs-support', '/repo/docs', 'support'),
    ]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        mode: 'found',
        tasks: [{
          ...parent,
          branchHandoffs: [
            handoff(platformRoot, 'Platform', 'task/PARENT-1'),
            handoff(toolsRoot, 'Tools', 'task/PARENT-1-tools'),
            handoff('/repo/docs', 'Docs', 'task/PARENT-1-docs'),
          ],
        }],
      },
    });

    const result = await resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'PARENT-1',
      childExecutionScope: { ...binding, deepFocusEnabled: true, selectedRepoIds: [] },
    });

    expect(result.branchChain.repos.map((repo) => repo.repoRoot)).toEqual([platformRoot, toolsRoot]);
  });

  it('rejects introduced repos when HEAD cannot be resolved', async () => {
    resolveSelectedMaterializationRoots.mockResolvedValue([selectedRoot('tools', '/tmp/tasksail-not-a-git-repo-for-child-chain-test')]);
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: { mode: 'found', tasks: [{ ...parent, branchHandoffs: [handoff(platformRoot, 'Platform', 'task/PARENT-1')] }] },
    });
    readChildTaskChains.mockResolvedValue(completedParentState());

    await expect(resolveChildTaskChainCreationContext({
      repoRoot: '/repo',
      listContextPacks: vi.fn(),
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'ROOT',
      childExecutionScope: { ...binding, selectedRepoIds: ['tools'] },
    })).rejects.toThrow('child-task-chain-divergent-repo-base-unresolved');
  });
});
