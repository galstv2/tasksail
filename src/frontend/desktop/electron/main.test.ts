// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DESKTOP_SHELL_INVOKE_CHANNEL } from '../src/shared/desktopContract';

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

function browserWindowCallCount(): number {
  return (
    BrowserWindowMock as unknown as {
      mock: { calls: unknown[][] };
    }
  ).mock.calls.length;
}

const appMock = {
  on: vi.fn(),
  quit: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  dock: { setIcon: vi.fn() },
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

describe('electron main bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    BrowserWindowMock.getAllWindows.mockReturnValue([]);
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/selected-directory'],
    });
  });

  it('creates a secure browser window and loads the dev server when configured', async () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173');
    const { createWindow } = await import('./main');

    await createWindow();

    expect(BrowserWindowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundColor: '#020617',
        minHeight: 640,
        minWidth: 960,
        title: 'TaskSail',
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        }),
      }),
    );
    expect(loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(loadFile).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalled();
  });

  it('loads the built renderer when no dev server URL is present', async () => {
    const { createWindow } = await import('./main');

    await createWindow();

    expect(loadFile).toHaveBeenCalledWith(expect.stringContaining('dist/index.html'));
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('rejects non-local dev server URLs', async () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', 'https://example.com');
    const { createWindow } = await import('./main');

    await expect(createWindow()).rejects.toThrow(
      'VITE_DEV_SERVER_URL must use http:// for local development.',
    );
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('registers application lifecycle handlers', async () => {
    const { registerAppLifecycle } = await import('./main');

    registerAppLifecycle();

    expect(appMock.whenReady).toHaveBeenCalled();
    expect(appMock.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
    await vi.waitFor(() => {
      expect(appMock.on).toHaveBeenCalledWith('activate', expect.any(Function));
    });
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      DESKTOP_SHELL_INVOKE_CHANNEL,
      expect.any(Function),
    );
  });

  it('rejects IPC requests from unauthorized renderer senders', async () => {
    const { registerDesktopContract } = await import('./main');

    registerDesktopContract();

    const handler = ipcMainMock.handle.mock.calls.find(
      ([channel]) => channel === DESKTOP_SHELL_INVOKE_CHANNEL,
    )?.[1] as ((event: { senderFrame?: { url?: string } }, request: { action: string }) => Promise<unknown>);

    await expect(
      handler(
        { senderFrame: { url: 'https://example.com/app' } },
        { action: 'queue.readStatus' },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'queue.readStatus',
      error: 'Desktop IPC request rejected: unauthorized renderer sender.',
    });
  });

  it('accepts IPC requests from the validated local dev server origin', async () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173');
    const { registerDesktopContract } = await import('./main');

    registerDesktopContract();

    const handler = ipcMainMock.handle.mock.calls.find(
      ([channel]) => channel === DESKTOP_SHELL_INVOKE_CHANNEL,
    )?.[1] as ((event: { senderFrame?: { url?: string } }, request: { action: string }) => Promise<unknown>);

    await expect(
      handler(
        { senderFrame: { url: 'http://localhost:5173/index.html' } },
        { action: 'environment.readStatus' },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'environment.readStatus',
      }),
    });
  });

  it('recreates the window on activate only when none are open and respects darwin quit rules', async () => {
    vi.resetModules();
    const { registerAppLifecycle } = await import('./main');

    registerAppLifecycle();
    await vi.waitFor(() => {
      expect(appMock.on.mock.calls.find(([event]) => event === 'activate')).toBeTruthy();
    });
    const activateHandler = appMock.on.mock.calls.find(([event]) => event === 'activate')?.[1] as
      | (() => void)
      | undefined;
    const closeHandler = appMock.on.mock.calls.find(([event]) => event === 'window-all-closed')?.[1] as
      | (() => void)
      | undefined;

    expect(activateHandler).toBeTypeOf('function');
    expect(closeHandler).toBeTypeOf('function');

    const browserWindowCallsBeforeActivate = browserWindowCallCount();
    BrowserWindowMock.getAllWindows.mockReturnValueOnce([]);
    activateHandler?.();
    await vi.waitFor(() => {
      expect(browserWindowCallCount()).toBeGreaterThan(browserWindowCallsBeforeActivate);
    });

    const priorCallCount = browserWindowCallCount();
    BrowserWindowMock.getAllWindows.mockReturnValueOnce([browserWindowInstance]);
    activateHandler?.();
    expect(browserWindowCallCount()).toBe(priorCallCount);

    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    closeHandler?.();
    expect(appMock.quit).not.toHaveBeenCalled();
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }

    Object.defineProperty(process, 'platform', { value: 'linux' });
    closeHandler?.();
    expect(appMock.quit).toHaveBeenCalledTimes(1);

    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  });

  it('ends the planner session during before-quit cleanup', async () => {
    vi.resetModules();
    const endSession = vi.fn(async () => undefined);
    vi.doMock('./plannerSession', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./plannerSession')>();
      return {
        ...actual,
        endSession,
      };
    });

    const { registerAppLifecycle } = await import('./main');
    registerAppLifecycle();

    const beforeQuitHandler = appMock.on.mock.calls.find(([event]) => event === 'before-quit')?.[1] as
      | (() => void)
      | undefined;
    expect(beforeQuitHandler).toBeTypeOf('function');

    beforeQuitHandler?.();
    await vi.waitFor(() => {
      expect(endSession).toHaveBeenCalledOnce();
    });
  });

  it('fails clearly for unsupported desktop actions', async () => {
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction({ action: 'shell.run' } as never),
    ).resolves.toEqual({
      ok: false,
      action: 'shell.run',
      error: 'Desktop action request failed runtime validation.',
      details: ['action must be one of the approved desktop actions.'],
    });
  });

  it('rejects malformed desktop action payloads before invoking handlers', async () => {
    const { handleDesktopAction } = await import('./main');
    const handlers = {
      submitDraft: vi.fn(),
      submitFollowUp: vi.fn(),
      readQueueStatus: vi.fn(),
      readEnvironmentStatus: vi.fn(),
      readObservability: vi.fn(),
    };

    await expect(
      handleDesktopAction(
        {
          action: 'planner.submitDraft',
          payload: {
            stage: 'ship-it',
            draft: {
              title: 'Bad draft',
              taskKind: 'standard',
              summary: 'Invalid stage should fail.',
            },
          },
        },
        handlers,
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.submitDraft',
      error: 'Desktop action request failed runtime validation.',
      details: expect.arrayContaining([
        'payload.draft.desiredOutcome must be a string.',
        'payload.stage must be compose, preview, or confirm.',
      ]),
    });

    expect(handlers.submitDraft).not.toHaveBeenCalled();
    expect(handlers.submitFollowUp).not.toHaveBeenCalled();
  });

  it('auto-starts the pipeline when moving to pending also activates the task', async () => {
    vi.resetModules();
    const runPipelineSequence = vi.fn(async () => ({
      workflowPath: 'standard',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationSeconds: 0,
      agentsRun: [],
      contextPackDir: null,
      status: 'completed',
    }));
    const pathExists = vi.fn(async () => false);
    const moveToPending = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'taskBoard.moveToPending' as const,
        mode: 'moved' as const,
        message: 'Moved task.md to pending as 20260328-task.md.',
        movedItem: '20260328-task.md',
        activatedItem: '20260328-task.md',
      },
    }));

    const getQueueStatus = vi.fn(async () => ({
      dropboxItems: [],
      pendingItems: ['20260328-task.md'],
      activeItem: '20260328-task.md',
      activeTasks: [{
        taskId: '20260328-task',
        state: 'active' as const,
        handoffsDir: '/repo/AgentWorkSpace/tasks/20260328-task/handoffs',
      }],
      workspaceReady: false,
      activeTaskWithBlankWorkspace: false,
      partialPublish: false,
      errorItemsCount: 0,
    }));

    vi.doMock('./utils', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./utils')>();
      return {
        ...actual,
        pathExists,
      };
    });
    vi.doMock('./main.taskBoard', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.taskBoard')>();
      return {
        ...actual,
        moveToPending,
        startTaskBoardWatcher: vi.fn(() => vi.fn()),
      };
    });
    vi.doMock('../../../backend/platform/agent-runner/pipeline/sequencer.js', () => ({
      runPipelineSequence,
    }));
    vi.doMock('../../../backend/platform/queue', () => ({
      acquireDirLockOrThrow: vi.fn(async () => vi.fn(async () => undefined)),
      deletePendingItem: vi.fn(),
      getQueueStatus,
      resolveQueuePaths: vi.fn(() => ({
        queueLockDir: '/repo/AgentWorkSpace/.queue-lock',
      })),
    }));
    vi.doMock('../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: vi.fn(() => []),
      stopPipeline: vi.fn(async () => undefined),
    }));

    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction({
        action: 'taskBoard.moveToPending',
        payload: { fileName: 'task.md', insertAtIndex: 0 },
      }),
    ).resolves.toEqual({
      ok: true,
      response: {
        action: 'taskBoard.moveToPending',
        mode: 'moved',
        message: 'Moved task.md to pending as 20260328-task.md.',
        movedItem: '20260328-task.md',
        activatedItem: '20260328-task.md',
      },
    });

    await vi.waitFor(() => {
      expect(runPipelineSequence).toHaveBeenCalledWith({
        repoRoot: expect.any(String),
        startAt: 'alice',
        taskId: '20260328-task',
      });
    });
  });

  it('does not auto-start the pipeline when move to pending does not activate a task', async () => {
    vi.resetModules();
    const runPipelineSequence = vi.fn(async () => undefined);
    const pathExists = vi.fn(async () => true);
    const moveToPending = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'taskBoard.moveToPending' as const,
        mode: 'moved' as const,
        message: 'Moved task.md to pending as 20260328-task.md.',
        movedItem: '20260328-task.md',
        activatedItem: null,
      },
    }));

    vi.doMock('./utils', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./utils')>();
      return {
        ...actual,
        pathExists,
      };
    });
    vi.doMock('./main.taskBoard', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./main.taskBoard')>();
      return {
        ...actual,
        moveToPending,
        startTaskBoardWatcher: vi.fn(() => vi.fn()),
      };
    });
    vi.doMock('../../../backend/platform/agent-runner/pipeline/sequencer.js', () => ({
      runPipelineSequence,
    }));
    vi.doMock('../../../backend/platform/queue', () => ({
      acquireDirLockOrThrow: vi.fn(async () => vi.fn(async () => undefined)),
      deletePendingItem: vi.fn(),
      getQueueStatus: vi.fn(),
      resolveQueuePaths: vi.fn(() => ({
        queueLockDir: '/repo/AgentWorkSpace/.queue-lock',
      })),
    }));
    vi.doMock('../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: vi.fn(() => []),
      stopPipeline: vi.fn(async () => undefined),
    }));

    const { handleDesktopAction } = await import('./main');
    await handleDesktopAction({
      action: 'taskBoard.moveToPending',
      payload: { fileName: 'task.md', insertAtIndex: 0 },
    });

    await Promise.resolve();
    expect(runPipelineSequence).not.toHaveBeenCalled();
  });

});
