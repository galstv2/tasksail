import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../main.stream', () => ({
  emitStreamEvent: vi.fn(),
}));

vi.mock('../main.contextPackCatalog', () => ({
  readWorkspaceSyncStateSnapshot: vi.fn(),
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

const { readWorkspaceSyncStateSnapshot } = await import('../main.contextPackCatalog');
const { resolveFocusedRepoRoot, resolveSelectedPrimaryRepoRoot } = await import('../../../../backend/platform/context-pack/focusedRepo.js');
const { createDropboxTask } = await import('../../../../backend/platform/queue/createDropboxTask.js');
const { createFollowupTask } = await import('../../../../backend/platform/queue/createFollowupTask.js');
const { publishPendingItem } = await import('../../../../backend/platform/queue/publishPendingItem.js');
const { readdir, readFile } = await import('node:fs/promises');
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

    expect(result.ok).toBe(true);
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

  it('rejects child-task Bypass Lily uploads without a carry-forward summary before writing a dropbox file', async () => {
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
      ok: false,
      action: 'planner.uploadSpec',
      error: 'Child-task staged draft is missing Parent Task Carry-Forward Summary content. Ask Lily to complete the intake before finalizing.',
    });
    expect(createDropboxTask).not.toHaveBeenCalled();
    expect(createFollowupTask).not.toHaveBeenCalled();
    expect(publishPendingItem).not.toHaveBeenCalled();
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
