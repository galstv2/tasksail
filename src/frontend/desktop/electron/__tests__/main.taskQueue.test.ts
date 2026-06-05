import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../main.stream', () => ({
  emitStreamEvent: vi.fn(),
  withStreamEvent: vi.fn(async (p: Promise<unknown>) => p),
}));

vi.mock('../plannerSession', () => ({
  getObservability: vi.fn(() => ({ sessionId: null })),
  getSessionState: vi.fn(() => null),
}));

vi.mock('../main.staging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../main.staging')>();
  return { ...actual, readOwnedStagedDraft: vi.fn(), readPlannerStagingSidecar: vi.fn(async () => null), readStagedDraft: vi.fn() };
});

vi.mock('../main.desktopActionHandlers', () => ({
  createDefaultDesktopActionHandlers: vi.fn(() => ({
    getPlannerSessionState: vi.fn(() => null),
    endPlannerSession: vi.fn(async () => ({ ended: true })),
    listContextPacks: vi.fn(async () => ({ ok: true, response: { action: 'contextPack.list', contextPacks: [] } })),
    submitDraft: vi.fn(), startPlannerSession: vi.fn(), updatePlannerSessionPersonality: vi.fn(),
    validateChildTaskFocus: vi.fn(), sendPlannerMessage: vi.fn(), savePlannerDraft: vi.fn(),
    readQueueStatus: vi.fn(), deletePendingItem: vi.fn(), readEnvironmentStatus: vi.fn(),
    readObservability: vi.fn(), pickContextPackDirectory: vi.fn(), discoverContextPackPrefill: vi.fn(),
    createContextPack: vi.fn(), listRepoTree: vi.fn(), reseedContextPack: vi.fn(),
    submitFollowUp: vi.fn(), previewContextPackSwitch: vi.fn(), applyContextPackSwitch: vi.fn(),
    clearActiveContextPack: vi.fn(), deleteContextPack: vi.fn(), pickMarkdownFile: vi.fn(),
    listArchivedTasks: vi.fn(), readParentContextBundle: vi.fn(), readParentChainArchiveBundle: vi.fn(),
    readParentArchiveMarkdown: vi.fn(), listConversationHistory: vi.fn(), hydrateConversation: vi.fn(),
    submitReinforcementFeedback: vi.fn(), updateRealignmentDoc: vi.fn(), readReinforcementOverview: vi.fn(),
    listReinforcementTasks: vi.fn(), readAgentRewards: vi.fn(), listRealignmentSessions: vi.fn(),
    readRealignmentDoc: vi.fn(), checkActiveWorkGuard: vi.fn(), startRealignment: vi.fn(),
    runRealignmentAnalysis: vi.fn(), dismissRealignment: vi.fn(), activateContextPack: vi.fn(),
    setRepositoryType: vi.fn(), setRepoCategory: vi.fn(), listExternalMcpServers: vi.fn(),
    addExternalMcpServer: vi.fn(), updateExternalMcpServer: vi.fn(), removeExternalMcpServer: vi.fn(),
    toggleExternalMcpServer: vi.fn(), validateExternalMcpConnection: vi.fn(),
    validateExternalMcpLocalCommand: vi.fn(), readSystemSettings: vi.fn(), saveSystemSettings: vi.fn(),
    restartApp: vi.fn(), loadAgentConfigAgents: vi.fn(), loadAgentModelCatalog: vi.fn(),
    loadAgentConfigCapabilities: vi.fn(), saveAgentModels: vi.fn(), addAgentModel: vi.fn(),
    removeAgentModel: vi.fn(), listAgentExtensions: vi.fn(), addAgentExtension: vi.fn(),
    reseedAgentExtension: vi.fn(), deleteAgentExtension: vi.fn(), loadAgentExtensionAssignments: vi.fn(),
    saveAgentExtensionAssignments: vi.fn(), loadExternalMcpAssignments: vi.fn(),
    saveExternalMcpAssignments: vi.fn(), listInstructionFiles: vi.fn(), readInstructionFile: vi.fn(),
    writeInstructionFile: vi.fn(), readTaskBoard: vi.fn(), readTaskNotifications: vi.fn(),
    markTaskNotificationsSeen: vi.fn(), dismissTaskNotification: vi.fn(),
    dismissAllTaskNotifications: vi.fn(), readTaskContent: vi.fn(),
    readChildChainBranchInventory: vi.fn(), reorderPending: vi.fn(), requeueErrorItem: vi.fn(),
    deleteTask: vi.fn(), moveToPending: vi.fn(), moveToOpen: vi.fn(),
    killTask: vi.fn(), retryKillCleanup: vi.fn(), saveDeepFocusSelections: vi.fn(),
    loadDeepFocusSelections: vi.fn(), clearDeepFocusSelections: vi.fn(),
    listFocusFilters: vi.fn(), createFocusFilter: vi.fn(), deleteFocusFilter: vi.fn(),
    loadContextPackSidebarState: vi.fn(), saveContextPackSidebarState: vi.fn(),
    setTerminalTaskScope: vi.fn(), uploadSpec: vi.fn(), cancelTask: vi.fn(),
  })),
}));

vi.mock('../log/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../main.contextPackTaskVisibility', () => ({
  refreshCurrentActiveContextPackTaskScope: vi.fn(async () => undefined),
}));

vi.mock('../main.terminalScopeRefresh', () => ({
  refreshTerminalScopeCaches: vi.fn(async () => undefined),
}));

vi.mock('../main.services', () => ({
  startBackendServices: vi.fn(),
  stopBackendServices: vi.fn(),
  checkBackendHealth: vi.fn(),
  readBackendServiceStatus: vi.fn(() => ({})),
}));

vi.mock('../plannerFocusValidation', () => ({
  PLANNER_FOCUS_FALLBACK_MESSAGE: 'fallback',
  PLANNER_FOCUS_VALID_MESSAGE: 'valid',
  validateChildTaskFocusSnapshot: vi.fn(),
}));

vi.mock('../plannerHistory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plannerHistory')>();
  return { ...actual, commitPendingRecordToHistory: vi.fn(async () => undefined) };
});

vi.mock('../main.plannerTitle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../main.plannerTitle')>();
  return { ...actual, resolvePlannerTaskTitleFromDraft: vi.fn(() => 'test_task_title') };
});

vi.mock('../main.markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../main.markdown')>();
  // Override only the two router-called validators (not parsePlannerEditableDraft or
  // canonicalizeEditableDraftRequirements, which must remain real for existing taskQueue tests).
  return {
    ...actual,
    validatePlannerProtectedMetadata: vi.fn(() => null),
    validatePlanningIntakeDraft: vi.fn(() => null),
  };
});

vi.mock('../main.contextPackCatalog', () => ({
  listAvailableContextPacks: vi.fn(),
  readWorkspaceSyncStateSnapshot: vi.fn(),
}));

vi.mock('../main.childTaskChain', () => ({
  resolveChildTaskChainCreationContext: vi.fn(),
}));

vi.mock('../../../../backend/platform/context-pack/focusedRepo.js', () => ({
  readDeepFocusOverlay: vi.fn(async () => undefined),
  resolveFocusedRepoRoot: vi.fn(),
  resolveSelectedPrimaryRepoRoot: vi.fn(),
}));

vi.mock('../../../../backend/platform/queue/createDropboxTask.js', () => ({
  createDropboxTask: vi.fn(),
}));

vi.mock('../../../../backend/platform/queue/createFollowupTask.js', () => ({
  createFollowupTask: vi.fn(),
}));

vi.mock('../../../../backend/platform/queue/publishPendingItem.js', () => ({
  publishPendingItem: vi.fn(async ({ publish }: { publish: () => Promise<string> }) => {
    const destinationPath = await publish();
    return { destinationPath, activation: { activated: true as const } };
  }),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: vi.fn(),
    readFile: vi.fn(),
  };
});

vi.mock('../../../../backend/platform/queue/dirLock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../backend/platform/queue/dirLock.js')>();
  return { ...actual, withDirLock: vi.fn(actual.withDirLock) };
});

const { readWorkspaceSyncStateSnapshot } = await import('../main.contextPackCatalog');
const { resolveChildTaskChainCreationContext } = await import('../main.childTaskChain');
const { resolveFocusedRepoRoot, resolveSelectedPrimaryRepoRoot } = await import('../../../../backend/platform/context-pack/focusedRepo.js');
const { createDropboxTask } = await import('../../../../backend/platform/queue/createDropboxTask.js');
const { createFollowupTask } = await import('../../../../backend/platform/queue/createFollowupTask.js');
const { publishPendingItem } = await import('../../../../backend/platform/queue/publishPendingItem.js');
const { readdir, readFile } = await import('node:fs/promises');
const { withDirLock } = await import('../../../../backend/platform/queue/dirLock.js');
const {
  runDropboxTaskScript,
  runFollowUpTaskScript,
  readBypassTemplate,
  submitUploadedSpecHelper,
  submitDraftViaDropboxHelper,
  submitFollowUpViaHelper,
  validatePlannerDraftForSubmission,
  validateFollowUpDraftForSubmission,
} = await import('../main.taskQueue');
const { handleDesktopAction } = await import('../main.desktopActionRouter');
const { readOwnedStagedDraft } = await import('../main.staging');

function buildUploadedSpec(extraSections = ''): string {
  return `
## Request Summary

Queue a completed bypass spec through the same dropbox intake boundary used by planner finalization.

## Desired Outcome

The uploaded spec is written to AgentWorkSpace/dropbox with platform-owned metadata.

## Constraints

- Preserve immutable planner scope.

## Acceptance Signals

- The task appears in dropbox.

${extraSections}
## Suggested Routing

- Recommended Execution: sequential
- Planner Notes: Operator supplied the planning intake directly.
`;
}

function buildPlannerSidecar(overrides: Record<string, unknown> = {}) {
  const sidecar = {
    version: 1 as const,
    ownership: 'planner-session' as const,
    sessionId: 'planner-active',
    draftFilename: 'draft.md',
    draftPath: '/repo/AgentWorkSpace/dropbox/.staging/draft.md',
    createdAt: '2026-03-07T18:20:00Z',
    title: 'immutable-pack / immutable-focus',
    primaryRepoId: 'immutable-repo',
    primaryRepoRoot: '/immutable/repo',
    primaryFocusRelativePath: 'immutable/focus',
    deepFocusEnabled: true,
    primaryFocusTargetKind: 'directory' as const,
    primaryFocusTargets: [
      {
        path: 'immutable/focus',
        kind: 'directory' as const,
        role: 'anchor' as const,
        repoId: 'immutable-repo',
        repoLocalPath: '/immutable/repo',
      },
    ],
    selectedTestTarget: { path: 'immutable/tests', kind: 'directory' as const },
    supportTargets: [{ path: 'immutable/docs.md', kind: 'file' as const, effectiveScope: 'full-directory' as const }],
    lineage: {
      taskKind: 'standard' as const,
      parentTaskId: '',
      rootTaskId: '',
      parentQmdRecordId: '',
      parentQmdScope: '',
      followUpReason: '',
    },
      contextPackBinding: {
        contextPackDir: '/immutable/context-pack',
        contextPackId: 'immutable-pack',
        scopeMode: 'focus-selection',
        primaryRepoId: 'immutable-repo',
        primaryFocusId: 'immutable-focus',
        selectedRepoIds: ['immutable-repo'],
        selectedFocusIds: ['immutable-focus'],
      deepFocusEnabled: true,
      selectedFocusPath: 'immutable/focus',
      selectedFocusTargetKind: 'directory' as const,
      selectedFocusTargets: [
        {
          path: 'immutable/focus',
          kind: 'directory' as const,
          role: 'anchor' as const,
          repoId: 'immutable-repo',
          repoLocalPath: '/immutable/repo',
        },
      ],
      selectedTestTarget: { path: 'immutable/tests', kind: 'directory' as const },
      selectedSupportTargets: [{ path: 'immutable/docs.md', kind: 'file' as const, effectiveScope: 'full-directory' as const }],
    },
  };
  return {
    ...sidecar,
    ...overrides,
    lineage: {
      ...sidecar.lineage,
      ...((overrides.lineage as Record<string, unknown> | undefined) ?? {}),
    },
    contextPackBinding: {
      ...sidecar.contextPackBinding,
      ...((overrides.contextPackBinding as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

function mockResolvedChildTaskChainContext(
  parentTaskId = 'PARENT-123',
  rootTaskId = 'ROOT-001',
  parentSummary = `Completed-work summary for ${parentTaskId}.`,
) {
  const childExecutionScope = {
    contextPackDir: '/context-packs/sample-pack',
    contextPackId: 'sample-pack-id',
    scopeMode: 'focus-selection',
    primaryRepoId: 'immutable-repo',
    primaryFocusId: 'immutable-focus',
    selectedRepoIds: ['immutable-repo'],
    selectedFocusIds: ['immutable-focus'],
    deepFocusEnabled: true,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: 'immutable/focus',
    selectedFocusTargetKind: 'directory' as const,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  };
  vi.mocked(resolveChildTaskChainCreationContext).mockResolvedValue({
    branchChain: {
      schemaVersion: 1,
      mode: 'continuation',
      rootTaskId,
      parentTaskId,
      depth: 1,
      repos: [],
    },
    parentContextSnapshot: null,
    childExecutionScope,
    parentArchivePath: '/archive/parent.md',
    parentArchiveArtifactDir: null,
    previousTaskId: parentTaskId,
    rootTaskId,
    depth: 1,
    parentSummary,
  });
}

describe('main.taskQueue direct submission hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readWorkspaceSyncStateSnapshot).mockResolvedValue({
      activeContextPackDir: '/context-packs/sample-pack',
      activeContextPackId: 'sample-pack-id',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedTestTarget: null,
      selectedSupportTargets: [],
      managedFolders: [],
      status: 'active',
      lastSyncedAt: '2026-03-07T18:30:00Z',
      workspaceFolderCount: null,
      workspaceFileCount: null,
    });
    vi.mocked(resolveSelectedPrimaryRepoRoot).mockResolvedValue({
      primaryRepoRoot: '/repos/backend',
      visibleRepoRoots: ['/repos/backend'],
      declaredRepoRoots: ['/repos/backend'],
      estateType: 'monolith',
      primaryRepoId: 'backend',
      primaryFocusId: 'api',
      primaryFocusRelativePath: 'apps/api',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      authoritySource: 'workspace-sync-state',
    });
    vi.mocked(resolveFocusedRepoRoot).mockResolvedValue(undefined);
    mockResolvedChildTaskChainContext();
  });

  it('derives the canonical direct-submission title from the active context pack instead of trusting the renderer title', async () => {
    vi.mocked(readWorkspaceSyncStateSnapshot).mockResolvedValue({
      activeContextPackDir: '/context-packs/sample-pack',
      activeContextPackId: 'sample-pack-id',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      managedFolders: [],
      status: 'active',
      lastSyncedAt: '2026-03-07T18:30:00Z',
      workspaceFolderCount: null,
      workspaceFileCount: null,
    });
    vi.mocked(createDropboxTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_backend-apps-api.md',
    );

    const result = await runDropboxTaskScript({
      summary: 'Queue a task from the direct submission seam.',
      desiredOutcome: 'The task lands in dropbox with platform-owned metadata.',
      constraints: 'Keep metadata authority in the platform.',
      criticalRequirements: 'None',
      compatibilityRequirements: 'None',
      requiredValidation: 'None',
      acceptanceSignals: '- Task file exists',
      suggestedPath: 'sequential',
      planningNotes: 'Ignore any renderer-authored title value.',
      kind: 'standard',
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'backend / apps/api',
      contextPackDir: '/context-packs/sample-pack',
      contextPackId: 'sample-pack-id',
      scopeMode: 'focus-selection',
      primaryFocusId: 'api',
      selectedRepoIds: [],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    }));
    expect(result).toEqual({
      filePath: '/repo/AgentWorkSpace/dropbox/20260307T183000Z_backend-apps-api.md',
      title: 'backend / apps/api',
    });
  });

  it('derives direct follow-up lineage from the active context-pack archive before creating the child task', async () => {
    vi.mocked(readWorkspaceSyncStateSnapshot).mockResolvedValue({
      activeContextPackDir: '/context-packs/sample-pack',
      activeContextPackId: 'sample-pack-id',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      managedFolders: [],
      status: 'active',
      lastSyncedAt: '2026-03-07T18:30:00Z',
      workspaceFolderCount: null,
      workspaceFileCount: null,
    });
    vi.mocked(createFollowupTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183500Z_backend-apps-api.md',
    );
    const archiveReader = {
      readdir: vi.fn(async (_targetPath, options) => {
        if (options && typeof options === 'object' && 'withFileTypes' in options && options.withFileTypes) {
          if (String(_targetPath).endsWith('/archive/tasks')) {
            return [{ name: '2026', isDirectory: () => true, isFile: () => false }] as unknown as Awaited<ReturnType<typeof readdir>>;
          }
          return [{ name: 'parent-task', isDirectory: () => true, isFile: () => false }] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof readdir>>;
      }),
      readFile: vi.fn(async (targetPath) => {
        const normalizedPath = String(targetPath);
        if (normalizedPath.endsWith('/AgentWorkSpace/qmd/context-packs/sample-pack/archive/tasks/2026/parent-task/archive.json')) {
          return JSON.stringify({
            task_id: 'PARENT-123',
            record_id: 'qmd://implementation-summary/PARENT-123/final',
            root_task_id: 'ROOT-001',
          });
        }
        throw new Error(`Unexpected readFile path: ${normalizedPath}`);
      }),
    };

    const result = await runFollowUpTaskScript({
      summary: 'Carry completed findings into the next queue item.',
      desiredOutcome: 'The follow-up child task lands with platform-owned lineage.',
      constraints: 'Do not trust renderer-owned lineage fields.',
      criticalRequirements: 'None',
      compatibilityRequirements: 'None',
      requiredValidation: 'None',
      acceptanceSignals: '- Child task is queued',
      parentTaskId: 'PARENT-123',
      followupReason: 'Continue the next slice from completed findings.',
      carryForwardSummary: 'Preserve the validated audit-trail constraints.',
      suggestedPath: 'parallel',
      planningNotes: 'Keep the parent closed.',
    }, archiveReader);

    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'backend / apps/api',
      parentTaskId: 'PARENT-123',
      parentQmdScope: 'qmd/context-packs/sample-pack',
      parentQmdRecordId: 'qmd://implementation-summary/PARENT-123/final',
      rootTaskId: 'ROOT-001',
      followupReason: 'Continue the next slice from completed findings.',
      carryForwardSummary: 'Preserve the validated audit-trail constraints.',
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    }));
    expect(result).toEqual({
      filePath: '/repo/AgentWorkSpace/dropbox/20260307T183500Z_backend-apps-api.md',
      title: 'backend / apps/api',
      rootTaskId: 'ROOT-001',
    });
  });

  it('submits Bypass Lily uploads to dropbox without publishing directly to pendingitems', async () => {
    vi.mocked(createDropboxTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_backend-apps-api.md',
    );

    const result = await submitUploadedSpecHelper(`
## Request Summary

Queue a completed bypass spec through the same dropbox intake boundary used by planner finalization.

## Desired Outcome

The uploaded spec is written to AgentWorkSpace/dropbox and is not moved directly into pendingitems.

## Constraints

- Preserve the normal queue intake boundary.

## Acceptance Signals

- The task appears in dropbox.

## Suggested Routing

- Recommended Execution: sequential
- Planner Notes: Operator supplied the planning intake directly.
`);

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.uploadSpec',
        mode: 'submitted',
        submittedPath: '/repo/AgentWorkSpace/dropbox/20260307T183000Z_backend-apps-api.md',
      }),
    });
    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'boundary_dropbox_intake',
      repoRoot: expect.any(String),
      summary: 'Queue a completed bypass spec through the same dropbox intake boundary used by planner finalization.',
      desiredOutcome: 'The uploaded spec is written to AgentWorkSpace/dropbox and is not moved directly into pendingitems.',
      acceptanceSignals: '- The task appears in dropbox.',
    }));
    expect(publishPendingItem).not.toHaveBeenCalled();
  });

  it('submits child-task Bypass Lily uploads from immutable sidecar lineage and focus instead of live workspace state', async () => {
    vi.mocked(createFollowupTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_immutable-child.md',
    );
    const sidecar = buildPlannerSidecar({
      lineage: {
        taskKind: 'child-task' as const,
        parentTaskId: 'PARENT-123',
        rootTaskId: 'ROOT-001',
        parentQmdRecordId: 'qmd://implementation-summary/PARENT-123/final',
        parentQmdScope: 'qmd/context-packs/immutable-pack',
        followUpReason: 'Continue from the archived parent task.',
      },
    });

    const result = await submitUploadedSpecHelper(
      buildUploadedSpec(`
## Critical Requirements

Child upload prose must be preserved.

## Compatibility Requirements

- Child upload compatibility stays intact.

## Required Validation

Review child upload queue output.

## Parent Task Carry-Forward Summary

- Carry forward the immutable parent findings.

`),
      { plannerSidecar: sidecar },
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.uploadSpec',
        mode: 'submitted',
      }),
    });
    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'child_dropbox_planner',
      parentTaskId: 'PARENT-123',
      rootTaskId: 'ROOT-001',
      parentQmdRecordId: 'qmd://implementation-summary/PARENT-123/final',
      parentQmdScope: 'qmd/context-packs/immutable-pack',
      followupReason: 'Continue from the archived parent task.',
      carryForwardSummary: '- Carry forward the immutable parent findings.',
      contextPackDir: '/immutable/context-pack',
      contextPackId: 'immutable-pack',
      selectedRepoIds: ['immutable-repo'],
      selectedFocusIds: ['immutable-focus'],
      primaryRepoId: 'immutable-repo',
      primaryFocusId: 'immutable-focus',
      deepFocusEnabled: true,
      selectedFocusPath: 'immutable/focus',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: sidecar.primaryFocusTargets,
      selectedTestTarget: { path: 'immutable/tests', kind: 'directory' },
      selectedSupportTargets: [{ path: 'immutable/docs.md', kind: 'file', effectiveScope: 'full-directory' }],
      criticalRequirements: '- CR-001: Child upload prose must be preserved.',
      compatibilityRequirements: '- COMP-001: Child upload compatibility stays intact.',
      requiredValidation: '- VAL-001: Review child upload queue output.',
    }));
    expect(createDropboxTask).not.toHaveBeenCalled();
    expect(readWorkspaceSyncStateSnapshot).not.toHaveBeenCalled();
    expect(publishPendingItem).not.toHaveBeenCalled();
  });

  it('submits recent standard Bypass Lily uploads from immutable sidecar context binding instead of live workspace state', async () => {
    vi.mocked(createDropboxTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_recent-standard.md',
    );

    const result = await submitUploadedSpecHelper(
      buildUploadedSpec(),
      { plannerSidecar: buildPlannerSidecar({ sessionId: 'planner-replay' }) },
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.uploadSpec',
        draftTitle: 'dropbox_intake_planner',
        submittedPath: '/repo/AgentWorkSpace/dropbox/20260307T183000Z_recent-standard.md',
      }),
    });
    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'dropbox_intake_planner',
      kind: 'standard',
      contextPackDir: '/immutable/context-pack',
      contextPackId: 'immutable-pack',
      scopeMode: 'focus-selection',
      primaryRepoId: 'immutable-repo',
      primaryFocusId: 'immutable-focus',
      selectedRepoIds: ['immutable-repo'],
      selectedFocusIds: ['immutable-focus'],
      selectedFocusPath: 'immutable/focus',
    }));
    expect(createFollowupTask).not.toHaveBeenCalled();
    expect(readWorkspaceSyncStateSnapshot).not.toHaveBeenCalled();
    expect(publishPendingItem).not.toHaveBeenCalled();
  });

  it('returns Bypass Lily template editable sections without platform-owned Source', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(buildUploadedSpec(`
## Critical Requirements

## Compatibility Requirements

## Required Validation

`) as never);
    const template = await readBypassTemplate();

    expect(template).toContain('## Critical Requirements');
    expect(template).toContain('## Compatibility Requirements');
    expect(template).toContain('## Required Validation');
    expect(template).not.toContain('# Task Title');
    expect(template.indexOf('## Critical Requirements')).toBeLessThan(template.indexOf('## Compatibility Requirements'));
    expect(template.indexOf('## Compatibility Requirements')).toBeLessThan(template.indexOf('## Required Validation'));
    expect(template).not.toContain('## Source');
  });

  it('canonicalizes Bypass Lily requirement sections before queueing', async () => {
    vi.mocked(createDropboxTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_requirements.md',
    );

    await submitUploadedSpecHelper(
      buildUploadedSpec(`
## Critical Requirements

- CR-009: Preserve exact ordering.

## Compatibility Requirements

- Existing callers keep working.

## Required Validation

Validation should be reviewed manually.

`),
      { plannerSidecar: buildPlannerSidecar() },
    );

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      criticalRequirements: '- CR-001: Preserve exact ordering.',
      compatibilityRequirements: '- COMP-001: Existing callers keep working.',
      requiredValidation: '- VAL-001: Validation should be reviewed manually.',
    }));
  });

  it('submits Bypass Lily uploads with the same repo-selection binding shape as Lily staging', async () => {
    vi.mocked(readWorkspaceSyncStateSnapshot).mockResolvedValue({
      activeContextPackDir: '/context-packs/platform-pack',
      activeContextPackId: 'platform-pack',
      scopeMode: 'focused',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedTestTarget: null,
      selectedSupportTargets: [],
      managedFolders: [],
      status: 'active',
      lastSyncedAt: '2026-03-07T18:30:00Z',
      workspaceFolderCount: null,
      workspaceFileCount: null,
    });
    vi.mocked(resolveSelectedPrimaryRepoRoot).mockResolvedValue({
      primaryRepoRoot: '/repos/platform',
      visibleRepoRoots: ['/repos/platform', '/repos/tools'],
      declaredRepoRoots: ['/repos/platform', '/repos/tools'],
      estateType: 'distributed-platform',
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      authoritySource: 'workspace-sync-state',
    });
    vi.mocked(createDropboxTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_platform.md',
    );

    await submitUploadedSpecHelper(buildUploadedSpec());

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'dropbox_intake_planner',
      contextPackDir: '/context-packs/platform-pack',
      contextPackId: 'platform-pack',
      scopeMode: 'repo-selection',
      primaryRepoId: 'platform',
      primaryFocusId: undefined,
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    }));
  });

  it('routes recent child-task Bypass Lily uploads through createFollowupTask', async () => {
    vi.mocked(createFollowupTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_recent-child.md',
    );
    mockResolvedChildTaskChainContext('RECENT-PARENT', 'RECENT-ROOT');

    await submitUploadedSpecHelper(
      buildUploadedSpec(`
## Parent Task Carry-Forward Summary

- Continue the recent child task.

`),
      {
        plannerSidecar: buildPlannerSidecar({
          lineage: {
            taskKind: 'child-task' as const,
            parentTaskId: 'RECENT-PARENT',
            rootTaskId: 'RECENT-ROOT',
            parentQmdRecordId: 'qmd://recent-parent',
            parentQmdScope: 'qmd/context-packs/recent-pack',
            followUpReason: 'Replay child task planning context.',
          },
        }),
      },
    );

    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      parentTaskId: 'RECENT-PARENT',
      rootTaskId: 'RECENT-ROOT',
      parentQmdRecordId: 'qmd://recent-parent',
      parentQmdScope: 'qmd/context-packs/recent-pack',
      followupReason: 'Replay child task planning context.',
    }));
    expect(createDropboxTask).not.toHaveBeenCalled();
    expect(publishPendingItem).not.toHaveBeenCalled();
  });

  it('synthesizes the carry-forward summary from the parent archive when a child-task Bypass Lily upload omits it', async () => {
    vi.mocked(createFollowupTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_synthesized-child.md',
    );

    const result = await submitUploadedSpecHelper(
      buildUploadedSpec(),
      {
        plannerSidecar: buildPlannerSidecar({
          lineage: {
            taskKind: 'child-task' as const,
            parentTaskId: 'PARENT-123',
            rootTaskId: 'ROOT-001',
            parentQmdRecordId: 'qmd://parent',
            parentQmdScope: 'qmd/context-packs/immutable-pack',
            followUpReason: 'Continue from parent.',
          },
        }),
      },
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.uploadSpec',
        mode: 'submitted',
      }),
    });
    // No carry-forward section in the upload -> synthesized from the parent archive summary.
    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      parentTaskId: 'PARENT-123',
      carryForwardSummary: 'Completed-work summary for PARENT-123.',
    }));
    expect(createDropboxTask).not.toHaveBeenCalled();
    expect(publishPendingItem).not.toHaveBeenCalled();
  });

  it('falls back to a parent-id carry-forward when neither the upload nor the parent archive supplies one', async () => {
    vi.mocked(createFollowupTask).mockResolvedValue(
      '/repo/AgentWorkSpace/dropbox/20260307T183000Z_fallback-child.md',
    );
    mockResolvedChildTaskChainContext('PARENT-123', 'ROOT-001', '');

    const result = await submitUploadedSpecHelper(
      buildUploadedSpec(),
      {
        plannerSidecar: buildPlannerSidecar({
          lineage: {
            taskKind: 'child-task' as const,
            parentTaskId: 'PARENT-123',
            rootTaskId: 'ROOT-001',
            parentQmdRecordId: 'qmd://parent',
            parentQmdScope: 'qmd/context-packs/immutable-pack',
            followUpReason: 'Continue from parent.',
          },
        }),
      },
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({ action: 'planner.uploadSpec', mode: 'submitted' }),
    });
    expect(createFollowupTask).toHaveBeenCalledWith(expect.objectContaining({
      carryForwardSummary: 'Carry-forward from parent task PARENT-123.',
    }));
  });

  it('continues rejecting platform-owned sections and top-level uploaded headings', async () => {
    const sidecar = buildPlannerSidecar();

    await expect(submitUploadedSpecHelper(`${buildUploadedSpec()}
## Task Lineage

- Task Kind: standard
`, { plannerSidecar: sidecar })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('Task Lineage'),
    }));

    await expect(submitUploadedSpecHelper(`# Uploaded Title
${buildUploadedSpec()}`, { plannerSidecar: sidecar })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('top-level title'),
    }));

    expect(createDropboxTask).not.toHaveBeenCalled();
    expect(createFollowupTask).not.toHaveBeenCalled();
    expect(publishPendingItem).not.toHaveBeenCalled();
  });

  it('no longer requires renderer-owned titles or parent qmd scope during direct-submission validation', () => {
    expect(validatePlannerDraftForSubmission({
      title: '',
      taskKind: 'standard',
      summary: 'Queue from the renderer.',
      desiredOutcome: 'Platform derives title.',
      constraints: '',
      criticalRequirements: 'None',
      compatibilityRequirements: 'None',
      requiredValidation: 'None',
      acceptanceSignals: '',
      parentTaskId: '',
      parentQmdRecordId: '',
      parentQmdScope: '',
      rootTaskId: '',
      followupReason: '',
      carryForwardSummary: '',
      suggestedPath: 'sequential',
      planningNotes: '',
    })).toEqual([]);

    expect(validateFollowUpDraftForSubmission({
      title: '',
      taskKind: 'child-task',
      summary: 'Queue a child task.',
      desiredOutcome: '',
      constraints: '',
      criticalRequirements: 'None',
      compatibilityRequirements: 'None',
      requiredValidation: 'None',
      acceptanceSignals: '',
      parentTaskId: 'PARENT-123',
      parentQmdRecordId: '',
      parentQmdScope: '',
      rootTaskId: '',
      followupReason: 'Continue follow-up work.',
      carryForwardSummary: 'Carry forward validated context.',
      suggestedPath: 'sequential',
      planningNotes: '',
    })).toEqual([]);
  });

  it('canonicalizes prose requirements for direct planner submission', async () => {
    const runner = vi.fn(async () => ({
      filePath: '/repo/AgentWorkSpace/dropbox/20260307T183000Z_direct.md',
      title: 'direct-task',
    }));

    await expect(submitDraftViaDropboxHelper({
      title: '',
      taskKind: 'standard',
      summary: 'Queue from the renderer with prose requirement sections.',
      desiredOutcome: 'The direct submission preserves all requirement text.',
      constraints: '',
      criticalRequirements: 'Preserve the direct prose requirement.',
      compatibilityRequirements: '- Existing direct callers keep working.',
      requiredValidation: 'Run the direct submission focused test.',
      acceptanceSignals: '- Task is queued.',
      parentTaskId: '',
      parentQmdRecordId: '',
      parentQmdScope: '',
      rootTaskId: '',
      followupReason: '',
      carryForwardSummary: '',
      suggestedPath: 'sequential',
      planningNotes: '',
    }, runner)).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      criticalRequirements: '- CR-001: Preserve the direct prose requirement.',
      compatibilityRequirements: '- COMP-001: Existing direct callers keep working.',
      requiredValidation: '- VAL-001: Run the direct submission focused test.',
    }));
  });

  it('canonicalizes prose requirements for direct follow-up submission', async () => {
    const runner = vi.fn(async () => ({
      filePath: '/repo/AgentWorkSpace/dropbox/20260307T183000Z_followup.md',
      title: 'followup-task',
      rootTaskId: 'ROOT-001',
    }));

    await expect(submitFollowUpViaHelper({
      title: '',
      taskKind: 'child-task',
      summary: 'Queue a child task with prose requirement sections.',
      desiredOutcome: 'The follow-up submission preserves all requirement text.',
      constraints: '',
      criticalRequirements: 'Do not lose the follow-up critical requirement.',
      compatibilityRequirements: 'Keep parent archive behavior compatible.',
      requiredValidation: 'Verify the follow-up runner receives generated IDs.',
      acceptanceSignals: '- Child task is queued.',
      parentTaskId: 'PARENT-123',
      parentQmdRecordId: '',
      parentQmdScope: '',
      rootTaskId: 'ROOT-001',
      followupReason: 'Continue follow-up work.',
      carryForwardSummary: 'Carry forward validated context.',
      suggestedPath: 'sequential',
      planningNotes: '',
    }, runner)).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      criticalRequirements: '- CR-001: Do not lose the follow-up critical requirement.',
      compatibilityRequirements: '- COMP-001: Keep parent archive behavior compatible.',
      requiredValidation: '- VAL-001: Verify the follow-up runner receives generated IDs.',
    }));
  });
});

describe('submitUploadedSpec lock-acquisition gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readWorkspaceSyncStateSnapshot).mockResolvedValue({
      activeContextPackDir: '/context-packs/sample-pack',
      activeContextPackId: 'sample-pack-id',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedTestTarget: null,
      selectedSupportTargets: [],
      managedFolders: [],
      status: 'active',
      lastSyncedAt: '2026-03-07T18:30:00Z',
      workspaceFolderCount: null,
      workspaceFileCount: null,
    });
    vi.mocked(resolveSelectedPrimaryRepoRoot).mockResolvedValue({
      primaryRepoRoot: '/repos/backend',
      visibleRepoRoots: ['/repos/backend'],
      declaredRepoRoots: ['/repos/backend'],
      estateType: 'monolith',
      primaryRepoId: 'backend',
      primaryFocusId: 'api',
      primaryFocusRelativePath: 'apps/api',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      authoritySource: 'workspace-sync-state',
    });
    vi.mocked(resolveFocusedRepoRoot).mockResolvedValue(undefined);
    mockResolvedChildTaskChainContext();
  });

  it('submitUploadedSpecFromActiveWorkspace waits for withDirLock before creating the task', async () => {
    // Use a Promise barrier to block the lock callback until we release it.
    let resolveBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { resolveBarrier = resolve; });

    let createCalled = false;
    vi.mocked(withDirLock).mockImplementationOnce(async (_lockDir, _op, fn) => {
      // Simulate a held lock: the create callback only runs after the barrier resolves.
      await barrier;
      return fn();
    });
    vi.mocked(createDropboxTask).mockImplementation(async () => {
      createCalled = true;
      return '/repo/AgentWorkSpace/dropbox/locked-task.md';
    });

    const submissionPromise = submitUploadedSpecHelper(buildUploadedSpec());

    // Lock is still held — create must not have been called yet.
    expect(createCalled).toBe(false);

    // Release the barrier (simulate lock release).
    resolveBarrier();
    const result = await submissionPromise;

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(createCalled).toBe(true);
    expect(vi.mocked(withDirLock)).toHaveBeenCalledWith(
      expect.stringContaining('queue-lock'),
      'submitUploadedSpecFromActiveWorkspace',
      expect.any(Function),
    );
  });

  it('submitUploadedSpecFromSidecar waits for withDirLock before creating the child task', async () => {
    let resolveBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { resolveBarrier = resolve; });

    let createCalled = false;
    vi.mocked(withDirLock).mockImplementationOnce(async (_lockDir, _op, fn) => {
      await barrier;
      return fn();
    });
    vi.mocked(createDropboxTask).mockImplementation(async () => {
      createCalled = true;
      return '/repo/AgentWorkSpace/dropbox/sidecar-task.md';
    });

    const sidecar = buildPlannerSidecar();
    const submissionPromise = submitUploadedSpecHelper(buildUploadedSpec(), { plannerSidecar: sidecar });

    expect(createCalled).toBe(false);

    resolveBarrier();
    const result = await submissionPromise;

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(createCalled).toBe(true);
    expect(vi.mocked(withDirLock)).toHaveBeenCalledWith(
      expect.stringContaining('queue-lock'),
      'submitUploadedSpecFromSidecar',
      expect.any(Function),
    );
  });
});

describe('planner.finalizeSpec lock-acquisition gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Provide a valid standard staged draft so the router reaches the lock call.
    vi.mocked(readOwnedStagedDraft).mockResolvedValue({
      draft: {
        filename: 'draft.md',
        content: '## Request Summary\n\ntest',
        modifiedAt: '2026-01-01T00:00:00Z',
      },
      metadata: {
        version: 1 as const,
        ownership: 'planner-session' as const,
        sessionId: 'test-session',
        draftFilename: 'draft.md',
        draftPath: '/repo/AgentWorkSpace/dropbox/.staging/draft.md',
        createdAt: '2026-01-01T00:00:00Z',
        title: 'test-pack / test-focus',
        primaryRepoId: 'test-repo',
        primaryRepoRoot: '/test/repo',
        primaryFocusRelativePath: 'src',
        deepFocusEnabled: false,
        primaryFocusTargetKind: 'directory' as const,
        primaryFocusTargets: [],
        selectedTestTarget: null,
        supportTargets: [],
        lineage: {
          taskKind: 'standard' as const,
          parentTaskId: '',
          rootTaskId: '',
          parentQmdRecordId: '',
          parentQmdScope: '',
          followUpReason: '',
        },
        contextPackBinding: {
          contextPackDir: '/test/context-pack',
          contextPackId: 'test-pack',
          scopeMode: 'focus-selection',
          primaryRepoId: 'test-repo',
          primaryFocusId: 'test-focus',
          selectedRepoIds: ['test-repo'],
          selectedFocusIds: ['test-focus'],
          deepFocusEnabled: false,
          selectedFocusPath: 'src',
          selectedFocusTargetKind: 'directory' as const,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      },
      error: null,
    });
  });

  it('planner.finalizeSpec waits for withDirLock before creating the dropbox task', async () => {
    // Promise barrier: the lock callback blocks until the barrier resolves.
    let resolveBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { resolveBarrier = resolve; });

    let createCalled = false;
    vi.mocked(withDirLock).mockImplementationOnce(async (_lockDir, _op, fn) => {
      // Lock is held — fn() (which calls createDropboxTask) only runs after barrier.
      await barrier;
      return fn();
    });
    vi.mocked(createDropboxTask).mockImplementation(async () => {
      createCalled = true;
      return '/repo/AgentWorkSpace/dropbox/finalized-task.md';
    });

    const finalizationPromise = handleDesktopAction({
      action: 'planner.finalizeSpec',
      payload: {},
    });

    // Lock is still held — createDropboxTask must not have been called yet.
    expect(createCalled).toBe(false);

    // Release the barrier (simulate lock release).
    resolveBarrier();
    const result = await finalizationPromise;

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(createCalled).toBe(true);
    expect(vi.mocked(withDirLock)).toHaveBeenCalledWith(
      expect.stringContaining('queue-lock'),
      'planner.finalizeSpec',
      expect.any(Function),
    );
  });
});
