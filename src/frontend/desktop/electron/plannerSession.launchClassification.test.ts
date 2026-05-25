// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyPlannerLaunchAllowedRoots } from './plannerSession.launchClassification';
import type { PlannerFocusSnapshot, PlannerParentBranchViewRequest } from '../src/shared/desktopContract';

const {
  resolveFocusedRepoRoot,
  resolveSelectedPrimaryRepoRoot,
  createPlannerParentBranchViewSession,
  brokerIsSessionActive,
  brokerStartSession,
  info,
  getPlanningAgentAllowedRoots,
  initializeStagedPlanningDraft,
  clearStagingArtifacts,
} = vi.hoisted(() => ({
  resolveFocusedRepoRoot: vi.fn(),
  resolveSelectedPrimaryRepoRoot: vi.fn(),
  createPlannerParentBranchViewSession: vi.fn(),
  brokerIsSessionActive: vi.fn(() => false),
  brokerStartSession: vi.fn(),
  info: vi.fn(),
  getPlanningAgentAllowedRoots: vi.fn(() => ['/repo/platform', '/repo/platform/AgentWorkSpace/templates']),
  initializeStagedPlanningDraft: vi.fn(),
  clearStagingArtifacts: vi.fn(),
}));

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }));
vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({ info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('./plannerCliProcess', () => ({ getPlanningAgentAllowedRoots }));
vi.mock('./main.staging', () => ({ initializeStagedPlanningDraft, clearStagingArtifacts }));
vi.mock('./plannerParentBranchView', () => ({
  createPlannerParentBranchViewSession,
  cleanupPlannerParentBranchViewSession: vi.fn(),
}));
vi.mock('./plannerSessionBroker', () => ({
  PlannerSessionBroker: class {
    isSessionActive = brokerIsSessionActive;
    startSession = brokerStartSession;
    endSession = vi.fn();
    sendMessage = vi.fn();
  },
}));
vi.mock('../../../backend/platform/context-pack/focusedRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/context-pack/focusedRepo.js')>();
  return {
    ...actual,
    resolveFocusedRepoRoot,
    resolveSelectedPrimaryRepoRoot,
  };
});

const snapshot = (binding: PlannerFocusSnapshot['contextPackBinding']): PlannerFocusSnapshot => ({
  version: 1,
  contextPackDir: binding.contextPackDir,
  contextPackId: binding.contextPackId,
  title: 'Parent',
  primaryRepoId: 'tools',
  primaryRepoRoot: '/repo/tools',
  primaryFocusRelativePath: null,
  primaryFocusTargetKind: null,
  primaryFocusTargets: [],
  selectedTestTarget: null,
  supportTargets: [],
  deepFocusEnabled: binding.deepFocusEnabled,
  contextPackBinding: binding,
});

const distributedBinding: PlannerFocusSnapshot['contextPackBinding'] = {
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  scopeMode: 'repo-selection',
  primaryRepoId: 'tools',
  selectedRepoIds: ['tools', 'platform', 'docs'],
  selectedFocusIds: [],
  repositoryTypes: { tools: 'primary', platform: 'support', docs: 'support' },
  deepFocusEnabled: false,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

const monolithBinding: PlannerFocusSnapshot['contextPackBinding'] = {
  contextPackDir: '/packs/mono',
  contextPackId: 'mono',
  scopeMode: 'focus-selection',
  primaryFocusId: 'api',
  selectedRepoIds: [],
  selectedFocusIds: ['api'],
  repositoryTypes: { api: 'primary' },
  deepFocusEnabled: false,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

const lineage = {
  parentTaskId: 'PARENT-1',
  parentQmdRecordId: 'qmd-1',
  parentQmdScope: 'qmd/context-packs/orders',
  rootTaskId: 'PARENT-1',
  followUpReason: 'Continue',
};

const parentTaskBranchView: PlannerParentBranchViewRequest = {
  schemaVersion: 1,
  parentTaskId: 'PARENT-1',
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  branchChainAvailability: { status: 'ready', message: 'ready' },
  branchHandoffs: [],
};

describe('planner launch allowed-root classification', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(2200);
    brokerIsSessionActive.mockReturnValue(false);
    brokerStartSession.mockReturnValue({ sessionId: 'planner-2200', created: true });
    clearStagingArtifacts.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    getPlanningAgentAllowedRoots.mockReturnValue(['/repo/platform', '/repo/platform/AgentWorkSpace/templates']);
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repo/tools',
      visibleRepoRoots: ['/repo/tools'],
      declaredRepoRoots: ['/repo/tools'],
      estateType: 'distributed-platform',
      primaryRepoId: 'tools',
      selectedRepoIds: ['tools'],
      selectedFocusIds: [],
      authoritySource: 'manifest-primary',
    });
  });

  it('classifies regular distributed-platform launch roots as platform allowlist or live baseline and logs parentBranchView none', async () => {
    const { startSession } = await import('./plannerSession');
    await startSession('/packs/orders');

    expect(info).toHaveBeenCalledWith('planner.session.launch.allowedRoots.classification', {
      sessionId: undefined,
      contextPackDir: '/packs/orders',
      rootCount: 3,
      parentBranchView: 'none',
      estateTypeHint: 'unknown',
      classifications: [
        { root: '/repo/platform', source: 'platform-allowlist' },
        { root: '/repo/platform/AgentWorkSpace/templates', source: 'platform-allowlist' },
        { root: '/repo/tools', source: 'live-baseline-no-parent' },
      ],
    });
    expect(Object.keys(info.mock.calls[0]![1])).toEqual([
      'sessionId',
      'contextPackDir',
      'rootCount',
      'parentBranchView',
      'estateTypeHint',
      'classifications',
    ]);
  });

  it('logs not-requested for child-task launch without a parent branch view', async () => {
    const { startSession } = await import('./plannerSession');
    await startSession('/packs/orders', undefined, undefined, snapshot(distributedBinding), lineage);

    expect(info).toHaveBeenCalledWith('planner.session.launch.allowedRoots.classification', expect.objectContaining({
      parentBranchView: 'not-requested',
      estateTypeHint: 'distributed-platform',
    }));
  });

  it('classifies distributed-platform parent worktrees and live overrides', async () => {
    createPlannerParentBranchViewSession.mockResolvedValue({
      focused: {
        primaryRepoRoot: '/runtime/session/tools',
        visibleRepoRoots: ['/runtime/session/tools', '/runtime/session/platform', '/repo/docs'],
        declaredRepoRoots: ['/runtime/session/tools', '/runtime/session/platform', '/repo/docs'],
        estateType: 'distributed-platform',
        primaryRepoId: 'tools',
        selectedRepoIds: ['tools', 'platform', 'docs'],
        selectedFocusIds: [],
        authoritySource: 'context-pack',
      },
      status: { mode: 'created', message: 'created', worktreeCount: 2 },
      session: {
        plannerSessionId: 'planner-2200',
        parentTaskId: 'PARENT-1',
        sessionDir: '/runtime/session',
        manifest: {
          schemaVersion: 1,
          plannerSessionId: 'planner-2200',
          parentTaskId: 'PARENT-1',
          contextPackDir: '/packs/orders',
          createdAt: 'now',
          bindings: [
            { repoRoot: '/repo/tools', repoLabel: 'tools', sourceBranch: 'task/tools', headCommitSha: 'a', worktreeRoot: '/runtime/session/tools', elapsedMs: 1, status: 'created' },
            { repoRoot: '/repo/platform', repoLabel: 'platform', sourceBranch: 'task/platform', headCommitSha: 'b', worktreeRoot: '/runtime/session/platform', elapsedMs: 1, status: 'created' },
          ],
        },
      },
    });
    const { startSession } = await import('./plannerSession');
    await startSession('/packs/orders', undefined, undefined, snapshot(distributedBinding), lineage, undefined, undefined, parentTaskBranchView);

    expect(info).toHaveBeenCalledWith('planner.session.launch.allowedRoots.classification', expect.objectContaining({
      parentBranchView: 'created',
      estateTypeHint: 'distributed-platform',
      classifications: [
        { root: '/repo/platform', source: 'platform-allowlist' },
        { root: '/repo/platform/AgentWorkSpace/templates', source: 'platform-allowlist' },
        { root: '/runtime/session/tools', source: 'parent-pinned-worktree', parentWorktreeRepoLabel: 'tools' },
        { root: '/runtime/session/platform', source: 'parent-pinned-worktree', parentWorktreeRepoLabel: 'platform' },
        { root: '/repo/docs', source: 'live-override' },
      ],
    }));
  });

  it('classifies monolith parent branch view roots without live overrides', async () => {
    createPlannerParentBranchViewSession.mockResolvedValue({
      focused: {
        primaryRepoRoot: '/runtime/session/mono',
        visibleRepoRoots: ['/runtime/session/mono'],
        declaredRepoRoots: ['/runtime/session/mono'],
        estateType: 'monolith',
        primaryRepoId: 'mono',
        selectedRepoIds: [],
        selectedFocusIds: ['api'],
        authoritySource: 'context-pack',
      },
      status: { mode: 'created', message: 'created', worktreeCount: 1 },
      session: {
        plannerSessionId: 'planner-2200',
        parentTaskId: 'PARENT-1',
        sessionDir: '/runtime/session',
        manifest: {
          schemaVersion: 1,
          plannerSessionId: 'planner-2200',
          parentTaskId: 'PARENT-1',
          contextPackDir: '/packs/mono',
          createdAt: 'now',
          bindings: [{ repoRoot: '/repo/mono', repoLabel: 'mono', sourceBranch: 'task/mono', headCommitSha: 'a', worktreeRoot: '/runtime/session/mono', elapsedMs: 1, status: 'created' }],
        },
      },
    });
    const { startSession } = await import('./plannerSession');
    await startSession('/packs/mono', undefined, undefined, snapshot(monolithBinding), lineage, undefined, undefined, parentTaskBranchView);

    expect(info).toHaveBeenCalledWith('planner.session.launch.allowedRoots.classification', expect.objectContaining({
      parentBranchView: 'created',
      estateTypeHint: 'monolith',
      classifications: [
        { root: '/repo/platform', source: 'platform-allowlist' },
        { root: '/repo/platform/AgentWorkSpace/templates', source: 'platform-allowlist' },
        { root: '/runtime/session/mono', source: 'parent-pinned-worktree', parentWorktreeRepoLabel: 'mono' },
      ],
    }));
  });

  it('classifies skipped missing handoffs as live baseline roots', async () => {
    createPlannerParentBranchViewSession.mockResolvedValue({
      focused: {
        primaryRepoRoot: '/repo/tools',
        visibleRepoRoots: ['/repo/tools'],
        declaredRepoRoots: ['/repo/tools'],
        estateType: 'distributed-platform',
        primaryRepoId: 'tools',
        selectedRepoIds: ['tools'],
        selectedFocusIds: [],
        authoritySource: 'context-pack',
      },
      status: { mode: 'skipped-missing-handoffs', message: 'missing', worktreeCount: 0 },
      session: undefined,
    });
    const { startSession } = await import('./plannerSession');
    await startSession('/packs/orders', undefined, undefined, snapshot(distributedBinding), lineage, undefined, undefined, {
      ...parentTaskBranchView,
      branchChainAvailability: { status: 'missing-branch-handoffs', message: 'missing' },
    });

    expect(info).toHaveBeenCalledWith('planner.session.launch.allowedRoots.classification', expect.objectContaining({
      parentBranchView: 'skipped-missing-handoffs',
      classifications: [
        { root: '/repo/platform', source: 'platform-allowlist' },
        { root: '/repo/platform/AgentWorkSpace/templates', source: 'platform-allowlist' },
        { root: '/repo/tools', source: 'live-baseline-no-parent' },
      ],
    }));
  });

  it('does not emit a classification log when an active session short-circuits start', async () => {
    brokerIsSessionActive.mockReturnValue(true);
    brokerStartSession.mockReturnValue({ sessionId: 'planner-existing', created: false });
    const { startSession } = await import('./plannerSession');
    await startSession('/packs/orders');

    expect(info).not.toHaveBeenCalledWith('planner.session.launch.allowedRoots.classification', expect.anything());
  });

  it('handles path boundaries, nested roots, negative over-match, and stable order', () => {
    expect(classifyPlannerLaunchAllowedRoots({
      allowedRoots: ['/repo/tools-worktree', '/repo/tools/subdir', '/repo/platform'],
      platformAllowlist: ['/repo/platform'],
      parentBranchViewBindings: [{ worktreeRoot: '/repo/tools', repoLabel: 'tools' }],
      hasParentBranchViewSession: true,
    })).toEqual([
      { root: '/repo/tools-worktree', source: 'live-override' },
      { root: '/repo/tools/subdir', source: 'parent-pinned-worktree', parentWorktreeRepoLabel: 'tools' },
      { root: '/repo/platform', source: 'platform-allowlist' },
    ]);
  });
});
