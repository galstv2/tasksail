// @vitest-environment node
//
// Startup registry repair queue-lock guard tests.
// Verifies that repairTaskRegistry is NOT called when the queue lock is held,
// and IS called when the lock is available.
//
// All interleaving is forced deterministically via mock control — no real race.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Mocks (vi.mock factories are hoisted) ─────────────────────────────────

vi.mock('../../../../backend/platform/queue/taskRegistry.js', () => ({
  repairTaskRegistry: vi.fn(async () => ({ schema_version: 2, tasks: {} })),
}));

vi.mock('../../../../backend/platform/queue/index.js', () => ({
  acquireDirLock: vi.fn(),
  resolveQueuePaths: vi.fn(() => ({
    queueLockDir: '/repo/AgentWorkSpace/pendingitems/.queue-lock.d',
  })),
}));

vi.mock('../paths', () => ({ REPO_ROOT: '/repo' }));

vi.mock('../log/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
  installProcessHandlers: vi.fn(() => vi.fn()),
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    quit: vi.fn(),
    dock: undefined,
    commandLine: undefined,
    whenReady: vi.fn(() => Promise.resolve()),
  },
  BrowserWindow: Object.assign(vi.fn(() => ({})), {
    getAllWindows: vi.fn(() => []),
  }),
  nativeImage: { createFromPath: vi.fn() },
}));

vi.mock('../planner/session', () => ({ endSession: vi.fn(async () => undefined) }));
vi.mock('./services', () => ({
  autoStartBackendServices: vi.fn(async () => undefined),
  stopBackendServicesDetached: vi.fn(),
}));
vi.mock('../log/ipcLogHandler', () => ({ registerIpcLogHandler: vi.fn() }));
vi.mock('../tasks/board', () => ({ startTaskBoardWatcher: vi.fn(() => vi.fn()) }));
vi.mock('./recovery', () => ({
  startTaskRecoveryController: vi.fn(() => ({
    noteActivatedPendingItem: vi.fn(),
    reconcileNow: vi.fn(),
    stop: vi.fn(),
  })),
}));
vi.mock('../runtime/runtimeStream', () => ({ startRuntimeStreamWatcher: vi.fn(() => vi.fn()) }));
vi.mock('../contextPack/taskVisibility', () => ({
  getCurrentActiveContextPackTaskScope: vi.fn(() => null),
  refreshCurrentActiveContextPackTaskScope: vi.fn(async () => ({ changed: false })),
}));
vi.mock('./cleanup', () => ({ cleanupWorkspaceOnQuit: vi.fn() }));
vi.mock('./windowManager', () => ({
  createWindow: vi.fn(async () => undefined),
  focusMainWindow: vi.fn(),
}));
vi.mock('./startupRecovery', () => ({
  cleanupStalePipelineState: vi.fn(async () => undefined),
  schedulePipelineAutoStart: vi.fn(),
}));
vi.mock('../planner/parentBranchView', () => ({
  recoverPlannerParentBranchViewsOnStartup: vi.fn(async () => undefined),
}));
vi.mock('../runtime/terminalScopeRefresh', () => ({
  refreshTerminalScopeCaches: vi.fn(async () => undefined),
}));
vi.mock('../ipc/desktopActionHandlers', () => ({
  createDefaultDesktopActionHandlers: vi.fn(() => ({})),
}));
vi.mock('./restart', () => ({ restartTaskSailApp: vi.fn() }));
vi.mock('../ipc/desktopActionRouter', () => ({
  DesktopActionRouter: class { },
}));
vi.mock('../ipc/contract', () => ({
  DesktopIpcContract: class {
    register() { /* no-op */ }
  },
}));
vi.mock('../contextPack', () => ({
  getContextPackCatalogRoots: vi.fn(() => []),
  listAvailableContextPacks: vi.fn(async () => []),
}));
vi.mock('../contextPack/watcher', () => ({
  startContextPackCatalogWatcher: vi.fn(),
  stopContextPackCatalogWatcher: vi.fn(),
}));
vi.mock('../tasks/notifications', () => ({
  startTaskNotificationRuntime: vi.fn(() => vi.fn()),
}));

// ── Imports under test (after vi.mock declarations) ───────────────────────

import { ElectronAppController } from './appController';
import { app as mockedApp, nativeImage as mockedNativeImage } from 'electron';
import * as queueIndex from '../../../../backend/platform/queue/index.js';
import * as taskRegistryMod from '../../../../backend/platform/queue/taskRegistry.js';

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Drive the startup repair path.
 * app.whenReady() is mocked to resolve immediately via Promise.resolve(), so
 * .then() fires in the next microtask tick. Flush enough ticks to let the
 * fire-and-forget IIFE (the guard + repair) complete.
 */
async function driveStartupRepair(): Promise<void> {
  const controller = new ElectronAppController({ hasSingleInstanceLock: true });
  controller.registerAppLifecycle();
  // Flush the microtask queue across the full async startup chain.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ElectronAppController startup repair — queue-lock guard (Track L)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips repairTaskRegistry when the queue lock is held (defers gracefully)', async () => {
    // Simulate lock held: acquireDirLock returns null immediately.
    vi.mocked(queueIndex.acquireDirLock).mockResolvedValueOnce(null);

    await driveStartupRepair();

    // acquireDirLock must be called with maxRetries=1, backoffMs=0 — a single
    // non-blocking attempt.  maxRetries=0 would never acquire even when free,
    // so asserting the exact argument catches that regression.
    expect(queueIndex.acquireDirLock).toHaveBeenCalledOnce();
    expect(queueIndex.acquireDirLock).toHaveBeenCalledWith(
      '/repo/AgentWorkSpace/pendingitems/.queue-lock.d',
      1,
      0,
    );
    // Repair must NOT run while lock is held.
    expect(taskRegistryMod.repairTaskRegistry).not.toHaveBeenCalled();
  });

  it('runs repairTaskRegistry and releases the lock when the lock is available', async () => {
    const releaseFn = vi.fn(async () => undefined);
    vi.mocked(queueIndex.acquireDirLock).mockResolvedValueOnce(releaseFn);
    vi.mocked(taskRegistryMod.repairTaskRegistry).mockResolvedValueOnce({
      schema_version: 2,
      tasks: {},
    });

    await driveStartupRepair();

    expect(queueIndex.acquireDirLock).toHaveBeenCalledOnce();
    expect(taskRegistryMod.repairTaskRegistry).toHaveBeenCalledOnce();
    expect(taskRegistryMod.repairTaskRegistry).toHaveBeenCalledWith('/repo');
    // Lock must be released after repair completes.
    expect(releaseFn).toHaveBeenCalledOnce();
  });

  it('releases the lock even when repairTaskRegistry throws', async () => {
    const releaseFn = vi.fn(async () => undefined);
    vi.mocked(queueIndex.acquireDirLock).mockResolvedValueOnce(releaseFn);
    vi.mocked(taskRegistryMod.repairTaskRegistry).mockRejectedValueOnce(
      new Error('scan-failed'),
    );

    await driveStartupRepair();

    // Lock must be released even when repair throws (finally block).
    expect(releaseFn).toHaveBeenCalledOnce();
    // repairTaskRegistry was invoked (just threw).
    expect(taskRegistryMod.repairTaskRegistry).toHaveBeenCalledOnce();
  });
});

// macOS dock icon path is bundle-relative: join(__dirname, '..', 'build',
// 'icon.png'). Under Vitest __dirname is electron/app (== this test's dir); at
// runtime it is dist-electron, so the same shape resolves to build/icon.png.
// Assert the RELATIVE shape, not a source-context absolute string. The literal
// must NOT gain an extra ../ for the deeper source dir (criticalConstraint/AD5).
describe('ElectronAppController macOS dock icon (bundle-relative shape, guards the app/ move)', () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    (mockedApp as unknown as { dock: { setIcon: ReturnType<typeof vi.fn> } }).dock = {
      setIcon: vi.fn(),
    };
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    (mockedApp as unknown as { dock: unknown }).dock = undefined;
  });

  it('sets the dock icon from join(__dirname, "..", "build", "icon.png")', async () => {
    await driveStartupRepair();
    expect(mockedNativeImage.createFromPath).toHaveBeenCalledWith(
      join(moduleDir, '..', 'build', 'icon.png'),
    );
    expect(
      (mockedApp as unknown as { dock: { setIcon: ReturnType<typeof vi.fn> } }).dock.setIcon,
    ).toHaveBeenCalledOnce();
  });
});
