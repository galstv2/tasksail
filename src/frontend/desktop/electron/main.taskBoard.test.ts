// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

vi.mock('./paths', () => ({
  REPO_ROOT: '/repo',
  DESKTOP_ROOT: '/repo/src/frontend/desktop',
}));

const {
  pathExists,
  repoFs,
  readFile,
  readdir,
  unlink,
  lstat,
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
  logError,
} = vi.hoisted(() => ({
  pathExists: vi.fn(async () => true),
  repoFs: {
    access: vi.fn<(path: string) => Promise<void>>(async () => undefined),
    readFile: vi.fn<(path: string, encoding: BufferEncoding) => Promise<string>>(async () => ''),
    readdir: vi.fn<(path: string) => Promise<string[]>>(async () => [] as string[]),
  },
  readFile: vi.fn(async () => ''),
  readdir: vi.fn(async () => [] as string[]),
  unlink: vi.fn(async () => undefined),
  lstat: vi.fn(async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 0 })),
  loadTaskRegistry: vi.fn(),
  getRegistryPath: vi.fn(() => '/repo/.platform-state/task-registry.json'),
  listArchivedTasksAction: vi.fn(),
  readQueueOrderManifest: vi.fn<() => Promise<string[]>>(async () => []),
  writeQueueOrderManifest: vi.fn(async () => undefined),
  resolveQueuePaths: vi.fn(() => ({
    queueLockDir: '/repo/.platform-state/queue/lock',
    queueOrderPath: '/repo/.platform-state/queue/queue-order.json',
    killRequestsDir: '/repo/AgentWorkSpace/pendingitems/.kill-requests',
    activeItemsDir: '/repo/AgentWorkSpace/pendingitems/.active-items',
    activatingItemsDir: '/repo/AgentWorkSpace/pendingitems/.activating-items',
  })),
  withDirLock: vi.fn(async (_dir: string, _label: string, callback: () => Promise<void>) => callback()),
  requeueErrorItemImpl: vi.fn(async () => ({
    requeuedItem: 'TASK-A.md',
    activatedItem: null,
  })),
  deletePendingItem: vi.fn(async () => undefined),
  deleteDropboxItem: vi.fn(async () => undefined),
  deleteErrorItem: vi.fn(async () => undefined),
  moveDropboxItemToPending: vi.fn(async () => ({
    movedItem: 'TASK-A.md',
    activatedItem: null,
  })),
  movePendingItemToDropbox: vi.fn(async () => ({
    movedItem: 'PENDING-A.md',
    openItemPath: '/repo/AgentWorkSpace/dropbox/PENDING-A.md',
  })),
  moveErrorItemToDropbox: vi.fn(async () => ({
    movedItem: 'TASK-A.md',
  })),
  requestTaskKill: vi.fn(async () => ({
    mode: 'kill-requested' as const,
    message: 'Stop requested.',
    taskId: 'ACTIVE-A',
    requestedAt: '2026-05-23T10:00:00Z',
    state: 'active' as const,
  })),
  executeRequestedTaskKill: vi.fn(async () => ({ mode: 'kill-requested' as const, taskId: 'ACTIVE-A' })),
  observeKillRequest: vi.fn(async (): Promise<{
    schemaVersion: 1;
    taskId: string;
    requestedAt: string;
    requestedBy: 'taskboard';
    reason: 'operator-kill-switch';
  } | null> => null),
  readActivationProgressRecords: vi.fn<() => Promise<Array<{
    schemaVersion: 1;
    taskId: string;
    queueName: string;
    title: string | null;
    phase: 'claimed' | 'validating' | 'preparing-worktree' | 'materializing-worktree' | 'initializing-task' | 'starting-pipeline';
    startedAt: string;
    updatedAt: string;
  }>>>(async () => []),
  logError: vi.fn(),
}));

vi.mock('./utils', () => ({
  pathExists,
  repoFs,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile,
    readdir,
    unlink,
    lstat,
  };
});

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry,
  getRegistryPath,
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
      child: vi.fn(() => ({
        error: logError,
        warn: vi.fn(),
        info: vi.fn(),
      })),
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

import {
  deleteTask,
  formatCompletedBranchHandoffText,
  moveToOpen,
  moveToPending,
  readTaskBoard,
  readTaskContent,
  reorderPending,
  requeueErrorItem,
  killTask,
} from './main.taskBoard';
import type {
  ArchivedTaskEntry,
  ContextPackListResponse,
  TaskBoardReadBoardResponse,
} from '../src/shared/desktopContract';

function contextPackList(activePackId: string | null): ContextPackListResponse {
  return {
    action: 'contextPack.list',
    mode: 'read-only',
    message: 'Context packs listed.',
    activeContextPackDir: activePackId ? `/packs/${activePackId}` : null,
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: activePackId ? [
      {
        contextPackId: activePackId,
        displayName: activePackId,
        contextPackDir: `/packs/${activePackId}`,
        manifestPath: null,
        bootstrapReady: true,
        source: 'configured-path',
        isActive: true,
        estateType: null,
        defaultScopeMode: null,
        repoCount: 0,
        primaryWorkingRepoIds: [],
        focusTargets: [],
      },
    ] : [],
  };
}

function taskEntry(
  taskId: string,
  state: 'open' | 'pending' | 'active' | 'failed' | 'completed',
  contextPackId: string | null,
): Record<string, unknown> {
  return {
    taskId,
    fileName: `${taskId}.md`,
    title: `Title ${taskId}`,
    state,
    contextPackId,
    contextPackDir: contextPackId ? `/packs/${contextPackId}` : null,
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    createdAt: '2026-05-16T00:00:00Z',
    completedAt: null,
    archivePath: state === 'completed' ? `/archive/${taskId}.md` : null,
  };
}

function archivedTask(taskId: string, archivedAt: string | null = null): ArchivedTaskEntry {
  return {
    taskId,
    title: `Archived ${taskId}`,
    summary: 'Closeout summary.',
    rootTaskId: taskId,
    qmdRecordId: `qmd-${taskId}`,
    followupReason: '',
    year: '2026',
    archivePath: `/repo/AgentWorkSpace/qmd/context-packs/pack-a/archive/tasks/2026/${taskId}/archive.md`,
    archivedAt,
    contextPackName: 'pack-a',
  };
}

function bindingMarkdown(taskId: string, contextPackId: string): string {
  return [
    `# ${taskId}`,
    '',
    '## Task Metadata',
    '',
    `- Task ID: ${taskId}`,
    '',
    '## Context Pack Binding',
    '',
    `- Context Pack Dir: /packs/${contextPackId}`,
    `- Context Pack ID: ${contextPackId}`,
    '- Scope Mode: focused',
  ].join('\n');
}

describe('main.taskBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {},
    });
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
    pathExists.mockResolvedValue(true);
    requestTaskKill.mockResolvedValue({
      mode: 'kill-requested',
      message: 'Stop requested.',
      taskId: 'ACTIVE-A',
      requestedAt: '2026-05-23T10:00:00Z',
      state: 'active',
    });
    executeRequestedTaskKill.mockResolvedValue({ mode: 'kill-requested', taskId: 'ACTIVE-A' });
    observeKillRequest.mockResolvedValue(null);
    movePendingItemToDropbox.mockResolvedValue({
      movedItem: 'PENDING-A.md',
      openItemPath: '/repo/AgentWorkSpace/dropbox/PENDING-A.md',
    });
    logError.mockClear();
    readActivationProgressRecords.mockResolvedValue([]);
  });

  it('shows only active-pack registry entries and hides other packs plus _unbound tasks', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [taskEntry('OPEN-A', 'open', 'pack-a')],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [taskEntry('ACTIVE-A', 'active', 'pack-a')],
          failed: [taskEntry('FAILED-A', 'failed', 'pack-a')],
          completed: [taskEntry('DONE-A', 'completed', 'pack-a')],
        },
        'pack-b': {
          open: [taskEntry('OPEN-B', 'open', 'pack-b')],
          pending: [taskEntry('PENDING-B', 'pending', 'pack-b')],
          active: [],
          failed: [],
          completed: [],
        },
        _unbound: {
          open: [taskEntry('OPEN-U', 'open', null)],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listArchivedTasks',
        mode: 'found',
        message: 'Archived tasks found.',
        tasks: [archivedTask('DONE-A')],
      },
    });

    const listContextPacks = vi.fn().mockResolvedValue(contextPackList('pack-a'));
    const result = await readTaskBoard(listContextPacks);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.dropboxItems.map((item) => item.taskId)).toEqual(['OPEN-A']);
    expect(response.pendingItems.map((item) => item.taskId)).toEqual(['ACTIVE-A', 'PENDING-A']);
    expect(response.errorItems.map((item) => item.taskId)).toEqual(['FAILED-A']);
    expect(response.completedItems.map((item) => item.taskId)).toEqual(['DONE-A']);
    expect(listContextPacks).toHaveBeenCalledTimes(1);
    expect(listArchivedTasksAction).toHaveBeenCalledWith(
      listContextPacks,
      { scope: expect.objectContaining({ contextPackId: 'pack-a' }) },
    );
  });

  it('overlays registry-backed pending task as activating from a valid marker', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    readActivationProgressRecords.mockResolvedValue([{
      schemaVersion: 1,
      taskId: 'PENDING-A',
      queueName: 'PENDING-A.md',
      title: 'Title PENDING-A',
      phase: 'materializing-worktree',
      startedAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:05Z',
    }]);

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList('pack-a')));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({
        taskId: 'PENDING-A',
        state: 'activating',
        activationPhase: 'materializing-worktree',
        activationStartedAt: '2026-05-23T10:00:00Z',
        activationUpdatedAt: '2026-05-23T10:00:05Z',
      }),
    ]);
  });

  it('overlays registry-backed active task as activating and keeps active-only active', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [],
          active: [
            taskEntry('ACTIVE-A', 'active', 'pack-a'),
            taskEntry('ACTIVE-B', 'active', 'pack-a'),
          ],
          failed: [],
          completed: [],
        },
      },
    });
    readActivationProgressRecords.mockResolvedValue([{
      schemaVersion: 1,
      taskId: 'ACTIVE-A',
      queueName: 'ACTIVE-A.md',
      title: 'Title ACTIVE-A',
      phase: 'starting-pipeline',
      startedAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:06Z',
    }]);

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList('pack-a')));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({ taskId: 'ACTIVE-A', state: 'activating' }),
      expect.objectContaining({ taskId: 'ACTIVE-B', state: 'active' }),
    ]);
  });

  it('overlays valid kill markers as stopping for registry-backed active rows', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [],
          active: [taskEntry('ACTIVE-A', 'active', 'pack-a')],
          failed: [],
          completed: [],
        },
      },
    });
    readdir.mockResolvedValueOnce(['ACTIVE-A.json']);
    observeKillRequest.mockResolvedValueOnce({
      schemaVersion: 1,
      taskId: 'ACTIVE-A',
      requestedAt: '2026-05-23T10:01:00Z',
      requestedBy: 'taskboard',
      reason: 'operator-kill-switch',
    });

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList('pack-a')));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({
        taskId: 'ACTIVE-A',
        state: 'stopping',
        stopRequestedAt: '2026-05-23T10:01:00Z',
      }),
    ]);
  });

  it('overlays valid kill markers as stopping for activating rows', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    readActivationProgressRecords.mockResolvedValue([{
      schemaVersion: 1,
      taskId: 'PENDING-A',
      queueName: 'PENDING-A.md',
      title: 'Title PENDING-A',
      phase: 'validating',
      startedAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:01Z',
    }]);
    readdir.mockResolvedValueOnce(['PENDING-A.json']);
    observeKillRequest.mockResolvedValueOnce({
      schemaVersion: 1,
      taskId: 'PENDING-A',
      requestedAt: '2026-05-23T10:01:00Z',
      requestedBy: 'taskboard',
      reason: 'operator-kill-switch',
    });

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList('pack-a')));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({
        taskId: 'PENDING-A',
        state: 'stopping',
        activationPhase: 'validating',
        stopRequestedAt: '2026-05-23T10:01:00Z',
      }),
    ]);
  });

  it('does not show plain pending rows as stopping from stale kill markers', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    readdir.mockResolvedValueOnce(['PENDING-A.json']);
    observeKillRequest.mockResolvedValueOnce({
      schemaVersion: 1,
      taskId: 'PENDING-A',
      requestedAt: '2026-05-23T10:01:00Z',
      requestedBy: 'taskboard',
      reason: 'operator-kill-switch',
    });

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList('pack-a')));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({ taskId: 'PENDING-A', state: 'pending' }),
    ]);
  });

  it('returns the newest completed tasks for the active context pack', async () => {
    const archivedTasks = Array.from({ length: 52 }, (_, index) => archivedTask(
      `DONE-${String(index + 1).padStart(2, '0')}`,
      new Date(Date.UTC(2026, 4, 1, index)).toISOString(),
    ));

    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listArchivedTasks',
        mode: 'found',
        message: 'Archived tasks found.',
        tasks: archivedTasks,
      },
    });

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList('pack-a')));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.completedItems).toHaveLength(50);
    expect(response.completedItems[0]?.taskId).toBe('DONE-52');
    expect(response.completedItems[49]?.taskId).toBe('DONE-03');
    expect(response.completedItems.map((item) => item.taskId)).not.toContain('DONE-02');
  });

  it('returns empty task arrays when no active context pack exists', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [taskEntry('OPEN-A', 'open', 'pack-a')],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });

    const result = await readTaskBoard(vi.fn().mockResolvedValue(contextPackList(null)));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.dropboxItems).toEqual([]);
    expect(response.pendingItems).toEqual([]);
    expect(response.errorItems).toEqual([]);
    expect(response.completedItems).toEqual([]);
  });

  it('filters fallback filesystem scans by markdown context pack binding', async () => {
    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readdir: vi.fn(async (dir: string) => {
        if (dir.endsWith('/dropbox')) {
          return ['OPEN-A.md', 'OPEN-B.md'];
        }
        if (dir.endsWith('/pendingitems')) {
          return ['TASK-A.md', 'TASK-B.md'];
        }
        if (dir.endsWith('/pendingitems/.active-items')) {
          return ['TASK-A'];
        }
        if (dir.endsWith('/error-items')) {
          return ['ERROR-A.md', 'ERROR-B.md'];
        }
        return [];
      }),
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('OPEN-A.md')) return bindingMarkdown('OPEN-A', 'pack-a');
        if (filePath.endsWith('OPEN-B.md')) return bindingMarkdown('OPEN-B', 'pack-b');
        if (filePath.endsWith('TASK-A.md')) return bindingMarkdown('TASK-A', 'pack-a');
        if (filePath.endsWith('TASK-B.md')) return bindingMarkdown('TASK-B', 'pack-b');
        if (filePath.endsWith('ERROR-A.md')) return bindingMarkdown('ERROR-A', 'pack-a');
        if (filePath.endsWith('ERROR-B.md')) return bindingMarkdown('ERROR-B', 'pack-b');
        return '';
      }),
    };

    const result = await readTaskBoard(
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
      fsAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.dropboxItems.map((item) => item.taskId)).toEqual(['OPEN-A']);
    expect(response.pendingItems).toEqual([
      expect.objectContaining({ taskId: 'TASK-A', state: 'active' }),
    ]);
    expect(response.errorItems.map((item) => item.taskId)).toEqual(['ERROR-A']);
  });

  it('overlays fallback pending task as activating and ignores unrelated markers', async () => {
    readActivationProgressRecords.mockResolvedValue([
      {
        schemaVersion: 1,
        taskId: 'TASK-A',
        queueName: 'TASK-A.md',
        title: 'Task A',
        phase: 'validating',
        startedAt: '2026-05-23T10:00:00Z',
        updatedAt: '2026-05-23T10:00:02Z',
      },
      {
        schemaVersion: 1,
        taskId: 'HIDDEN-TASK',
        queueName: 'HIDDEN-TASK.md',
        title: 'Hidden',
        phase: 'claimed',
        startedAt: '2026-05-23T10:00:00Z',
        updatedAt: '2026-05-23T10:00:01Z',
      },
    ]);
    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readdir: vi.fn(async (dir: string) => {
        if (dir.endsWith('/pendingitems')) return ['TASK-A.md'];
        if (dir.endsWith('/pendingitems/.active-items')) return [];
        return [];
      }),
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('TASK-A.md')) return bindingMarkdown('TASK-A', 'pack-a');
        return '';
      }),
    };

    const result = await readTaskBoard(
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
      fsAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({
        taskId: 'TASK-A',
        state: 'activating',
        activationPhase: 'validating',
      }),
    ]);
  });

  it('does not mark a visible fallback pending item active from a hidden pack active marker', async () => {
    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readdir: vi.fn(async (dir: string) => {
        if (dir.endsWith('/dropbox')) {
          return [];
        }
        if (dir.endsWith('/pendingitems')) {
          return ['TASK-A.md', 'TASK-B.md'];
        }
        if (dir.endsWith('/pendingitems/.active-items')) {
          return ['TASK-B'];
        }
        if (dir.endsWith('/error-items')) {
          return [];
        }
        return [];
      }),
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('TASK-A.md')) return bindingMarkdown('TASK-A', 'pack-a');
        if (filePath.endsWith('TASK-B.md')) return bindingMarkdown('TASK-B', 'pack-b');
        return '';
      }),
    };

    const result = await readTaskBoard(
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
      fsAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.pendingItems).toEqual([
      expect.objectContaining({ taskId: 'TASK-A', state: 'pending' }),
    ]);
  });

  it('returns not-found for hidden task content without reading the file body', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-b': {
          open: [taskEntry('TASK-B', 'open', 'pack-b')],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });

    const result = await readTaskContent(
      { column: 'open', fileName: 'TASK-B.md' },
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'taskBoard.readTaskContent',
        mode: 'not-found',
        fileName: 'TASK-B.md',
      }),
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('returns active-pack task content when the requested queue item is visible', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [taskEntry('TASK-A', 'pending', 'pack-a')],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    readFile.mockResolvedValue('# Task A\n\nBody for pack A.');

    const result = await readTaskContent(
      { column: 'pending', fileName: 'TASK-A.md' },
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'taskBoard.readTaskContent',
        mode: 'found',
        fileName: 'TASK-A.md',
        content: '# Task A\n\nBody for pack A.',
      }),
    });
    expect(readFile).toHaveBeenCalledWith('/repo/AgentWorkSpace/pendingitems/TASK-A.md', 'utf-8');
  });

  it('reads completed content only from the active context-pack archive listing', async () => {
    listArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listArchivedTasks',
        mode: 'found',
        message: 'Archived tasks found.',
        tasks: [archivedTask('DONE-A')],
      },
    });
    readFile.mockResolvedValue('# Done A\n\nArchived content.');
    const listContextPacks = vi.fn().mockResolvedValue(contextPackList('pack-a'));

    await expect(
      readTaskContent({ column: 'completed', fileName: 'DONE-B.md' }, listContextPacks),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'taskBoard.readTaskContent',
        mode: 'not-found',
        fileName: 'DONE-B.md',
      }),
    });
    expect(readFile).not.toHaveBeenCalled();

    const result = await readTaskContent(
      { column: 'completed', fileName: 'DONE-A.md' },
      listContextPacks,
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'taskBoard.readTaskContent',
        mode: 'found',
        fileName: 'DONE-A.md',
        content: '# Done A\n\nArchived content.',
      }),
    });
    expect(readFile).toHaveBeenCalledWith(
      '/repo/AgentWorkSpace/qmd/context-packs/pack-a/archive/tasks/2026/DONE-A/archive.md',
      'utf-8',
    );
  });

  it('rejects hidden task mutations without calling queue helpers', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-b': {
          open: [taskEntry('OPEN-B', 'open', 'pack-b')],
          pending: [taskEntry('PENDING-B', 'pending', 'pack-b')],
          active: [],
          failed: [taskEntry('ERROR-B', 'failed', 'pack-b')],
          completed: [],
        },
      },
    });
    const listContextPacks = vi.fn().mockResolvedValue(contextPackList('pack-a'));

    await expect(deleteTask({ column: 'pending', fileName: 'PENDING-B.md' }, listContextPacks))
      .resolves.toEqual(expect.objectContaining({ ok: false }));
    await expect(moveToPending({ fileName: 'OPEN-B.md', insertAtIndex: 0 }, listContextPacks))
      .resolves.toEqual(expect.objectContaining({ ok: false }));
    await expect(moveToOpen({ fileName: 'ERROR-B.md' }, listContextPacks))
      .resolves.toEqual(expect.objectContaining({ ok: false }));
    await expect(requeueErrorItem({ fileName: 'ERROR-B.md', insertAtIndex: 0 }, listContextPacks))
      .resolves.toEqual(expect.objectContaining({ ok: false }));

    expect(deletePendingItem).not.toHaveBeenCalled();
    expect(moveDropboxItemToPending).not.toHaveBeenCalled();
    expect(moveErrorItemToDropbox).not.toHaveBeenCalled();
    expect(requeueErrorItemImpl).not.toHaveBeenCalled();
  });

  it('accepts stop requests before delayed background cleanup resolves', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [],
          active: [taskEntry('ACTIVE-A', 'active', 'pack-a')],
          failed: [],
          completed: [],
        },
      },
    });
    let resolveCleanup!: (value: { mode: 'kill-requested'; taskId: string }) => void;
    executeRequestedTaskKill.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCleanup = resolve;
    }));

    const result = await killTask(
      { fileName: 'ACTIVE-A.md', taskId: 'ACTIVE-A' },
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'taskBoard.killTask',
        mode: 'kill-requested',
        taskId: 'ACTIVE-A',
      }),
    });
    expect(requestTaskKill).toHaveBeenCalledWith({ repoRoot: '/repo', taskId: 'ACTIVE-A' });
    expect(executeRequestedTaskKill).toHaveBeenCalledTimes(1);
    resolveCleanup?.({ mode: 'kill-requested', taskId: 'ACTIVE-A' });
  });

  it('logs background cleanup failures without rejecting the accepted stop response', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [],
          active: [taskEntry('ACTIVE-A', 'active', 'pack-a')],
          failed: [],
          completed: [],
        },
      },
    });
    executeRequestedTaskKill.mockRejectedValueOnce(new Error('cleanup exploded'));

    const result = await killTask(
      { fileName: 'ACTIVE-A.md', taskId: 'ACTIVE-A' },
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'taskBoard.killTask',
        mode: 'kill-requested',
        taskId: 'ACTIVE-A',
      }),
    });
    expect(logError).toHaveBeenCalledWith(
      'task_kill.background_cleanup_failed',
      expect.any(Error),
      { taskId: 'ACTIVE-A' },
    );
  });

  it('schedules background cleanup once while a task cleanup is in flight', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [],
          active: [taskEntry('ACTIVE-A', 'active', 'pack-a')],
          failed: [],
          completed: [],
        },
      },
    });
    executeRequestedTaskKill.mockImplementation(() => new Promise(() => {}));
    const listContextPacks = vi.fn().mockResolvedValue(contextPackList('pack-a'));

    await killTask({ fileName: 'ACTIVE-A.md', taskId: 'ACTIVE-A' }, listContextPacks);
    await killTask({ fileName: 'ACTIVE-A.md', taskId: 'ACTIVE-A' }, listContextPacks);

    expect(requestTaskKill).toHaveBeenCalledTimes(2);
    expect(executeRequestedTaskKill).toHaveBeenCalledTimes(1);
  });

  it('rejects pending-source move to open for active registry evidence before queue mutation', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [],
          active: [taskEntry('ACTIVE-A', 'active', 'pack-a')],
          failed: [],
          completed: [],
        },
      },
    });

    const result = await moveToOpen(
      { fileName: 'ACTIVE-A.md', sourceColumn: 'pending' },
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
    );

    expect(result).toEqual({
      ok: false,
      action: 'taskBoard.moveToOpen',
      error: 'Active tasks cannot be returned to open.',
    });
    expect(movePendingItemToDropbox).not.toHaveBeenCalled();
  });

  it('surfaces backend pending-source move to open rejection for activating evidence', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    readActivationProgressRecords.mockResolvedValue([{
      schemaVersion: 1,
      taskId: 'PENDING-A',
      queueName: 'PENDING-A.md',
      title: 'Title PENDING-A',
      phase: 'validating',
      startedAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:01Z',
    }]);
    movePendingItemToDropbox.mockRejectedValueOnce(new Error('pending-return-open-failed: "PENDING-A.md" has started-task evidence (activating marker).'));

    const result = await moveToOpen(
      { fileName: 'PENDING-A.md', sourceColumn: 'pending' },
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      action: 'taskBoard.moveToOpen',
      error: expect.stringContaining('activating marker'),
    }));
    expect(movePendingItemToDropbox).toHaveBeenCalledWith({
      fileName: 'PENDING-A.md',
      repoRoot: '/repo',
      reason: 'operator-drag-return-open',
    });
  });

  it('surfaces backend pending-source move to open rejection for kill request marker evidence', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    movePendingItemToDropbox.mockRejectedValueOnce(new Error('pending-return-open-failed: "PENDING-A.md" has started-task evidence (kill request marker).'));

    const result = await moveToOpen(
      { fileName: 'PENDING-A.md', sourceColumn: 'pending' },
      vi.fn().mockResolvedValue(contextPackList('pack-a')),
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      action: 'taskBoard.moveToOpen',
      error: expect.stringContaining('kill request marker'),
    }));
    expect(movePendingItemToDropbox).toHaveBeenCalledWith({
      fileName: 'PENDING-A.md',
      repoRoot: '/repo',
      reason: 'operator-drag-return-open',
    });
  });

  it('surfaces child-chain cleanup preflight failures from deleteTask', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    deletePendingItem.mockRejectedValueOnce(new Error('child-task-chain-delete-cleanup-blocked-completed-task for task "PENDING-A": completed chain tasks must remain archived history'));

    const result = await deleteTask({ column: 'pending', fileName: 'PENDING-A.md' }, vi.fn().mockResolvedValue(contextPackList('pack-a')));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      action: 'taskBoard.deleteTask',
      error: expect.stringContaining('child-task-chain-delete-cleanup-blocked-completed-task'),
    }));
  });

  it('surfaces child-chain cleanup write failures from deleteTask', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    deletePendingItem.mockRejectedValueOnce(new Error('EISDIR: illegal operation on a directory'));

    const result = await deleteTask({ column: 'pending', fileName: 'PENDING-A.md' }, vi.fn().mockResolvedValue(contextPackList('pack-a')));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      action: 'taskBoard.deleteTask',
      error: expect.stringContaining('EISDIR'),
    }));
  });

  it('resolves context-pack scope and registry at most once per visible mutation handler', async () => {
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [taskEntry('OPEN-A', 'open', 'pack-a')],
          pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
          active: [],
          failed: [taskEntry('ERROR-A', 'failed', 'pack-a')],
          completed: [],
        },
      },
    });

    const cases: Array<(listContextPacks: () => Promise<ContextPackListResponse>) => Promise<unknown>> = [
      (listContextPacks) => requeueErrorItem({ fileName: 'ERROR-A.md', insertAtIndex: 0 }, listContextPacks),
      (listContextPacks) => deleteTask({ column: 'pending', fileName: 'PENDING-A.md' }, listContextPacks),
      (listContextPacks) => moveToPending({ fileName: 'OPEN-A.md', insertAtIndex: 0 }, listContextPacks),
      (listContextPacks) => moveToOpen({ fileName: 'ERROR-A.md' }, listContextPacks),
    ];

    for (const run of cases) {
      vi.clearAllMocks();
      loadTaskRegistry.mockResolvedValue({
        schema_version: 2,
        tasks: {
          'pack-a': {
            open: [taskEntry('OPEN-A', 'open', 'pack-a')],
            pending: [taskEntry('PENDING-A', 'pending', 'pack-a')],
            active: [],
            failed: [taskEntry('ERROR-A', 'failed', 'pack-a')],
            completed: [],
          },
        },
      });
      const listContextPacks = vi.fn().mockResolvedValue(contextPackList('pack-a'));
      const result = await run(listContextPacks);
      expect(result).toEqual(expect.objectContaining({ ok: true }));
      expect(listContextPacks).toHaveBeenCalledTimes(1);
      expect(loadTaskRegistry).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects pending reorder payloads that include hidden filenames', async () => {
    repoFs.readdir.mockResolvedValue(['HIDDEN-B.md', 'VISIBLE-A.md']);
    repoFs.readFile.mockImplementation(async (filePath: string, _encoding: BufferEncoding) => {
      if (filePath.endsWith('VISIBLE-A.md')) {
        return bindingMarkdown('VISIBLE-A', 'pack-a');
      }
      if (filePath.endsWith('HIDDEN-B.md')) {
        return bindingMarkdown('HIDDEN-B', 'pack-b');
      }
      return '';
    });

    const listContextPacks = vi.fn().mockResolvedValue(contextPackList('pack-a'));
    const result = await reorderPending(
      { order: ['VISIBLE-A.md', 'HIDDEN-B.md'] },
      listContextPacks,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      action: 'taskBoard.reorderPending',
      error: 'HIDDEN-B.md is not visible in the active context pack.',
    }));
    expect(listContextPacks).toHaveBeenCalledTimes(1);
    expect(loadTaskRegistry).toHaveBeenCalledTimes(1);
    expect(writeQueueOrderManifest).not.toHaveBeenCalled();
  });

  it('merges visible pending reorder updates without dropping hidden filenames', async () => {
    repoFs.readdir.mockResolvedValue(['HIDDEN-B.md', 'HIDDEN-C.md', 'VISIBLE-A.md', 'VISIBLE-D.md']);
    repoFs.readFile.mockImplementation(async (filePath: string, _encoding: BufferEncoding) => {
      if (filePath.endsWith('VISIBLE-A.md')) {
        return bindingMarkdown('VISIBLE-A', 'pack-a');
      }
      if (filePath.endsWith('VISIBLE-D.md')) {
        return bindingMarkdown('VISIBLE-D', 'pack-a');
      }
      if (filePath.endsWith('HIDDEN-B.md')) {
        return bindingMarkdown('HIDDEN-B', 'pack-b');
      }
      if (filePath.endsWith('HIDDEN-C.md')) {
        return bindingMarkdown('HIDDEN-C', 'pack-b');
      }
      return '';
    });
    readQueueOrderManifest.mockResolvedValue([
      'HIDDEN-B.md',
      'VISIBLE-A.md',
      'HIDDEN-C.md',
      'VISIBLE-D.md',
    ]);

    const listContextPacks = vi.fn().mockResolvedValue(contextPackList('pack-a'));
    const result = await reorderPending(
      { order: ['VISIBLE-D.md', 'VISIBLE-A.md'] },
      listContextPacks,
    );

    expect(result.ok).toBe(true);
    expect(listContextPacks).toHaveBeenCalledTimes(1);
    expect(loadTaskRegistry).toHaveBeenCalledTimes(1);
    expect(writeQueueOrderManifest).toHaveBeenCalledWith(
      '/repo/.platform-state/queue/queue-order.json',
      ['HIDDEN-B.md', 'VISIBLE-D.md', 'HIDDEN-C.md', 'VISIBLE-A.md'],
    );
  });

  it('formats completed task branch handoff text for manual operator review', () => {
    const text = formatCompletedBranchHandoffText({
      ...archivedTask('task-one'),
      branchHandoffs: [
        {
          repoRoot: '/repos/platform',
          repoLabel: 'platform',
          branch: 'task/task-one',
          baseCommitSha: 'base',
          headCommitSha: 'head',
          commitsAhead: 1,
          status: 'ready-for-operator-review',
        },
        {
          repoRoot: '/repos/tools',
          repoLabel: 'tools',
          branch: 'task/task-one',
          baseCommitSha: 'base',
          headCommitSha: 'head',
          commitsAhead: 2,
          status: 'auto-merged-to-target',
          autoMerge: {
            enabled: true,
            status: 'applied',
            targetBranch: 'main',
            detail: 'Merged with --no-commit --no-ff; changes are staged for operator review.',
          },
        },
      ],
    });

    expect(text).toContain('Completed. Review source branch `task/task-one` in `platform` and merge manually if approved.');
    expect(text).toContain('Completed. Source branch `task/task-one` in `tools` has been auto-merged into `main` with `--no-commit --no-ff`; changes are staged for operator review.');
  });
});
