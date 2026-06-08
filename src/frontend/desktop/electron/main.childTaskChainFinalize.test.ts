import { describe, expect, it, vi, beforeEach } from 'vitest';

const createFollowupTask = vi.fn();
const createDropboxTask = vi.fn();
const resolveChildTaskChainCreationContext = vi.fn();
const readOwnedStagedDraft = vi.fn();
const commitPendingRecordToHistory = vi.fn();

vi.mock('../../../backend/platform/queue/createFollowupTask.js', () => ({ createFollowupTask }));
vi.mock('../../../backend/platform/queue/createDropboxTask.js', () => ({ createDropboxTask }));
vi.mock('./archive/childTaskChain', () => ({ resolveChildTaskChainCreationContext }));
vi.mock('./planner/staging', () => ({
  readOwnedStagedDraft,
  readPlannerStagingSidecar: vi.fn(),
  readStagedDraft: vi.fn(),
}));
vi.mock('./planner/history', () => ({ commitPendingRecordToHistory }));
vi.mock('./runtime/stream', () => ({
  emitStreamEvent: vi.fn(),
  setTerminalTaskScopeForWebContents: vi.fn(),
  withStreamEvent: vi.fn(async (_event, fn) => fn()),
}));
vi.mock('./log/logger', () => ({ createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })) }));

const metadata = {
  lineage: {
    taskKind: 'child-task',
    parentTaskId: 'PARENT-1',
    parentQmdRecordId: 'qmd-1',
    parentQmdScope: 'qmd/context-packs/orders',
    rootTaskId: 'PARENT-1',
    followUpReason: 'Continue',
  },
  contextPackBinding: {
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
  },
};

describe('planner.finalizeSpec child task chain metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFollowupTask.mockResolvedValue('/repo/AgentWorkSpace/dropbox/child.md');
    resolveChildTaskChainCreationContext.mockResolvedValue({
      branchChain: { schemaVersion: 1, mode: 'continuation', rootTaskId: 'PARENT-1', parentTaskId: 'PARENT-1', depth: 1, repos: [] },
      parentContextSnapshot: null,
      childExecutionScope: { contextPackDir: '/packs/orders', contextPackId: 'orders' },
      parentArchivePath: '/archive/parent.md',
      parentArchiveArtifactDir: '/archive/parent',
      previousTaskId: 'PARENT-1',
    });
    readOwnedStagedDraft.mockResolvedValue({
      draft: {
        content: `# Child title

## Task Lineage

- Task Kind: child-task
- Parent Task ID: PARENT-1
- Root Task ID: PARENT-1
- Parent QMD Record ID: qmd-1
- Parent QMD Scope: qmd/context-packs/orders
- Follow-Up Reason: Continue

## Context Pack Binding

- Context Pack Dir: /packs/orders
- Context Pack ID: orders
- Scope Mode: repo-selection

## Request Summary

Implement the child task continuation metadata path with enough detail for queue creation.

## Desired Outcome

The child task is created with branch-chain metadata and planned state.

## Constraints

Keep the implementation scoped to the child-task metadata creation contract.

## Critical Requirements

None

## Compatibility Requirements

None

## Required Validation

None

## Acceptance Signals

- The child creation path records chain state and preserves the selected execution scope.

## Parent Task Carry-Forward Summary

Carry forward the immediate parent context so the child task can continue safely.

## Suggested Routing

- Recommended Execution: Simple
- Planner Notes: Notes
`,
      },
      metadata,
      error: null,
    });
  });

  it('resolves chain context before createFollowupTask and passes Branch Chain inputs', async () => {
    const { handleDesktopAction } = await import('./ipc/desktopActionRouter');
    const result = await handleDesktopAction({ action: 'planner.finalizeSpec' }, {
      listContextPacks: vi.fn(),
    } as never);

    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(resolveChildTaskChainCreationContext).toHaveBeenCalledWith(expect.objectContaining({
      parentTaskId: 'PARENT-1',
      requestedRootTaskId: 'PARENT-1',
      childExecutionScope: metadata.contextPackBinding,
    }));
    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      branchChain: expect.objectContaining({ rootTaskId: 'PARENT-1' }),
      previousTaskId: 'PARENT-1',
    }));
  });

  it('rejects resolver failures before createFollowupTask', async () => {
    resolveChildTaskChainCreationContext.mockRejectedValueOnce(new Error('child-task-chain-creation-blocked: not tip'));
    const { handleDesktopAction } = await import('./ipc/desktopActionRouter');
    const result = await handleDesktopAction({ action: 'planner.finalizeSpec' }, {
      listContextPacks: vi.fn(),
    } as never);

    expect(result.ok).toBe(false);
    expect(createFollowupTask).not.toHaveBeenCalled();
  });

  it('rejects introduced repo HEAD resolution failures before createFollowupTask', async () => {
    resolveChildTaskChainCreationContext.mockRejectedValueOnce(
      new Error('child-task-chain-divergent-repo-base-unresolved: /repo/tools'),
    );
    const { handleDesktopAction } = await import('./ipc/desktopActionRouter');
    const result = await handleDesktopAction({ action: 'planner.finalizeSpec' }, {
      listContextPacks: vi.fn(),
    } as never);

    expect(result.ok).toBe(false);
    expect(createFollowupTask).not.toHaveBeenCalled();
  });
});
