// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const archiveMock = vi.hoisted(() => ({
  listArchivedTasksAction: vi.fn(),
}));
const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('./main.archivedTasks', () => ({ listArchivedTasksAction: archiveMock.listArchivedTasksAction }));
vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({ warn: loggerMock.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: { createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }) },
}));

import { handleDesktopAction } from './main.desktopActionRouter';
import { readParentContextBundleAction } from './main.parentContextBundle';
import type { PlannerReadParentContextBundleResponse } from '../src/shared/desktopContract';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'parent-context-'));
  archiveMock.listArchivedTasksAction.mockReset();
  loggerMock.warn.mockReset();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function archivedTask(overrides: Record<string, unknown> = {}) {
  const archiveArtifactDir = path.join(tempDir, 'archive');
  return {
    taskId: 'TASK-001',
    title: 'Parent task',
    summary: 'Summary',
    rootTaskId: 'ROOT-001',
    qmdRecordId: 'QMD-1',
    followupReason: '',
    year: '2026',
    archivePath: path.join(archiveArtifactDir, 'archive.md'),
    contextPackName: 'pack',
    parentTaskContent: { taskSummary: 'Fallback summary' },
    parentContextArtifacts: {
      status: 'available',
      archiveArtifactDir,
      handoffsDir: path.join(archiveArtifactDir, 'handoffs'),
      implementationStepsDir: path.join(archiveArtifactDir, 'ImplementationSteps'),
      handoffs: [],
      implementationSteps: [],
      missing: [],
    },
    ...overrides,
  };
}

function mockArchiveTask(task: ReturnType<typeof archivedTask>): void {
  archiveMock.listArchivedTasksAction.mockResolvedValue({
    ok: true,
    response: {
      action: 'planner.listArchivedTasks',
      mode: 'found',
      message: 'Found.',
      tasks: [task],
    },
  });
}

function loadedBundle(result: Awaited<ReturnType<typeof readParentContextBundleAction>>) {
  if (!result.ok) throw new Error(result.error);
  return (result.response as PlannerReadParentContextBundleResponse).bundle;
}

describe('readParentContextBundleAction', () => {
  it('reads allowed handoffs and direct ImplementationSteps in deterministic order', async () => {
    const archiveArtifactDir = path.join(tempDir, 'archive');
    const handoffsDir = path.join(archiveArtifactDir, 'handoffs');
    const stepsDir = path.join(archiveArtifactDir, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(stepsDir, { recursive: true });
    const intake = path.join(handoffsDir, 'intake.md');
    const spec = path.join(handoffsDir, 'implementation-spec.md');
    const professional = path.join(handoffsDir, 'professional-task.md');
    const stepB = path.join(stepsDir, '002-build.md');
    const stepA = path.join(stepsDir, '001-plan.md');
    const tests = path.join(stepsDir, 'tests.md');
    writeFileSync(intake, 'intake');
    writeFileSync(spec, 'spec');
    writeFileSync(professional, 'professional');
    writeFileSync(stepB, 'step b');
    writeFileSync(stepA, 'step a');
    writeFileSync(tests, 'tests');
    mockArchiveTask(archivedTask({
      parentContextArtifacts: {
        status: 'available',
        archiveArtifactDir,
        handoffsDir,
        implementationStepsDir: stepsDir,
        handoffs: [
          { fileName: 'professional-task.md', path: professional, relativePath: 'handoffs/professional-task.md', sizeBytes: 12 },
          { fileName: 'implementation-spec.md', path: spec, relativePath: 'handoffs/implementation-spec.md', sizeBytes: 4 },
          { fileName: 'intake.md', path: intake, relativePath: 'handoffs/intake.md', sizeBytes: 6 },
        ],
        implementationSteps: [
          { fileName: '002-build.md', path: stepB, relativePath: 'ImplementationSteps/002-build.md', sizeBytes: 6 },
          { fileName: '001-plan.md', path: stepA, relativePath: 'ImplementationSteps/001-plan.md', sizeBytes: 6 },
          { fileName: 'tests.md', path: tests, relativePath: 'ImplementationSteps/tests.md', sizeBytes: 5 },
        ],
        missing: [],
      },
    }));

    const result = await readParentContextBundleAction(vi.fn(), {
      parentTaskId: 'TASK-001',
      contextPackDir: '/packs/pack',
      contextPackId: 'pack',
    });

    expect(archiveMock.listArchivedTasksAction).toHaveBeenCalledWith(expect.any(Function), {
      scope: { contextPackDir: '/packs/pack', contextPackId: 'pack', contextPackName: 'pack' },
    });
    expect(result.ok).toBe(true);
    const bundle = loadedBundle(result);
    expect(bundle.files.map((file) => file.relativePath)).toEqual([
      'handoffs/intake.md',
      'handoffs/implementation-spec.md',
      'ImplementationSteps/001-plan.md',
      'ImplementationSteps/002-build.md',
    ]);
    expect(bundle.files.map((file) => file.content)).toEqual(['intake', 'spec', 'step a', 'step b']);
  });

  it('skips symlinks and path escapes with structured warnings', async () => {
    const archiveArtifactDir = path.join(tempDir, 'archive');
    const handoffsDir = path.join(archiveArtifactDir, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    const target = path.join(tempDir, 'target.md');
    const link = path.join(handoffsDir, 'intake.md');
    writeFileSync(target, 'target');
    symlinkSync(target, link);
    mockArchiveTask(archivedTask({
      parentContextArtifacts: {
        status: 'missing-artifacts',
        archiveArtifactDir,
        handoffsDir,
        implementationStepsDir: null,
        handoffs: [
          { fileName: 'intake.md', path: link, relativePath: 'handoffs/intake.md', sizeBytes: 6 },
          { fileName: 'final-summary.md', path: path.join(tempDir, 'outside.md'), relativePath: 'handoffs/final-summary.md', sizeBytes: 7 },
        ],
        implementationSteps: [],
        missing: ['ImplementationSteps'],
      },
    }));

    const result = await readParentContextBundleAction(vi.fn(), {
      parentTaskId: 'TASK-001',
      contextPackDir: '/packs/pack',
      contextPackId: 'pack',
    });

    expect(result.ok).toBe(true);
    expect(loadedBundle(result).files).toEqual([]);
    expect(loadedBundle(result).status).toBe('missing-artifacts');
    expect(loggerMock.warn).toHaveBeenCalledWith('Skipped parent context bundle file.', expect.objectContaining({ reason: 'symlink' }));
    expect(loggerMock.warn).toHaveBeenCalledWith('Skipped parent context bundle file.', expect.objectContaining({ reason: 'path-escape' }));
  });

  it('returns fallback summary for legacy flat archives and fails closed when artifact metadata is absent', async () => {
    mockArchiveTask(archivedTask({
      parentContextArtifacts: {
        status: 'legacy-flat-archive',
        archiveArtifactDir: null,
        handoffsDir: null,
        implementationStepsDir: null,
        handoffs: [],
        implementationSteps: [],
        missing: ['handoffs'],
      },
    }));
    const legacy = await readParentContextBundleAction(vi.fn(), {
      parentTaskId: 'TASK-001',
      contextPackDir: '/packs/pack',
      contextPackId: 'pack',
    });
    expect(loadedBundle(legacy).status).toBe('legacy-flat-archive');
    expect(loadedBundle(legacy).fallbackSummary?.taskSummary).toBe('Fallback summary');

    mockArchiveTask(archivedTask({ parentContextArtifacts: undefined }));
    const missing = await readParentContextBundleAction(vi.fn(), {
      parentTaskId: 'TASK-001',
      contextPackDir: '/packs/pack',
      contextPackId: 'pack',
    });
    expect(missing).toMatchObject({ ok: false, action: 'planner.readParentContextBundle' });
  });

  it('truncates large files at valid UTF-8 byte boundaries', async () => {
    const archiveArtifactDir = path.join(tempDir, 'archive');
    const handoffsDir = path.join(archiveArtifactDir, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    const intake = path.join(handoffsDir, 'intake.md');
    writeFileSync(intake, `${'a'.repeat(32767)}€`);
    mockArchiveTask(archivedTask({
      parentContextArtifacts: {
        status: 'available',
        archiveArtifactDir,
        handoffsDir,
        implementationStepsDir: null,
        handoffs: [{ fileName: 'intake.md', path: intake, relativePath: 'handoffs/intake.md', sizeBytes: 32770 }],
        implementationSteps: [],
        missing: [],
      },
    }));

    const result = await readParentContextBundleAction(vi.fn(), {
      parentTaskId: 'TASK-001',
      contextPackDir: '/packs/pack',
      contextPackId: 'pack',
    });

    const file = loadedBundle(result).files[0];
    expect(file?.truncated).toBe(true);
    expect(file?.content).not.toContain('\uFFFD');
    expect(Buffer.byteLength(file?.content ?? '', 'utf8')).toBeLessThanOrEqual(32768);
  });

  it('stops at the total bundle cap with a partial final file', async () => {
    const archiveArtifactDir = path.join(tempDir, 'archive');
    const stepsDir = path.join(archiveArtifactDir, 'ImplementationSteps');
    mkdirSync(stepsDir, { recursive: true });
    const entries = Array.from({ length: 8 }, (_, index) => {
      const fileName = `${String(index + 1).padStart(3, '0')}.md`;
      const filePath = path.join(stepsDir, fileName);
      const content = index === 5 ? 'b'.repeat(10000) : 'a'.repeat(32768);
      writeFileSync(filePath, content);
      return {
        fileName,
        path: filePath,
        relativePath: `ImplementationSteps/${fileName}`,
        sizeBytes: Buffer.byteLength(content),
      };
    });
    mockArchiveTask(archivedTask({
      parentContextArtifacts: {
        status: 'available',
        archiveArtifactDir,
        handoffsDir: null,
        implementationStepsDir: stepsDir,
        handoffs: [],
        implementationSteps: entries,
        missing: [],
      },
    }));

    const result = await readParentContextBundleAction(vi.fn(), {
      parentTaskId: 'TASK-001',
      contextPackDir: '/packs/pack',
      contextPackId: 'pack',
    });

    const bundle = loadedBundle(result);
    expect(bundle.totalBytes).toBe(196608);
    expect(bundle.truncated).toBe(true);
    expect(bundle.files.at(-1)?.relativePath).toBe('ImplementationSteps/007.md');
    expect(bundle.files.at(-1)?.truncated).toBe(true);
    expect(bundle.files).toHaveLength(7);
  });
});

describe('desktop action router parent context bundle routing', () => {
  it('uses the injected readParentContextBundle handler', async () => {
    const payload = { parentTaskId: 'TASK-001', contextPackDir: '/packs/pack', contextPackId: 'pack' };
    const readParentContextBundle = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.readParentContextBundle', mode: 'loaded', accepted: true, message: 'Injected.', bundle: {} },
    });

    const result = await handleDesktopAction(
      { action: 'planner.readParentContextBundle', payload },
      { readParentContextBundle },
    );

    expect(readParentContextBundle).toHaveBeenCalledWith(payload);
    expect(result).toEqual(await readParentContextBundle.mock.results[0]?.value);
  });
});
