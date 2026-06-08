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
const assertPlannerHistoryRecordHydratable = vi.fn();
const resolvePlannerLaunchExtensions = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

const PlannerSessionBrokerMock = vi.fn();

vi.mock('./sessionBroker', () => ({
  PlannerSessionBroker: PlannerSessionBrokerMock,
}));

vi.mock('./staging', () => ({
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
}));

vi.mock('./history', () => ({
  beginPendingRecord,
  appendPendingMessage,
  discardPendingRecord,
}));

vi.mock('./recentChildTaskEligibility', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recentChildTaskEligibility')>()),
  assertPlannerHistoryRecordHydratable,
}));

vi.mock('../../../../backend/platform/planner-history/store.js', () => ({
  getPlannerHistoryRecord,
}));

vi.mock('../contextPack/catalog', () => ({
  readWorkspaceSyncStateSnapshot,
}));

vi.mock('../../../../backend/platform/context-pack/focusedRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../backend/platform/context-pack/focusedRepo.js')>();
  return {
    ...actual,
    resolveSelectedPrimaryRepoRoot,
    resolveFocusedRepoRoot,
    collectFocusedRepoTargetDirectoryRoots,
  };
});

vi.mock('./launchExtensions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./launchExtensions')>()),
  resolvePlannerLaunchExtensions,
}));

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
    PlannerSessionBrokerMock.mockImplementation(function () { return ({
      startSession: brokerStartSession,
      endSession: brokerEndSession,
      sendMessage: vi.fn(),
      saveDraft: vi.fn(),
      isSessionActive: vi.fn(() => false),
      getState: vi.fn(() => null),
      getObservability: vi.fn(() => ({ sessionId: null })),
    }); });
    vi.spyOn(Date, 'now').mockReturnValue(999);
    resolvePlannerLaunchExtensions.mockResolvedValue({
      plannerSessionId: 'unused',
      launchExtensions: undefined,
      availabilityNote: 'LILY-REPLAY-NOTE',
      skillCount: 0,
      pluginCount: 0,
      extensionIds: [],
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    readWorkspaceSyncStateSnapshot.mockResolvedValue({
      activeContextPackDir: '/contextpacks/historical',
      activeContextPackId: 'historical',
    });
    assertPlannerHistoryRecordHydratable.mockResolvedValue({
      visible: true,
      reason: 'current-completed-tip',
      taskId: 'historical',
      rootTaskId: 'ROOT-1',
      currentTipTaskId: 'historical',
      currentTipState: 'completed',
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

    const plannerSession = await import('./session');
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
    // Replaying a child task drops the source lineage so the staged draft defaults
    // to a standalone standard task — no parent linkage carried into the new chain.
    expect(initializeStagedPlanningDraft.mock.calls[0]?.[0]?.lineage).toBeUndefined();
    expect(beginPendingRecord.mock.calls[0]?.[0]).not.toBe('source-record-session');

    // Replay resolves a FRESH Lily assignment for the new session id, and the availability note
    // is runtime-only — never persisted into pending history.
    expect(resolvePlannerLaunchExtensions).toHaveBeenCalledWith(
      expect.objectContaining({ plannerSessionId: `planner-999-${process.pid}-0`, providerId: 'copilot' }),
    );
    expect(JSON.stringify(beginPendingRecord.mock.calls)).not.toContain('LILY-REPLAY-NOTE');
    expect(JSON.stringify(appendPendingMessage.mock.calls)).not.toContain('LILY-REPLAY-NOTE');
  });

  it('looks up the replay record by the live workspace activeContextPackId, not by contextPackDir basename', async () => {
    readWorkspaceSyncStateSnapshot.mockResolvedValueOnce({
      activeContextPackDir: '/contextpacks/orders',
      activeContextPackId: 'orders',
    });

    const plannerSession = await import('./session');
    await plannerSession.startSession('/contextpacks/live-renamed', undefined, 'source-record-session');

    expect(getPlannerHistoryRecord).toHaveBeenCalledTimes(1);
    const lookupArgs = getPlannerHistoryRecord.mock.calls[0]?.[0] as { contextPackId?: string };
    expect(lookupArgs.contextPackId).toBe('orders');
    expect(lookupArgs.contextPackId).not.toBe('live-renamed');
  });

  it('rejects stale child replay before staging, broker startup, or pending history mutation', async () => {
    assertPlannerHistoryRecordHydratable.mockResolvedValueOnce({
      visible: false,
      reason: 'not-current-chain-tip',
      taskId: 'historical',
      rootTaskId: 'ROOT-1',
      currentTipTaskId: 'newer-child',
      currentTipState: 'completed',
    });

    const plannerSession = await import('./session');
    await expect(
      plannerSession.startSession('/contextpacks/live', undefined, 'source-record-session'),
    ).rejects.toThrow("This recent can't be replayed right now because its underlying task has changed. Refresh the recent list and try again.");

    expect(clearStagingArtifacts).not.toHaveBeenCalled();
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalled();
    expect(brokerStartSession).not.toHaveBeenCalled();
    expect(beginPendingRecord).not.toHaveBeenCalled();
  });

  it('rejects child replay when child-chain state is invalid before staging or broker startup', async () => {
    assertPlannerHistoryRecordHydratable.mockResolvedValueOnce({
      visible: false,
      reason: 'child-chain-state-invalid',
      taskId: 'historical',
      rootTaskId: null,
      currentTipTaskId: null,
      currentTipState: null,
    });

    const plannerSession = await import('./session');
    await expect(
      plannerSession.startSession('/contextpacks/live', undefined, 'source-record-session'),
    ).rejects.toThrow("This recent can't be replayed right now because its task data is being updated. Try again in a moment.");

    expect(clearStagingArtifacts).not.toHaveBeenCalled();
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalled();
    expect(brokerStartSession).not.toHaveBeenCalled();
    expect(beginPendingRecord).not.toHaveBeenCalled();
  });

  it('keeps standard replay unchanged and does not check child-chain eligibility', async () => {
    const standardSidecar = {
      ...buildReplaySidecar(),
      lineage: {
        taskKind: 'standard' as const,
        parentTaskId: '',
        rootTaskId: '',
        parentQmdRecordId: '',
        parentQmdScope: '',
        followUpReason: '',
      },
    };
    getPlannerHistoryRecord.mockResolvedValueOnce({
      id: 'standard-record',
      contextPackDir: '/contextpacks/historical',
      contextPackId: 'historical',
      createdAt: '2026-03-21T05:00:00Z',
      title: standardSidecar.title,
      finalizedDestinationPath: '/repo/dropbox/standard.md',
      sidecarSnapshot: standardSidecar,
      transcript: [],
    });

    const plannerSession = await import('./session');
    await expect(
      plannerSession.startSession('/contextpacks/live', undefined, 'standard-record'),
    ).resolves.toEqual({ sessionId: 'planner-999', created: true });

    expect(assertPlannerHistoryRecordHydratable).not.toHaveBeenCalled();
    expect(brokerStartSession).toHaveBeenCalled();
  });
});
