import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { findRepoRoot } from '../core/index.js';
import { discardRetainedTaskWorktrees } from '../core/worktreeFinalize.js';
import { resolveQueuePaths } from './paths.js';
import { withDirLock } from './dirLock.js';
import { cleanupDeletedChildTaskChainTask } from './childTaskChainDeletion.js';
import { removeTask } from './taskRegistry.js';

export interface DeleteErrorItemOptions {
  queueName: string;
  repoRoot?: string;
}

export async function deleteErrorItem(
  options: DeleteErrorItemOptions,
): Promise<void> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);
  const queueName = normalizeQueueName(options.queueName);
  const targetPath = join(queuePaths.errorItemsDir, queueName);

  const deletedTaskId = queueName.replace(/\.md$/, '');
  await withDirLock(queuePaths.queueLockDir, 'Delete error item', async () => {
    await cleanupDeletedChildTaskChainTask(repoRoot, deletedTaskId, async () => {
      try {
        await unlink(targetPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Delete error item blocked: "${queueName}" does not exist in error-items/.`);
        }
        throw err;
      }
    });
    try { await removeTask(repoRoot, deletedTaskId); } catch { /* best-effort */ }
  });

  // Deleting an error item is the operator signal to drop retained forensic
  // state: worktree dirs, task branches, and per-task runtime state. This
  // mirrors requeue and dropbox disposal.
  await discardRetainedTaskWorktrees(deletedTaskId, repoRoot);
}

function normalizeQueueName(queueName: string): string {
  const trimmed = queueName.trim();
  if (!trimmed || trimmed.startsWith('.')) {
    throw new Error('Delete error item blocked: queue item name must be a visible markdown file.');
  }
  const normalized = basename(trimmed);
  if (!normalized.endsWith('.md')) {
    throw new Error('Delete error item blocked: queue item name must end with .md.');
  }
  return normalized;
}
