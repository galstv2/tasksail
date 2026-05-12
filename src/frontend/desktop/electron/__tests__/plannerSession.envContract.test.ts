// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const brokerStartSession = vi.fn(() => ({ sessionId: 'planner-101', created: true }));
const brokerEndSession = vi.fn();
const resolveFocusedRepoRoot = vi.fn();
const resolveSelectedPrimaryRepoRoot = vi.fn();
const collectFocusedRepoTargetDirectoryRoots = vi.fn(() => []);
const clearStagingArtifacts = vi.fn();
const initializeStagedPlanningDraft = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('../plannerSessionBroker', () => ({
  PlannerSessionBroker: vi.fn().mockImplementation(() => ({
    startSession: brokerStartSession,
    endSession: brokerEndSession,
    sendMessage: vi.fn(),
    saveDraft: vi.fn(),
    isSessionActive: vi.fn(() => false),
    getState: vi.fn(() => null),
    getObservability: vi.fn(() => ({ sessionId: null })),
  })),
}));

vi.mock('../main.staging', () => ({
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
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

describe('plannerSession focus env contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    brokerStartSession.mockReturnValue({ sessionId: 'planner-101', created: true });
    collectFocusedRepoTargetDirectoryRoots.mockReturnValue([]);
    clearStagingArtifacts.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
  });

  it('serializes live Deep Focus metadata into broker focusEnv', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/stale',
      visibleRepoRoots: ['/repos/stale'],
      declaredRepoRoots: ['/repos/stale'],
      estateType: 'distributed-platform',
      primaryRepoId: 'stale',
      selectedRepoIds: ['stale'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    });
    resolveFocusedRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/platform',
      visibleRepoRoots: ['/repos/platform', '/repos/tools'],
      declaredRepoRoots: ['/repos/platform', '/repos/tools'],
      estateType: 'distributed-platform',
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
      authoritySource: 'manifest-primary',
    });

    const plannerSession = await import('../plannerSession');
    await plannerSession.startSession('/context-pack', {
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'libs/Acme.Models',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: 'libs/Acme.Models',
          kind: 'directory',
          repoId: 'platform',
          role: 'anchor',
          testTarget: { path: 'libs/Acme.Models.Tests', kind: 'directory' },
        },
        {
          path: 'Acme.Seed',
          kind: 'directory',
          repoId: 'tools',
          role: 'primary',
        },
      ],
      selectedTestTarget: null,
      selectedSupportTargets: [],
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    });

    expect(resolveSelectedPrimaryRepoRoot).not.toHaveBeenCalled();
    expect(brokerStartSession).toHaveBeenCalledWith(expect.objectContaining({
      contextPackDir: '/context-pack',
      focusEnv: expect.objectContaining({
        targetReposJson: JSON.stringify(['/repos/platform', '/repos/tools']),
        primaryFocusPath: 'libs/Acme.Models',
        primaryFocusTargetKind: 'directory',
        primaryFocusTargetsJson: JSON.stringify([
          {
            path: 'libs/Acme.Models',
            kind: 'directory',
            role: 'anchor',
            testTarget: { path: 'libs/Acme.Models.Tests', kind: 'directory' },
          },
          {
            path: 'Acme.Seed',
            kind: 'directory',
            role: 'primary',
          },
        ]),
        testTargetPath: 'libs/Acme.Models.Tests',
        testTargetKind: 'directory',
        contextPackPaths: '/context-pack',
        contextPackSearchRoots: '/context-pack',
      }),
    }));
  });

  it('serializes standard focused-repo metadata without Deep Focus primary target JSON', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repos/backend',
      visibleRepoRoots: ['/repos/backend'],
      declaredRepoRoots: ['/repos/backend'],
      estateType: 'distributed-platform',
      primaryRepoId: 'backend',
      primaryFocusRelativePath: 'services/api',
      primaryFocusTargetKind: 'directory',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      authoritySource: 'manifest-primary',
    });

    const plannerSession = await import('../plannerSession');
    await plannerSession.startSession('/context-pack');

    expect(brokerStartSession).toHaveBeenCalledWith(expect.objectContaining({
      focusEnv: expect.objectContaining({
        targetReposJson: JSON.stringify(['/repos/backend']),
        primaryFocusPath: 'services/api',
        primaryFocusTargetKind: 'directory',
      }),
    }));
    const [startOptions] = brokerStartSession.mock.calls[0] as unknown as [{
      focusEnv: { primaryFocusTargetsJson?: string };
    }];
    expect(startOptions.focusEnv.primaryFocusTargetsJson).toBeUndefined();
  });

  it('omits focusEnv when no focus selection resolves', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);

    const plannerSession = await import('../plannerSession');
    await plannerSession.startSession('/context-pack');

    expect(brokerStartSession).toHaveBeenCalledWith(expect.objectContaining({
      contextPackDir: '/context-pack',
      focusEnv: undefined,
    }));
  });
});
