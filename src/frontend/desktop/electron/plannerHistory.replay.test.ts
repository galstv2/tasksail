// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const brokerStartSession = vi.fn(() => ({ sessionId: 'planner-999', created: true }));
const brokerEndSession = vi.fn();
const resolveFocusedRepoRoot = vi.fn();
const resolveSelectedPrimaryRepoRoot = vi.fn();
const collectFocusedRepoTargetDirectoryRoots = vi.fn(() => ['/repos/historical/src/api']);
const clearStagingArtifacts = vi.fn();
const initializeStagedPlanningDraft = vi.fn();
const getPlannerHistoryRecord = vi.fn();
const beginPendingRecord = vi.fn();
const appendPendingMessage = vi.fn();
const discardPendingRecord = vi.fn();
const readWorkspaceSyncStateSnapshot = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

const PlannerSessionBrokerMock = vi.fn();

vi.mock('./plannerSessionBroker', () => ({
  PlannerSessionBroker: PlannerSessionBrokerMock,
}));

vi.mock('./main.staging', () => ({
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
}));

vi.mock('./plannerHistory', () => ({
  beginPendingRecord,
  appendPendingMessage,
  discardPendingRecord,
}));

vi.mock('../../../backend/platform/planner-history/store.js', () => ({
  getPlannerHistoryRecord,
}));

vi.mock('./main.contextPackCatalog', () => ({
  readWorkspaceSyncStateSnapshot,
}));

vi.mock('../../../backend/platform/context-pack/focusedRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/context-pack/focusedRepo.js')>();
  return {
    ...actual,
    resolveSelectedPrimaryRepoRoot,
    resolveFocusedRepoRoot,
    collectFocusedRepoTargetDirectoryRoots,
  };
});

function buildReplaySidecar() {
  return {
    version: 1 as const,
    ownership: 'planner-session' as const,
    sessionId: 'source-record-session',
    draftFilename: 'old-draft.md',
    draftPath: '/repo/AgentWorkSpace/dropbox/.staging/old-draft.md',
    createdAt: '2026-03-21T04:00:00Z',
    title: 'historical child task',
    primaryRepoId: 'historical-repo',
    primaryRepoRoot: '/repos/historical',
    primaryFocusRelativePath: 'src/api',
    deepFocusEnabled: true,
    primaryFocusTargetKind: 'directory' as const,
    primaryFocusTargets: [
      {
        path: 'src/api',
        kind: 'directory' as const,
        role: 'anchor' as const,
        repoLocalPath: '/repos/historical',
        repoId: 'historical-repo',
      },
    ],
    selectedTestTarget: { path: 'tests/api.test.ts', kind: 'file' as const },
    supportTargets: [{ path: 'docs', kind: 'directory' as const, effectiveScope: 'full-directory' as const }],
    lineage: {
      taskKind: 'child-task' as const,
      parentTaskId: 'TASK-1',
      rootTaskId: 'ROOT-1',
      parentQmdRecordId: 'qmd-1',
      parentQmdScope: 'qmd/context-packs/historical',
      followUpReason: 'Continue implementation.',
    },
    contextPackBinding: {
      contextPackDir: '/contextpacks/historical',
      contextPackId: 'historical',
      scopeMode: 'focus-selection',
      selectedRepoIds: ['historical-repo'],
      selectedFocusIds: ['historical-focus'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/api',
      selectedFocusTargetKind: 'directory' as const,
      selectedFocusTargets: [
        {
          path: 'src/api',
          kind: 'directory' as const,
          role: 'anchor' as const,
          repoLocalPath: '/repos/historical',
          repoId: 'historical-repo',
        },
      ],
      selectedTestTarget: { path: 'tests/api.test.ts', kind: 'file' as const },
      selectedSupportTargets: [{ path: 'docs', kind: 'directory' as const, effectiveScope: 'full-directory' as const }],
    },
  };
}

describe('planner history replay session bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    PlannerSessionBrokerMock.mockImplementation(() => ({
      startSession: brokerStartSession,
      endSession: brokerEndSession,
      sendMessage: vi.fn(),
      saveDraft: vi.fn(),
      isSessionActive: vi.fn(() => false),
      getState: vi.fn(() => null),
      getObservability: vi.fn(() => ({ sessionId: null })),
    }));
    vi.spyOn(Date, 'now').mockReturnValue(999);
    readWorkspaceSyncStateSnapshot.mockResolvedValue({
      activeContextPackDir: '/contextpacks/historical',
      activeContextPackId: 'historical',
    });
    const sidecar = buildReplaySidecar();
    getPlannerHistoryRecord.mockResolvedValue({
      id: 'source-record-session',
      contextPackDir: '/contextpacks/historical',
      contextPackId: 'historical',
      createdAt: '2026-03-21T05:00:00Z',
      title: sidecar.title,
      finalizedDestinationPath: '/repo/dropbox/historical.md',
      sidecarSnapshot: sidecar,
      transcript: [],
    });
    initializeStagedPlanningDraft.mockImplementation(async (options) => ({
      ...buildReplaySidecar(),
      sessionId: options.sessionId,
      contextPackBinding: options.contextPackBinding,
      lineage: options.lineage,
      title: options.title,
    }));
  });

  it('uses the frozen sidecar binding instead of live workspace selection and starts a fresh pending record', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/live',
      visibleRepoRoots: ['/repos/live'],
      declaredRepoRoots: ['/repos/live'],
      estateType: 'distributed-platform',
      primaryRepoId: 'live-repo',
      primaryFocusRelativePath: 'live/path',
      selectedRepoIds: ['live-repo'],
      selectedFocusIds: ['live-focus'],
      authoritySource: 'workspace-sync-state',
    });
    resolveFocusedRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/live-default',
      visibleRepoRoots: ['/repos/live-default'],
      declaredRepoRoots: ['/repos/live-default'],
      estateType: 'distributed-platform',
      primaryRepoId: 'live-default',
      selectedRepoIds: ['live-default'],
      selectedFocusIds: [],
      authoritySource: 'manifest-primary',
    });

    const plannerSession = await import('./plannerSession');
    await expect(
      plannerSession.startSession('/contextpacks/live', undefined, 'source-record-session'),
    ).resolves.toEqual({ sessionId: 'planner-999', created: true });

    expect(resolveSelectedPrimaryRepoRoot).not.toHaveBeenCalled();
    expect(resolveFocusedRepoRoot).not.toHaveBeenCalled();
    expect(clearStagingArtifacts).toHaveBeenCalledWith({ force: true });
    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'planner-999',
      contextPackDir: '/contextpacks/historical',
      title: 'historical child task',
      lineage: expect.objectContaining({
        taskKind: 'child-task',
        parentTaskId: 'TASK-1',
      }),
      contextPackBinding: expect.objectContaining({
        contextPackDir: '/contextpacks/historical',
        selectedRepoIds: ['historical-repo'],
        selectedFocusPath: 'src/api',
      }),
      focusedRepo: expect.objectContaining({
        primaryRepoId: 'historical-repo',
        primaryRepoRoot: '/repos/historical',
        primaryFocusRelativePath: 'src/api',
        selectedRepoIds: ['historical-repo'],
      }),
    }));
    expect(brokerStartSession).toHaveBeenCalledWith(expect.objectContaining({
      contextPackDir: '/contextpacks/historical',
      focusEnv: expect.objectContaining({
        targetReposJson: JSON.stringify(['/repos/historical']),
        primaryFocusPath: 'src/api',
        testTargetPath: 'tests/api.test.ts',
      }),
    }));
    expect(beginPendingRecord).toHaveBeenCalledWith(
      'planner-999',
      '/contextpacks/historical',
      expect.objectContaining({
        sessionId: 'planner-999',
        title: 'historical child task',
      }),
    );
    expect(beginPendingRecord.mock.calls[0]?.[0]).not.toBe('source-record-session');
  });

  it('looks up the replay record by the live workspace activeContextPackId, not by contextPackDir basename', async () => {
    readWorkspaceSyncStateSnapshot.mockResolvedValueOnce({
      activeContextPackDir: '/contextpacks/orders',
      activeContextPackId: 'orders',
    });

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/live-renamed', undefined, 'source-record-session');

    expect(getPlannerHistoryRecord).toHaveBeenCalledTimes(1);
    const lookupArgs = getPlannerHistoryRecord.mock.calls[0]?.[0] as { contextPackId?: string };
    expect(lookupArgs.contextPackId).toBe('orders');
    expect(lookupArgs.contextPackId).not.toBe('live-renamed');
  });
});

