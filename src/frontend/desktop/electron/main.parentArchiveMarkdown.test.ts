// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathMock = vi.hoisted(() => ({ repoRoot: '' }));

vi.mock('./paths', () => ({
  get REPO_ROOT() {
    return pathMock.repoRoot;
  },
  get DESKTOP_ROOT() {
    return path.join(pathMock.repoRoot, 'src/frontend/desktop');
  },
}));

const archiveMock = vi.hoisted(() => ({
  listArchivedTasksAction: vi.fn(),
}));

vi.mock('./main.archivedTasks', () => ({
  listArchivedTasksAction: archiveMock.listArchivedTasksAction,
}));

import { readParentArchiveMarkdownAction } from './main.parentArchiveMarkdown';
import { handleDesktopAction } from './main.desktopActionRouter';

function payload(overrides: Record<string, string> = {}) {
  return {
    parentTaskId: 'parent-1',
    contextPackDir: '/packs/test-pack',
    contextPackId: 'test-pack',
    ...overrides,
  };
}

function archivePath(...parts: string[]): string {
  return path.join(pathMock.repoRoot, 'AgentWorkSpace', 'qmd', 'context-packs', 'test-pack', 'archive', 'tasks', ...parts);
}

function mockListing(filePath: string, taskId = 'parent-1'): void {
  archiveMock.listArchivedTasksAction.mockResolvedValue({
    ok: true,
    response: {
      action: 'planner.listArchivedTasks',
      mode: 'found',
      message: 'Found.',
      tasks: [{
        taskId,
        title: 'Parent Task',
        summary: '',
        rootTaskId: taskId,
        qmdRecordId: '',
        followupReason: '',
        year: '2026',
        archivePath: filePath,
        archivedAt: '2026-05-17T08:42:11Z',
        contextPackName: 'test-pack',
      }],
    },
  });
}

describe('readParentArchiveMarkdownAction', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'parent-archive-md-'));
    pathMock.repoRoot = path.join(tmpRoot, 'repo');
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('reads a selected nested parent archive through explicit scope', async () => {
    const filePath = archivePath('2026', 'parent-1', 'archive.md');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, '# Parent\n\nBody');
    mockListing(filePath);

    const result = await readParentArchiveMarkdownAction(vi.fn(), payload());

    expect(archiveMock.listArchivedTasksAction).toHaveBeenCalledWith(expect.any(Function), {
      scope: { contextPackDir: '/packs/test-pack', contextPackId: 'test-pack', contextPackName: 'test-pack' },
    });
    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.readParentArchiveMarkdown',
        taskId: 'parent-1',
        title: 'Parent Task',
        archivePath: filePath,
        archivedAt: '2026-05-17T08:42:11Z',
        content: '# Parent\n\nBody',
        sizeBytes: 14,
      }),
    });
  });

  it('fails when the selected parent is missing', async () => {
    mockListing(archivePath('2026', 'other', 'archive.md'), 'other');

    const result = await readParentArchiveMarkdownAction(vi.fn(), payload());

    expect(result).toMatchObject({
      ok: false,
      action: 'planner.readParentArchiveMarkdown',
      error: 'Archived parent task parent-1 was not found in the selected context pack.',
    });
  });

  it('rejects path escapes and archive-root string-prefix siblings', async () => {
    const filePath = path.join(pathMock.repoRoot, 'AgentWorkSpace', 'qmd', 'context-packs', 'test-pack', 'archive', 'tasks-sibling', 'archive.md');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, '# Escape');
    mockListing(filePath);

    const result = await readParentArchiveMarkdownAction(vi.fn(), payload());

    expect(result).toMatchObject({ ok: false, action: 'planner.readParentArchiveMarkdown' });
  });

  it('rejects symlink archives', async () => {
    const target = archivePath('2026', 'target.md');
    const filePath = archivePath('2026', 'parent-1', 'archive.md');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(target, '# Target');
    symlinkSync(target, filePath);
    mockListing(filePath);

    const result = await readParentArchiveMarkdownAction(vi.fn(), payload());

    expect(result).toMatchObject({ ok: false, error: 'Archived parent archive file cannot be a symlink.' });
  });

  it('rejects non-regular files and oversized files', async () => {
    const dirPath = archivePath('2026', 'parent-1', 'archive.md');
    mkdirSync(dirPath, { recursive: true });
    mockListing(dirPath);
    await expect(readParentArchiveMarkdownAction(vi.fn(), payload()))
      .resolves.toMatchObject({ ok: false, error: 'Archived parent archive path is not a regular file.' });

    const bigPath = archivePath('2026', 'parent-2', 'archive.md');
    mkdirSync(path.dirname(bigPath), { recursive: true });
    writeFileSync(bigPath, Buffer.alloc(2 * 1024 * 1024 + 1));
    mockListing(bigPath);
    await expect(readParentArchiveMarkdownAction(vi.fn(), payload()))
      .resolves.toMatchObject({ ok: false, error: 'Parent archive is too large to preview. The limit is 2 MiB.' });
  });

  it('reads a legacy flat archive markdown file', async () => {
    const filePath = archivePath('2026', 'parent-1.md');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, '# Legacy');
    mockListing(filePath);

    const result = await readParentArchiveMarkdownAction(vi.fn(), payload());

    expect(result).toMatchObject({
      ok: true,
      response: { action: 'planner.readParentArchiveMarkdown', content: '# Legacy' },
    });
  });

  it('uses the injected readParentArchiveMarkdown handler in the router', async () => {
    const readParentArchiveMarkdown = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.readParentArchiveMarkdown', mode: 'loaded', accepted: true, message: 'Injected.' },
    });
    const requestPayload = payload();

    const result = await handleDesktopAction(
      { action: 'planner.readParentArchiveMarkdown', payload: requestPayload },
      { readParentArchiveMarkdown },
    );

    expect(readParentArchiveMarkdown).toHaveBeenCalledWith(requestPayload);
    expect(result).toEqual(await readParentArchiveMarkdown.mock.results[0]?.value);
  });
});
