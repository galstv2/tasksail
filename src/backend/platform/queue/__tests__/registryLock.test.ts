import path from 'node:path';
import { fork } from 'node:child_process';
import { mkdtemp, rm, utimes, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { acquireRegistryLock, REGISTRY_LOCK_DIR_RELATIVE } from '../registryLock.js';
import { loadTaskRegistry, registerTask } from '../taskRegistry.js';

describe('registryLock', () => {
  it('blocks a second caller until the first releases', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'tasksail-registry-lock-'));
    try {
      const releaseFirst = await acquireRegistryLock(repoRoot, { timeoutMs: 100 });
      let secondAcquired = false;
      const second = acquireRegistryLock(repoRoot, { timeoutMs: 2000, backoffMs: 10 })
        .then(async (releaseSecond) => {
          secondAcquired = true;
          await releaseSecond();
        });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondAcquired).toBe(false);
      await releaseFirst();
      await second;
      expect(secondAcquired).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('reclaims a stale registry lock directory', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'tasksail-registry-lock-'));
    try {
      const lockDir = path.join(repoRoot, REGISTRY_LOCK_DIR_RELATIVE);
      await mkdir(lockDir, { recursive: true });
      const stale = new Date(Date.now() - 60_000);
      await utimes(lockDir, stale, stale);

      const release = await acquireRegistryLock(repoRoot, { timeoutMs: 500, backoffMs: 10 });
      await release();
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('preserves concurrent transitions from separate child processes', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'tasksail-registry-lock-'));
    const workerPath = path.join(repoRoot, 'transition-worker.mjs');
    try {
      await registerTask(repoRoot, makeEntry('task-a'));
      await registerTask(repoRoot, makeEntry('task-b'));
      await writeFile(
        workerPath,
        `
          import { transitionTask } from '${path.resolve('src/backend/platform/queue/taskRegistry.ts')}';
          await transitionTask(process.env.REPO_ROOT, process.env.TASK_ID, 'pending', 'active');
          if (process.send) process.send('done');
        `,
        'utf-8',
      );

      await Promise.all([
        runWorker(workerPath, repoRoot, 'task-a'),
        runWorker(workerPath, repoRoot, 'task-b'),
      ]);

      const activeIds = Object.values((await loadTaskRegistry(repoRoot)).tasks)
        .flatMap((set) => set.active.map((entry) => entry.taskId))
        .sort();
      expect(activeIds).toEqual(['task-a', 'task-b']);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

function makeEntry(taskId: string) {
  return {
    taskId,
    fileName: `${taskId}.md`,
    title: taskId,
    state: 'pending' as const,
    contextPackId: null,
    contextPackDir: null,
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    createdAt: null,
    completedAt: null,
    archivePath: null,
  };
}

async function runWorker(workerPath: string, repoRoot: string, taskId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = fork(workerPath, {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, REPO_ROOT: repoRoot, TASK_ID: taskId },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker exited ${code}`));
    });
  });
}
