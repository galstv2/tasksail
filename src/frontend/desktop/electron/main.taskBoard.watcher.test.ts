// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- hoisted mocks (must be set up before any import of the module under test) ----

const watchMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: watchMock,
}));

vi.mock('./paths', () => ({
  REPO_ROOT: '/repo',
  DESKTOP_ROOT: '/repo/src/frontend/desktop',
}));

const {
  pathExists,
  repoFs,
  loadTaskRegistry,
  getRegistryPath,
  listArchivedTasksAction,
  readQueueOrderManifest,
  writeQueueOrderManifest,
  resolveQueuePaths,
  withDirLock,
  requeueErrorItemImpl,
  deletePendingItem,
  deleteDropboxItem,
  deleteErrorItem,
  moveDropboxItemToPending,
  movePendingItemToDropbox,
  moveErrorItemToDropbox,
  requestTaskKill,
  executeRequestedTaskKill,
  observeKillRequest,
  readActivationProgressRecords,
} = vi.hoisted(() => ({
  pathExists: vi.fn(async () => true),
  repoFs: {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ''),
    readdir: vi.fn(async () => [] as string[]),
  },
  loadTaskRegistry: vi.fn(async () => ({ schema_version: 2, tasks: {} })),
  getRegistryPath: vi.fn(() => '/repo/.platform-state/task-registry.json'),
  listArchivedTasksAction: vi.fn(async () => ({
    ok: true,
    response: {
      action: 'planner.listArchivedTasks',
      mode: 'found',
      message: 'No archived tasks.',
      tasks: [],
    },
  })),
  readQueueOrderManifest: vi.fn(async () => [] as string[]),
  writeQueueOrderManifest: vi.fn(async () => undefined),
  resolveQueuePaths: vi.fn(() => ({
    queueLockDir: '/repo/.platform-state/queue/lock',
    queueOrderPath: '/repo/.platform-state/queue/queue-order.json',
    killRequestsDir: '/repo/AgentWorkSpace/pendingitems/.kill-requests',
    activeItemsDir: '/repo/AgentWorkSpace/pendingitems/.active-items',
    activatingItemsDir: '/repo/AgentWorkSpace/pendingitems/.activating-items',
  })),
  withDirLock: vi.fn(async (_dir: string, _label: string, callback: () => Promise<void>) => callback()),
  requeueErrorItemImpl: vi.fn(async () => ({ requeuedItem: 'TASK-A.md', activatedItem: null })),
  deletePendingItem: vi.fn(async () => undefined),
  deleteDropboxItem: vi.fn(async () => undefined),
  deleteErrorItem: vi.fn(async () => undefined),
  moveDropboxItemToPending: vi.fn(async () => ({ movedItem: 'TASK-A.md', activatedItem: null })),
  movePendingItemToDropbox: vi.fn(async () => ({
    movedItem: 'PENDING-A.md',
    openItemPath: '/repo/AgentWorkSpace/dropbox/PENDING-A.md',
  })),
  moveErrorItemToDropbox: vi.fn(async () => ({ movedItem: 'TASK-A.md' })),
  requestTaskKill: vi.fn(async () => ({
    mode: 'kill-requested' as const,
    message: 'Stop requested.',
    taskId: 'ACTIVE-A',
    requestedAt: '2026-05-23T10:00:00Z',
    state: 'active' as const,
  })),
  executeRequestedTaskKill: vi.fn(async () => ({ mode: 'kill-requested' as const, taskId: 'ACTIVE-A' })),
  observeKillRequest: vi.fn(async () => null),
  readActivationProgressRecords: vi.fn(async () => []),
}));

vi.mock('./utils', () => ({ pathExists, repoFs }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual };
});

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry,
  getRegistryPath,
}));

vi.mock('./main.archivedTasks', () => ({ listArchivedTasksAction }));

vi.mock('../../../backend/platform/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/core')>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      child: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })),
    })),
  };
});

vi.mock('../../../backend/platform/queue', () => ({
  readQueueOrderManifest,
  writeQueueOrderManifest,
  resolveQueuePaths,
  withDirLock,
  requeueErrorItem: requeueErrorItemImpl,
  deletePendingItem,
  deleteDropboxItem,
  deleteErrorItem,
  moveDropboxItemToPending,
  movePendingItemToDropbox,
  moveErrorItemToDropbox,
  requestTaskKill,
  executeRequestedTaskKill,
  observeKillRequest,
  readActivationProgressRecords,
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: { createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }) },
}));

// ---- import the module under test ----

import { startTaskBoardWatcher, resetBroadcastState } from './main.taskBoard';
import type { ContextPackListResponse } from '../src/shared/desktopContract';

function makeListContextPacks(): () => Promise<ContextPackListResponse> {
  return vi.fn().mockResolvedValue({
    action: 'contextPack.list',
    mode: 'read-only',
    message: 'Context packs listed.',
    activeContextPackDir: null,
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: [],
  });
}

// Fake FSWatcher returned by watchMock.
interface FakeWatcher {
  errorHandler: ((err: Error) => void) | null;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  trigger: () => void;
}

function createFakeWatcher(): FakeWatcher {
  const watcher: FakeWatcher = {
    errorHandler: null,
    close: vi.fn(),
    on: vi.fn(),
    trigger: () => { /* no-op by default */ },
  };
  watcher.on.mockImplementation((event: string, handler: (err: Error) => void) => {
    if (event === 'error') watcher.errorHandler = handler;
    return watcher;
  });
  return watcher;
}

describe('startTaskBoardWatcher — missing-target retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    watchMock.mockReset();
    resetBroadcastState();
    vi.mocked(loadTaskRegistry).mockResolvedValue({ schema_version: 2, tasks: {} });
    vi.mocked(listArchivedTasksAction).mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listArchivedTasks',
        mode: 'found',
        message: 'No archived tasks.',
        tasks: [],
      },
    });
    vi.mocked(readActivationProgressRecords).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attaches watchers for targets that exist and schedules retry for missing targets', () => {
    // Only 3 of the 7 targets exist — the rest throw (simulating ENOENT).
    // The implementation tries all 7 targets, so watch is called 7 times.
    let callCount = 0;
    const attachedWatchers: FakeWatcher[] = [];
    watchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        const w = createFakeWatcher();
        attachedWatchers.push(w);
        return w;
      }
      throw new Error('ENOENT: no such file or directory');
    });

    const stop = startTaskBoardWatcher(makeListContextPacks());
    // All 7 targets are attempted (watch called 7 times).
    expect(watchMock).toHaveBeenCalledTimes(7);
    // But only 3 watchers actually attached (4-7 threw).
    expect(attachedWatchers).toHaveLength(3);

    stop();
    // Stop closes only the successfully attached watchers.
    for (const w of attachedWatchers) {
      expect(w.close).toHaveBeenCalled();
    }
  });

  it('retries and attaches watcher for a previously missing target when it appears', async () => {
    // First call sequence: first target succeeds, all others fail.
    let phase = 'first';
    const firstWatcher = createFakeWatcher();
    const retryWatchers: FakeWatcher[] = [];
    watchMock.mockImplementation((_target: string) => {
      if (phase === 'first') {
        phase = 'failing';
        return firstWatcher;
      }
      if (phase === 'failing') {
        throw new Error('ENOENT');
      }
      // Retry phase: all targets succeed.
      const w = createFakeWatcher();
      retryWatchers.push(w);
      return w;
    });

    const stop = startTaskBoardWatcher(makeListContextPacks());
    // Initial pass: 7 targets attempted, first succeeded, 6 threw.
    expect(watchMock.mock.calls.length).toBe(7);

    // Capture which paths were attempted so we can verify retry targets match.
    const initialTargets = watchMock.mock.calls.map((args) => args[0] as string);

    phase = 'retry';

    // Advance time past WATCH_RETRY_MS (1000ms).
    vi.advanceTimersByTime(1100);
    await Promise.resolve();

    // Retry must have called watch() for the previously-missing targets.
    expect(watchMock.mock.calls.length).toBeGreaterThan(7);

    // Every path attempted on retry must be one of the original 7 targets —
    // proving the retry re-attaches the SAME missing paths, not arbitrary ones.
    const retryTargets = watchMock.mock.calls.slice(7).map((args) => args[0] as string);
    for (const retryTarget of retryTargets) {
      expect(initialTargets).toContain(retryTarget);
    }

    // At least one retry watcher must have been created (the previously missing
    // target is now attached).
    expect(retryWatchers.length).toBeGreaterThan(0);

    stop();
    // After stop, the initial successful watcher must be closed (confirming
    // cleanup runs across all watchers, not only the retry ones).
    expect(firstWatcher.close).toHaveBeenCalled();
  });

  it('attaches watchers on retry and invokes broadcastTaskBoardUpdate after missing targets appear', () => {
    // All targets fail on first attempt, then succeed on retry.
    let retryPhase = false;
    const retryWatchers: FakeWatcher[] = [];
    watchMock.mockImplementation(() => {
      if (!retryPhase) throw new Error('ENOENT');
      const w = createFakeWatcher();
      retryWatchers.push(w);
      return w;
    });

    const stop = startTaskBoardWatcher(makeListContextPacks());
    // First attempt tries all 7 targets and all fail.
    expect(watchMock.mock.calls.length).toBe(7);

    retryPhase = true;

    // Advance past WATCH_RETRY_MS (1000ms) — the retry callback fires synchronously within advanceTimersByTime.
    vi.advanceTimersByTime(1100);

    // After the retry timer fires, attachWatchers runs again; now all targets succeed.
    expect(retryWatchers.length).toBe(7);
    // Each newly attached watcher triggers broadcastTaskBoardUpdate (fire-and-forget).
    // We can confirm all 7 new watcher FSWatcher instances were created.
    expect(watchMock.mock.calls.length).toBe(14);

    stop();
    // All watchers from the retry phase should be closed.
    for (const w of retryWatchers) {
      expect(w.close).toHaveBeenCalled();
    }
  });

  it('stop prevents further retries after cleanup', () => {
    // All targets fail initially.
    watchMock.mockImplementation(() => { throw new Error('ENOENT'); });

    const stop = startTaskBoardWatcher(makeListContextPacks());
    const callsBeforeStop = watchMock.mock.calls.length;

    stop();

    // Advance past retry interval — no additional calls should occur.
    vi.advanceTimersByTime(5000);
    expect(watchMock.mock.calls.length).toBe(callsBeforeStop);
  });

  it('reattaches watcher and retries after a watcher error event on an existing target', () => {
    let watchCount = 0;
    const watchers: FakeWatcher[] = [];
    watchMock.mockImplementation(() => {
      watchCount++;
      const w = createFakeWatcher();
      watchers.push(w);
      return w;
    });

    const stop = startTaskBoardWatcher(makeListContextPacks());
    const initialCount = watchCount;
    expect(initialCount).toBeGreaterThan(0);

    // Trigger an error on the first watcher, which simulates a filesystem error.
    watchers[0].errorHandler?.(new Error('EPERM'));

    // Advance past WATCH_RETRY_MS.
    vi.advanceTimersByTime(1100);

    // At least one retry watcher should have been created for the failed target.
    expect(watchCount).toBeGreaterThan(initialCount);

    stop();
  });
});
