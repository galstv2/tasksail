// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONTEXT_PACK_CATALOG_CHANGED_CHANNEL,
  DESKTOP_SHELL_INVOKE_CHANNEL,
} from '../src/shared/desktopContract';
import { TASKSAIL_DEV_GRACEFUL_RESTART_MESSAGE } from './devRestartProtocol';

const loadURL = vi.fn(async () => undefined);
const loadFile = vi.fn(async () => undefined);
const show = vi.fn();
const focus = vi.fn();
const restore = vi.fn();
const isMinimized = vi.fn(() => false);
const isDestroyed = vi.fn(() => false);
const webContentsOn = vi.fn();
const once = vi.fn((event: string, callback: () => void) => {
  if (event === 'ready-to-show') {
    callback();
  }
});

const browserWindowInstance = {
  loadFile,
  loadURL,
  focus,
  restore,
  isMinimized,
  isDestroyed,
  webContents: { id: 7, on: webContentsOn },
  once,
  show,
};

const BrowserWindowMock = vi.fn(function () { return browserWindowInstance; }) as unknown as {
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
  exit: vi.fn(),
  quit: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  whenReady: vi.fn(() => Promise.resolve()),
  dock: { setIcon: vi.fn() },
};

const dialogMock = {
  showOpenDialog: vi.fn(),
};

const ipcMainMock = {
  handle: vi.fn(),
};

const stopBackendServicesDetachedMock = vi.fn();
const cleanupWorkspaceOnQuitMock = vi.fn();

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: BrowserWindowMock,
  dialog: dialogMock,
  ipcMain: ipcMainMock,
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

vi.mock('./app/services', () => ({
  autoStartBackendServices: vi.fn(async () => undefined),
  startBackendServices: vi.fn(async () => ({
    status: 'idle',
    action: 'services.readStatus',
    mode: 'observed',
  })),
  checkContainerRuntimeAvailable: vi.fn(async () => ({ ok: true })),
  stopBackendServices: vi.fn(async () => undefined),
  stopBackendServicesDetached: stopBackendServicesDetachedMock,
  checkBackendHealth: vi.fn(async () => undefined),
  readBackendServiceStatus: vi.fn(() => ({
    status: 'idle',
    action: 'services.readStatus',
    mode: 'observed',
  })),
}));

vi.mock('./app/cleanup', () => ({
  cleanupWorkspaceOnQuit: cleanupWorkspaceOnQuitMock,
}));

describe('electron main bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    appMock.requestSingleInstanceLock.mockReturnValue(true);
    isMinimized.mockReturnValue(false);
    isDestroyed.mockReturnValue(false);
    BrowserWindowMock.getAllWindows.mockReturnValue([]);
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/selected-directory'],
    });
  });

  it('exits at module load when another TaskSail instance owns the lock', async () => {
    appMock.requestSingleInstanceLock.mockReturnValue(false);

    await import('./main');

    expect(appMock.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(appMock.exit).toHaveBeenCalledWith(0);
    expect(appMock.whenReady).not.toHaveBeenCalled();
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
    expect(webContentsOn).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });

  it('retries connection-class dev server load failures before succeeding', async () => {
    vi.useFakeTimers();
    const loadFailure = Object.assign(new Error('not ready'), {
      code: 'ERR_CONNECTION_REFUSED',
    });
    const retryWindow = {
      loadURL: vi.fn()
        .mockRejectedValueOnce(loadFailure)
        .mockRejectedValueOnce(loadFailure)
        .mockRejectedValueOnce(loadFailure)
        .mockResolvedValueOnce(undefined),
      isDestroyed: vi.fn(() => false),
    };
    const { loadDevServerUrlWithRetry } = await import('./main');

    const loadPromise = loadDevServerUrlWithRetry(
      retryWindow as never,
      'http://localhost:5173',
    );
    await vi.advanceTimersByTimeAsync(750);
    await loadPromise;

    expect(retryWindow.loadURL).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('does not retry non-connection dev server load failures', async () => {
    const loadFailure = Object.assign(new Error('bad url'), {
      code: 'ERR_FAILED',
    });
    const retryWindow = {
      loadURL: vi.fn().mockRejectedValueOnce(loadFailure),
      isDestroyed: vi.fn(() => false),
    };
    const { loadDevServerUrlWithRetry } = await import('./main');

    await expect(
      loadDevServerUrlWithRetry(retryWindow as never, 'http://localhost:5173'),
    ).rejects.toThrow('bad url');
    expect(retryWindow.loadURL).toHaveBeenCalledOnce();
  });

  it('loads the built renderer when no dev server URL is present', async () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', '');
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
    expect(appMock.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(appMock.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
    expect(appMock.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
    await vi.waitFor(() => {
      expect(appMock.on).toHaveBeenCalledWith('activate', expect.any(Function));
    });
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      DESKTOP_SHELL_INVOKE_CHANNEL,
      expect.any(Function),
    );
  });

  it('starts the runtime stream watcher with an active context-pack scope provider', async () => {
    vi.resetModules();
    const startRuntimeStreamWatcher = vi.fn(() => vi.fn());
    vi.doMock('./runtime/runtimeStream', () => ({
      refreshRuntimeStreamState: vi.fn(async () => undefined),
      resetRuntimeStreamState: vi.fn(),
      startRuntimeStreamWatcher,
    }));
    vi.doMock('./runtime/stream', () => ({
      clearTerminalTaskScopeForWebContents: vi.fn(),
      emitStreamEvent: vi.fn(),
      refreshStreamTaskMetadataForScope: vi.fn(async () => undefined),
      resetStreamState: vi.fn(),
      setTerminalTaskScopeForWebContents: vi.fn(),
      withStreamEvent: vi.fn(async (promise: Promise<unknown>) => promise),
    }));
    vi.doMock('./tasks/board', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./tasks/board')>();
      return {
        ...actual,
        startTaskBoardWatcher: vi.fn(() => vi.fn()),
      };
    });
    vi.doMock('./contextPack/watcher', () => ({
      startContextPackCatalogWatcher: vi.fn(),
      stopContextPackCatalogWatcher: vi.fn(),
    }));
    const { registerAppLifecycle } = await import('./main');

    registerAppLifecycle();

    await vi.waitFor(() => {
      expect(startRuntimeStreamWatcher).toHaveBeenCalledWith({
        listContextPacks: expect.any(Function),
        scopeProvider: expect.any(Function),
      });
    });
  });

  it('resets terminal streams only when a catalog watcher refresh changes active context-pack identity', async () => {
    vi.resetModules();
    const resetStreamState = vi.fn();
    const resetRuntimeStreamState = vi.fn();
    const refreshStreamTaskMetadataForScope = vi.fn(async () => undefined);
    const refreshCurrentActiveContextPackTaskScope = vi.fn()
      .mockResolvedValueOnce({
        previous: null,
        next: { contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'pack-a' },
        changed: true,
      })
      .mockResolvedValueOnce({
        previous: { contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'pack-a' },
        next: { contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'pack-a' },
        changed: false,
      })
      .mockResolvedValueOnce({
        previous: { contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'pack-a' },
        next: { contextPackId: 'pack-b', contextPackDir: '/packs/pack-b', contextPackName: 'pack-b' },
        changed: true,
      });
    const startContextPackCatalogWatcher = vi.fn();
    const windowSend = vi.fn();
    BrowserWindowMock.getAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { send: windowSend } },
    ]);
    vi.doMock('./contextPack/taskVisibility', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./contextPack/taskVisibility')>()),
      refreshCurrentActiveContextPackTaskScope,
    }));
    vi.doMock('./runtime/stream', () => ({
      clearTerminalTaskScopeForWebContents: vi.fn(),
      emitStreamEvent: vi.fn(),
      refreshStreamTaskMetadataForScope,
      resetStreamState,
      setTerminalTaskScopeForWebContents: vi.fn(),
      withStreamEvent: vi.fn(async (promise: Promise<unknown>) => promise),
    }));
    vi.doMock('./runtime/runtimeStream', () => ({
      refreshRuntimeStreamState: vi.fn(async () => undefined),
      resetRuntimeStreamState,
      startRuntimeStreamWatcher: vi.fn(() => vi.fn()),
    }));
    vi.doMock('./tasks/board', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./tasks/board')>();
      return {
        ...actual,
        startTaskBoardWatcher: vi.fn(() => vi.fn()),
      };
    });
    vi.doMock('./contextPack/watcher', () => ({
      startContextPackCatalogWatcher,
      stopContextPackCatalogWatcher: vi.fn(),
    }));

    const { registerAppLifecycle } = await import('./main');
    registerAppLifecycle();

    await vi.waitFor(() => {
      expect(startContextPackCatalogWatcher).toHaveBeenCalledOnce();
    });
    const onChange = startContextPackCatalogWatcher.mock.calls[0]?.[0]?.onChange as
      | ((event: { type: string }) => void)
      | undefined;
    expect(onChange).toBeTypeOf('function');

    onChange?.({ type: 'refreshed' });
    await vi.waitFor(() => {
      expect(refreshCurrentActiveContextPackTaskScope).toHaveBeenCalledTimes(2);
    });
    expect(windowSend).toHaveBeenCalledWith(
      CONTEXT_PACK_CATALOG_CHANGED_CHANNEL,
      { type: 'refreshed' },
    );
    expect(resetStreamState).toHaveBeenCalledTimes(1);
    expect(resetRuntimeStreamState).toHaveBeenCalledTimes(1);

    onChange?.({ type: 'identity-changed' });
    await vi.waitFor(() => {
      expect(refreshCurrentActiveContextPackTaskScope).toHaveBeenCalledTimes(3);
      expect(resetStreamState).toHaveBeenCalledTimes(2);
      expect(resetRuntimeStreamState).toHaveBeenCalledTimes(2);
    });
    expect(windowSend).toHaveBeenCalledWith(
      CONTEXT_PACK_CATALOG_CHANGED_CHANNEL,
      { type: 'identity-changed' },
    );

    vi.doUnmock('./contextPack/taskVisibility');
    vi.doUnmock('./runtime/stream');
    vi.doUnmock('./runtime/runtimeStream');
    vi.doUnmock('./tasks/board');
    vi.doUnmock('./contextPack/watcher');
  });

  it('logs startup task-registry repair failures without blocking bootstrap', async () => {
    vi.resetModules();
    const warnSpy = vi.fn();
    vi.doMock('./log/logger', () => ({
      createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
        child: vi.fn(),
      }),
      installProcessHandlers: vi.fn(() => vi.fn()),
    }));
    vi.doMock('../../../backend/platform/queue/taskRegistry.js', () => ({
      loadTaskRegistry: vi.fn(async () => ({ schema_version: 2, tasks: {} })),
      repairTaskRegistry: vi.fn(async () => {
        throw new Error('registry repair denied');
      }),
    }));
    vi.doMock('./tasks/board', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./tasks/board')>();
      return {
        ...actual,
        startTaskBoardWatcher: vi.fn(() => vi.fn()),
      };
    });
    vi.doMock('./contextPack/watcher', () => ({
      startContextPackCatalogWatcher: vi.fn(),
      stopContextPackCatalogWatcher: vi.fn(),
    }));
    vi.doMock('./runtime/runtimeStream', () => ({
      refreshRuntimeStreamState: vi.fn(async () => undefined),
      resetRuntimeStreamState: vi.fn(),
      startRuntimeStreamWatcher: vi.fn(() => vi.fn()),
    }));
    vi.doMock('./app/recovery', () => ({
      startTaskRecoveryController: vi.fn(() => ({ stop: vi.fn() })),
    }));

    const { registerAppLifecycle } = await import('./main');
    registerAppLifecycle();

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith('task-registry.repair.failed', {
        reason: 'registry repair denied',
      });
    });
    expect(appMock.whenReady).toHaveBeenCalled();
    vi.doUnmock('./log/logger');
    vi.doUnmock('../../../backend/platform/queue/taskRegistry.js');
    vi.doUnmock('./tasks/board');
    vi.doUnmock('./contextPack/watcher');
    vi.doUnmock('./runtime/runtimeStream');
    vi.doUnmock('./app/recovery');
  });

  it('logs unreadable stale agent receipts during startup cleanup', async () => {
    vi.resetModules();
    const warnSpy = vi.fn();
    const readdirMock = vi.fn(async (targetPath: string) => {
      if (targetPath.endsWith('/.platform-state/runtime/tasks')) {
        return ['task-1'];
      }
      if (targetPath.endsWith('/.platform-state/runtime/tasks/task-1/role-sessions')) {
        return ['alice.json'];
      }
      return [];
    });
    const readFileMock = vi.fn(async () => '{ malformed');
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        readdir: readdirMock,
        readFile: readFileMock,
      };
    });
    vi.doMock('./log/logger', () => ({
      createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
        child: vi.fn(),
      }),
      installProcessHandlers: vi.fn(() => vi.fn()),
    }));
    vi.doMock('../../../backend/platform/queue/taskRegistry.js', () => ({
      loadTaskRegistry: vi.fn(async () => ({ schema_version: 2, tasks: {} })),
      repairTaskRegistry: vi.fn(async () => ({})),
    }));
    vi.doMock('./tasks/board', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./tasks/board')>();
      return {
        ...actual,
        startTaskBoardWatcher: vi.fn(() => vi.fn()),
      };
    });
    vi.doMock('./contextPack/watcher', () => ({
      startContextPackCatalogWatcher: vi.fn(),
      stopContextPackCatalogWatcher: vi.fn(),
    }));
    vi.doMock('./runtime/runtimeStream', () => ({
      refreshRuntimeStreamState: vi.fn(async () => undefined),
      resetRuntimeStreamState: vi.fn(),
      startRuntimeStreamWatcher: vi.fn(() => vi.fn()),
    }));
    vi.doMock('./app/recovery', () => ({
      startTaskRecoveryController: vi.fn(() => ({ stop: vi.fn() })),
    }));

    const { registerAppLifecycle } = await import('./main');
    registerAppLifecycle();

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        'startup.recovery.receipt.read.failed',
        expect.objectContaining({
          receiptPath: expect.stringContaining('alice.json'),
          reason: expect.any(String),
        }),
      );
    });
    vi.doUnmock('node:fs/promises');
    vi.doUnmock('./log/logger');
    vi.doUnmock('../../../backend/platform/queue/taskRegistry.js');
    vi.doUnmock('./tasks/board');
    vi.doUnmock('./contextPack/watcher');
    vi.doUnmock('./runtime/runtimeStream');
    vi.doUnmock('./app/recovery');
  });

  it('focuses the existing main window when a second instance is launched', async () => {
    isMinimized.mockReturnValue(true);
    const { registerAppLifecycle, createWindow } = await import('./main');

    await createWindow();
    registerAppLifecycle();
    const secondInstanceHandler = appMock.on.mock.calls.find(([event]) => event === 'second-instance')?.[1] as
      | ((event: unknown, argv: string[], workingDirectory: string, additionalData: unknown) => void)
      | undefined;

    expect(secondInstanceHandler).toBeTypeOf('function');
    secondInstanceHandler?.({}, ['tasksail'], '/repo', {});

    expect(restore).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('ignores a second-instance event when no main window exists yet', async () => {
    const { registerAppLifecycle } = await import('./main');

    registerAppLifecycle();
    const secondInstanceHandler = appMock.on.mock.calls.find(([event]) => event === 'second-instance')?.[1] as
      | ((event: unknown, argv: string[], workingDirectory: string, additionalData: unknown) => void)
      | undefined;

    expect(() => secondInstanceHandler?.({}, ['tasksail'], '/repo', {})).not.toThrow();
    expect(focus).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
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
    vi.doMock('./planner/session', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./planner/session')>();
      return {
        ...actual,
        endSession,
      };
    });

    const { registerAppLifecycle } = await import('./main');
    registerAppLifecycle();

    const beforeQuitHandler = appMock.on.mock.calls.find(([event]) => event === 'before-quit')?.[1] as
      | ((event: { preventDefault: () => void }) => void)
      | undefined;
    expect(beforeQuitHandler).toBeTypeOf('function');

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });
    await vi.waitFor(() => {
      expect(endSession).toHaveBeenCalledOnce();
    });
    // Quit is deferred (preventDefault) until staging cleanup completes, then dispatched.
    expect(preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(appMock.quit).toHaveBeenCalled();
    });
    expect(cleanupWorkspaceOnQuitMock).toHaveBeenCalledOnce();
    expect(stopBackendServicesDetachedMock).toHaveBeenCalledWith(expect.any(String));
  });

  it('still dispatches the quit when planner-session cleanup fails during before-quit', async () => {
    vi.resetModules();
    const endSession = vi.fn(async () => {
      throw new Error('cleanup boom');
    });
    vi.doMock('./planner/session', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./planner/session')>();
      return {
        ...actual,
        endSession,
      };
    });

    const { registerAppLifecycle } = await import('./main');
    registerAppLifecycle();

    const beforeQuitHandler = appMock.on.mock.calls.find(([event]) => event === 'before-quit')?.[1] as
      | ((event: { preventDefault: () => void }) => void)
      | undefined;
    expect(beforeQuitHandler).toBeTypeOf('function');

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    // A rejected cleanup must not block shutdown — the quit is still dispatched.
    await vi.waitFor(() => {
      expect(appMock.quit).toHaveBeenCalled();
    });
    expect(endSession).toHaveBeenCalledOnce();
  });

  it('handles dev graceful restart without full workspace cleanup', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173');
    const existingMessageListeners = new Set(process.listeners('message'));

    try {
      const { registerAppLifecycle } = await import('./main');
      registerAppLifecycle();

      const addedMessageListeners = process.listeners('message')
        .filter((listener) => !existingMessageListeners.has(listener));
      expect(addedMessageListeners).toHaveLength(1);
      (addedMessageListeners[0] as (message: unknown) => void)(
        TASKSAIL_DEV_GRACEFUL_RESTART_MESSAGE,
      );

      expect(appMock.quit).toHaveBeenCalledOnce();

      const beforeQuitHandler = appMock.on.mock.calls.find(([event]) => event === 'before-quit')?.[1] as
        | (() => void)
        | undefined;
      expect(beforeQuitHandler).toBeTypeOf('function');

      beforeQuitHandler?.();

      expect(cleanupWorkspaceOnQuitMock).not.toHaveBeenCalled();
      expect(stopBackendServicesDetachedMock).not.toHaveBeenCalled();
    } finally {
      for (const listener of process.listeners('message')) {
        if (!existingMessageListeners.has(listener)) {
          process.off('message', listener as (...args: unknown[]) => void);
        }
      }
    }
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

  it('passes terminal.setTaskScope through with the IPC sender id', async () => {
    const { handleDesktopAction } = await import('./main');
    const setTerminalTaskScope = vi.fn(() => ({
      action: 'terminal.setTaskScope' as const,
      mode: 'scoped' as const,
      selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
      events: [],
      taskScopes: [],
      message: 'Terminal task scope updated.',
    }));

    await expect(
      handleDesktopAction(
        {
          action: 'terminal.setTaskScope',
          payload: { taskGuid: 'feedbeef-1234-4234-9234-123456789abc' },
        },
        { setTerminalTaskScope },
        { webContentsId: 42 },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'terminal.setTaskScope',
        selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
      }),
    });
    expect(setTerminalTaskScope).toHaveBeenCalledWith(
      42,
      'feedbeef-1234-4234-9234-123456789abc',
    );
  });

  it('requires sender context for terminal.setTaskScope', async () => {
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction({
        action: 'terminal.setTaskScope',
        payload: { taskGuid: null },
      }),
    ).resolves.toEqual({
      ok: false,
      action: 'terminal.setTaskScope',
      error: 'Terminal task scope requires an IPC sender.',
    });
  });

  it('refreshes context-pack task scope before emitting a successful switch event', async () => {
    vi.resetModules();
    const refreshCurrentActiveContextPackTaskScope = vi.fn(async () => ({
      previous: null,
      next: { contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'pack-a' },
      changed: true,
    }));
    const resetStreamState = vi.fn();
    const resetRuntimeStreamState = vi.fn();
    const emitStreamEvent = vi.fn();
    const refreshStreamTaskMetadataForScope = vi.fn(async () => undefined);
    vi.doMock('./contextPack/taskVisibility', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./contextPack/taskVisibility')>()),
      refreshCurrentActiveContextPackTaskScope,
    }));
    vi.doMock('./runtime/stream', () => ({
      clearTerminalTaskScopeForWebContents: vi.fn(),
      emitStreamEvent,
      refreshStreamTaskMetadataForScope,
      resetStreamState,
      setTerminalTaskScopeForWebContents: vi.fn(),
      withStreamEvent: vi.fn(async (promise: Promise<unknown>) => promise),
    }));
    vi.doMock('./runtime/runtimeStream', () => ({
      refreshRuntimeStreamState: vi.fn(async () => undefined),
      resetRuntimeStreamState,
      startRuntimeStreamWatcher: vi.fn(() => vi.fn()),
    }));
    vi.doMock('../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: vi.fn(() => []),
      stopPipeline: vi.fn(async () => undefined),
    }));

    const { handleDesktopAction } = await import('./main');
    const applyContextPackSwitch = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'contextPack.applySwitch' as const,
        mode: 'applied' as const,
        message: 'Applied.',
        commandPath: '/repo/src/backend/scripts/python/activate-context-pack-helper.py',
        result: {
          ok: true,
          wrapperAction: 'apply' as const,
          stage: 'applied',
          status: 'ok',
          activation: { performed: true, exitCode: 0, output: '' },
          envStateCleared: false,
          error: null,
          contextPackId: 'pack-a',
          contextPackDir: '/packs/pack-a',
          workspaceFile: null,
          stateFile: null,
          scopeMode: 'focused' as const,
          selectedRepoIds: [],
          selectedFocusIds: [],
          warnings: [],
          foldersToAdd: [],
          foldersToRemove: [],
          managedFolders: [],
          targetFolders: [],
          lastSyncedAt: null,
          deepFocusEnabled: false,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      },
    }));
    const listContextPacks = vi.fn(async () => ({
      action: 'contextPack.list' as const,
      mode: 'read-only' as const,
      message: 'listed',
      activeContextPackDir: '/packs/pack-a',
      configuredPaths: [],
      searchRoots: [],
      recentContextPackDirs: [],
      contextPacks: [],
    }));

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.applySwitch',
          payload: {
            contextPackDir: '/packs/pack-a',
            scopeMode: 'focused',
            selectedRepoIds: [],
            selectedFocusIds: [],
          },
        },
        { applyContextPackSwitch, listContextPacks },
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(refreshCurrentActiveContextPackTaskScope).toHaveBeenCalledWith(listContextPacks);
    expect(resetStreamState).toHaveBeenCalledOnce();
    expect(refreshStreamTaskMetadataForScope).toHaveBeenCalledOnce();
    expect(resetRuntimeStreamState).toHaveBeenCalledOnce();
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'contextPack.applySwitch',
    }));
    expect(refreshCurrentActiveContextPackTaskScope.mock.invocationCallOrder[0]).toBeLessThan(
      emitStreamEvent.mock.invocationCallOrder[0]!,
    );
  });

  it('clears context-pack task scope before emitting a successful clear event', async () => {
    vi.resetModules();
    const refreshCurrentActiveContextPackTaskScope = vi.fn(async () => ({
      previous: { contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'pack-a' },
      next: null,
      changed: true,
    }));
    const resetStreamState = vi.fn();
    const resetRuntimeStreamState = vi.fn();
    const emitStreamEvent = vi.fn();
    const refreshStreamTaskMetadataForScope = vi.fn(async () => undefined);
    vi.doMock('./contextPack/taskVisibility', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./contextPack/taskVisibility')>()),
      refreshCurrentActiveContextPackTaskScope,
    }));
    vi.doMock('./runtime/stream', () => ({
      clearTerminalTaskScopeForWebContents: vi.fn(),
      emitStreamEvent,
      refreshStreamTaskMetadataForScope,
      resetStreamState,
      setTerminalTaskScopeForWebContents: vi.fn(),
      withStreamEvent: vi.fn(async (promise: Promise<unknown>) => promise),
    }));
    vi.doMock('./runtime/runtimeStream', () => ({
      refreshRuntimeStreamState: vi.fn(async () => undefined),
      resetRuntimeStreamState,
      startRuntimeStreamWatcher: vi.fn(() => vi.fn()),
    }));
    vi.doMock('../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: vi.fn(() => []),
      stopPipeline: vi.fn(async () => undefined),
    }));

    const { handleDesktopAction } = await import('./main');
    const clearActiveContextPack = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'contextPack.clearActive' as const,
        mode: 'cleared' as const,
        message: 'Cleared.',
        commandPath: '/repo/src/backend/scripts/python/activate-context-pack-helper.py',
        result: {
          ok: true,
          wrapperAction: 'clear' as const,
          stage: 'cleared',
          status: 'ok',
          activation: { performed: false, exitCode: null, output: '' },
          envStateCleared: true,
          error: null,
          contextPackId: null,
          contextPackDir: null,
          workspaceFile: null,
          stateFile: null,
          scopeMode: null,
          selectedRepoIds: [],
          selectedFocusIds: [],
          warnings: [],
          foldersToAdd: [],
          foldersToRemove: [],
          managedFolders: [],
          targetFolders: [],
          lastSyncedAt: null,
          deepFocusEnabled: false,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      },
    }));
    const listContextPacks = vi.fn(async () => ({
      action: 'contextPack.list' as const,
      mode: 'read-only' as const,
      message: 'listed',
      activeContextPackDir: null,
      configuredPaths: [],
      searchRoots: [],
      recentContextPackDirs: [],
      contextPacks: [],
    }));

    await expect(
      handleDesktopAction(
        { action: 'contextPack.clearActive' },
        { clearActiveContextPack, listContextPacks },
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(refreshCurrentActiveContextPackTaskScope).toHaveBeenCalledWith(listContextPacks);
    expect(resetStreamState).toHaveBeenCalledOnce();
    expect(refreshStreamTaskMetadataForScope).toHaveBeenCalledOnce();
    expect(resetRuntimeStreamState).toHaveBeenCalledOnce();
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'contextPack.clearActive',
    }));
    expect(resetStreamState.mock.invocationCallOrder[0]).toBeLessThan(
      emitStreamEvent.mock.invocationCallOrder[0]!,
    );
  });

  it('allows context-pack switch and clear while pipelines are active', async () => {
    vi.resetModules();
    const refreshCurrentActiveContextPackTaskScope = vi.fn();
    const resetStreamState = vi.fn();
    const resetRuntimeStreamState = vi.fn();
    const emitStreamEvent = vi.fn();
    vi.doMock('./contextPack/taskVisibility', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./contextPack/taskVisibility')>()),
      refreshCurrentActiveContextPackTaskScope,
    }));
    vi.doMock('./runtime/stream', () => ({
      clearTerminalTaskScopeForWebContents: vi.fn(),
      emitStreamEvent,
      refreshStreamTaskMetadataForScope: vi.fn(async () => undefined),
      resetStreamState,
      setTerminalTaskScopeForWebContents: vi.fn(),
      withStreamEvent: vi.fn(async (promise: Promise<unknown>) => promise),
    }));
    vi.doMock('./runtime/runtimeStream', () => ({
      refreshRuntimeStreamState: vi.fn(async () => undefined),
      resetRuntimeStreamState,
      startRuntimeStreamWatcher: vi.fn(() => vi.fn()),
    }));
    vi.doMock('../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: vi.fn(() => [{ taskId: 'TASK-A' }]),
      stopPipeline: vi.fn(async () => undefined),
    }));

    const { handleDesktopAction } = await import('./main');
    const applyContextPackSwitch = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'contextPack.applySwitch' as const,
        mode: 'applied' as const,
        message: 'Applied.',
        commandPath: '/repo/src/backend/scripts/python/activate-context-pack-helper.py',
        result: {
          ok: true,
          wrapperAction: 'apply' as const,
          stage: 'applied',
          status: 'ok',
          activation: { performed: true, exitCode: 0, output: '' },
          envStateCleared: false,
          error: null,
          contextPackId: 'pack-a',
          contextPackDir: '/packs/pack-a',
          workspaceFile: null,
          stateFile: null,
          scopeMode: 'focused' as const,
          selectedRepoIds: [],
          selectedFocusIds: [],
          warnings: [],
          foldersToAdd: [],
          foldersToRemove: [],
          managedFolders: [],
          targetFolders: [],
          lastSyncedAt: null,
          deepFocusEnabled: false,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      },
    }));
    const clearActiveContextPack = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'contextPack.clearActive' as const,
        mode: 'cleared' as const,
        message: 'Cleared.',
        commandPath: '/repo/src/backend/scripts/python/activate-context-pack-helper.py',
        result: {
          ok: true,
          wrapperAction: 'clear' as const,
          stage: 'cleared',
          status: 'ok',
          activation: { performed: false, exitCode: null, output: '' },
          envStateCleared: true,
          error: null,
          contextPackId: null,
          contextPackDir: null,
          workspaceFile: null,
          stateFile: null,
          scopeMode: null,
          selectedRepoIds: [],
          selectedFocusIds: [],
          warnings: [],
          foldersToAdd: [],
          foldersToRemove: [],
          managedFolders: [],
          targetFolders: [],
          lastSyncedAt: null,
          deepFocusEnabled: false,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      },
    }));
    const listContextPacks = vi.fn(async () => ({
      action: 'contextPack.list' as const,
      mode: 'read-only' as const,
      message: 'listed',
      activeContextPackDir: '/packs/pack-a',
      configuredPaths: [],
      searchRoots: [],
      recentContextPackDirs: [],
      contextPacks: [],
    }));

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.applySwitch',
          payload: {
            contextPackDir: '/packs/pack-a',
            scopeMode: 'focused',
            selectedRepoIds: [],
            selectedFocusIds: [],
          },
        },
        { applyContextPackSwitch, listContextPacks },
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(
      handleDesktopAction(
        { action: 'contextPack.clearActive' },
        { clearActiveContextPack, listContextPacks },
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(applyContextPackSwitch).toHaveBeenCalledOnce();
    expect(clearActiveContextPack).toHaveBeenCalledOnce();
    expect(refreshCurrentActiveContextPackTaskScope).toHaveBeenCalledTimes(2);
    expect(resetStreamState).toHaveBeenCalledTimes(2);
    expect(resetRuntimeStreamState).toHaveBeenCalledTimes(2);
    expect(emitStreamEvent).toHaveBeenCalledTimes(2);
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
    vi.doMock('./tasks/board', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./tasks/board')>();
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

  describe('planner.uploadSpec dispatch — immutable sidecar wiring', () => {
    const uploadedContent = '## Request Summary\n\nUpload immutable scope through dispatch.\n';

    function buildSidecar(
      sessionId: string,
      taskKind: 'standard' | 'child-task' = 'standard',
    ) {
      return {
        version: 1 as const,
        ownership: 'planner-session' as const,
        sessionId,
        draftFilename: 'draft.md',
        draftPath: '/repo/AgentWorkSpace/dropbox/.staging/draft.md',
        createdAt: '2026-03-07T18:20:00Z',
        title: 'pack / focus',
        primaryRepoId: 'repo',
        primaryRepoRoot: '/repo',
        primaryFocusRelativePath: 'focus',
        deepFocusEnabled: false,
        primaryFocusTargetKind: null,
        primaryFocusTargets: [],
        selectedTestTarget: null,
        supportTargets: [],
        lineage: {
          taskKind,
          parentTaskId: '',
          rootTaskId: '',
          parentQmdRecordId: '',
          parentQmdScope: '',
          followUpReason: '',
        },
        contextPackBinding: {
          contextPackDir: '/context-pack',
          contextPackId: 'pack',
          scopeMode: 'focus-selection',
          selectedRepoIds: ['repo'],
          selectedFocusIds: ['focus'],
          deepFocusEnabled: false,
          selectedFocusPath: 'focus',
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      };
    }

    async function loadHandlerWithMocks(
      sessionId: string | undefined,
      sidecarSessionId: string | null,
    ) {
      vi.resetModules();
      const sidecar = sidecarSessionId === null ? null : buildSidecar(sidecarSessionId);
      const readPlannerStagingSidecar = vi.fn(async () => sidecar);
      const getObservability = vi.fn(() => ({ sessionId }));

      vi.doMock('./planner/staging', async (importOriginal) => {
        const actual = await importOriginal<typeof import('./planner/staging')>();
        return { ...actual, readPlannerStagingSidecar };
      });
      vi.doMock('./planner/session', async (importOriginal) => {
        const actual = await importOriginal<typeof import('./planner/session')>();
        return { ...actual, getObservability };
      });

      const { handleDesktopAction } = await import('./main');
      return { handleDesktopAction, sidecar, readPlannerStagingSidecar };
    }

    it('forwards the active planner sidecar to uploadSpec when the session id matches', async () => {
      const { handleDesktopAction, sidecar, readPlannerStagingSidecar } =
        await loadHandlerWithMocks('planner-active', 'planner-active');
      const uploadSpec = vi.fn(async () => ({
        ok: true as const,
        response: {
          action: 'planner.uploadSpec' as const,
          mode: 'submitted' as const,
          accepted: true as const,
          message: 'ok',
          draftTitle: 'pack / focus',
          submittedPath: '/repo/AgentWorkSpace/dropbox/test.md',
          observationMode: true as const,
        },
      }));

      await handleDesktopAction(
        { action: 'planner.uploadSpec', payload: { content: uploadedContent } },
        { uploadSpec },
      );

      expect(readPlannerStagingSidecar).toHaveBeenCalledTimes(1);
      expect(uploadSpec).toHaveBeenCalledWith(uploadedContent, { plannerSidecar: sidecar });
    });

    it('passes a null sidecar when the staged sidecar belongs to a stale planner session', async () => {
      const { handleDesktopAction } = await loadHandlerWithMocks('planner-active', 'planner-stale');
      const uploadSpec = vi.fn(async () => ({
        ok: true as const,
        response: {
          action: 'planner.uploadSpec' as const,
          mode: 'submitted' as const,
          accepted: true as const,
          message: 'ok',
          draftTitle: 'pack / focus',
          submittedPath: '/repo/AgentWorkSpace/dropbox/test.md',
          observationMode: true as const,
        },
      }));

      await handleDesktopAction(
        { action: 'planner.uploadSpec', payload: { content: uploadedContent } },
        { uploadSpec },
      );

      expect(uploadSpec).toHaveBeenCalledWith(uploadedContent, { plannerSidecar: null });
    });

    it('rejects child-task or recent uploads when the selected task sidecar is not active', async () => {
      const { handleDesktopAction } = await loadHandlerWithMocks('planner-active', 'planner-stale');
      const uploadSpec = vi.fn();

      await expect(
        handleDesktopAction(
          {
            action: 'planner.uploadSpec',
            payload: {
              content: uploadedContent,
              requirePlannerSidecar: true,
              expectedTaskKind: 'child-task',
            },
          },
          { uploadSpec },
        ),
      ).resolves.toEqual({
        ok: false,
        action: 'planner.uploadSpec',
        error: 'Bypass Planner upload for child-task or recent-task mode requires the active planner sidecar. Wait for the selected task session to finish connecting, then retry.',
      });
      expect(uploadSpec).not.toHaveBeenCalled();
    });

    it('rejects child-task or recent uploads when no planner session is active', async () => {
      const { handleDesktopAction, readPlannerStagingSidecar } =
        await loadHandlerWithMocks(undefined, 'planner-stale');
      const uploadSpec = vi.fn();

      await expect(
        handleDesktopAction(
          {
            action: 'planner.uploadSpec',
            payload: {
              content: uploadedContent,
              requirePlannerSidecar: true,
              expectedTaskKind: 'standard',
            },
          },
          { uploadSpec },
        ),
      ).resolves.toEqual({
        ok: false,
        action: 'planner.uploadSpec',
        error: 'Bypass Planner upload for child-task or recent-task mode requires the active planner sidecar. Wait for the selected task session to finish connecting, then retry.',
      });
      expect(readPlannerStagingSidecar).not.toHaveBeenCalled();
      expect(uploadSpec).not.toHaveBeenCalled();
    });

    it('rejects task-kind assertions without sidecar authority', async () => {
      const { handleDesktopAction } = await loadHandlerWithMocks('planner-active', 'planner-active');
      const uploadSpec = vi.fn();

      await expect(
        handleDesktopAction(
          {
            action: 'planner.uploadSpec',
            payload: {
              content: uploadedContent,
              expectedTaskKind: 'child-task',
            },
          },
          { uploadSpec },
        ),
      ).resolves.toEqual({
        ok: false,
        action: 'planner.uploadSpec',
        error: 'Desktop action request failed runtime validation.',
        details: ['payload.expectedTaskKind requires payload.requirePlannerSidecar to be true.'],
      });
      expect(uploadSpec).not.toHaveBeenCalled();
    });

    it('rejects uploads when the active sidecar task kind does not match the selected bypass mode', async () => {
      vi.resetModules();
      const sidecar = buildSidecar('planner-active', 'standard');
      vi.doMock('./planner/staging', async (importOriginal) => {
        const actual = await importOriginal<typeof import('./planner/staging')>();
        return { ...actual, readPlannerStagingSidecar: vi.fn(async () => sidecar) };
      });
      vi.doMock('./planner/session', async (importOriginal) => {
        const actual = await importOriginal<typeof import('./planner/session')>();
        return { ...actual, getObservability: vi.fn(() => ({ sessionId: 'planner-active' })) };
      });
      const { handleDesktopAction } = await import('./main');
      const uploadSpec = vi.fn();

      await expect(
        handleDesktopAction(
          {
            action: 'planner.uploadSpec',
            payload: {
              content: uploadedContent,
              requirePlannerSidecar: true,
              expectedTaskKind: 'child-task',
            },
          },
          { uploadSpec },
        ),
      ).resolves.toEqual({
        ok: false,
        action: 'planner.uploadSpec',
        error: 'Platform expected child-task but active planner metadata declares standard. Restart the planner session before uploading.',
      });
      expect(uploadSpec).not.toHaveBeenCalled();
    });

    it('skips reading the sidecar and forwards a null sidecar when no planner session is active', async () => {
      const { handleDesktopAction, readPlannerStagingSidecar } =
        await loadHandlerWithMocks(undefined, 'planner-stale');
      const uploadSpec = vi.fn(async () => ({
        ok: true as const,
        response: {
          action: 'planner.uploadSpec' as const,
          mode: 'submitted' as const,
          accepted: true as const,
          message: 'ok',
          draftTitle: 'pack / focus',
          submittedPath: '/repo/AgentWorkSpace/dropbox/test.md',
          observationMode: true as const,
        },
      }));

      await handleDesktopAction(
        { action: 'planner.uploadSpec', payload: { content: uploadedContent } },
        { uploadSpec },
      );

      expect(readPlannerStagingSidecar).not.toHaveBeenCalled();
      expect(uploadSpec).toHaveBeenCalledWith(uploadedContent, { plannerSidecar: null });
    });
  });

});
