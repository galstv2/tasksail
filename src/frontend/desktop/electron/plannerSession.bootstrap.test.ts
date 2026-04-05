// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const initializeStagedPlanningDraft = vi.fn();
const clearStagingArtifacts = vi.fn();
const resolveFocusedRepoRoot = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('./main.staging', () => ({
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
}));

vi.mock('../../../backend/platform/context-pack/focusedRepo.js', () => ({
  resolveFocusedRepoRoot,
}));

describe('plannerSession staging bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(101);
  });

  it('initializes staging once for a newly created session', async () => {
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

    expect(result).toEqual({ sessionId: 'planner-101', created: true });
    expect(clearStagingArtifacts).toHaveBeenCalledWith({ force: true });
    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith({
      sessionId: 'planner-101',
      contextPackDir: '/contextpacks/orders',
      focusedRepo: {
        primaryRepoId: 'backend',
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'apps/api',
        selectedRepoIds: ['backend'],
        selectedFocusIds: ['api'],
      },
    });
  });

  it('does not reinitialize staging when the session is reused', async () => {
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const plannerSession = await import('./plannerSession');
    await expect(plannerSession.startSession('/contextpacks/test')).resolves.toEqual({ sessionId: 'planner-101', created: true });
    await expect(plannerSession.startSession('/contextpacks/test')).resolves.toEqual({ sessionId: 'planner-101', created: false });

    expect(initializeStagedPlanningDraft).toHaveBeenCalledTimes(1);
    expect(clearStagingArtifacts).toHaveBeenCalledTimes(1);
  });

  it('cleans up owned staging when the planner session ends', async () => {
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');

    await plannerSession.endSession();

    expect(clearStagingArtifacts).toHaveBeenNthCalledWith(1, { force: true });
    expect(clearStagingArtifacts).toHaveBeenNthCalledWith(2, { sessionId: 'planner-101' });
  });
});
