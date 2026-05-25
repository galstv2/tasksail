import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { movePendingItemToDropbox } from '../pendingReturnToOpen.js';
import { resolveQueuePaths } from '../paths.js';
import { writeQueueOrderManifest } from '../queueOrderManifest.js';

function tempRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'tasksail-pending-open-'));
}

async function writePending(repoRoot: string, fileName: string): Promise<ReturnType<typeof resolveQueuePaths>> {
  const paths = resolveQueuePaths(repoRoot);
  await mkdir(paths.pendingDir, { recursive: true });
  await mkdir(paths.dropboxDir, { recursive: true });
  await writeFile(path.join(paths.pendingDir, fileName), '# Pending\n');
  await writeQueueOrderManifest(paths.queueOrderPath, [fileName]);
  return paths;
}

describe('movePendingItemToDropbox', () => {
  it('moves plain pending markdown to open and removes the queue-order entry', async () => {
    const repoRoot = tempRepo();
    const paths = await writePending(repoRoot, 'task-a.md');

    const result = await movePendingItemToDropbox({
      repoRoot,
      fileName: 'task-a.md',
      reason: 'operator-drag-return-open',
    });

    expect(result.movedItem).toBe('task-a.md');
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(false);
    await expect(readFile(path.join(paths.dropboxDir, 'task-a.md'), 'utf-8')).resolves.toContain('# Pending');
    expect(existsSync(paths.queueOrderPath)).toBe(false);
  });

  it('fails closed when started-task evidence exists', async () => {
    const repoRoot = tempRepo();
    const paths = await writePending(repoRoot, 'task-a.md');
    await mkdir(paths.activeItemsDir, { recursive: true });
    await writeFile(path.join(paths.activeItemsDir, 'task-a'), 'task-a.md');

    await expect(movePendingItemToDropbox({
      repoRoot,
      fileName: 'task-a.md',
      reason: 'operator-drag-return-open',
    })).rejects.toThrow('started-task evidence');
    expect(existsSync(path.join(paths.pendingDir, 'task-a.md'))).toBe(true);
    expect(existsSync(path.join(paths.dropboxDir, 'task-a.md'))).toBe(false);
  });
});
