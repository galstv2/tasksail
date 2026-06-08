// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannerFocusSnapshot } from '../../src/shared/desktopContract';

const initializeStagedPlanningDraft = vi.fn();
const clearStagingArtifacts = vi.fn();
const resolvePlannerLaunchExtensions = vi.fn();

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }));
vi.mock('./staging', () => ({ initializeStagedPlanningDraft, clearStagingArtifacts }));
vi.mock('../log/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));
// Override only the resolver so real backend staging (lock + disk) never runs in this unit test.
vi.mock('./launchExtensions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./launchExtensions')>()),
  resolvePlannerLaunchExtensions,
}));

const snapshot: PlannerFocusSnapshot = {
  version: 1,
  contextPackDir: '/packs/parent',
  contextPackId: 'parent',
  title: 'Parent task',
  primaryRepoId: 'parent-repo',
  primaryRepoRoot: '/repo/parent',
  primaryFocusRelativePath: 'src/parent',
  primaryFocusTargetKind: 'directory',
  primaryFocusTargets: [],
  selectedTestTarget: null,
  supportTargets: [],
  deepFocusEnabled: false,
  contextPackBinding: {
    contextPackDir: '/packs/parent',
    contextPackId: 'parent',
    scopeMode: 'repo-selection',
    primaryRepoId: 'parent-repo',
    selectedRepoIds: ['parent-repo'],
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

describe('plannerSession childTaskExecutionScope staging', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(101);
    clearStagingArtifacts.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    // Enabled extensions present: prove they never bleed into child execution scope or staging.
    resolvePlannerLaunchExtensions.mockResolvedValue({
      plannerSessionId: 'unused',
      launchExtensions: { pluginDirs: ['/stage/ext/plugins/p1'], skillDirs: ['/stage/ext/skills'] },
      availabilityNote: 'LILY-EXTENSION-NOTE',
      skillCount: 1,
      pluginCount: 1,
      extensionIds: ['p1'],
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('passes childTaskExecutionScope as the staged child context override', async () => {
    const { startSession } = await import('./session');
    await startSession('/packs/live', undefined, undefined, snapshot, lineage, {
      contextPackDir: '/packs/child',
      contextPackId: 'child',
      scopeMode: 'focus-selection',
      selectedRepoIds: [],
      selectedFocusIds: ['checkout'],
      repositoryTypes: { checkout: 'support' },
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: 'checkout',
      selectedFocusPath: 'apps/checkout',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    });

    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      contextPackBinding: snapshot.contextPackBinding,
      childTaskExecutionScope: expect.objectContaining({
        contextPackDir: '/packs/child',
        selectedFocusIds: ['checkout'],
        deepFocusPrimaryFocusId: 'checkout',
      }),
    }));
    expect(initializeStagedPlanningDraft.mock.calls[0]?.[0].childTaskExecutionScope)
      .not.toHaveProperty('repositoryTypes');
    // Lily extensions never enter the staged child execution scope, focus, or sidecar.
    const stagedPayload = JSON.stringify(initializeStagedPlanningDraft.mock.calls);
    expect(stagedPayload).not.toContain('/stage/ext');
    expect(stagedPayload).not.toContain('LILY-EXTENSION-NOTE');
  });

  it('derives standard child execution primary authority from independent repository types', async () => {
    const { startSession } = await import('./session');
    await startSession('/packs/live', undefined, undefined, snapshot, lineage, {
      contextPackDir: '/packs/parent',
      contextPackId: 'parent',
      scopeMode: 'repo-selection',
      selectedRepoIds: ['tools', 'platform'],
      selectedFocusIds: [],
      repositoryTypes: { tools: 'support', platform: 'primary' },
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    });

    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      childTaskExecutionScope: expect.objectContaining({
        primaryRepoId: 'platform',
        selectedRepoIds: ['tools', 'platform'],
      }),
    }));
  });

  it('omits childTaskExecutionScope when no override is supplied', async () => {
    const { startSession } = await import('./session');
    await startSession('/packs/live', undefined, undefined, snapshot, lineage);

    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.not.objectContaining({
      childTaskExecutionScope: expect.anything(),
    }));
  });

  it('preserves multi-primary standard role authority and keeps scalar primary as anchor', async () => {
    const { startSession } = await import('./session');
    await startSession('/packs/live', undefined, undefined, snapshot, lineage, {
      contextPackDir: '/packs/child',
      contextPackId: 'child',
      scopeMode: 'repo-selection',
      selectedRepoIds: ['platform', 'tools', 'docs'],
      selectedFocusIds: [],
      repositoryTypes: { platform: 'primary', tools: 'primary', docs: 'support' },
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    });

    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      childTaskExecutionScope: expect.objectContaining({
        primaryRepoId: 'platform',
        selectedRepoIds: ['platform', 'tools', 'docs'],
        repositoryTypes: { platform: 'primary', tools: 'primary', docs: 'support' },
      }),
    }));
  });
});
