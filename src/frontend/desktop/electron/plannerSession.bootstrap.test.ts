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

let actualCollectFocusedRepoTargetDirectoryRoots:
  typeof import('../../../backend/platform/context-pack/focusedRepo.js')['collectFocusedRepoTargetDirectoryRoots'];

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('./main.staging', () => ({
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
}));

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

describe('plannerSession staging bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // restoreMocks: true wipes mockImplementation between tests; re-apply.
    collectFocusedRepoTargetDirectoryRoots.mockImplementation(
      actualCollectFocusedRepoTargetDirectoryRoots,
    );
    vi.spyOn(Date, 'now').mockReturnValue(101);
  });

  it('initializes staging once for a newly created session', async () => {
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

    expect(result).toEqual({ sessionId: 'planner-101', created: true });
    expect(clearStagingArtifacts).toHaveBeenCalledWith({ force: true });
    expect(initializeStagedPlanningDraft).toHaveBeenCalledWith({
      sessionId: 'planner-101',
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

  it('does not reinitialize staging when the session is reused', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
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
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    resolveFocusedRepoRoot.mockResolvedValue(undefined);
    initializeStagedPlanningDraft.mockResolvedValue(undefined);
    clearStagingArtifacts.mockResolvedValue(undefined);

    const plannerSession = await import('./plannerSession');
    await plannerSession.startSession('/contextpacks/test');

    await plannerSession.endSession();

    expect(clearStagingArtifacts).toHaveBeenNthCalledWith(1, { force: true });
    expect(clearStagingArtifacts).toHaveBeenNthCalledWith(2, { sessionId: 'planner-101' });
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
        sessionId: 'planner-101',
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
      sessionId: 'planner-101',
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
        sessionId: 'planner-101',
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
