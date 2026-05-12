import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { acquireDirLockOrThrow, readQueueOrderManifest, writeQueueOrderManifest } from '../operations.js';
import { deletePendingItem } from '../deletePendingItem.js';

describe('queue-order manifest locking', () => {
  let repoRoot: string;
  let pendingDir: string;
  let queueOrderPath: string;
  let queueLockDir: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'tasksail-queue-order-'));
    pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    queueOrderPath = path.join(repoRoot, '.platform-state', 'queue', 'queue-order.json');
    queueLockDir = path.join(pendingDir, '.queue-lock.d');
    await mkdir(pendingDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('deletePendingItem waits for the queue lock before mutating queue-order.json', async () => {
    await writeFile(path.join(pendingDir, 'task-a.md'), '# A\n');
    await writeFile(path.join(pendingDir, 'task-b.md'), '# B\n');
    await writeQueueOrderManifest(queueOrderPath, ['task-a.md', 'task-b.md']);

    const release = await acquireDirLockOrThrow(queueLockDir, 'test');
    const deletion = deletePendingItem({ repoRoot, queueName: 'task-a.md' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(existsSync(path.join(pendingDir, 'task-a.md'))).toBe(true);
    expect(await readQueueOrderManifest(queueOrderPath)).toEqual(['task-a.md', 'task-b.md']);
    await release();
    await deletion;

    expect(existsSync(path.join(pendingDir, 'task-a.md'))).toBe(false);
    expect(await readQueueOrderManifest(queueOrderPath)).toEqual(['task-b.md']);
  });

  it('concurrent manifest writers preserve independent updates', async () => {
    await writeFile(path.join(pendingDir, 'task-a.md'), '# A\n');
    await writeFile(path.join(pendingDir, 'task-b.md'), '# B\n');
    await writeFile(path.join(pendingDir, 'task-c.md'), '# C\n');
    await writeQueueOrderManifest(queueOrderPath, ['task-a.md', 'task-b.md', 'task-c.md']);

    await Promise.all([
      deletePendingItem({ repoRoot, queueName: 'task-a.md' }),
      (async () => {
        const release = await acquireDirLockOrThrow(queueLockDir, 'test-reorder');
        try {
          const order = await readQueueOrderManifest(queueOrderPath);
          await writeQueueOrderManifest(queueOrderPath, order.filter((name) => name !== 'task-c.md'));
        } finally {
          await release();
        }
      })(),
    ]);

    expect(await readQueueOrderManifest(queueOrderPath)).toEqual(['task-b.md']);
    await expect(readFile(path.join(pendingDir, 'task-a.md'), 'utf-8')).rejects.toThrow(/ENOENT/);
  });
});
