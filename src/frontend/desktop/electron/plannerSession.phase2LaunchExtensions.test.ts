// @vitest-environment node
//
// Track C confirmation: Phase 2 Lily launch-extension integration.
//
// Confirms the narrowest faithful seam: resolver output is threaded to broker capture,
// first-turn note is applied (positive) or absent (negative), session reuse skips
// re-resolution, and staged paths / note text never reach allowedRoots, focusEnv,
// pending-message display text, or staging sidecar arguments.
//
// The plannerSession.ts module owns module-level state (broker, firstMessageSent,
// activeLilyAvailabilityNote, activeLilyExtensionCleanup). vi.resetModules() in
// beforeEach isolates each test so state resets between runs.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be declared before any module import so vi.hoisted values bind correctly.
const initializeStagedPlanningDraft = vi.fn();
const clearStagingArtifacts = vi.fn();
const resolveFocusedRepoRoot = vi.fn();
const resolveSelectedPrimaryRepoRoot = vi.fn();
const info = vi.fn();
const warn = vi.fn();
const resolveLilyPlannerLaunchExtensions = vi.fn();
const appendPendingMessage = vi.fn();
const beginPendingRecord = vi.fn();
const discardPendingRecord = vi.fn();

// Deterministic planner session ID: Date.now() pinned to 777 in beforeEach.
// Format matches nextPlannerSessionId(): planner-<epochMs>-<pid>-<counter>.
const sid = (counter: number): string => `planner-777-${process.pid}-${counter}`;

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

// Override only the resolver; keep the real first-turn/note string helpers from the module so
// applyLilyLaunchAvailabilityNoteToFirstTurn and wrapFreshSessionMessage run against real code.
vi.mock('./plannerLaunchExtensions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plannerLaunchExtensions')>();
  return { ...actual, resolveLilyPlannerLaunchExtensions };
});

vi.mock('../../../backend/platform/context-pack/focusedRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/context-pack/focusedRepo.js')>();
  return {
    ...actual,
    resolveSelectedPrimaryRepoRoot,
    resolveFocusedRepoRoot,
  };
});

// Minimal resolved-lily helper — mirrors the bootstrap test pattern exactly.
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
    launchExtensions: undefined as { pluginDirs: readonly string[]; skillDirs: readonly string[] } | undefined,
    availabilityNote: undefined as string | undefined,
    skillCount: 0,
    pluginCount: 0,
    extensionIds: [] as readonly string[],
    cleanup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('plannerSession phase2 launch-extension confirmation', () => {
  beforeEach(() => {
    vi.doUnmock('./plannerCliProcess');
    vi.doUnmock('./plannerParentBranchView');
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(777);

    // Happy-path defaults: resolver resolves with no extensions; staging helpers succeed.
    resolveLilyPlannerLaunchExtensions.mockResolvedValue(resolvedLily());
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // Row 1 positive: assignments → launchExtensions in broker + first-turn note
  // -------------------------------------------------------------------------

  describe('lily-positive: assignments present', () => {
    it('passes staged launchExtensions to broker.startSession', async () => {
      const launchExtensions = {
        pluginDirs: ['/stage/launch-id/plugins/phase2-cobalt'],
        skillDirs: ['/stage/launch-id/skills'],
      };
      resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(
        resolvedLily({ launchExtensions }),
      );

      const { PlannerSessionBroker } = await import('./plannerSessionBroker');
      const startSession = vi.spyOn(PlannerSessionBroker.prototype, 'startSession');
      const plannerSession = await import('./plannerSession');

      await plannerSession.startSession('/packs/orders');

      expect(startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: sid(0),
          launchExtensions,
        }),
      );
    });

    it('applies the resolver availability note to the first broker turn only', async () => {
      const note = 'Optional Skills And Plugins Available This Session';
      resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(
        resolvedLily({ availabilityNote: note }),
      );

      const { PlannerSessionBroker } = await import('./plannerSessionBroker');
      const sendMessage = vi
        .spyOn(PlannerSessionBroker.prototype, 'sendMessage')
        .mockResolvedValue('sent');
      vi.spyOn(PlannerSessionBroker.prototype, 'getObservability').mockReturnValue({
        sessionId: sid(0),
      } as never);

      const plannerSession = await import('./plannerSession');
      await plannerSession.startSession('/packs/orders');
      await plannerSession.sendMessage('Do the thing', 'Do the thing');
      await plannerSession.sendMessage('Second turn');

      // First broker call must contain the note.
      expect(sendMessage.mock.calls[0][0]).toContain(note);
      // Second broker call must NOT contain the note (first-turn consumed).
      expect(sendMessage.mock.calls[1][0]).not.toContain(note);
    });

    it('stores only the operator display text in pending history — never the injected note', async () => {
      const note = 'Optional Skills And Plugins Available This Session';
      resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(
        resolvedLily({ availabilityNote: note }),
      );

      const { PlannerSessionBroker } = await import('./plannerSessionBroker');
      vi.spyOn(PlannerSessionBroker.prototype, 'sendMessage').mockResolvedValue('sent');
      vi.spyOn(PlannerSessionBroker.prototype, 'getObservability').mockReturnValue({
        sessionId: sid(0),
      } as never);

      const plannerSession = await import('./plannerSession');
      await plannerSession.startSession('/packs/orders');
      await plannerSession.sendMessage('Plan this', 'Plan this (display)');

      // History receives the display text, not the note-injected broker text.
      expect(appendPendingMessage).toHaveBeenCalledWith(
        'operator',
        'Plan this (display)',
        expect.any(String),
        sid(0),
      );
      // Note body must not appear anywhere in the history call arguments.
      expect(JSON.stringify(appendPendingMessage.mock.calls)).not.toContain(
        'Optional Skills And Plugins Available This Session',
      );
    });

    it('does not include staged skill/plugin dirs in the allowedRoots passed to broker.startSession', async () => {
      const launchExtensions = {
        pluginDirs: ['/stage/launch-id/plugins/phase2-cobalt'],
        skillDirs: ['/stage/launch-id/skills/phase2-ferret'],
      };
      resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(
        resolvedLily({ launchExtensions }),
      );

      const { PlannerSessionBroker } = await import('./plannerSessionBroker');
      const startSession = vi.spyOn(PlannerSessionBroker.prototype, 'startSession');
      const plannerSession = await import('./plannerSession');

      await plannerSession.startSession('/packs/orders');

      const brokerOptions = startSession.mock.calls[0][0] as { allowedRoots?: string[] };
      const roots = brokerOptions?.allowedRoots ?? [];
      // Staged dirs must not appear in the allowed-roots list passed to the broker.
      expect(roots).not.toContain('/stage/launch-id/plugins/phase2-cobalt');
      expect(roots).not.toContain('/stage/launch-id/skills/phase2-ferret');
      for (const root of roots) {
        expect(root).not.toContain('/stage/launch-id');
      }
    });

    it('does not include staged paths in focusEnv passed to broker.startSession', async () => {
      const launchExtensions = {
        pluginDirs: ['/stage/launch-id/plugins/phase2-cobalt'],
        skillDirs: ['/stage/launch-id/skills/phase2-ferret'],
      };
      resolveLilyPlannerLaunchExtensions.mockResolvedValueOnce(
        resolvedLily({ launchExtensions }),
      );

      const { PlannerSessionBroker } = await import('./plannerSessionBroker');
      const startSession = vi.spyOn(PlannerSessionBroker.prototype, 'startSession');
      const plannerSession = await import('./plannerSession');

      await plannerSession.startSession('/packs/orders');

      const brokerOptions = startSession.mock.calls[0][0] as { focusEnv?: unknown };
      const focusEnvStr = JSON.stringify(brokerOptions?.focusEnv ?? {});
      expect(focusEnvStr).not.toContain('/stage/launch-id');
    });
  });

  // -------------------------------------------------------------------------
  // Row 1 negative: unassigned planning-agent → no stage, no extensions, no note
  // -------------------------------------------------------------------------

  describe('lily-negative: no assignment', () => {
    it('produces no launchExtensions when planning-agent has no assignments', async () => {
      // resolvedLily() defaults: launchExtensions: undefined, availabilityNote: undefined.
      // This represents the unassigned / empty-assignment case.
      const { PlannerSessionBroker } = await import('./plannerSessionBroker');
      const startSession = vi.spyOn(PlannerSessionBroker.prototype, 'startSession');
      const plannerSession = await import('./plannerSession');

      await plannerSession.startSession('/packs/orders');

      const brokerOptions = startSession.mock.calls[0][0] as {
        launchExtensions?: unknown;
      };
      // Broker must receive undefined or absent launchExtensions (not a non-empty object).
      expect(brokerOptions?.launchExtensions).toBeUndefined();
    });

    it('does not inject an availability note into the first broker turn when unassigned', async () => {
      const { PlannerSessionBroker } = await import('./plannerSessionBroker');
      const sendMessage = vi
        .spyOn(PlannerSessionBroker.prototype, 'sendMessage')
        .mockResolvedValue('sent');
      vi.spyOn(PlannerSessionBroker.prototype, 'getObservability').mockReturnValue({
        sessionId: sid(0),
      } as never);

      const plannerSession = await import('./plannerSession');
      await plannerSession.startSession('/packs/orders');
      await plannerSession.sendMessage('Plan the task');

      const firstSent = sendMessage.mock.calls[0][0];
      // No note header in the broker message.
      expect(firstSent).not.toContain('Optional Skills And Plugins Available This Session');
    });

    it('does not record an availability note in pending history when unassigned', async () => {
      const { PlannerSessionBroker } = await import('./plannerSessionBroker');
      vi.spyOn(PlannerSessionBroker.prototype, 'sendMessage').mockResolvedValue('sent');
      vi.spyOn(PlannerSessionBroker.prototype, 'getObservability').mockReturnValue({
        sessionId: sid(0),
      } as never);

      const plannerSession = await import('./plannerSession');
      await plannerSession.startSession('/packs/orders');
      await plannerSession.sendMessage('Plan the task', 'Plan the task');

      // History call must contain the raw display text, not any note body.
      expect(appendPendingMessage).toHaveBeenCalledWith(
        'operator',
        'Plan the task',
        expect.any(String),
        expect.anything(),
      );
      expect(JSON.stringify(appendPendingMessage.mock.calls)).not.toContain(
        'Optional Skills And Plugins Available This Session',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Row 1 reuse: session reuse does not re-read assignments
  // -------------------------------------------------------------------------

  describe('session reuse', () => {
    it('does not re-resolve Lily extensions for a second startSession call on the same active session', async () => {
      const plannerSession = await import('./plannerSession');
      await plannerSession.startSession('/packs/orders');

      // Poison: if re-resolved, it would throw.
      resolveLilyPlannerLaunchExtensions.mockRejectedValueOnce(
        new Error('should not re-read active session config'),
      );

      const result = await plannerSession.startSession('/packs/orders');
      expect(result.created).toBe(false);
      // Resolver called exactly once (first startSession), not again on reuse.
      expect(resolveLilyPlannerLaunchExtensions).toHaveBeenCalledTimes(1);
    });

    it('re-resolves extensions for a new session created after the prior session ends', async () => {
      const cleanupA = vi.fn().mockResolvedValue(undefined);
      resolveLilyPlannerLaunchExtensions
        .mockResolvedValueOnce(resolvedLily({ cleanup: cleanupA }))
        .mockResolvedValueOnce(resolvedLily());

      const plannerSession = await import('./plannerSession');
      await plannerSession.startSession('/packs/orders');
      await plannerSession.endSession();
      await plannerSession.startSession('/packs/orders');

      expect(resolveLilyPlannerLaunchExtensions).toHaveBeenCalledTimes(2);
      expect(cleanupA).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance: POC resolver is NOT imported by plannerSession
  // -------------------------------------------------------------------------

  it('plannerSession.ts does NOT import the Phase 1 POC resolver (plannerLaunchExtensionsPoc)', async () => {
    // Static-analysis check: read the production source and confirm it does not reference
    // the Phase 1 POC module. The path is resolved relative to this test file's directory.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { resolve, dirname } = await import('node:path');
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(thisDir, 'plannerSession.ts'), 'utf-8');
    expect(src).not.toContain('plannerLaunchExtensionsPoc');
    expect(src).not.toContain('lily-launch-extensions-poc');
  });
});
