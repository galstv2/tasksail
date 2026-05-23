// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannerFocusSnapshot, PlannerParentBranchViewRequest } from '../src/shared/desktopContract';

const {
  initializeStagedPlanningDraft,
  clearStagingArtifacts,
  createPlannerParentBranchViewSession,
  cleanupPlannerParentBranchViewSession,
  brokerIsSessionActive,
  brokerStartSession,
  brokerEndSession,
} = vi.hoisted(() => ({
  initializeStagedPlanningDraft: vi.fn(),
  clearStagingArtifacts: vi.fn(),
  createPlannerParentBranchViewSession: vi.fn(),
  cleanupPlannerParentBranchViewSession: vi.fn(),
  brokerIsSessionActive: vi.fn(() => false),
  brokerStartSession: vi.fn(),
  brokerEndSession: vi.fn(),
}));

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }));
vi.mock('./main.staging', () => ({ initializeStagedPlanningDraft, clearStagingArtifacts }));
vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));
vi.mock('./plannerParentBranchView', () => ({
  createPlannerParentBranchViewSession,
  cleanupPlannerParentBranchViewSession,
}));
vi.mock('./plannerSessionBroker', () => ({
  PlannerSessionBroker: class {
    isSessionActive = brokerIsSessionActive;
    startSession = brokerStartSession;
    endSession = brokerEndSession;
    sendMessage = vi.fn();
  },
}));

const snapshot: PlannerFocusSnapshot = {
  version: 1,
  contextPackDir: '/packs/parent',
  contextPackId: 'parent',
  title: 'Parent task',
  primaryRepoId: 'platform',
  primaryRepoRoot: '/repo/platform',
  primaryFocusRelativePath: null,
  primaryFocusTargetKind: null,
  primaryFocusTargets: [],
  selectedTestTarget: null,
  supportTargets: [],
  deepFocusEnabled: false,
  contextPackBinding: {
    contextPackDir: '/packs/parent',
    contextPackId: 'parent',
    scopeMode: 'repo-selection',
    primaryRepoId: 'platform',
    selectedRepoIds: ['platform'],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  },
};

const lineage = {
  parentTaskId: 'PARENT-1',
  parentQmdRecordId: 'qmd-1',
  parentQmdScope: 'qmd/context-packs/parent',
  rootTaskId: 'PARENT-1',
  followUpReason: 'Continue',
};

const parentTaskBranchView: PlannerParentBranchViewRequest = {
  schemaVersion: 1,
  parentTaskId: 'PARENT-1',
  contextPackDir: '/packs/parent',
  contextPackId: 'parent',
  branchChainAvailability: { status: 'ready', message: 'ready' },
  branchHandoffs: [{
    repoRoot: '/repo/platform',
    repoLabel: 'platform',
    branch: 'task/root',
    baseCommitSha: 'abc',
    headCommitSha: 'def',
    commitsAhead: 1,
    status: 'committed',
  }],
};

describe('plannerSession parent branch view orchestration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1200);
    brokerIsSessionActive.mockReturnValue(false);
    brokerStartSession.mockReturnValue({ sessionId: 'planner-1200', created: true });
    clearStagingArtifacts.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    createPlannerParentBranchViewSession.mockResolvedValue({
      focused: {
        primaryRepoRoot: '/runtime/platform',
        visibleRepoRoots: ['/runtime/platform'],
        declaredRepoRoots: ['/runtime/platform'],
        estateType: 'distributed-platform',
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        authoritySource: 'context-pack',
      },
      status: { mode: 'created', message: 'created', worktreeCount: 1 },
      session: {
        plannerSessionId: 'planner-1200',
        parentTaskId: 'PARENT-1',
        sessionDir: '/runtime/session',
        manifest: { schemaVersion: 1, plannerSessionId: 'planner-1200', parentTaskId: 'PARENT-1', contextPackDir: '/packs/parent', createdAt: 'now', bindings: [] },
      },
    });
  });

  it('passes parentTaskBranchView in the fragile startSession argument slot and keeps staging unrewritten', async () => {
    const { createDefaultDesktopActionHandlers } = await import('./main.desktopActionHandlers');
    const handlers = createDefaultDesktopActionHandlers();

    const result = await handlers.startPlannerSession({
      contextPackDir: '/packs/live',
      childTaskFocusSnapshot: snapshot,
      childTaskLineage: lineage,
      parentTaskBranchView,
    });

    expect(createPlannerParentBranchViewSession).toHaveBeenCalledWith(expect.objectContaining({
      plannerSessionId: 'planner-1200',
      request: parentTaskBranchView,
      focused: expect.objectContaining({ primaryRepoRoot: '/repo/platform' }),
    }));
    expect(result).toEqual(expect.objectContaining({
      sessionId: 'planner-1200',
      parentBranchViewStatus: { mode: 'created', message: 'created', worktreeCount: 1 },
    }));
    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'planner-1200',
      focusedRepo: expect.objectContaining({ primaryRepoRoot: '/repo/platform' }),
      contextPackBinding: snapshot.contextPackBinding,
    }));
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalledWith(expect.objectContaining({
      parentTaskBranchView: expect.anything(),
    }));
  });

  it('cleans created views when staging initialization fails before rethrowing', async () => {
    initializeStagedPlanningDraft.mockRejectedValueOnce(new Error('staging failed'));
    const { startSession } = await import('./plannerSession');

    await expect(startSession('/packs/live', undefined, undefined, snapshot, lineage, undefined, undefined, parentTaskBranchView))
      .rejects.toThrow('staging failed');
    expect(cleanupPlannerParentBranchViewSession).toHaveBeenCalledWith(expect.objectContaining({
      plannerSessionId: 'planner-1200',
    }));
  });

  it('blocks broker start, staging, and pending history when source branch validation fails', async () => {
    const error = new Error('Parent branch view failed: source branch task/root no longer exists in platform. Restore the branch or choose another parent task.');
    createPlannerParentBranchViewSession.mockRejectedValueOnce(error);
    const { startSession } = await import('./plannerSession');

    await expect(startSession('/packs/live', undefined, undefined, snapshot, lineage, undefined, undefined, parentTaskBranchView))
      .rejects.toThrow(error.message);

    expect(brokerStartSession).not.toHaveBeenCalled();
    expect(clearStagingArtifacts).not.toHaveBeenCalled();
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalled();
    expect(cleanupPlannerParentBranchViewSession).not.toHaveBeenCalled();
  });
});
