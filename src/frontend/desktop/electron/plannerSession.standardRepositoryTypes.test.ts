// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannerFocusSnapshot } from '../src/shared/desktopContract';

const initializeStagedPlanningDraft = vi.fn();
const clearStagingArtifacts = vi.fn();

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }));
vi.mock('./main.staging', () => ({ initializeStagedPlanningDraft, clearStagingArtifacts }));
vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));

const snapshot: PlannerFocusSnapshot = {
  version: 1,
  contextPackDir: '/packs/parent',
  contextPackId: 'parent',
  title: 'Parent task',
  primaryRepoId: 'parent-repo',
  primaryRepoRoot: '/repo/parent',
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

describe('plannerSession standard repositoryTypes staging', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(101);
    clearStagingArtifacts.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
  });

  it('preserves multi-primary standard role authority and keeps scalar primary as anchor', async () => {
    const { startSession } = await import('./plannerSession');
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
