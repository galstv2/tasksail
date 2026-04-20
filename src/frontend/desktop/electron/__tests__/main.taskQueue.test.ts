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
const { readdir } = await import('node:fs/promises');
const {
  runDropboxTaskScript,
  runFollowUpTaskScript,
  validatePlannerDraftForSubmission,
  validateFollowUpDraftForSubmission,
} = await import('../main.taskQueue');

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
      attachedManagedFolders: [],
      missingManagedFolders: [],
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
      attachedManagedFolders: [],
      missingManagedFolders: [],
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
      acceptanceSignals: '- Task file exists',
      suggestedPath: 'sequential',
      planningNotes: 'Ignore any renderer-authored title value.',
      kind: 'standard',
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'backend / apps/api',
      contextPackDir: '/context-packs/sample-pack',
      contextPackId: 'sample-pack-id',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
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
      attachedManagedFolders: [],
      missingManagedFolders: [],
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
          return [{ name: '2026', isDirectory: () => true }] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        return ['parent-task.md'] as unknown as Awaited<ReturnType<typeof readdir>>;
      }),
      readFile: vi.fn(async (targetPath) => {
        const normalizedPath = String(targetPath);
        if (normalizedPath.endsWith('/AgentWorkSpace/qmd/context-packs/sample-pack/archive/tasks/2026/parent-task.json')) {
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

  it('no longer requires renderer-owned titles or parent qmd scope during direct-submission validation', () => {
    expect(validatePlannerDraftForSubmission({
      title: '',
      taskKind: 'standard',
      summary: 'Queue from the renderer.',
      desiredOutcome: 'Platform derives title.',
      constraints: '',
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
});
