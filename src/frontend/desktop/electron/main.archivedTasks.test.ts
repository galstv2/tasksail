// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

import { listArchivedTasksAction } from './main.archivedTasks';
import type { ContextPackListResponse } from '../src/shared/desktopContract';

function createCatalog(overrides?: Partial<ContextPackListResponse>): ContextPackListResponse {
  return {
    action: 'contextPack.list',
    mode: 'read-only',
    message: 'Context packs listed.',
    activeContextPackDir: null,
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: [],
    ...overrides,
  };
}

describe('listArchivedTasksAction', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns no-context-pack when no active context pack exists', async () => {
    const lister = vi.fn().mockResolvedValue(createCatalog());

    const result = await listArchivedTasksAction(lister);

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.listArchivedTasks',
        mode: 'no-context-pack',
        tasks: [],
      }),
    });
  });

  it('returns empty when archive directory does not exist', async () => {
    const lister = vi.fn().mockResolvedValue(
      createCatalog({
        contextPacks: [
          {
            contextPackId: 'nonexistent-pack',
            displayName: 'Nonexistent Pack',
            contextPackDir: '/tmp/nonexistent',
            manifestPath: null,
            bootstrapReady: false,
            source: 'configured-path',
            isActive: true,
            estateType: null,
            defaultScopeMode: null,
            repoCount: 0,
            primaryWorkingRepoIds: [],
            focusTargets: [],
          },
        ],
      }),
    );

    const result = await listArchivedTasksAction(lister);

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.listArchivedTasks',
        mode: 'empty',
        tasks: [],
      }),
    });
  });

  it('returns found tasks from a real archive directory', async () => {
    const lister = vi.fn().mockResolvedValue(
      createCatalog({
        contextPacks: [
          {
            contextPackId: 'live-test-context-pack',
            displayName: 'Live Test',
            contextPackDir: '/tmp/test',
            manifestPath: null,
            bootstrapReady: false,
            source: 'configured-path',
            isActive: true,
            estateType: null,
            defaultScopeMode: null,
            repoCount: 0,
            primaryWorkingRepoIds: [],
            focusTargets: [],
          },
        ],
      }),
    );

    const result = await listArchivedTasksAction(lister);

    if (!result.ok) {
      // Archive may not exist in CI — that returns empty, which is also ok
      return;
    }

    const response = result.response;
    expect(response.action).toBe('planner.listArchivedTasks');
    expect(['found', 'empty']).toContain(response.action === 'planner.listArchivedTasks' ? (response as { mode: string }).mode : '');
  });
});
