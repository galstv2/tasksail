// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const initializeStagedPlanningDraft = vi.fn();
const clearStagingArtifacts = vi.fn();
const resolveFocusedRepoRoot = vi.fn();
const resolveSelectedPrimaryRepoRoot = vi.fn();
const collectFocusedRepoTargetDirectoryRoots = vi.fn();
const info = vi.fn();
const warn = vi.fn();
const resolveLilyPlannerLaunchExtensions = vi.fn();
const appendPendingMessage = vi.fn();
const beginPendingRecord = vi.fn();
const discardPendingRecord = vi.fn();

let actualCollectFocusedRepoTargetDirectoryRoots:
  typeof import('../../../backend/platform/context-pack/focusedRepo.js')['collectFocusedRepoTargetDirectoryRoots'];

// Deterministic monotonic session ID: Date.now() is pinned to 101 and the per-process pid is
// constant; the trailing integer is plannerSession's counter (reset by vi.resetModules each test).
const sid = (counter: number): string => `planner-101-${process.pid}-${counter}`;

// Minimal valid child-task focus fixtures so buildFocusedRepoFromSnapshot succeeds and the resolve
// step (which runs after focus computation) is actually reached in branch-view ordering tests.
const childSnapshot = {
  version: 1 as const,
  contextPackDir: '/packs/parent',
  contextPackId: 'parent',
  title: 'Parent task',
  primaryRepoId: 'parent-repo',
  primaryRepoRoot: '/repo/parent',
  primaryFocusRelativePath: 'src/parent',
  primaryFocusTargetKind: 'directory' as const,
  primaryFocusTargets: [],
  selectedTestTarget: null,
  supportTargets: [],
  deepFocusEnabled: false,
  contextPackBinding: {
    contextPackDir: '/packs/parent',
    contextPackId: 'parent',
    scopeMode: 'repo-selection' as const,
    selectedRepoIds: ['parent-repo'],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  },
} as never;
const childLineage = {
  parentTaskId: 'PARENT-1',
  parentQmdRecordId: 'qmd-1',
  parentQmdScope: 'qmd/context-packs/parent',
  rootTaskId: 'PARENT-1',
  followUpReason: 'Continue',
} as never;

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }));

vi.mock('./main.staging', () => ({ clearStagingArtifacts, initializeStagedPlanningDraft }));

vi.mock('./plannerHistory', () => ({ appendPendingMessage, beginPendingRecord, discardPendingRecord }));

vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info,
    warn,
    error: vi.fn(),
    child: vi.fn(() => ({ debug: vi.fn(), info, warn, error: vi.fn(), child: vi.fn() })),
  })),
}));

// Override only the resolver; keep the real first-turn/note string helpers from the module.
vi.mock('./plannerLaunchExtensions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plannerLaunchExtensions')>();
  return { ...actual, resolveLilyPlannerLaunchExtensions };
});

vi.mock('../../../backend/platform/context-pack/focusedRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/context-pack/focusedRepo.js')>();
  actualCollectFocusedRepoTargetDirectoryRoots = actual.collectFocusedRepoTargetDirectoryRoots;
  return {
    ...actual,
    resolveSelectedPrimaryRepoRoot,
    resolveFocusedRepoRoot,
    collectFocusedRepoTargetDirectoryRoots,
  };
});

function resolvedLily(
  overrides: Partial<{
    launchExtensions: { pluginDirs: readonly string[]; skillDirs: readonly string[] } | undefined;
    availabilityNote: string | undefined;
    skillCount: number;
    pluginCount: number;
    extensionIds: readonly string[];
    cleanup: () => Promise<void>;
  }> = {},
) {
  return {
    plannerSessionId: 'unused-by-orchestrator',
    launchExtensions: undefined,
    availabilityNote: undefined,
    skillCount: 0,
    pluginCount: 0,
    extensionIds: [],
    cleanup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('plannerSession staging bootstrap', () => {
  beforeEach(() => {
    vi.doUnmock('./plannerCliProcess');
    vi.doUnmock('./plannerParentBranchView');
    vi.resetModules();
    vi.clearAllMocks();
    // restoreMocks: true wipes mockImplementation between tests; re-apply.
    collectFocusedRepoTargetDirectoryRoots.mockImplementation(actualCollectFocusedRepoTargetDirectoryRoots);
    vi.spyOn(Date, 'now').mockReturnValue(101);
    resolveLilyPlannerLaunchExtensions.mockResolvedValue(resolvedLily());
  });

  it('initializes staging once for a newly created session via the production resolver (no POC config)', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/backend',
      visibleRepoRoots: ['/repos/backend'],
      declaredRepoRoots: ['/repos/backend'],
      estateType: 'distributed-platform',
      primaryRepoId: 'backend',
      primaryFocusId: undefined,
      primaryFocusRelativePath: 'apps/api',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      authoritySource: 'manifest-primary',
    });
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const plannerSession = await import('./plannerSession');
    const result = await plannerSession.startSession('/contextpacks/orders');

    expect(result).toEqual({ sessionId: sid(0), created: true });
    // Production resolver replaces the POC resolver and is invoked with the planner session ID.
    expect(resolveLilyPlannerLaunchExtensions).toHaveBeenCalledWith({
      repoRoot: expect.any(String),
      plannerSessionId: sid(0),
      providerId: 'copilot',
    });
    expect(clearStagingArtifacts).toHaveBeenCalledWith({ force: true });
    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith({
      sessionId: sid(0),
      contextPackDir: '/contextpacks/orders',
      focusedRepo: {
        estateType: 'distributed-platform',
        primaryRepoId: 'backend',
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'apps/api',
        selectedRepoIds: ['backend'],
        selectedFocusIds: ['api'],
      },
    });
  });

  it('does not re-resolve Lily extensions or recreate a stage when the session is reused', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const plannerSession = await import('./plannerSession');
    await expect(plannerSession.startSession('/contextpacks/test')).resolves.toEqual({ sessionId: sid(0), created: true });
    resolveLilyPlannerLaunchExtensions.mockRejectedValueOnce(new Error('should not re-read active session config'));
    await expect(plannerSession.startSession('/contextpacks/test')).resolves.toEqual({ sessionId: sid(0), created: false });

    expect(initializeStagedPlanningDraft).toHaveBeenCalledTimes(1);
    expect(clearStagingArtifacts).toHaveBeenCalledTimes(1);
    expect(resolveLilyPlannerLaunchExtensions).toHaveBeenCalledTimes(1);
  });

  it('passes staged launchExtensions to broker.startSession with plannerSessionId as the launch ID', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);
    const launchExtensions = { pluginDirs: ['/stage/plugins/p1'], skillDirs: ['/stage/skills'] };
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(resolvedLily({ launchExtensions }));

    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    const startSession = vi.spyOn(PlannerSessionBroker.prototype, 'startSession');

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');

    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: sid(0), launchExtensions }),
    );
  });

  it('generates distinct monotonic plannerSessionIds (and stage launch IDs) for same-millisecond sessions', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');
    await plannerSession.endSession();
    await plannerSession.startSession('/contextpacks/test');

    const calls = resolveLilyPlannerLaunchExtensions.mock.calls;
    expect(calls[0][0].plannerSessionId).toBe(sid(0));
    expect(calls[1][0].plannerSessionId).toBe(sid(1));
    expect(calls[0][0].plannerSessionId).not.toBe(calls[1][0].plannerSessionId);
  });

  it('rejects invalid Lily assignments before broker.startSession, staging, and provider spawn', async () => {
    resolveLilyPlannerLaunchExtensions.mockRejectedValueOnce(new Error('Lily extensions unavailable.'));
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    const startSession = vi.spyOn(PlannerSessionBroker.prototype, 'startSession');

    const plannerSession = await import('./plannerSession');
    await expect(plannerSession.startSession('/contextpacks/test')).rejects.toThrow(
      'Lily extensions unavailable.',
    );

    expect(startSession).not.toHaveBeenCalled();
    expect(clearStagingArtifacts).not.toHaveBeenCalled();
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalled();
  });

  it('resolves Lily launch extensions after reasoning validation and before branch-view work', async () => {
    const order: string[] = [];
    vi.doMock('./plannerParentBranchView', () => ({
      cleanupPlannerParentBranchViewSession: vi.fn(() => {
        order.push('cleanup-parent-branch-view');
      }),
      createPlannerParentBranchViewSession: vi.fn(() => {
        order.push('create-parent-branch-view');
      }),
    }));
    resolveLilyPlannerLaunchExtensions.mockImplementationOnce(() => {
      order.push('resolve-launch-extensions');
      return Promise.reject(new Error('resolver stopped launch'));
    });
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    const startSession = vi.spyOn(PlannerSessionBroker.prototype, 'startSession');

    const plannerSession = await import('./plannerSession');
    await expect(plannerSession.startSession(
      '/contextpacks/test',
      undefined,
      undefined,
      childSnapshot,
      childLineage,
      undefined,
      undefined,
      {} as never,
    )).rejects.toThrow('resolver stopped launch');

    expect(order).toEqual(['resolve-launch-extensions']);
    expect(order).not.toContain('create-parent-branch-view');
    expect(startSession).not.toHaveBeenCalled();
  });

  it('cleans the Lily extension stage when broker.startSession throws', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(resolvedLily({ cleanup }));
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    vi.spyOn(PlannerSessionBroker.prototype, 'startSession').mockImplementation(() => {
      throw new Error('broker boom');
    });

    const plannerSession = await import('./plannerSession');
    await expect(plannerSession.startSession('/contextpacks/test')).rejects.toThrow('broker boom');

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans the newly created Lily extension stage when broker returns created false', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(resolvedLily({ cleanup }));
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    vi.spyOn(PlannerSessionBroker.prototype, 'startSession').mockReturnValue({ sessionId: sid(0), created: false });

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(initializeStagedPlanningDraft).not.toHaveBeenCalled();
  });

  it('cleans the Lily extension stage when parent branch view creation fails after staging', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(resolvedLily({ cleanup }));
    vi.doMock('./plannerParentBranchView', () => ({
      cleanupPlannerParentBranchViewSession: vi.fn(),
      createPlannerParentBranchViewSession: vi.fn(() => {
        throw new Error('branch view boom');
      }),
    }));
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    const startSession = vi.spyOn(PlannerSessionBroker.prototype, 'startSession');

    const plannerSession = await import('./plannerSession');
    await expect(plannerSession.startSession(
      '/contextpacks/test',
      undefined,
      undefined,
      childSnapshot,
      childLineage,
      undefined,
      undefined,
      {} as never,
    )).rejects.toThrow('branch view boom');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(startSession).not.toHaveBeenCalled();
  });

  it('ends the failed broker session and cleans stale handles before resolving a replacement snapshot', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const cleanupA = vi.fn().mockResolvedValue(undefined);
    const cleanupB = vi.fn().mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions
      .mockResolvedValueOnce(resolvedLily({ cleanup: cleanupA }))
      .mockResolvedValueOnce(resolvedLily({ cleanup: cleanupB }));

    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    let active = false;
    let brokerStatus: 'idle' | 'failed' = 'idle';
    vi.spyOn(PlannerSessionBroker.prototype, 'isSessionActive').mockImplementation(() => active);
    vi.spyOn(PlannerSessionBroker.prototype, 'getObservability').mockImplementation(() => ({
      sessionId: sid(0),
      brokerStatus,
      activeTurnId: null,
      queuedTurnCount: 0,
      cliSessionId: null,
      lastTurnSource: 'none',
      lastTurnOutcome: 'idle',
      lastTurnAt: null,
      lastTurnHadContent: false,
      lastExitCode: null,
      turnCount: 0,
      error: null,
    }));
    const endSession = vi.spyOn(PlannerSessionBroker.prototype, 'endSession').mockImplementation(() => undefined);
    vi.spyOn(PlannerSessionBroker.prototype, 'startSession').mockImplementation(() => ({ sessionId: sid(0), created: true }));

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');
    active = true;
    brokerStatus = 'failed';
    await plannerSession.startSession('/contextpacks/test');

    expect(endSession).toHaveBeenCalled();
    expect(cleanupA).toHaveBeenCalledTimes(1); // stale stage from the failed session is cleaned
    expect(resolveLilyPlannerLaunchExtensions).toHaveBeenCalledTimes(2); // replacement resolves a fresh snapshot
  });

  it('cleans stale Lily extension and parent-branch-view handles on a failed-broker replacement even when reasoning validation throws', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    // First start succeeds (valid effort); the failed-broker replacement attempt hits a
    // reasoning-effort validation error (invalid format) before extension staging.
    const reasoningEffort = vi.fn().mockReturnValueOnce(undefined).mockReturnValue('Invalid Effort');
    vi.doMock('./plannerCliProcess', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./plannerCliProcess')>()),
      getPlanningAgentReasoningEffort: reasoningEffort,
    }));

    // Session A owns a parent branch view so the replacement must clean it too.
    const cleanupParentBranchView = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./plannerParentBranchView', () => ({
      cleanupPlannerParentBranchViewSession: cleanupParentBranchView,
      createPlannerParentBranchViewSession: vi.fn().mockResolvedValue({
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
          plannerSessionId: sid(0),
          parentTaskId: 'PARENT-1',
          sessionDir: '/runtime/session',
          manifest: { schemaVersion: 1, plannerSessionId: sid(0), parentTaskId: 'PARENT-1', contextPackDir: '/packs/parent', createdAt: 'now', bindings: [] },
        },
      }),
    }));

    const cleanupA = vi.fn().mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(resolvedLily({ cleanup: cleanupA }));

    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    let active = false;
    let brokerStatus: 'idle' | 'failed' = 'idle';
    vi.spyOn(PlannerSessionBroker.prototype, 'isSessionActive').mockImplementation(() => active);
    vi.spyOn(PlannerSessionBroker.prototype, 'getObservability').mockImplementation(() => ({
      sessionId: sid(0),
      brokerStatus,
      activeTurnId: null,
      queuedTurnCount: 0,
      cliSessionId: null,
      lastTurnSource: 'none',
      lastTurnOutcome: 'idle',
      lastTurnAt: null,
      lastTurnHadContent: false,
      lastExitCode: null,
      turnCount: 0,
      error: null,
    }));
    const endSession = vi.spyOn(PlannerSessionBroker.prototype, 'endSession').mockImplementation(() => undefined);
    vi.spyOn(PlannerSessionBroker.prototype, 'startSession').mockImplementation(() => ({ sessionId: sid(0), created: true }));

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test', undefined, undefined, childSnapshot, childLineage, undefined, undefined, {} as never);
    active = true;
    brokerStatus = 'failed';
    await expect(plannerSession.startSession('/contextpacks/test')).rejects.toThrow(/reasoning effort/i);

    expect(endSession).toHaveBeenCalled();
    // Stale handles from the failed session are cleaned before the throwing validation, not after.
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupParentBranchView).toHaveBeenCalledTimes(1);
    // Validation threw before extension staging, so no replacement snapshot was resolved.
    expect(resolveLilyPlannerLaunchExtensions).toHaveBeenCalledTimes(1);
  });

  it('cleans up owned staging and the Lily extension stage when the planner session ends', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(resolvedLily({ cleanup }));

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');
    await plannerSession.endSession();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(clearStagingArtifacts).toHaveBeenNthCalledWith(1, { force: true });
    expect(clearStagingArtifacts).toHaveBeenNthCalledWith(2, { sessionId: sid(0) });
  });

  it('continues staging cleanup on endSession even when the Lily extension cleanup handle reports a failure', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);
    // The resolver's cleanup handle logs cleanup.failed internally and never throws.
    const cleanup = vi.fn().mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(resolvedLily({ cleanup }));

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');
    await plannerSession.endSession();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(clearStagingArtifacts).toHaveBeenNthCalledWith(2, { sessionId: sid(0) });
  });

  it('logs staging bootstrap failures, ends the broker session, and cleans the Lily extension stage', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockRejectedValue(new Error('Staging bootstrap failed.'));
    const cleanup = vi.fn().mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(resolvedLily({ cleanup }));
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    const endSession = vi.spyOn(PlannerSessionBroker.prototype, 'endSession');

    const plannerSession = await import('./plannerSession');
    await expect(plannerSession.startSession('/contextpacks/test')).rejects.toThrow(
      'Staging bootstrap failed.',
    );

    expect(endSession).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('planner.session.start.cleanup.failed', {
      contextPackDir: '/contextpacks/test',
      reason: 'Staging bootstrap failed.',
    });
  });

  it('prepends the availability note only to the first planner turn and stores only the Guide display text', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(
      resolvedLily({ availabilityNote: 'NOTE-BODY' }),
    );
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    const sendMessage = vi
      .spyOn(PlannerSessionBroker.prototype, 'sendMessage')
      .mockResolvedValue('sent');
    vi.spyOn(PlannerSessionBroker.prototype, 'getObservability').mockReturnValue({
      sessionId: sid(0),
    } as never);

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');
    await plannerSession.sendMessage('hello there', 'hello there (display)');
    await plannerSession.sendMessage('second turn');

    const firstSent = sendMessage.mock.calls[0][0];
    expect(firstSent).toContain('NOTE-BODY');
    expect(firstSent).toContain('hello there');
    // Second turn is not first: no note, no fresh-session wrap.
    expect(sendMessage.mock.calls[1][0]).toBe('second turn');
    // Pending history stores the operator display text, never the injected note.
    expect(appendPendingMessage).toHaveBeenCalledWith(
      'operator',
      'hello there (display)',
      expect.any(String),
      sid(0),
    );
    expect(JSON.stringify(appendPendingMessage.mock.calls)).not.toContain('NOTE-BODY');
  });

  it('routes saveDraft through the same first-turn wrapper when no prior message was sent', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(
      resolvedLily({ availabilityNote: 'NOTE-BODY' }),
    );
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    const saveDraft = vi.spyOn(PlannerSessionBroker.prototype, 'saveDraft').mockResolvedValue('sent');

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');
    await plannerSession.saveDraft();

    const sentPrompt = saveDraft.mock.calls[0][0];
    expect(sentPrompt).toContain('NOTE-BODY');
    expect(sentPrompt).toContain('staged planning document');
  });

  it('consumes the first turn once: saveDraft before any sendMessage leaves the later first sendMessage unmodified', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);
    resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(
      resolvedLily({ availabilityNote: 'NOTE-BODY' }),
    );
    const { PlannerSessionBroker } = await import('./plannerSessionBroker');
    const saveDraft = vi.spyOn(PlannerSessionBroker.prototype, 'saveDraft').mockResolvedValue('sent');
    const sendMessage = vi
      .spyOn(PlannerSessionBroker.prototype, 'sendMessage')
      .mockResolvedValue('sent');
    vi.spyOn(PlannerSessionBroker.prototype, 'getObservability').mockReturnValue({
      sessionId: sid(0),
    } as never);

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');
    await plannerSession.saveDraft();
    await plannerSession.sendMessage('first operator turn');

    // The save-draft prompt consumed the first turn (note + wrap).
    expect(saveDraft.mock.calls[0][0]).toContain('NOTE-BODY');
    // The subsequent operator message is a non-first turn: unmodified, no note, no second wrap.
    expect(sendMessage.mock.calls[0][0]).toBe('first operator turn');
  });

  it('derives the parent directory as the planner context root for a file-focus selection on services/Acme.Api/Routes.cs', async () => {
    const focusedResult = {
      primaryRepoRoot: '/repos/backend',
      visibleRepoRoots: ['/repos/backend'],
      declaredRepoRoots: ['/repos/backend'],
      estateType: 'distributed-platform' as const,
      primaryRepoId: 'backend',
      primaryFocusId: undefined,
      primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
      deepFocusEnabled: true,
      primaryFocusTargetKind: 'file' as const,
      selectedTestTarget: { path: 'services/Acme.Api.Tests', kind: 'directory' as const },
      testTarget: undefined,
      supportTargets: [
        { path: 'libs/Acme.Models', kind: 'directory' as const, effectiveScope: 'full-directory' as const },
      ],
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      authoritySource: 'workspace-sync-state' as const,
    };
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(focusedResult);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/acme');

    expect(collectFocusedRepoTargetDirectoryRoots).toHaveBeenCalledTimes(1);
    expect(collectFocusedRepoTargetDirectoryRoots).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
        primaryFocusTargetKind: 'file',
      }),
    );

    const helperReturn = collectFocusedRepoTargetDirectoryRoots.mock.results[0]!.value as string[];
    expect(helperReturn).toEqual([
      '/repos/backend/services/Acme.Api',
      '/repos/backend/services/Acme.Api.Tests',
      '/repos/backend/libs/Acme.Models',
    ]);

    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sid(0),
        contextPackDir: '/contextpacks/acme',
        focusedRepo: expect.objectContaining({
          primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
          primaryFocusTargetKind: 'file',
          deepFocusEnabled: true,
        }),
      }),
    );
  });

  it('uses selected-primary resolution for Deep Focus sessions and carries raw test metadata into staging', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/backend',
      visibleRepoRoots: ['/repos/backend'],
      declaredRepoRoots: ['/repos/backend'],
      estateType: 'distributed-platform',
      primaryRepoId: 'backend',
      primaryFocusId: undefined,
      primaryFocusRelativePath: 'src/handler.ts',
      deepFocusEnabled: true,
      primaryFocusTargetKind: 'file',
      selectedTestTarget: { path: 'tests/handler.test.ts', kind: 'file' },
      testTarget: undefined,
      supportTargets: [{ path: 'docs', kind: 'directory', effectiveScope: 'full-directory' }],
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      authoritySource: 'workspace-sync-state',
    });
    resolveFocusedRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/backend',
      visibleRepoRoots: ['/repos/backend'],
      declaredRepoRoots: ['/repos/backend'],
      estateType: 'distributed-platform',
      primaryRepoId: 'backend',
      primaryFocusId: undefined,
      primaryFocusRelativePath: undefined,
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      authoritySource: 'manifest-primary',
    });
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/orders');

    expect(resolveSelectedPrimaryRepoRoot).toHaveBeenCalledWith('/contextpacks/orders', expect.any(String));
    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith({
      sessionId: sid(0),
      contextPackDir: '/contextpacks/orders',
      focusedRepo: {
        estateType: 'distributed-platform',
        primaryRepoId: 'backend',
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'src/handler.ts',
        deepFocusEnabled: true,
        primaryFocusTargetKind: 'file',
        selectedTestTarget: { path: 'tests/handler.test.ts', kind: 'file' },
        supportTargets: [{ path: 'docs', kind: 'directory', effectiveScope: 'full-directory' }],
        selectedRepoIds: ['backend'],
        selectedFocusIds: [],
      },
    });
  });

  it('prefers live UI Deep Focus state over disk-derived selection for staging', async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'planner-ui-roots-'));
    const contextPackDir = path.join(fixtureRoot, 'context-pack');
    const platformRoot = path.join(fixtureRoot, 'platform');
    const toolsRoot = path.join(fixtureRoot, 'tools');
    mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
    mkdirSync(platformRoot, { recursive: true });
    mkdirSync(toolsRoot, { recursive: true });
    writeFileSync(
      path.join(contextPackDir, 'qmd', 'repo-sources.json'),
      JSON.stringify({
        estate_type: 'distributed-platform',
        repositories: [
          {
            repo_id: 'platform',
            repository_type: 'primary',
            local_paths: [platformRoot],
          },
          {
            repo_id: 'tools',
            repository_type: 'primary',
            local_paths: [toolsRoot],
          },
        ],
      }),
      'utf-8',
    );
    const resolvedPlatformRoot = realpathSync(platformRoot);
    const resolvedToolsRoot = realpathSync(toolsRoot);
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/stale',
      visibleRepoRoots: ['/repos/stale'],
      declaredRepoRoots: ['/repos/stale'],
      estateType: 'distributed-platform',
      primaryRepoId: 'stale',
      primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
      deepFocusEnabled: true,
      primaryFocusTargetKind: 'file',
      selectedTestTarget: { path: 'services/Acme.Api.Tests', kind: 'directory' },
      supportTargets: [{ path: 'libs/Acme.Events', kind: 'directory', effectiveScope: 'full-directory' }],
      selectedRepoIds: ['stale'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    });
    resolveFocusedRepoRoot.mockResolvedValue({
      primaryRepoRoot: platformRoot,
      visibleRepoRoots: [platformRoot, toolsRoot],
      declaredRepoRoots: [platformRoot, toolsRoot],
      estateType: 'distributed-platform',
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
      authoritySource: 'manifest-primary',
    });
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const uiSelection = {
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'libs/Acme.Models',
      selectedFocusTargetKind: 'directory' as const,
      selectedFocusTargets: [
        {
          path: 'libs/Acme.Models',
          kind: 'directory' as const,
          repoLocalPath: '/malicious/platform',
          repoId: 'platform',
          role: 'anchor' as const,
          testTarget: { path: 'libs/Acme.Models.Tests', kind: 'directory' as const },
        },
        {
          path: 'Acme.Seed',
          kind: 'directory' as const,
          repoLocalPath: '/malicious/tools',
          repoId: 'tools',
          role: 'primary' as const,
        },
      ],
      selectedTestTarget: null,
      selectedSupportTargets: [],
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    };

    const plannerSession = await import('./plannerSession');
    try {
      await plannerSession.startSession(contextPackDir, uiSelection);

      expect(resolveSelectedPrimaryRepoRoot).not.toHaveBeenCalled();
      expect(initializeStagedPlanningDraft).toHaveBeenCalledWith({
        sessionId: sid(0),
        contextPackDir,
        focusedRepo: {
          estateType: 'distributed-platform',
          primaryRepoId: 'platform',
          primaryRepoRoot: resolvedPlatformRoot,
          primaryFocusRelativePath: 'libs/Acme.Models',
          deepFocusEnabled: true,
          primaryFocusTargetKind: 'directory',
          primaryFocusTargets: [
            {
              ...uiSelection.selectedFocusTargets[0],
              repoLocalPath: resolvedPlatformRoot,
            },
            {
              ...uiSelection.selectedFocusTargets[1],
              repoLocalPath: resolvedToolsRoot,
            },
          ],
          selectedTestTarget: { path: 'libs/Acme.Models.Tests', kind: 'directory' },
          supportTargets: [],
          selectedRepoIds: ['platform', 'tools'],
          selectedFocusIds: [],
        },
      });
      expect(collectFocusedRepoTargetDirectoryRoots).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryRepoRoot: resolvedPlatformRoot,
          visibleRepoRoots: [resolvedPlatformRoot, resolvedToolsRoot],
          primaryFocusTargets: expect.arrayContaining([
            expect.objectContaining({ repoLocalPath: resolvedPlatformRoot }),
            expect.objectContaining({ repoLocalPath: resolvedToolsRoot }),
          ]),
        }),
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
