import { beforeEach, describe, expect, it, vi } from 'vitest';

const createFollowupTask = vi.fn();
const createDropboxTask = vi.fn();
const resolveChildTaskChainCreationContext = vi.fn();
const readWorkspaceSyncStateSnapshot = vi.fn();

vi.mock('../../../../backend/platform/queue/createFollowupTask.js', () => ({ createFollowupTask }));
vi.mock('../../../../backend/platform/queue/createDropboxTask.js', () => ({ createDropboxTask }));
vi.mock('../archive/childTaskChain', () => ({ resolveChildTaskChainCreationContext }));
vi.mock('../contextPack/catalog', () => ({
  listAvailableContextPacks: vi.fn(),
  readWorkspaceSyncStateSnapshot,
}));
vi.mock('../runtime/stream', () => ({ emitStreamEvent: vi.fn() }));
vi.mock('../tasks/board', () => ({ broadcastTaskBoardUpdate: vi.fn(async () => undefined) }));

describe('main.taskQueue standard repositoryTypes upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFollowupTask.mockResolvedValue('/repo/AgentWorkSpace/dropbox/child.md');
    createDropboxTask.mockResolvedValue('/repo/AgentWorkSpace/dropbox/task.md');
    resolveChildTaskChainCreationContext.mockResolvedValue({
      branchChain: { schemaVersion: 1, mode: 'continuation', rootTaskId: 'PARENT-1', parentTaskId: 'PARENT-1', depth: 1, repos: [] },
      parentContextSnapshot: null,
      childExecutionScope: { contextPackDir: '/packs/orders', contextPackId: 'orders' },
      parentArchivePath: '/archive/parent.md',
      parentArchiveArtifactDir: null,
      previousTaskId: 'PARENT-1',
    });
  });

  it('forwards sidecar repositoryTypes through child-task Bypass Lily upload', async () => {
    const { submitUploadedSpecHelper } = await import('../tasks/queue');
    await submitUploadedSpecHelper(`## Request Summary

Implement multi-primary support.

## Desired Outcome

Repository roles reach task markdown.

## Constraints

None

## Critical Requirements

None

## Compatibility Requirements

None

## Required Validation

None

## Acceptance Signals

- Selection Roles are forwarded.

## Parent Task Carry-Forward Summary

Carry.
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
          primaryRepoId: 'platform',
          selectedRepoIds: ['platform', 'tools'],
          selectedFocusIds: [],
          repositoryTypes: { platform: 'primary', tools: 'primary' },
          deepFocusEnabled: false,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      } as never,
    });

    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      repositoryTypes: { platform: 'primary', tools: 'primary' },
    }));
  });

  it('forwards sidecar repositoryTypes through standard Bypass Lily upload', async () => {
    const { submitUploadedSpecHelper } = await import('../tasks/queue');
    await submitUploadedSpecHelper(`## Request Summary

Implement multi-primary support.

## Desired Outcome

Repository roles reach task markdown.

## Constraints

None

## Critical Requirements

None

## Compatibility Requirements

None

## Required Validation

None

## Acceptance Signals

- Selection Roles are forwarded.
`, {
      plannerSidecar: {
        lineage: {
          taskKind: 'standard',
          parentTaskId: '',
          parentQmdRecordId: '',
          parentQmdScope: '',
          rootTaskId: '',
          followUpReason: '',
        },
        contextPackBinding: {
          contextPackDir: '/packs/orders',
          contextPackId: 'orders',
          scopeMode: 'repo-selection',
          primaryRepoId: 'platform',
          selectedRepoIds: ['platform', 'tools'],
          selectedFocusIds: [],
          repositoryTypes: { platform: 'primary', tools: 'support' },
          deepFocusEnabled: false,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      } as never,
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      repositoryTypes: { platform: 'primary', tools: 'support' },
    }));
  });
});
