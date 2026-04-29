// @vitest-environment node

/**
 * readTaskBoard "completed column" contract:
 *
 *   QMD is the system of record for completed tasks.
 *
 * The on-disk task registry's `completed[]` is wiped on Electron startup by
 * repairTaskRegistry — which scans dropbox/pendingitems/error-items but NOT
 * the QMD archive — leaving valid QMD-archived tasks orphaned in the registry.
 * If readTaskBoard derived `completedItems` from `registry.completed[]`, the
 * UI's completed selection would flap: archived .md files would appear
 * whenever the registry was empty (legacy fallback path) and silently vanish
 * after a repair sweep cleared `completed[]`.
 *
 * The contract: readTaskBoard MUST always resolve `completedItems` from the
 * QMD archive scan via listArchivedTasksAction, regardless of registry state.
 */

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

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry: vi.fn(),
  getAllTasks: vi.fn(),
  getTasksForContextPack: vi.fn(),
  getRegistryPath: vi.fn(() => '/repo/.platform-state/queue/task-registry.json'),
}));

vi.mock('./main.archivedTasks', () => ({
  listArchivedTasksAction: vi.fn(),
}));

import {
  loadTaskRegistry,
  getAllTasks,
  getTasksForContextPack,
} from '../../../backend/platform/queue/taskRegistry.js';
import { listArchivedTasksAction } from './main.archivedTasks';
import { readTaskBoard } from './main.taskBoard';
import type {
  ArchivedTaskEntry,
  ContextPackListResponse,
  TaskBoardReadBoardResponse,
} from '../src/shared/desktopContract';

const mockLoadTaskRegistry = vi.mocked(loadTaskRegistry);
const mockGetAllTasks = vi.mocked(getAllTasks);
const mockGetTasksForContextPack = vi.mocked(getTasksForContextPack);
const mockListArchivedTasksAction = vi.mocked(listArchivedTasksAction);

function archivedTask(taskId: string): ArchivedTaskEntry {
  return {
    taskId,
    title: `Archived ${taskId}`,
    summary: 'Closeout summary.',
    rootTaskId: taskId,
    qmdRecordId: `qmd-${taskId}`,
    followupReason: '',
    year: '2026',
    archivePath: `/repo/AgentWorkSpace/qmd/context-packs/pack-a/archive/tasks/2026/${taskId}.md`,
    contextPackName: 'pack-a',
  };
}

function emptyContextPackList(): ContextPackListResponse {
  return {
    action: 'contextPack.list',
    mode: 'read-only',
    message: 'Context packs listed.',
    activeContextPackDir: null,
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: [],
  };
}

describe('readTaskBoard — completed column reads QMD as system of record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns QMD-archived tasks even when the registry has populated open/pending/failed entries (Path A)', async () => {
    // Registry has data → hasRegistryData=true → Path A fires.
    // Critically, registry.tasks._unbound.completed is EMPTY — this simulates
    // the post-repairTaskRegistry state where completed[] was wiped.
    mockLoadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
            {
              taskId: 'open-1',
              fileName: 'open-1.md',
              title: 'Open task',
              state: 'open',
              contextPackId: null,
              contextPackDir: null,
              scopeMode: null,
              selectedRepoIds: [],
              selectedFocusIds: [],
              createdAt: '2026-04-26T00:00:00Z',
              completedAt: null,
              archivePath: null,
            },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [], // wiped by repairTaskRegistry
        },
      },
    });

    mockGetAllTasks.mockReturnValue({
      open: [
        {
          taskId: 'open-1',
          fileName: 'open-1.md',
          title: 'Open task',
          state: 'open',
          contextPackId: null,
          contextPackDir: null,
          scopeMode: null,
          selectedRepoIds: [],
          selectedFocusIds: [],
          createdAt: '2026-04-26T00:00:00Z',
          completedAt: null,
          archivePath: null,
        },
      ],
      pending: [],
      active: [],
      failed: [],
      completed: [],
    });
    mockGetTasksForContextPack.mockReturnValue({
      open: [], pending: [], active: [], failed: [], completed: [],
    });

    // QMD scan returns one archived task.
    const archived = archivedTask('20260408t003544z-platform');
    mockListArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listArchivedTasks',
        mode: 'found',
        message: '1 archived task.',
        tasks: [archived],
      },
    });

    const listContextPacks = vi.fn().mockResolvedValue(emptyContextPackList());

    const result = await readTaskBoard(listContextPacks);

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow for TS
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.completedItems).toEqual([archived]);
    expect(response.dropboxItems).toHaveLength(1);
    expect(mockListArchivedTasksAction).toHaveBeenCalledWith(listContextPacks);
  });

  it('returns QMD-archived tasks when the registry is fully empty (Path B fallback)', async () => {
    // Registry has NO data → hasRegistryData=false → Path B fires.
    // The QMD scan must still drive the completed column.
    mockLoadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {},
    });

    const archived = archivedTask('20260408t003544z-platform');
    mockListArchivedTasksAction.mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listArchivedTasks',
        mode: 'found',
        message: '1 archived task.',
        tasks: [archived],
      },
    });

    const listContextPacks = vi.fn().mockResolvedValue(emptyContextPackList());

    const result = await readTaskBoard(listContextPacks);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.completedItems).toEqual([archived]);
  });

  it('returns empty completed list when listContextPacks is not provided (no QMD scan possible)', async () => {
    // No lister → cannot scan QMD → completedItems must be empty (not throw).
    mockLoadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {},
    });

    const result = await readTaskBoard();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as TaskBoardReadBoardResponse;
    expect(response.completedItems).toEqual([]);
    expect(mockListArchivedTasksAction).not.toHaveBeenCalled();
  });
});
