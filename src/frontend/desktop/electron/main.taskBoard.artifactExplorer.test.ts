// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: { createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }) },
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
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ''),
    readdir: vi.fn(async () => [] as string[]),
  },
  readFile: vi.fn<(path: string, encoding?: BufferEncoding) => Promise<string>>(async () => ''),
  readdir: vi.fn<(path: string, options?: unknown) => Promise<unknown[]>>(async () => []),
  unlink: vi.fn(async () => undefined),
  lstat: vi.fn<(path: string) => Promise<{ isFile: () => boolean; isSymbolicLink: () => boolean; size: number }>>(
    async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 0 }),
  ),
  loadTaskRegistry: vi.fn(async () => ({ schema_version: 2, tasks: {} })),
  getRegistryPath: vi.fn(() => '/repo/.platform-state/task-registry.json'),
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
  requeueErrorItemImpl: vi.fn(async () => ({ requeuedItem: 'TASK-A.md', activatedItem: null })),
  deletePendingItem: vi.fn(async () => undefined),
  deleteDropboxItem: vi.fn(async () => undefined),
  deleteErrorItem: vi.fn(async () => undefined),
  moveDropboxItemToPending: vi.fn(async () => ({ movedItem: 'TASK-A.md', activatedItem: null })),
  movePendingItemToDropbox: vi.fn(async () => ({ movedItem: 'PENDING-A.md', openItemPath: '/x' })),
  moveErrorItemToDropbox: vi.fn(async () => ({ movedItem: 'TASK-A.md' })),
  requestTaskKill: vi.fn(async () => ({ mode: 'kill-requested' as const, message: '', taskId: 'A', requestedAt: '', state: 'active' as const })),
  executeRequestedTaskKill: vi.fn(async () => ({ mode: 'kill-requested' as const, taskId: 'A' })),
  observeKillRequest: vi.fn(async () => null),
  readActivationProgressRecords: vi.fn(async () => []),
  logError: vi.fn(),
}));

vi.mock('./utils', () => ({ pathExists, repoFs }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile, readdir, unlink, lstat };
});

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({ loadTaskRegistry, getRegistryPath }));

vi.mock('./main.archivedTasks', () => ({ listArchivedTasksAction }));

vi.mock('../../../backend/platform/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/core')>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({ error: logError, warn: vi.fn(), info: vi.fn(), child: vi.fn(() => ({ error: logError, warn: vi.fn(), info: vi.fn() })) })),
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

import { readTaskContent } from './main.taskBoard';
import type { ArchivedTaskEntry } from '../src/shared/desktopContract';

type DirentKind = 'file' | 'dir' | 'symlink';

function dirent(name: string, kind: DirentKind): unknown {
  return {
    name,
    isSymbolicLink: () => kind === 'symlink',
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  };
}

const NESTED_ROOT = '/repo/AgentWorkSpace/qmd/context-packs/pack-a/archive/tasks/2026/DONE-A';

function nestedArchivedTask(overrides: Partial<ArchivedTaskEntry> = {}): ArchivedTaskEntry {
  return {
    taskId: 'DONE-A',
    title: 'Archived DONE-A',
    summary: 'Closeout summary.',
    rootTaskId: 'DONE-A',
    qmdRecordId: 'qmd-DONE-A',
    followupReason: '',
    year: '2026',
    archivePath: `${NESTED_ROOT}/archive.md`,
    archivedAt: null,
    contextPackName: 'pack-a',
    archiveArtifactDir: NESTED_ROOT,
    ...overrides,
  };
}

function resolveArchivedTasks(tasks: ArchivedTaskEntry[]): void {
  listArchivedTasksAction.mockResolvedValue({
    ok: true,
    response: { action: 'planner.listArchivedTasks', mode: 'found', message: 'ok', tasks },
  });
}

// Mock a nested archive root containing archive.md, handoffs/final-summary.md,
// ImplementationSteps/slice-1.md, ImplementationSteps/slice-2.xml, plus entries
// that must be skipped.
function mockNestedTree(): void {
  readdir.mockImplementation(async (dir: string) => {
    if (dir === NESTED_ROOT) {
      return [
        dirent('archive.md', 'file'),
        dirent('sidecar.json', 'file'),
        dirent('.hidden.md', 'file'),
        dirent('linked.md', 'symlink'),
        dirent('handoffs', 'dir'),
        dirent('ImplementationSteps', 'dir'),
        dirent('.git', 'dir'),
      ];
    }
    if (dir === `${NESTED_ROOT}/handoffs`) {
      return [dirent('final-summary.md', 'file'), dirent('.DS_Store', 'file')];
    }
    if (dir === `${NESTED_ROOT}/ImplementationSteps`) {
      return [dirent('slice-1.md', 'file'), dirent('slice-2.xml', 'file')];
    }
    return [];
  });
  lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: 42 });
}

const listContextPacks = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  loadTaskRegistry.mockResolvedValue({ schema_version: 2, tasks: {} });
  readFile.mockResolvedValue('');
  readdir.mockResolvedValue([]);
  lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: 0 });
});

describe('readTaskContent completed artifact explorer', () => {
  it('returns archive.md content plus every regular markdown artifact, archive.md first, casing preserved', async () => {
    resolveArchivedTasks([nestedArchivedTask()]);
    mockNestedTree();
    readFile.mockResolvedValue('# Archive\n');

    const result = await readTaskContent({ column: 'completed', fileName: 'DONE-A.md' }, listContextPacks);

    expect(result.ok).toBe(true);
    const response = (result as { response: { artifacts: { relativePath: string; contentType?: string }[]; artifactRelativePath: string; content: string } }).response;
    expect(response.artifactRelativePath).toBe('archive.md');
    expect(response.content).toBe('# Archive\n');
    expect(response.artifacts.map((a) => a.relativePath)).toEqual([
      'archive.md',
      'handoffs/final-summary.md',
      'ImplementationSteps/slice-1.md',
      'ImplementationSteps/slice-2.xml',
    ]);
    expect(response.artifacts.find((a) => a.relativePath === 'ImplementationSteps/slice-2.xml')).toMatchObject({
      contentType: 'xml',
    });
    expect(readFile).toHaveBeenCalledWith(`${NESTED_ROOT}/archive.md`, 'utf-8');
  });

  it('reads a requested nested handoff and returns its relative path plus the same artifact list', async () => {
    resolveArchivedTasks([nestedArchivedTask()]);
    mockNestedTree();
    readFile.mockImplementation(async (p: string) =>
      p.endsWith('handoffs/final-summary.md') ? '# Final Summary\n' : '# Archive\n');

    const result = await readTaskContent(
      { column: 'completed', fileName: 'DONE-A.md', artifactRelativePath: 'handoffs/final-summary.md' },
      listContextPacks,
    );

    const response = (result as { response: { artifacts: { relativePath: string; contentType?: string }[]; artifactRelativePath: string; content: string } }).response;
    expect(response.artifactRelativePath).toBe('handoffs/final-summary.md');
    expect(response.content).toBe('# Final Summary\n');
    expect(response.artifacts.map((a) => a.relativePath)).toEqual([
      'archive.md',
      'handoffs/final-summary.md',
      'ImplementationSteps/slice-1.md',
      'ImplementationSteps/slice-2.xml',
    ]);
    expect(readFile).toHaveBeenCalledWith(`${NESTED_ROOT}/handoffs/final-summary.md`, 'utf-8');
    expect(readFile).not.toHaveBeenCalledWith(`${NESTED_ROOT}/archive.md`, 'utf-8');
  });

  it('reads a requested XML implementation-step artifact and marks the response as XML', async () => {
    resolveArchivedTasks([nestedArchivedTask()]);
    mockNestedTree();
    readFile.mockImplementation(async (p: string) =>
      p.endsWith('ImplementationSteps/slice-2.xml')
        ? '<executionSlice><metadata><sliceId>slice-2</sliceId></metadata></executionSlice>\n'
        : '# Archive\n');

    const result = await readTaskContent(
      { column: 'completed', fileName: 'DONE-A.md', artifactRelativePath: 'ImplementationSteps/slice-2.xml' },
      listContextPacks,
    );

    const response = (result as { response: { artifactRelativePath: string; content: string; contentType: string } }).response;
    expect(response.artifactRelativePath).toBe('ImplementationSteps/slice-2.xml');
    expect(response.contentType).toBe('xml');
    expect(response.content).toContain('<executionSlice>');
    expect(readFile).toHaveBeenCalledWith(`${NESTED_ROOT}/ImplementationSteps/slice-2.xml`, 'utf-8');
  });

  it('rejects traversal, absolute, and unknown artifact paths without reading an outside file', async () => {
    for (const bad of ['../outside.md', '/etc/passwd', 'handoffs/missing.md']) {
      vi.clearAllMocks();
      resolveArchivedTasks([nestedArchivedTask()]);
      mockNestedTree();

      const result = await readTaskContent(
        { column: 'completed', fileName: 'DONE-A.md', artifactRelativePath: bad },
        listContextPacks,
      );

      const response = (result as { response: { mode: string } }).response;
      expect(response.mode).toBe('not-found');
      expect(readFile).not.toHaveBeenCalled();
    }
  });

  it('prepends branch handoff text for archive.md only, never for nested artifacts', async () => {
    const withHandoff = nestedArchivedTask({
      branchHandoffs: [{ branch: 'feature/x', repoLabel: 'svc', autoMerge: null } as never],
    });
    resolveArchivedTasks([withHandoff]);
    mockNestedTree();
    readFile.mockImplementation(async (p: string) =>
      p.endsWith('handoffs/final-summary.md') ? '# Final Summary\n' : '# Archive Body\n');

    const archiveRead = await readTaskContent({ column: 'completed', fileName: 'DONE-A.md' }, listContextPacks);
    const archiveContent = (archiveRead as { response: { content: string } }).response.content;
    expect(archiveContent).toContain('## Operator Branch Handoff');
    expect(archiveContent).toContain('# Archive Body');

    const nestedRead = await readTaskContent(
      { column: 'completed', fileName: 'DONE-A.md', artifactRelativePath: 'handoffs/final-summary.md' },
      listContextPacks,
    );
    const nestedContent = (nestedRead as { response: { content: string } }).response.content;
    expect(nestedContent).toBe('# Final Summary\n');
    expect(nestedContent).not.toContain('## Operator Branch Handoff');
  });

  it('exposes a single archive.md artifact backed by the flat archive path for legacy flat archives', async () => {
    const flatTask = nestedArchivedTask({
      archivePath: '/repo/AgentWorkSpace/qmd/legacy/DONE-A.md',
      archiveArtifactDir: null,
    });
    resolveArchivedTasks([flatTask]);
    readFile.mockResolvedValue('# Legacy Flat\n');

    const result = await readTaskContent({ column: 'completed', fileName: 'DONE-A.md' }, listContextPacks);

    const response = (result as { response: { artifacts: { relativePath: string }[]; artifactRelativePath: string; content: string; mode: string } }).response;
    expect(response.mode).toBe('found');
    expect(response.artifactRelativePath).toBe('archive.md');
    expect(response.content).toBe('# Legacy Flat\n');
    expect(response.artifacts).toHaveLength(1);
    expect(response.artifacts[0]?.relativePath).toBe('archive.md');
    expect(readFile).toHaveBeenCalledWith('/repo/AgentWorkSpace/qmd/legacy/DONE-A.md', 'utf-8');
  });
});
