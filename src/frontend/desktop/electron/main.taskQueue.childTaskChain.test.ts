import { beforeEach, describe, expect, it, vi } from 'vitest';

const createFollowupTask = vi.fn();
const publishPendingItem = vi.fn();
const resolveChildTaskChainCreationContext = vi.fn();
const readWorkspaceSyncStateSnapshot = vi.fn();
const resolveSelectedPrimaryRepoRoot = vi.fn();
const resolveFocusedRepoRoot = vi.fn();
const readDeepFocusOverlay = vi.fn();

vi.mock('../../../backend/platform/queue/createFollowupTask.js', () => ({ createFollowupTask }));
vi.mock('../../../backend/platform/queue/createDropboxTask.js', () => ({ createDropboxTask: vi.fn() }));
vi.mock('../../../backend/platform/queue/publishPendingItem.js', () => ({ publishPendingItem }));
vi.mock('./main.childTaskChain', () => ({ resolveChildTaskChainCreationContext }));
vi.mock('./main.contextPackCatalog', () => ({
  listAvailableContextPacks: vi.fn(),
  readWorkspaceSyncStateSnapshot,
}));
vi.mock('../../../backend/platform/context-pack/focusedRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/context-pack/focusedRepo.js')>();
  return {
    ...actual,
    readDeepFocusOverlay,
    resolveSelectedPrimaryRepoRoot,
    resolveFocusedRepoRoot,
  };
});
vi.mock('./main.stream', () => ({ emitStreamEvent: vi.fn() }));

describe('main.taskQueue child task chain metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readWorkspaceSyncStateSnapshot.mockResolvedValue({
      activeContextPackDir: '/packs/orders',
      activeContextPackId: 'orders',
      selectedRepoIds: ['orders-api'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    });
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      estateType: 'distributed-platform',
      primaryRepoId: 'orders-api',
      primaryRepoRoot: '/repo/orders-api',
      primaryFocusRelativePath: 'src/orders',
      primaryFocusTargetKind: 'directory',
      primaryFocusTargets: [],
      selectedRepoIds: ['orders-api'],
      selectedFocusIds: [],
    });
    readDeepFocusOverlay.mockResolvedValue(null);
    resolveChildTaskChainCreationContext.mockResolvedValue({
      branchChain: { schemaVersion: 1, mode: 'continuation', rootTaskId: 'PARENT-1', parentTaskId: 'PARENT-1', depth: 1, repos: [] },
      parentContextSnapshot: null,
      childExecutionScope: { contextPackDir: '/packs/orders', contextPackId: 'orders' },
      parentArchivePath: '/archive/parent.md',
      parentArchiveArtifactDir: null,
      previousTaskId: 'PARENT-1',
    });
    publishPendingItem.mockImplementation(async ({ publish }) => ({
      destinationPath: await publish(),
      activation: { status: 'deferred' },
    }));
    createFollowupTask.mockResolvedValue('/repo/AgentWorkSpace/dropbox/child.md');
  });

  it('passes Branch Chain inputs and Deep Focus primary IDs for direct follow-up submission', async () => {
    const { runFollowUpTaskScript } = await import('./main.taskQueue');
    await runFollowUpTaskScript({
      summary: 'Summary',
      desiredOutcome: 'Outcome',
      constraints: 'None',
      acceptanceSignals: 'Done',
      parentTaskId: 'PARENT-1',
      followupReason: 'Continue',
      carryForwardSummary: 'Carry',
      suggestedPath: 'sequential',
      planningNotes: 'Notes',
    }, {
      readdir: vi.fn().mockResolvedValue([{ name: '2026', isDirectory: () => true }]),
      readFile: vi.fn().mockResolvedValue(`# Parent

- Task ID: PARENT-1
- QMD Record ID: qmd-1
- Root Task ID: PARENT-1
`),
    });

    expect(resolveChildTaskChainCreationContext).toHaveBeenCalledWith(expect.objectContaining({
      parentTaskId: 'PARENT-1',
      childExecutionScope: expect.objectContaining({
        deepFocusPrimaryRepoId: 'orders-api',
        selectedFocusPath: 'src/orders',
      }),
    }));
    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      branchChain: expect.objectContaining({ rootTaskId: 'PARENT-1' }),
      deepFocusPrimaryRepoId: 'orders-api',
    }));
  });

  it('passes Branch Chain inputs for child-task Bypass Lily upload from sidecar', async () => {
    const { submitUploadedSpecHelper } = await import('./main.taskQueue');
    const result = await submitUploadedSpecHelper(`## Request Summary

Implement child-task continuation metadata from an uploaded draft.

## Desired Outcome

The uploaded child task is submitted with branch-chain metadata.

## Constraints

Keep the upload scoped to child-task creation metadata.

## Critical Requirements

None

## Compatibility Requirements

None

## Required Validation

None

## Acceptance Signals

- The child task upload passes Branch Chain inputs to createFollowupTask.

## Parent Task Carry-Forward Summary

Carry forward the parent scope and archive pointers.

## Suggested Routing

- Recommended Execution: Simple
- Planner Notes: Notes
`, {
      plannerSidecar: {
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
          deepFocusPrimaryRepoId: 'orders-api',
          selectedRepoIds: ['orders-api'],
          selectedFocusIds: [],
          deepFocusEnabled: true,
          selectedFocusPath: 'src/orders',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      } as never,
    });

    expect(result.ok).toBe(true);
    expect(readWorkspaceSyncStateSnapshot).not.toHaveBeenCalled();
    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      branchChain: expect.objectContaining({ rootTaskId: 'PARENT-1' }),
      deepFocusPrimaryRepoId: 'orders-api',
    }));
  });
});
