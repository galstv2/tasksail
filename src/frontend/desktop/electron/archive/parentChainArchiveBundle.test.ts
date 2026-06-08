// @vitest-environment node

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathMock = vi.hoisted(() => ({ repoRoot: '' }));
const archiveMock = vi.hoisted(() => ({ listArchivedTasksAction: vi.fn() }));
const chainMock = vi.hoisted(() => ({ readChildTaskChains: vi.fn() }));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock('../paths', () => ({
  get REPO_ROOT() {
    return pathMock.repoRoot;
  },
  get DESKTOP_ROOT() {
    return path.join(pathMock.repoRoot, 'src/frontend/desktop');
  },
}));
vi.mock('./archivedTasks', () => ({ listArchivedTasksAction: archiveMock.listArchivedTasksAction }));
vi.mock('../../../../backend/platform/queue/childTaskChains.js', () => ({ readChildTaskChains: chainMock.readChildTaskChains }));
vi.mock('../log/logger', () => ({
  createLogger: vi.fn(() => ({ warn: loggerMock.warn, info: loggerMock.info, error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: { createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }) },
}));

import { readParentChainArchiveBundleAction } from './parentChainArchiveBundle';
import type { PlannerReadParentChainArchiveBundleResponse } from '../../src/shared/desktopContract';

function archivePath(tmpRoot: string, taskId: string, fileName = 'archive.md'): string {
  return path.join(tmpRoot, 'repo', 'AgentWorkSpace', 'qmd', 'context-packs', 'pack', 'archive', 'tasks', '2026', taskId, fileName);
}

function entry(tmpRoot: string, taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    taskId,
    title: `Title ${taskId}`,
    summary: '',
    rootTaskId: taskId === 'root' ? 'root' : 'root',
    qmdRecordId: taskId,
    followupReason: '',
    year: '2026',
    archivePath: archivePath(tmpRoot, taskId),
    archivedAt: '2026-05-17T08:42:11.000Z',
    contextPackName: 'pack',
    ...overrides,
  };
}

function record(taskId: string, depth: number, state = 'completed', overrides: Record<string, unknown> = {}) {
  return {
    taskId,
    rootTaskId: 'root',
    parentTaskId: depth === 0 ? null : 'root',
    previousTaskId: null,
    depth,
    state,
    archivePath: '',
    archiveArtifactDir: null,
    parentArchivePath: null,
    parentArchiveArtifactDir: null,
    parentContextSnapshot: null,
    childExecutionScope: null,
    branchChain: null,
    completedBranchHandoffs: null,
    completedAt: '2026-05-17T08:42:11.000Z',
    createdAt: '2026-05-17T08:42:11.000Z',
    updatedAt: '2026-05-17T08:42:11.000Z',
    ...overrides,
  };
}

function mockListing(tasks: unknown[]): void {
  archiveMock.listArchivedTasksAction.mockResolvedValue({
    ok: true,
    response: { action: 'planner.listArchivedTasks', mode: 'found', message: 'Found.', tasks },
  });
}

function mockState(taskIds = ['root', 'child', 'parent'], overrides: Record<string, unknown> = {}): void {
  chainMock.readChildTaskChains.mockResolvedValue({
    schemaVersion: 1,
    updatedAt: '2026-05-17T08:42:11.000Z',
    chains: { root: { rootTaskId: 'root', currentTipTaskId: 'parent', contextPackId: 'pack', contextPackDir: '/packs/pack', taskIds, createdAt: '2026-05-17T08:42:11.000Z', updatedAt: '2026-05-17T08:42:11.000Z' } },
    tasks: {
      root: record('root', 0, 'completed'),
      child: record('child', 1, 'completed'),
      parent: record('parent', 2, 'completed'),
      planned: record('planned', 3, 'planned'),
      pending: record('pending', 4, 'pending'),
      active: record('active', 5, 'active'),
      failed: record('failed', 6, 'failed'),
    },
    ...overrides,
  });
}

function payload(overrides: Record<string, string> = {}) {
  return { parentTaskId: 'parent', rootTaskId: 'root', contextPackDir: '/packs/pack', contextPackId: 'pack', ...overrides };
}

function bundle(result: Awaited<ReturnType<typeof readParentChainArchiveBundleAction>>) {
  if (!result.ok) throw new Error(result.error);
  return (result.response as PlannerReadParentChainArchiveBundleResponse).bundle;
}

describe('readParentChainArchiveBundleAction', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'parent-chain-archive-'));
    pathMock.repoRoot = path.join(tmpRoot, 'repo');
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns no-chain-state for a standalone root absent from child-chain state', async () => {
    const root = entry(tmpRoot, 'root');
    mockListing([root]);
    chainMock.readChildTaskChains.mockResolvedValue({ schemaVersion: 1, updatedAt: 'now', chains: {}, tasks: {} });

    const result = await readParentChainArchiveBundleAction(vi.fn(), payload({ parentTaskId: 'root', rootTaskId: 'root' }));

    expect(bundle(result)).toMatchObject({ status: 'no-chain-state', rootTaskId: 'root', tasks: [], missingTaskIds: [] });
  });

  it('reads completed archives in chain-state order through explicit scope', async () => {
    for (const taskId of ['root', 'child', 'parent']) {
      const filePath = archivePath(tmpRoot, taskId);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${taskId} archive`);
    }
    mockListing([entry(tmpRoot, 'parent'), entry(tmpRoot, 'root'), entry(tmpRoot, 'child')]);
    mockState();

    const result = await readParentChainArchiveBundleAction(vi.fn(), payload());

    expect(archiveMock.listArchivedTasksAction).toHaveBeenCalledWith(expect.any(Function), {
      scope: { contextPackDir: '/packs/pack', contextPackId: 'pack', contextPackName: 'pack' },
    });
    const loaded = bundle(result);
    expect(loaded.status).toBe('available');
    expect(loaded.tasks.map((task) => task.taskId)).toEqual(['root', 'child', 'parent']);
    expect(loaded.tasks.map((task) => task.content)).toEqual(['root archive', 'child archive', 'parent archive']);
  });

  it('includes root, intermediate child, and selected grandchild only', async () => {
    for (const taskId of ['root', 'child', 'parent', 'planned', 'pending', 'active', 'failed']) {
      const filePath = archivePath(tmpRoot, taskId);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, taskId);
    }
    mockListing(['root', 'child', 'parent', 'planned', 'pending', 'active', 'failed'].map((taskId) => entry(tmpRoot, taskId)));
    mockState(['root', 'child', 'parent', 'planned', 'pending', 'active', 'failed']);

    const loaded = bundle(await readParentChainArchiveBundleAction(vi.fn(), payload()));

    expect(loaded.tasks.map((task) => task.taskId)).toEqual(['root', 'child', 'parent']);
  });

  it('fails closed for invalid or inconsistent child-chain state', async () => {
    mockListing([entry(tmpRoot, 'parent')]);
    chainMock.readChildTaskChains.mockRejectedValue(new Error('child-task-chains-invalid-schema'));
    await expect(readParentChainArchiveBundleAction(vi.fn(), payload())).resolves.toMatchObject({ ok: false });
    mockState(['root', 'child']);
    await expect(readParentChainArchiveBundleAction(vi.fn(), payload())).resolves.toMatchObject({ ok: false });
  });

  it('degrades missing and unsafe archives to missingTaskIds without logging content', async () => {
    const rootPath = archivePath(tmpRoot, 'root');
    mkdirSync(path.dirname(rootPath), { recursive: true });
    writeFileSync(rootPath, 'root archive');
    const linkPath = archivePath(tmpRoot, 'parent');
    mkdirSync(path.dirname(linkPath), { recursive: true });
    symlinkSync(rootPath, linkPath);
    mockListing([
      entry(tmpRoot, 'root'),
      entry(tmpRoot, 'child', { archivePath: archivePath(tmpRoot, 'child', 'legacy.md') }),
      entry(tmpRoot, 'parent'),
    ]);
    mockState(['root', 'child', 'parent'], {
      tasks: {
        root: record('root', 0, 'completed', { archivePath: rootPath }),
        child: record('child', 1, 'completed', { archivePath: archivePath(tmpRoot, 'child') }),
        parent: record('parent', 2, 'completed'),
      },
    });

    const loaded = bundle(await readParentChainArchiveBundleAction(vi.fn(), payload()));

    expect(loaded.status).toBe('missing-archives');
    expect(loaded.tasks.map((task) => task.taskId)).toEqual(['root']);
    expect(loaded.missingTaskIds).toEqual(['child', 'parent']);
    expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain('root archive');
  });

  it('skips legacy flat markdown by basename without masking it as an archive-path mismatch', async () => {
    const legacyPath = archivePath(tmpRoot, 'parent', 'legacy.md');
    mkdirSync(path.dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, 'legacy content');
    mockListing([entry(tmpRoot, 'parent', { archivePath: legacyPath })]);
    mockState(['parent'], {
      chains: { root: { rootTaskId: 'root', currentTipTaskId: 'parent', contextPackId: 'pack', contextPackDir: '/packs/pack', taskIds: ['parent'], createdAt: '2026-05-17T08:42:11.000Z', updatedAt: '2026-05-17T08:42:11.000Z' } },
      tasks: {
        parent: record('parent', 0, 'completed', { archivePath: legacyPath }),
      },
    });

    const loaded = bundle(await readParentChainArchiveBundleAction(vi.fn(), payload()));

    expect(loaded.status).toBe('missing-archives');
    expect(loaded.tasks).toEqual([]);
    expect(loaded.missingTaskIds).toEqual(['parent']);
    expect(loggerMock.warn).toHaveBeenCalledWith('Skipped parent chain archive.', expect.objectContaining({
      taskId: 'parent',
      reason: 'legacy-flat-markdown-path',
      archivePath: legacyPath,
    }));
    expect(loggerMock.warn).not.toHaveBeenCalledWith('Skipped parent chain archive.', expect.objectContaining({
      reason: 'archive-path-mismatch',
    }));
  });

  it('skips path escapes, non-regular files, and read failures', async () => {
    const outside = path.join(tmpRoot, 'outside', 'archive.md');
    const directoryPath = archivePath(tmpRoot, 'child');
    const unreadable = archivePath(tmpRoot, 'parent');
    mkdirSync(path.dirname(outside), { recursive: true });
    mkdirSync(directoryPath, { recursive: true });
    mkdirSync(path.dirname(unreadable), { recursive: true });
    writeFileSync(outside, 'outside');
    writeFileSync(unreadable, 'unreadable');
    chmodSync(unreadable, 0);
    mockListing([
      entry(tmpRoot, 'root', { archivePath: outside }),
      entry(tmpRoot, 'child', { archivePath: directoryPath }),
      entry(tmpRoot, 'parent', { archivePath: unreadable }),
    ]);
    mockState(['root', 'child', 'parent']);

    const loaded = bundle(await readParentChainArchiveBundleAction(vi.fn(), payload()));
    chmodSync(unreadable, 0o600);

    expect(loaded.status).toBe('missing-archives');
    expect(loaded.tasks).toEqual([]);
    expect(loaded.missingTaskIds).toEqual(['root', 'child', 'parent']);
    expect(loggerMock.warn).toHaveBeenCalledWith('Skipped parent chain archive.', expect.objectContaining({ reason: 'path-escape' }));
    expect(loggerMock.warn).toHaveBeenCalledWith('Skipped parent chain archive.', expect.objectContaining({ reason: 'not-regular-file' }));
  });

  it('truncates per-file and total content at valid UTF-8 boundaries', async () => {
    for (const taskId of ['root', 'child', 'parent']) {
      const filePath = archivePath(tmpRoot, taskId);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${'a'.repeat(65_535)}€`);
    }
    mockListing(['root', 'child', 'parent'].map((taskId) => entry(tmpRoot, taskId)));
    mockState();

    const loaded = bundle(await readParentChainArchiveBundleAction(vi.fn(), payload()));

    expect(loaded.truncated).toBe(true);
    expect(loaded.tasks[0].truncated).toBe(true);
    expect(loaded.tasks[0].content).not.toContain('\uFFFD');
  });

  it('marks later completed tasks missing when the total bundle cap is exhausted without per-file truncation', async () => {
    const taskIds = ['root', 'child-1', 'child-2', 'child-3', 'child-4', 'parent'];
    const content = `${'a'.repeat(65_533)}€`;
    for (const taskId of taskIds) {
      const filePath = archivePath(tmpRoot, taskId);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }
    mockListing(taskIds.map((taskId) => entry(tmpRoot, taskId)));
    mockState(taskIds, {
      chains: { root: { rootTaskId: 'root', currentTipTaskId: 'parent', contextPackId: 'pack', contextPackDir: '/packs/pack', taskIds, createdAt: '2026-05-17T08:42:11.000Z', updatedAt: '2026-05-17T08:42:11.000Z' } },
      tasks: Object.fromEntries(taskIds.map((taskId, index) => [taskId, record(taskId, index, 'completed')])),
    });

    const loaded = bundle(await readParentChainArchiveBundleAction(vi.fn(), payload()));

    expect(loaded.truncated).toBe(true);
    expect(loaded.tasks.map((task) => task.taskId)).toEqual(['root', 'child-1', 'child-2', 'child-3']);
    expect(loaded.tasks.every((task) => !task.truncated)).toBe(true);
    expect(loaded.missingTaskIds).toEqual(['child-4', 'parent']);
    expect(loaded.tasks.map((task) => task.content).join('')).not.toContain('\uFFFD');
    expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain(content);
  });

});
