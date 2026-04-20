// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadURL = vi.fn(async () => undefined);
const loadFile = vi.fn(async () => undefined);
const show = vi.fn();
const once = vi.fn((event: string, callback: () => void) => {
  if (event === 'ready-to-show') {
    callback();
  }
});

const browserWindowInstance = {
  loadFile,
  loadURL,
  once,
  show,
};

const BrowserWindowMock = vi.fn(() => browserWindowInstance) as unknown as {
  (): typeof browserWindowInstance;
  getAllWindows: ReturnType<typeof vi.fn>;
};
BrowserWindowMock.getAllWindows = vi.fn(() => []);

const appMock = {
  on: vi.fn(),
  quit: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
};

const dialogMock = {
  showOpenDialog: vi.fn(),
};

const ipcMainMock = {
  handle: vi.fn(),
};

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: BrowserWindowMock,
  dialog: dialogMock,
  ipcMain: ipcMainMock,
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

function buildPlannerStagingMetadata(overrides: {
  sessionId?: string;
  draftFilename?: string;
  title?: string;
  taskKind?: 'standard' | 'child-task';
  parentTaskId?: string;
  rootTaskId?: string;
  parentQmdRecordId?: string;
  parentQmdScope?: string;
  followUpReason?: string;
  createdAt?: string;
  deepFocusEnabled?: boolean;
  primaryFocusRelativePath?: string | null;
  primaryFocusTargetKind?: 'directory' | 'file' | null;
  selectedTestTarget?: { path: string; kind: 'directory' | 'file' } | null;
  supportTargets?: Array<{ path: string; kind: 'directory' | 'file'; effectiveScope?: string }>;
} = {}) {
  const draftFilename = overrides.draftFilename ?? '20260321T040000Z_backend-apps-api.md';
  return {
    version: 1 as const,
    ownership: 'planner-session' as const,
    sessionId: overrides.sessionId ?? 'planner-101',
    draftFilename,
    draftPath: `/repo/AgentWorkSpace/dropbox/.staging/${draftFilename}`,
    createdAt: overrides.createdAt ?? '2026-03-21T04:00:00Z',
    title: overrides.title ?? 'backend / apps/api',
    primaryRepoId: 'backend',
    primaryRepoRoot: '/repo/backend',
    primaryFocusRelativePath: overrides.primaryFocusRelativePath ?? 'apps/api',
    deepFocusEnabled: overrides.deepFocusEnabled ?? false,
    primaryFocusTargetKind: overrides.primaryFocusTargetKind ?? null,
    selectedTestTarget: overrides.selectedTestTarget ?? null,
    supportTargets: overrides.supportTargets ?? [],
    lineage: {
      taskKind: overrides.taskKind ?? 'standard',
      parentTaskId: overrides.parentTaskId ?? '',
      rootTaskId: overrides.rootTaskId ?? '',
      parentQmdRecordId: overrides.parentQmdRecordId ?? '',
      parentQmdScope: overrides.parentQmdScope ?? '',
      followUpReason: overrides.followUpReason ?? '',
    },
    contextPackBinding: {
      contextPackDir: '/contextpacks/orders',
      contextPackId: 'orders',
      scopeMode: 'focus-selection',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: overrides.deepFocusEnabled ?? false,
      selectedFocusPath: overrides.primaryFocusRelativePath ?? 'apps/api',
      selectedFocusTargetKind: overrides.primaryFocusTargetKind ?? null,
      selectedTestTarget: overrides.selectedTestTarget ?? null,
      selectedSupportTargets: (overrides.supportTargets ?? []).map((target) => ({ ...target })),
    },
  };
}

function buildOwnedPlannerDraft(
  content: string,
  metadataOverrides: Parameters<typeof buildPlannerStagingMetadata>[0] = {},
) {
  const metadata = buildPlannerStagingMetadata(metadataOverrides);
  return {
    draft: {
      filename: metadata.draftFilename,
      content,
      modifiedAt: '2026-03-21T04:00:00.000Z',
    },
    error: null,
    metadata,
  };
}

describe('electron main — planner finalization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('node:fs/promises');
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    BrowserWindowMock.getAllWindows.mockReturnValue([]);
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/selected-directory'],
    });
  });

  it('blocks finalize while the broker is still running a planner turn', async () => {
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.finalizeSpec',
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'running' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Drafting...',
            exitCode: null,
            usage: null,
            error: null,
          })),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.finalizeSpec',
      error: 'Planner session is still running a turn. Wait for draft generation to finish before finalizing.',
    });
  });

  it('blocks finalize when the staged draft is missing required intake sections', async () => {
    vi.resetModules();
    vi.doMock('./main.staging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.staging')>();
      return {
        ...actual,
        clearStagingArtifacts: vi.fn(async () => undefined),
        readOwnedStagedDraft: vi.fn(async () => buildOwnedPlannerDraft(`# backend / apps/api

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Context Pack Binding

- Context Pack Dir: /contextpacks/orders
- Context Pack ID: orders
- Scope Mode: focus-selection
- Selected Repo IDs: backend
- Selected Focus IDs: api

## Request Summary

Too short.

## Desired Outcome

Ship a useful planning intake.

## Constraints

None

## Acceptance Signals

Not bullet shaped

## Parent Task Carry-Forward Summary


## Suggested Routing

- Recommended Execution: sequential
- Planner Notes:

## Source

- Created By: Planning Agent
- Created At (UTC): 2026-03-21T04:00:00Z
`)),
      };
    });
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.finalizeSpec',
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Draft ready.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
          endPlannerSession: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.finalizeSpec',
      error: 'Staged draft Request Summary is too short. Ask Lily to provide a fuller planning intake before finalizing.',
    });
  });

  it('blocks finalize when acceptance signals lack bulleted content', async () => {
    vi.resetModules();
    vi.doMock('./main.staging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.staging')>();
      return {
        ...actual,
        clearStagingArtifacts: vi.fn(async () => undefined),
        readOwnedStagedDraft: vi.fn(async () => buildOwnedPlannerDraft(`# backend / apps/api

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Context Pack Binding

- Context Pack Dir: /contextpacks/orders
- Context Pack ID: orders
- Scope Mode: focus-selection
- Selected Repo IDs: backend
- Selected Focus IDs: api

## Request Summary

This request summary is long enough to pass the minimum length gate for validation.

## Desired Outcome

Ship a useful planning intake.

## Constraints

None

## Acceptance Signals

All signals are written as plain text without bullets or numbered items.

## Suggested Routing

- Recommended Execution: sequential
- Planner Notes:

## Source

- Created By: Planning Agent
- Created At (UTC): 2026-03-21T04:00:00Z
`)),
      };
    });
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.finalizeSpec',
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Draft ready.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
          endPlannerSession: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.finalizeSpec',
      error: 'Staged draft Acceptance Signals must contain at least one bullet or numbered item before finalizing.',
    });
  });

  it('rejects finalize when expectedTaskKind disagrees with platform-owned staged metadata', async () => {
    vi.resetModules();
    vi.doMock('./main.staging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.staging')>();
      return {
        ...actual,
        clearStagingArtifacts: vi.fn(async () => undefined),
        readOwnedStagedDraft: vi.fn(async () => buildOwnedPlannerDraft(`# backend / apps/api

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Context Pack Binding

- Context Pack Dir: /contextpacks/orders
- Context Pack ID: orders
- Scope Mode: focus-selection
- Selected Repo IDs: backend
- Selected Focus IDs: api

## Request Summary

This request summary is long enough to pass the minimum length gate for validation.

## Desired Outcome

Ship a useful planning intake.

## Constraints

None

## Acceptance Signals

- Signal one is present.

## Suggested Routing

- Recommended Execution: sequential
- Planner Notes:

## Source

- Created By: Planning Agent
- Created At (UTC): 2026-03-21T04:00:00Z
`)),
      };
    });
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.finalizeSpec',
          payload: { expectedTaskKind: 'child-task' },
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Draft ready.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
          endPlannerSession: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.finalizeSpec',
      error: 'Platform expected child-task but staged planner metadata declares standard. Restart the planner session before finalizing.',
    });
  });

  it('rejects finalize when the platform-owned Task Lineage section is missing from the staged draft', async () => {
    vi.resetModules();
    vi.doMock('./main.staging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.staging')>();
      return {
        ...actual,
        clearStagingArtifacts: vi.fn(async () => undefined),
        readOwnedStagedDraft: vi.fn(async () => buildOwnedPlannerDraft(`# backend / apps/api

## Context Pack Binding

- Context Pack Dir: /contextpacks/orders
- Context Pack ID: orders
- Scope Mode: focus-selection
- Selected Repo IDs: backend
- Selected Focus IDs: api

## Request Summary

This request summary is long enough to pass the minimum length gate for validation.

## Desired Outcome

Ship something useful.

## Acceptance Signals

- At least one signal.

## Suggested Routing

- Recommended Execution: sequential
- Planner Notes:

## Source

- Created By: Planning Agent
- Created At (UTC): 2026-03-21T04:00:00Z
`, { taskKind: 'child-task', parentTaskId: 'CAP-001', rootTaskId: 'ROOT-001', parentQmdScope: 'qmd/context-packs/orders', followUpReason: 'Continue the next slice.' })),
      };
    });
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.finalizeSpec',
          payload: { expectedTaskKind: 'child-task' },
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Draft ready.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
          endPlannerSession: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.finalizeSpec',
      error: 'Staged draft is missing the platform-owned Task Lineage section. Ask Lily to restore the staged shell before finalizing.',
    });
  });

  it('finalize builds a canonical dropbox task from platform-owned staging metadata', async () => {
    vi.resetModules();
    const clearStagingArtifacts = vi.fn(async () => undefined);
    const createDropboxTask = vi.fn(async () => '/repo/AgentWorkSpace/dropbox/20260321T040000Z_backend-apps-api.md');
    vi.doMock('./main.staging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.staging')>();
      return {
        ...actual,
        clearStagingArtifacts,
        readOwnedStagedDraft: vi.fn(async () => buildOwnedPlannerDraft(`# backend / apps/api

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Context Pack Binding

- Context Pack Dir: /contextpacks/orders
- Context Pack ID: orders
- Scope Mode: focus-selection
- Selected Repo IDs: backend
- Selected Focus IDs: api

## Request Summary

This request summary is long enough to pass the minimum length validation gate.

## Desired Outcome

Ship a useful planning intake.

## Constraints

None

## Acceptance Signals

- Signal one.

## Suggested Routing

- Recommended Execution: sequential
- Planner Notes: Keep the focus constrained.

## Source

- Created By: Planning Agent
- Created At (UTC): 2026-03-21T04:00:00Z
`)),
      };
    });
    vi.doMock('../../../backend/platform/queue/createDropboxTask.js', () => ({
      createDropboxTask,
    }));
    const { handleDesktopAction } = await import('./main');
    const endPlannerSession = vi.fn(async () => ({ ended: true }));

    await expect(
      handleDesktopAction(
        {
          action: 'planner.finalizeSpec',
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Draft ready.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
          endPlannerSession,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.finalizeSpec',
        mode: 'finalized',
      }),
    });
    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'backend / apps/api',
      summary: 'This request summary is long enough to pass the minimum length validation gate.',
      desiredOutcome: 'Ship a useful planning intake.',
      constraints: 'None',
      acceptanceSignals: '- Signal one.',
      suggestedPath: 'sequential',
      planningNotes: 'Keep the focus constrained.',
      kind: 'standard',
      contextPackDir: '/contextpacks/orders',
      contextPackId: 'orders',
      scopeMode: 'focus-selection',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: false,
      selectedFocusPath: 'apps/api',
      selectedFocusTargetKind: null,
      selectedTestTarget: null,
      selectedSupportTargets: [],
    }));
    expect(clearStagingArtifacts).not.toHaveBeenCalled();
    expect(endPlannerSession).toHaveBeenCalledOnce();
  });

  it('finalizes a staged draft even if planner session later reports failed', async () => {
    vi.resetModules();
    const createDropboxTask = vi.fn(async () => '/repo/AgentWorkSpace/dropbox/20260321T040001Z_backend-apps-api.md');
    const endPlannerSession = vi.fn(async () => ({ ended: true }));
    vi.doMock('./main.staging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.staging')>();
      return {
        ...actual,
        clearStagingArtifacts: vi.fn(async () => undefined),
        readOwnedStagedDraft: vi.fn(async () => buildOwnedPlannerDraft(`# backend / apps/api

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Context Pack Binding

- Context Pack Dir: /contextpacks/orders
- Context Pack ID: orders
- Scope Mode: focus-selection
- Selected Repo IDs: backend
- Selected Focus IDs: api

## Request Summary

This request summary is long enough to pass the minimum length validation gate.

## Desired Outcome

Ship a useful planning intake.

## Constraints

None

## Acceptance Signals

- Signal one.

## Suggested Routing

- Recommended Execution: sequential
- Planner Notes:

## Source

- Created By: Planning Agent
- Created At (UTC): 2026-03-21T04:00:00Z
`)),
      };
    });
    vi.doMock('../../../backend/platform/queue/createDropboxTask.js', () => ({
      createDropboxTask,
    }));
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.finalizeSpec',
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'failed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Draft ready before failure.',
            exitCode: 1,
            usage: null,
            error: 'Planner exited after writing the draft.',
          })),
          endPlannerSession,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.finalizeSpec',
        mode: 'finalized',
      }),
    });
    expect(createDropboxTask).toHaveBeenCalledOnce();
    expect(endPlannerSession).toHaveBeenCalledOnce();
  });

  it('threads Deep Focus staging metadata through planner finalization submission', async () => {
    vi.resetModules();
    const createDropboxTask = vi.fn(async () => '/repo/AgentWorkSpace/dropbox/20260321T040002Z_backend-src-handler-ts-file.md');
    vi.doMock('./main.staging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.staging')>();
      return {
        ...actual,
        clearStagingArtifacts: vi.fn(async () => undefined),
        readOwnedStagedDraft: vi.fn(async () => buildOwnedPlannerDraft(`# backend / src/handler.ts (file)

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Context Pack Binding

- Context Pack Dir: /contextpacks/orders
- Context Pack ID: orders
- Scope Mode: focus-selection
- Selected Repo IDs: backend
- Selected Focus IDs: api
- Deep Focus Enabled: true
- Selected Focus Path: src/handler.ts
- Selected Focus Target Kind: file
- Selected Test Target: {"path":"tests/handler.test.ts","kind":"file"}
- Selected Support Targets: [{"path":"docs","kind":"directory","effectiveScope":"full-directory"}]

## Request Summary

This request summary is long enough to satisfy planner finalization validation requirements.

## Desired Outcome

Preserve Deep Focus metadata for the downstream task submission seam.

## Constraints

Do not widen the selected boundary.

## Acceptance Signals

- Deep Focus metadata is forwarded.

## Suggested Routing

- Recommended Execution: sequential
- Planner Notes: Keep the file scope exact.

## Source

- Created By: Planning Agent
- Created At (UTC): 2026-03-21T04:00:00Z
`, {
          title: 'backend / src/handler.ts (file)',
          deepFocusEnabled: true,
          primaryFocusRelativePath: 'src/handler.ts',
          primaryFocusTargetKind: 'file',
          selectedTestTarget: { path: 'tests/handler.test.ts', kind: 'file' },
          supportTargets: [{ path: 'docs', kind: 'directory', effectiveScope: 'full-directory' }],
        })),
      };
    });
    vi.doMock('../../../backend/platform/queue/createDropboxTask.js', () => ({
      createDropboxTask,
    }));
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        { action: 'planner.finalizeSpec' },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Draft ready.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
          endPlannerSession: vi.fn(async () => ({ ended: true })),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.finalizeSpec',
        mode: 'finalized',
      }),
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      deepFocusEnabled: true,
      selectedFocusPath: 'src/handler.ts',
      selectedFocusTargetKind: 'file',
      selectedTestTarget: { path: 'tests/handler.test.ts', kind: 'file' },
      selectedSupportTargets: [{ path: 'docs', kind: 'directory', effectiveScope: 'full-directory' }],
    }));
  });

  it('blocks finalize when a child-task staged draft is missing carry-forward summary', async () => {
    vi.resetModules();
    vi.doMock('./main.staging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.staging')>();
      return {
        ...actual,
        clearStagingArtifacts: vi.fn(async () => undefined),
        readOwnedStagedDraft: vi.fn(async () => buildOwnedPlannerDraft(`# backend / apps/api

## Task Lineage

- Task Kind: child-task
- Parent Task ID: CAP-001
- Root Task ID: ROOT-001
- Parent QMD Record ID: qmd-1
- Parent QMD Scope: qmd/scope
- Follow-Up Reason: Continue the child task

## Context Pack Binding

- Context Pack Dir: /contextpacks/orders
- Context Pack ID: orders
- Scope Mode: focus-selection
- Selected Repo IDs: backend
- Selected Focus IDs: api

## Request Summary

This child-task extends the parent work with enough context to pass the length gate.

## Desired Outcome

Complete the child-task intake with preserved lineage.

## Constraints

- Preserve lineage.

## Acceptance Signals

- Child-task draft is reviewable.

## Parent Task Carry-Forward Summary


## Suggested Routing

- Recommended Execution: sequential
- Planner Notes:

## Source

- Created By: Planning Agent
- Created At (UTC): 2026-03-21T04:00:00Z
`, {
          taskKind: 'child-task',
          parentTaskId: 'CAP-001',
          rootTaskId: 'ROOT-001',
          parentQmdRecordId: 'qmd-1',
          parentQmdScope: 'qmd/scope',
          followUpReason: 'Continue the child task',
        })),
      };
    });
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.finalizeSpec',
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Draft ready.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
          endPlannerSession: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.finalizeSpec',
      error: 'Child-task staged draft is missing Parent Task Carry-Forward Summary content. Ask Lily to complete the intake before finalizing.',
    });
  });

});
