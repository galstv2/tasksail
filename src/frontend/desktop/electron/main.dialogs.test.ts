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
}));

/**
 * Build a mocked `node:fs/promises` module that prevents real filesystem writes.
 * Callers pass read-side overrides; write-side operations (`writeFile`, `mkdir`,
 * `appendFile`, `cp`, `rm`) default to no-ops so tests never leak to disk.
 */
async function safeFsMock(
  importOriginal: () => Promise<typeof import('node:fs/promises')>,
  overrides: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const actual = await importOriginal();
  return {
    ...actual,
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    appendFile: vi.fn(async () => undefined),
    cp: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('electron main bootstrap — dialogs and planner', () => {
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

  it('uses native directory selection for context-pack picker requests', async () => {
    const { pickContextPackDirectoryAction } = await import('./main');

    await expect(
      pickContextPackDirectoryAction({
        purpose: 'context-pack-destination',
        defaultPath: '/tmp/context-packs',
      }),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.pickDirectory',
        mode: 'selected',
        selectedPath: '/tmp/selected-directory',
      }),
    });

    expect(dialogMock.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '/tmp/context-packs',
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
      }),
    );
  });

  it('submits confirmed planner drafts through the dropbox helper seam', async () => {
    const { buildDropboxTaskArgs, submitDraftViaDropboxHelper } = await import('./main');

    const draft = {
      title: 'Submit through helper seam',
      taskKind: 'standard' as const,
      summary: 'Create a dropbox task from the desktop shell.',
      desiredOutcome: 'Queue automation can claim the task.',
      constraints: 'Renderer stays file-system blind.',
      acceptanceSignals: 'Helper returns a created path.',
      parentTaskId: '',
      parentQmdRecordId: '',
      parentQmdScope: '',
      rootTaskId: '',
      followupReason: '',
      carryForwardSummary: '',
      suggestedPath: 'sequential' as const,
      planningNotes: 'Approved in confirm stage.',
      sourceState: 'active' as const,
    };

    expect(buildDropboxTaskArgs(draft)).toEqual([
      '--title',
      'Submit through helper seam',
      '--task-kind',
      'standard',
      '--summary',
      'Create a dropbox task from the desktop shell.',
      '--desired-outcome',
      'Queue automation can claim the task.',
      '--constraints',
      'Renderer stays file-system blind.',
      '--acceptance-signals',
      'Helper returns a created path.',
      '--suggested-path',
      'sequential',
      '--planning-notes',
      'Approved in confirm stage.',
    ]);

    await expect(
      submitDraftViaDropboxHelper(draft, async () =>
        'AgentWorkSpace/dropbox/20260307T183000Z-submit-through-helper-seam.md',
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.submitDraft',
        mode: 'submitted',
        submittedPath: 'AgentWorkSpace/dropbox/20260307T183000Z-submit-through-helper-seam.md',
        observationMode: true,
      }),
    });
  });

  it('stages and submits completed-task follow-up drafts through the follow-up helper seam', async () => {
    const { buildFollowUpTaskArgs, handleDesktopAction, submitFollowUpViaHelper } = await import('./main');

    const followUpDraft = {
      title: 'Create child-task intake for live follow-up integration',
      taskKind: 'child-task' as const,
      summary: 'Start a child-task planning flow from completed renderer findings.',
      desiredOutcome: 'A new child-task intake is created without reopening the parent task.',
      constraints: 'Keep the parent task read-only.',
      acceptanceSignals: 'Child-task draft preserves lineage.',
      parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
      parentQmdRecordId: 'qmd://implementation-summary/CAP-CUSTOM-TERMINAL-08/final',
      parentQmdScope: 'qmd/context-packs/test-pack',
      rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
      followupReason: 'Carry completed renderer findings into the next child-task slice.',
      carryForwardSummary: 'Preserve read-only workflow console behavior.',
      suggestedPath: 'sequential' as const,
      planningNotes: 'Parent Final Summary Reference: qmd/context-packs/test-pack.md',
      sourceState: 'completed' as const,
    };

    expect(buildFollowUpTaskArgs(followUpDraft)).toEqual([
      '--title',
      'Create child-task intake for live follow-up integration',
      '--requested-adjustment',
      'Start a child-task planning flow from completed renderer findings.',
      '--desired-outcome',
      'A new child-task intake is created without reopening the parent task.',
      '--constraints',
      'Keep the parent task read-only.',
      '--acceptance-signals',
      'Child-task draft preserves lineage.',
      '--parent-task-id',
      'CAP-CUSTOM-TERMINAL-08',
      '--parent-qmd-scope',
      'qmd/context-packs/test-pack',
      '--root-task-id',
      'CAP-CUSTOM-TERMINAL-01',
      '--followup-reason',
      'Carry completed renderer findings into the next child-task slice.',
      '--carry-forward-summary',
      'Preserve read-only workflow console behavior.',
      '--planning-notes',
      'Parent Final Summary Reference: qmd/context-packs/test-pack.md',
      '--suggested-path',
      'sequential',
      '--parent-qmd-record-id',
      'qmd://implementation-summary/CAP-CUSTOM-TERMINAL-08/final',
    ]);

    await expect(
      handleDesktopAction(
        {
          action: 'followup.begin',
          payload: {
            draft: followUpDraft,
            stage: 'preview',
          },
        },
        {
          submitDraft: vi.fn(),
          submitFollowUp: vi.fn(),
          readQueueStatus: vi.fn(),
          readEnvironmentStatus: vi.fn(),
          readObservability: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'followup.begin',
        mode: 'dry-run',
        parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
        reopenedTask: false,
      }),
    });

    await expect(
      submitFollowUpViaHelper(followUpDraft, async () =>
        'AgentWorkSpace/dropbox/create-child-task-intake-for-live-follow-up-integration.md',
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'followup.begin',
        mode: 'submitted',
        sourceTaskId: 'CAP-CUSTOM-TERMINAL-08',
        submittedPath: 'AgentWorkSpace/dropbox/create-child-task-intake-for-live-follow-up-integration.md',
        reopenedTask: false,
      }),
    });
  });

  it('reports planner validation failures before touching the helper seam', async () => {
    const { submitDraftViaDropboxHelper } = await import('./main');
    const runner = vi.fn();

    await expect(
      submitDraftViaDropboxHelper(
        {
          title: '',
          taskKind: 'standard',
          summary: '',
          desiredOutcome: '',
          constraints: 'Local only',
          acceptanceSignals: 'n/a',
          parentTaskId: '',
          parentQmdRecordId: '',
          parentQmdScope: '',
          rootTaskId: '',
          followupReason: '',
          carryForwardSummary: '',
          suggestedPath: 'sequential',
          planningNotes: 'n/a',
        },
        runner,
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.submitDraft',
      error: 'Planner draft validation failed before dropbox submission.',
      details: [
        'Title is required before submitting to dropbox.',
        'Request summary is required before submitting to dropbox.',
        'Desired outcome is required before submitting to dropbox.',
      ],
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('uses fallback messages for non-Error helper failures and default follow-up root IDs', async () => {
    const { buildFollowUpTaskArgs, submitDraftViaDropboxHelper, submitFollowUpViaHelper } = await import('./main');

    expect(
      buildFollowUpTaskArgs({
        title: 'Default root id',
        taskKind: 'child-task',
        summary: 'Use parent task as fallback root.',
        desiredOutcome: 'Args stay complete.',
        constraints: 'n/a',
        acceptanceSignals: 'n/a',
        parentTaskId: 'CAP-PARENT-1',
        parentQmdRecordId: '',
        parentQmdScope: 'qmd/context-packs/test-pack',
        rootTaskId: '',
        followupReason: 'Continue work.',
        carryForwardSummary: 'Preserve lineage.',
        suggestedPath: 'sequential',
        planningNotes: 'n/a',
      }),
    ).toContain('CAP-PARENT-1');

    await expect(
      submitDraftViaDropboxHelper(
        {
          title: 'Non error failure',
          taskKind: 'standard',
          summary: 'Attempt submission.',
          desiredOutcome: 'Fallback error message.',
          constraints: 'n/a',
          acceptanceSignals: 'n/a',
          parentTaskId: '',
          parentQmdRecordId: '',
          parentQmdScope: '',
          rootTaskId: '',
          followupReason: '',
          carryForwardSummary: '',
          suggestedPath: 'sequential',
          planningNotes: 'n/a',
        },
        async () => {
          throw 'boom';
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.submitDraft',
      error: 'Dropbox submission failed unexpectedly in the Electron main process.',
    });

    await expect(
      submitFollowUpViaHelper(
        {
          title: 'Non error follow-up failure',
          taskKind: 'child-task',
          summary: 'Attempt follow-up creation.',
          desiredOutcome: 'Fallback error message.',
          constraints: 'n/a',
          acceptanceSignals: 'n/a',
          parentTaskId: 'CAP-PARENT-1',
          parentQmdRecordId: '',
          parentQmdScope: 'qmd/context-packs/test-pack',
          rootTaskId: '',
          followupReason: 'Continue work.',
          carryForwardSummary: 'Preserve lineage.',
          suggestedPath: 'sequential',
          planningNotes: 'n/a',
        },
        async () => {
          throw 'boom';
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'followup.begin',
      error: 'Follow-up submission failed unexpectedly in the Electron main process.',
    });
  });

  it('validates follow-up task kind explicitly before submission', async () => {
    const { validateFollowUpDraftForSubmission } = await import('./main');

    expect(
      validateFollowUpDraftForSubmission({
        title: 'Wrong kind',
        taskKind: 'standard',
        summary: 'Attempt follow-up creation.',
        desiredOutcome: 'Observe validation.',
        constraints: 'n/a',
        acceptanceSignals: 'n/a',
        parentTaskId: '',
        parentQmdRecordId: '',
        parentQmdScope: '',
        rootTaskId: '',
        followupReason: '',
        carryForwardSummary: '',
        suggestedPath: 'sequential',
        planningNotes: 'n/a',
      }),
    ).toContain('Follow-up drafts must use the child-task task kind.');
  });

  it('returns actionable helper failures when dropbox submission fails', async () => {
    const { submitDraftViaDropboxHelper } = await import('./main');

    await expect(
      submitDraftViaDropboxHelper(
        {
          title: 'Broken submission',
          taskKind: 'standard',
          summary: 'Attempt submission.',
          desiredOutcome: 'Observe failure path.',
          constraints: 'n/a',
          acceptanceSignals: 'n/a',
          parentTaskId: '',
          parentQmdRecordId: '',
          parentQmdScope: '',
          rootTaskId: '',
          followupReason: '',
          carryForwardSummary: '',
          suggestedPath: 'sequential',
          planningNotes: 'n/a',
        },
        async () => {
          throw new Error('createDropboxTask failed with code 1');
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.submitDraft',
      error: 'createDropboxTask failed with code 1',
    });
  });

  it('reports follow-up validation and lineage failures without reopening the parent task', async () => {
    const { submitFollowUpViaHelper } = await import('./main');
    const runner = vi.fn();

    await expect(
      submitFollowUpViaHelper(
        {
          title: 'Broken follow-up',
          taskKind: 'child-task',
          summary: 'Attempt follow-up creation.',
          desiredOutcome: 'Observe lineage validation.',
          constraints: 'n/a',
          acceptanceSignals: 'n/a',
          parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
          parentQmdRecordId: '',
          parentQmdScope: '',
          rootTaskId: '',
          followupReason: '',
          carryForwardSummary: '',
          suggestedPath: 'sequential',
          planningNotes: 'n/a',
        },
        runner,
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'followup.begin',
      error: 'Follow-up draft validation failed before child-task submission.',
      details: [
        'Parent QMD scope is required for follow-up creation.',
        'Follow-up reason is required for follow-up creation.',
        'Carry-forward summary is required when follow-up lineage must stay local and explicit.',
      ],
    });
    expect(runner).not.toHaveBeenCalled();

    await expect(
      submitFollowUpViaHelper(
        {
          title: 'Broken follow-up',
          taskKind: 'child-task',
          summary: 'Attempt follow-up creation.',
          desiredOutcome: 'Observe lineage failure.',
          constraints: 'n/a',
          acceptanceSignals: 'n/a',
          parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
          parentQmdRecordId: 'qmd://implementation-summary/CAP-CUSTOM-TERMINAL-08/final',
          parentQmdScope: 'qmd/context-packs/test-pack',
          rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
          followupReason: 'Continue with the next child task.',
          carryForwardSummary: 'Preserve read-only boundaries.',
          suggestedPath: 'sequential',
          planningNotes: 'n/a',
        },
        async () => {
          throw new Error('Carry-forward lookup failed: parent archive record could not be resolved.');
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'followup.begin',
      error: 'Carry-forward lookup failed: parent archive record could not be resolved.',
    });
  });

  it('rejects child-task kind in planner.submitDraft to enforce follow-up intake path', async () => {
    const { submitDraftViaDropboxHelper } = await import('./main');
    const runner = vi.fn();

    await expect(
      submitDraftViaDropboxHelper(
        {
          title: 'Sneaky child task',
          taskKind: 'child-task',
          summary: 'Attempt bypass.',
          desiredOutcome: 'Should be blocked.',
          constraints: '',
          acceptanceSignals: '',
          parentTaskId: 'CAP-PARENT-1',
          parentQmdRecordId: '',
          parentQmdScope: '',
          rootTaskId: '',
          followupReason: 'Bypass attempt.',
          carryForwardSummary: 'Some summary.',
          suggestedPath: 'sequential',
          planningNotes: '',
        },
        runner,
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.submitDraft',
      error: 'Planner draft validation failed before dropbox submission.',
      details: [
        'Child-task drafts must use the follow-up intake path (followup.begin), not planner.submitDraft.',
      ],
    });

    expect(runner).not.toHaveBeenCalled();
  });

  it('surfaces broker-backed save-draft failures cleanly', async () => {
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.saveDraft',
        },
        {
          savePlannerDraft: vi.fn(async () => 'sent' as const),
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'failed' as const,
            copilotSessionId: null,
            turnId: 'turn-1',
            content: '',
            exitCode: 1,
            usage: null,
            error: 'Planner failed while writing the staged draft.',
          })),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.saveDraft',
      error: 'Planner failed while writing the staged draft.',
    });
  });

  it('fails closed when the planner completed without writing a staged draft', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(),
        readdir: vi.fn(async () => []),
        rename: vi.fn(),
        stat: vi.fn(),
    }));
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.readStagedDraft',
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Saved draft.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.readStagedDraft',
      error: 'Planner completed without writing a staged draft to AgentWorkSpace/dropbox/.staging.',
    });
  });

  it('fails closed when the newest staged draft is empty', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(async () => '  \n'),
        readdir: vi.fn(async () => ['20260320T003500Z-spec.md']),
        rename: vi.fn(),
        stat: vi.fn(async () => ({
          mtime: new Date('2026-03-20T00:35:00.000Z'),
          mtimeMs: new Date('2026-03-20T00:35:00.000Z').getTime(),
        })),
    }));
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'planner.readStagedDraft',
        },
        {
          getPlannerSessionState: vi.fn(() => ({
            brokerStatus: 'completed' as const,
            copilotSessionId: 'copilot-session-1',
            turnId: 'turn-1',
            content: 'Saved draft.',
            exitCode: 0,
            usage: null,
            error: null,
          })),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.readStagedDraft',
      error: 'Staged draft 20260320T003500Z-spec.md is empty. Ask Lily to rewrite the draft before finalizing.',
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
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(async () => `# Draft Title

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

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
- Created At (UTC): 2026-03-21T01:00:00Z
`),
        readdir: vi.fn(async () => ['20260321T010000Z-spec.md']),
        rename: vi.fn(),
        stat: vi.fn(async () => ({
          mtime: new Date('2026-03-21T01:00:00.000Z'),
          mtimeMs: new Date('2026-03-21T01:00:00.000Z').getTime(),
        })),
    }));
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
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(async () => `# Draft Title

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

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
- Created At (UTC): 2026-03-21T01:00:00Z
`),
        readdir: vi.fn(async () => ['20260321T010000Z-spec.md']),
        rename: vi.fn(),
        stat: vi.fn(async () => ({
          mtime: new Date('2026-03-21T01:00:00.000Z'),
          mtimeMs: new Date('2026-03-21T01:00:00.000Z').getTime(),
        })),
    }));
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

  it('routes planner.pickMarkdownFile through handleDesktopAction', async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/docs/intake.md'],
    });

    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const real = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...real,
        writeFile: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => undefined),
        readFile: vi.fn(async () => '# Intake\n\n## Request Summary\n\nBuild a feature.'),
        stat: vi.fn(async () => ({ size: 100 })),
      };
    });
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction({ action: 'planner.pickMarkdownFile' }),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.pickMarkdownFile',
        mode: 'selected',
        filename: 'intake.md',
        path: '/tmp/docs/intake.md',
      }),
    });
  });

  it('pickMarkdownFile returns cancelled mode when dialog is dismissed', async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });

    const { pickMarkdownFileAction } = await import('./main');

    await expect(pickMarkdownFileAction()).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.pickMarkdownFile',
        mode: 'cancelled',
        filename: null,
        content: null,
      }),
    });
  });

  it('pickMarkdownFile rejects files exceeding the size limit', async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/docs/huge.md'],
    });

    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const real = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...real,
        writeFile: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => undefined),
        stat: vi.fn(async () => ({ size: 256 * 1024 })),
      };
    });
    const { pickMarkdownFileAction } = await import('./main');

    const result = await pickMarkdownFileAction();
    expect(result.ok).toBe(false);
    expect(result).toEqual(
      expect.objectContaining({
        action: 'planner.pickMarkdownFile',
        error: expect.stringContaining('128 KB size limit'),
      }),
    );
  });

  it('pickMarkdownFile rejects empty files', async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/docs/empty.md'],
    });

    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const real = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...real,
        writeFile: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => undefined),
        readFile: vi.fn(async () => '   \n  '),
        stat: vi.fn(async () => ({ size: 5 })),
      };
    });
    const { pickMarkdownFileAction } = await import('./main');

    const result = await pickMarkdownFileAction();
    expect(result.ok).toBe(false);
    expect(result).toEqual(
      expect.objectContaining({
        action: 'planner.pickMarkdownFile',
        error: 'Selected Markdown file is empty.',
      }),
    );
  });

  it('rejects finalize when expectedTaskKind disagrees with staged draft Task Kind', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(async () => `# Standard Draft

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:

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
`),
        readdir: vi.fn(async () => ['20260321T020000Z-spec.md']),
        rename: vi.fn(),
        stat: vi.fn(async () => ({
          mtime: new Date('2026-03-21T02:00:00.000Z'),
          mtimeMs: new Date('2026-03-21T02:00:00.000Z').getTime(),
        })),
    }));
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
      error: 'Platform expected child-task but staged draft declares standard. Ask Lily to correct the Task Kind field before finalizing.',
    });
  });

  it('applies child-task validation when expectedTaskKind is child-task even if Task Kind field is missing', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(async () => `# Draft Without Task Kind

## Request Summary

This request summary is long enough to pass the minimum length gate for validation.

## Desired Outcome

Ship something useful.

## Acceptance Signals

- At least one signal.

## Suggested Routing

- Recommended Execution: sequential
`),
        readdir: vi.fn(async () => ['20260321T030000Z-spec.md']),
        rename: vi.fn(),
        stat: vi.fn(async () => ({
          mtime: new Date('2026-03-21T03:00:00.000Z'),
          mtimeMs: new Date('2026-03-21T03:00:00.000Z').getTime(),
        })),
    }));
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
      error: expect.stringContaining('missing required lineage fields'),
    });
  });

  it('finalize without expectedTaskKind falls back to file content Task Kind (backward compat)', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(async () => `# Valid Standard Draft

## Task Lineage

- Task Kind: standard

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
`),
        readdir: vi.fn(async () => ['20260321T040000Z-spec.md']),
        rename: vi.fn(async () => undefined),
        stat: vi.fn(async () => ({
          mtime: new Date('2026-03-21T04:00:00.000Z'),
          mtimeMs: new Date('2026-03-21T04:00:00.000Z').getTime(),
        })),
    }));
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
      ok: true,
      response: expect.objectContaining({
        action: 'planner.finalizeSpec',
        mode: 'finalized',
      }),
    });
  });

  it('finalizes a staged draft even if planner session later reports failed', async () => {
    vi.resetModules();
    const rename = vi.fn(async () => undefined);
    const endPlannerSession = vi.fn();
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(async () => `# Valid Standard Draft

## Task Lineage

- Task Kind: standard

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
`),
        readdir: vi.fn(async () => ['20260321T040000Z-spec.md']),
        rename,
        stat: vi.fn(async () => ({
          mtime: new Date('2026-03-21T04:00:00.000Z'),
          mtimeMs: new Date('2026-03-21T04:00:00.000Z').getTime(),
        })),
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

    // rename may also be called by the startup repairTaskRegistry (atomic write);
    // assert the finalizeSpec call specifically.
    expect(rename).toHaveBeenCalledWith(
      expect.stringContaining('.staging'),
      expect.stringContaining('dropbox'),
    );
    expect(endPlannerSession).toHaveBeenCalledOnce();
  });

  it('blocks finalize when a child-task staged draft is missing carry-forward lineage', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readFile: vi.fn(async () => `# Child Task Draft

## Task Lineage

- Task Kind: child-task
- Parent Task ID: CAP-001
- Root Task ID:
- Parent QMD Record ID: qmd-1
- Parent QMD Scope: qmd/scope
- Follow-Up Reason:

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
- Created At (UTC): 2026-03-21T01:00:00Z
`),
        readdir: vi.fn(async () => ['20260321T010100Z-spec.md']),
        rename: vi.fn(),
        stat: vi.fn(async () => ({
          mtime: new Date('2026-03-21T01:01:00.000Z'),
          mtimeMs: new Date('2026-03-21T01:01:00.000Z').getTime(),
        })),
    }));
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
      error: 'Child-task staged draft is missing required lineage fields: Root Task ID, Follow-Up Reason. Ask Lily to complete the task lineage before finalizing.',
    });
  });

  it('clears staging directory before starting a planner session', async () => {
    vi.resetModules();
    const mkdirMock = vi.fn(async () => undefined);
    const unlinkMock = vi.fn(async () => undefined);
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        mkdir: mkdirMock,
        readdir: vi.fn(async () => ['stale-draft.md', 'another.md', 'notes.txt']),
        unlink: unlinkMock,
    }));
    const { handleDesktopAction } = await import('./main');

    await handleDesktopAction(
      { action: 'planner.startSession' },
      {
        startPlannerSession: vi.fn(async () => ({ sessionId: 'planner-1', created: true })),
        getPlannerSessionState: vi.fn(() => ({
          brokerStatus: 'idle' as const,
          copilotSessionId: null,
          turnId: null,
          content: '',
          exitCode: null,
          usage: null,
          error: null,
        })),
      },
    );

    expect(mkdirMock).toHaveBeenCalledWith(expect.stringMatching(/AgentWorkSpace\/dropbox\/\.staging$/), { recursive: true });
    expect(unlinkMock).toHaveBeenCalledTimes(2);
    const unlinkPaths = unlinkMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(unlinkPaths.every((p: string) => p.endsWith('.md'))).toBe(true);
    expect(unlinkPaths.some((p: string) => p.endsWith('notes.txt'))).toBe(false);
  });

  it('clears staging directory before saving a planner draft', async () => {
    vi.resetModules();
    const mkdirMock = vi.fn(async () => undefined);
    const unlinkMock = vi.fn(async () => undefined);
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        mkdir: mkdirMock,
        readdir: vi.fn(async () => ['old-draft.md']),
        unlink: unlinkMock,
    }));
    const { handleDesktopAction } = await import('./main');

    await handleDesktopAction(
      { action: 'planner.saveDraft' },
      {
        savePlannerDraft: vi.fn(async () => 'sent' as const),
        getPlannerSessionState: vi.fn(() => ({
          brokerStatus: 'completed' as const,
          copilotSessionId: 'copilot-session-1',
          turnId: 'turn-1',
          content: 'Draft saved.',
          exitCode: 0,
          usage: null,
          error: null,
        })),
      },
    );

    expect(mkdirMock).toHaveBeenCalledWith(expect.stringMatching(/AgentWorkSpace\/dropbox\/\.staging$/), { recursive: true });
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect((unlinkMock.mock.calls[0] as unknown[])[0]).toMatch(/old-draft\.md$/);
  });

  it('does not clear staging when planner.startSession reuses an existing session', async () => {
    vi.resetModules();
    const unlinkMock = vi.fn(async () => undefined);
    vi.doMock('node:fs/promises', async (importOriginal) => safeFsMock(importOriginal as () => Promise<typeof import('node:fs/promises')>, {
        readdir: vi.fn(async () => ['current-draft.md']),
        unlink: unlinkMock,
    }));
    const { handleDesktopAction } = await import('./main');

    await handleDesktopAction(
      { action: 'planner.startSession' },
      {
        startPlannerSession: vi.fn(async () => ({ sessionId: 'planner-1', created: false })),
        getPlannerSessionState: vi.fn(() => ({
          brokerStatus: 'running' as const,
          copilotSessionId: 'copilot-session-1',
          turnId: 'turn-1',
          content: 'Working...',
          exitCode: null,
          usage: null,
          error: null,
        })),
      },
    );

    expect(unlinkMock).not.toHaveBeenCalled();
  });

});
