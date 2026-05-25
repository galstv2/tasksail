import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { returnPendingTaskToOpenForBranchConflict } from '../branchConflictReturnToOpen.js';
import { resolveQueuePaths } from '../paths.js';
import { registerTask, loadTaskRegistry } from '../taskRegistry.js';
import { writeActivationProgress } from '../activationProgress.js';

function conflict() {
  return {
    candidateTaskId: 'task-a',
    conflictingTaskId: 'active-a',
    originalRoot: '/repo',
    repoLabel: 'repo',
    worktreeBranch: 'task/root',
  };
}

async function seedPending(repoRoot: string, taskId = 'task-a'): Promise<ReturnType<typeof resolveQueuePaths>> {
  const paths = resolveQueuePaths(repoRoot);
  mkdirSync(paths.pendingDir, { recursive: true });
  mkdirSync(paths.dropboxDir, { recursive: true });
  writeFileSync(path.join(paths.pendingDir, `${taskId}.md`), '# Task\n', 'utf-8');
  mkdirSync(path.dirname(paths.queueOrderPath), { recursive: true });
  writeFileSync(paths.queueOrderPath, JSON.stringify({ order: [`${taskId}.md`, 'later.md'] }, null, 2), 'utf-8');
  await registerTask(repoRoot, {
    taskId,
    fileName: `${taskId}.md`,
    title: 'Task',
    state: 'pending',
    contextPackId: null,
    contextPackDir: null,
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    createdAt: '2026-05-19T00:00:00Z',
    completedAt: null,
    archivePath: null,
  });
  return paths;
}

describe('branch conflict return to open', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  it('moves the pending item to dropbox, removes queue order, and transitions pending to open', async () => {
    const repoRoot = tempDir('branch-return-open-');
    const paths = await seedPending(repoRoot);

    await expect(returnPendingTaskToOpenForBranchConflict({
      repoRoot,
      queuePaths: paths,
      taskId: 'task-a',
      queueName: 'task-a.md',
      pendingItemPath: path.join(paths.pendingDir, 'task-a.md'),
      conflict: conflict(),
    })).resolves.toEqual({
      movedItem: 'task-a.md',
      openItemPath: path.join(paths.dropboxDir, 'task-a.md'),
    });

    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(false);
    expect(readFileSync(path.join(paths.dropboxDir, 'task-a.md'), 'utf-8')).toBe('# Task\n');
    expect(JSON.parse(readFileSync(paths.queueOrderPath, 'utf-8'))).toEqual({ order: ['later.md'] });
    const registry = await loadTaskRegistry(repoRoot);
    expect(registry.tasks._unbound?.pending).toEqual([]);
    expect(registry.tasks._unbound?.open.map((entry) => entry.taskId)).toEqual(['task-a']);
    expect(existsSync(path.join(repoRoot, '.platform-state', 'child-task-chains.json'))).toBe(false);
  });

  it('clears activation progress marker while preserving return-to-open behavior', async () => {
    const repoRoot = tempDir('branch-return-activating-');
    const paths = await seedPending(repoRoot);
    await writeActivationProgress(paths, {
      taskId: 'task-a',
      queueName: 'task-a.md',
      title: 'Task',
      phase: 'validating',
      startedAt: '2026-05-23T10:00:00Z',
    });

    await returnPendingTaskToOpenForBranchConflict({
      repoRoot,
      queuePaths: paths,
      taskId: 'task-a',
      queueName: 'task-a.md',
      pendingItemPath: path.join(paths.pendingDir, 'task-a.md'),
      conflict: conflict(),
    });

    expect(existsSync(path.join(paths.activatingItemsDir, 'task-a.json'))).toBe(false);
    expect(existsSync(path.join(paths.dropboxDir, 'task-a.md'))).toBe(true);
  });

  it('fails before rename when the dropbox destination already exists', async () => {
    const repoRoot = tempDir('branch-return-collision-');
    const paths = await seedPending(repoRoot);
    writeFileSync(path.join(paths.dropboxDir, 'task-a.md'), '# Existing\n', 'utf-8');

    await expect(returnPendingTaskToOpenForBranchConflict({
      repoRoot,
      queuePaths: paths,
      taskId: 'task-a',
      queueName: 'task-a.md',
      pendingItemPath: path.join(paths.pendingDir, 'task-a.md'),
      conflict: conflict(),
    })).rejects.toThrow('activation-branch-conflict-return-open-failed');

    expect(readFileSync(path.join(paths.pendingDir, 'task-a.md'), 'utf-8')).toBe('# Task\n');
    expect(readFileSync(path.join(paths.dropboxDir, 'task-a.md'), 'utf-8')).toBe('# Existing\n');
  });

  it('keeps the file in dropbox when registry transition fails', async () => {
    vi.doMock('../taskRegistry.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../taskRegistry.js')>();
      return {
        ...actual,
        transitionTask: vi.fn(async () => {
          throw new Error('registry unavailable');
        }),
      };
    });
    const { returnPendingTaskToOpenForBranchConflict: importedReturn } = await import('../branchConflictReturnToOpen.js');
    const repoRoot = tempDir('branch-return-registry-fail-');
    const paths = await seedPending(repoRoot);

    await importedReturn({
      repoRoot,
      queuePaths: paths,
      taskId: 'task-a',
      queueName: 'task-a.md',
      pendingItemPath: path.join(paths.pendingDir, 'task-a.md'),
      conflict: conflict(),
    });

    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(false);
    expect(existsSync(path.join(paths.dropboxDir, 'task-a.md'))).toBe(true);
  });
});
