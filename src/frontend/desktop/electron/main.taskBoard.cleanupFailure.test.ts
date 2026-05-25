// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('./paths', () => ({
  REPO_ROOT: '/repo',
}));

const {
  pathExists,
  repoFs,
  readFile,
  readdir,
  loadTaskRegistry,
  listArchivedTasksAction,
  readQueueOrderManifest,
  writeQueueOrderManifest,
  resolveQueuePaths,
  withDirLock,
  executeRequestedTaskKill,
  requestTaskKill,
  observeKillRequest,
  readActivationProgressRecords,
  logError,
} = vi.hoisted(() => ({
  pathExists: vi.fn(async () => true),
  repoFs: {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ''),
    readdir: vi.fn(async () => [] as string[]),
  },
  readFile: vi.fn(async () => ''),
  readdir: vi.fn(async () => [] as string[]),
  loadTaskRegistry: vi.fn(),
  listArchivedTasksAction: vi.fn(),
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
  executeRequestedTaskKill: vi.fn(async () => ({ mode: 'kill-requested' as const, taskId: 'ACTIVE-A' })),
  requestTaskKill: vi.fn(async () => ({
    mode: 'kill-requested' as const,
    message: 'Stop requested.',
    taskId: 'ACTIVE-A',
    requestedAt: '2026-05-24T10:00:00Z',
    state: 'active' as const,
  })),
  observeKillRequest: vi.fn<() => Promise<any>>(async () => null),
  readActivationProgressRecords: vi.fn(async () => []),
  logError: vi.fn(),
}));

vi.mock('./utils', () => ({
  pathExists,
  repoFs,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile, readdir };
});

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry,
  getRegistryPath: vi.fn(() => '/repo/.platform-state/task-registry.json'),
}));

vi.mock('./main.archivedTasks', () => ({
  listArchivedTasksAction,
}));

vi.mock('../../../backend/platform/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/core')>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      error: logError,
      warn: vi.fn(),
      info: vi.fn(),
      child: vi.fn(() => ({ error: logError, warn: vi.fn(), info: vi.fn() })),
    })),
  };
});

vi.mock('../../../backend/platform/queue', () => ({
  readQueueOrderManifest,
  writeQueueOrderManifest,
  resolveQueuePaths,
  withDirLock,
  requeueErrorItem: vi.fn(),
  deletePendingItem: vi.fn(),
  deleteDropboxItem: vi.fn(),
  deleteErrorItem: vi.fn(),
  moveDropboxItemToPending: vi.fn(),
  movePendingItemToDropbox: vi.fn(),
  moveErrorItemToDropbox: vi.fn(),
  requestTaskKill,
  executeRequestedTaskKill,
  observeKillRequest,
  readActivationProgressRecords,
}));

vi.mock('../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
  listActivePipelines: vi.fn(() => []),
}));

import { readTaskBoard, retryKillCleanup } from './main.taskBoard';
import type { TaskBoardReadBoardResponse } from '../src/shared/desktopContract';

function taskEntry(taskId: string, state: 'pending' | 'active') {
  return {
    id: taskId,
    taskId,
    fileName: `${taskId}.md`,
    title: `Title ${taskId}`,
    state,
    createdAt: '2026-05-24T00:00:00Z',
    updatedAt: '2026-05-24T00:00:00Z',
    contextPackId: 'pack-a',
    contextPackDir: '/packs/pack-a',
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    completedAt: null,
    archivePath: null,
  };
}

function registry(active = true) {
  return {
    schema_version: 2,
    tasks: {
      'pack-a': {
        open: [],
        pending: active ? [] : [taskEntry('ACTIVE-A', 'pending')],
        active: active ? [taskEntry('ACTIVE-A', 'active')] : [],
        failed: [],
        completed: [],
      },
    },
  };
}

function contextPackList() {
  return {
    action: 'contextPack.list' as const,
    mode: 'read-only' as const,
    message: 'Context packs listed.',
    activeContextPackDir: '/packs/pack-a',
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: [{
      contextPackId: 'pack-a',
      displayName: 'pack-a',
      contextPackDir: '/packs/pack-a',
      manifestPath: null,
      bootstrapReady: true,
      source: 'configured-path' as const,
      isActive: true,
      estateType: null,
      defaultScopeMode: null,
      repoCount: 0,
      primaryWorkingRepoIds: [],
      focusTargets: [],
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadTaskRegistry.mockResolvedValue(registry());
  listArchivedTasksAction.mockResolvedValue({
    ok: true,
    response: {
      action: 'planner.listArchivedTasks',
      mode: 'found',
      message: 'Archived tasks found.',
      tasks: [],
    },
  });
  repoFs.readdir.mockResolvedValue([]);
  repoFs.readFile.mockResolvedValue('');
  readFile.mockResolvedValue('');
  readdir.mockResolvedValue([]);
  readQueueOrderManifest.mockResolvedValue([]);
  executeRequestedTaskKill.mockResolvedValue({ mode: 'kill-requested', taskId: 'ACTIVE-A' });
  observeKillRequest.mockResolvedValue(null);
  readActivationProgressRecords.mockResolvedValue([]);
});

describe('task board kill cleanup failure read model', () => {
  it('overlays cleanup failure fields only for visible active rows with valid failed markers', async () => {
    readdir.mockResolvedValueOnce(['ACTIVE-A.json']);
    observeKillRequest.mockResolvedValueOnce({
      schemaVersion: 1,
      taskId: 'ACTIVE-A',
      requestedAt: '2026-05-24T10:00:00Z',
      requestedBy: 'taskboard',
      reason: 'operator-kill-switch',
      cleanupStatus: 'failed',
      cleanupAttemptCount: 1,
      cleanupLastFailedAt: '2026-05-24T10:01:00Z',
      cleanupLastErrorCode: 'unproven-stopped',
      cleanupLastErrorMessage: 'Unable to prove pipeline stopped.',
    });

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({
        taskId: 'ACTIVE-A',
        state: 'stopping',
        stopCleanupStatus: 'failed',
        stopCleanupFailedAt: '2026-05-24T10:01:00Z',
        stopCleanupErrorCode: 'unproven-stopped',
        stopCleanupMessage: 'Unable to prove pipeline stopped.',
        stopCleanupRetryable: true,
      }),
    ]);
  });

  it('does not overlay cleanup failure onto plain pending rows from stale markers', async () => {
    loadTaskRegistry.mockResolvedValue(registry(false));
    readdir.mockResolvedValueOnce(['ACTIVE-A.json']);
    observeKillRequest.mockResolvedValueOnce({
      schemaVersion: 1,
      taskId: 'ACTIVE-A',
      requestedAt: '2026-05-24T10:00:00Z',
      requestedBy: 'taskboard',
      reason: 'operator-kill-switch',
      cleanupStatus: 'failed',
      cleanupLastErrorCode: 'failed-item-cleanup-failed',
    });

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({ taskId: 'ACTIVE-A', state: 'pending' }),
    ]);
    expect(response.pendingItems[0].stopCleanupStatus).toBeUndefined();
  });

  it('retry cleanup returns before delayed cleanup resolves and coalesces duplicate scheduling', async () => {
    let resolveCleanup: (() => void) | undefined;
    executeRequestedTaskKill.mockImplementation(() => new Promise((resolve) => {
      resolveCleanup = () => resolve({ mode: 'kill-requested', taskId: 'ACTIVE-A' });
    }));
    observeKillRequest.mockResolvedValue({
      schemaVersion: 1,
      taskId: 'ACTIVE-A',
      requestedAt: '2026-05-24T10:00:00Z',
      requestedBy: 'taskboard',
      reason: 'operator-kill-switch',
      cleanupStatus: 'failed',
      cleanupAttemptCount: 1,
      cleanupLastErrorCode: 'failed-item-cleanup-failed',
    });
    readdir.mockResolvedValue(['ACTIVE-A.json']);

    const first = await retryKillCleanup({ fileName: 'ACTIVE-A.md', taskId: 'ACTIVE-A' }, vi.fn().mockResolvedValue(contextPackList()));
    const second = await retryKillCleanup({ fileName: 'ACTIVE-A.md', taskId: 'ACTIVE-A' }, vi.fn().mockResolvedValue(contextPackList()));

    expect(first).toMatchObject({ ok: true, response: { action: 'taskBoard.retryKillCleanup', mode: 'cleanup-retry-scheduled' } });
    expect(second).toMatchObject({ ok: true, response: { action: 'taskBoard.retryKillCleanup', mode: 'cleanup-retry-scheduled' } });
    expect(executeRequestedTaskKill).toHaveBeenCalledTimes(1);
    if (resolveCleanup) resolveCleanup();
  });

  it('rejects retry cleanup when the visible row is not failed cleanup stopping', async () => {
    readdir.mockResolvedValueOnce(['ACTIVE-A.json']);
    observeKillRequest.mockResolvedValueOnce({
      schemaVersion: 1,
      taskId: 'ACTIVE-A',
      requestedAt: '2026-05-24T10:00:00Z',
      requestedBy: 'taskboard',
      reason: 'operator-kill-switch',
    });

    const result = await retryKillCleanup({ fileName: 'ACTIVE-A.md', taskId: 'ACTIVE-A' }, vi.fn().mockResolvedValue(contextPackList()));

    expect(result).toMatchObject({ ok: false, action: 'taskBoard.retryKillCleanup' });
    expect(executeRequestedTaskKill).not.toHaveBeenCalled();
  });
});
