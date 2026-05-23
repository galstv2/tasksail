import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { findRepoRoot } from '../core/index.js';
import { discardRetainedTaskWorktrees } from '../core/worktreeFinalize.js';
import { resolveQueuePaths } from './paths.js';
import { withDirLock } from './dirLock.js';
import { cleanupDeletedChildTaskChainTask } from './childTaskChainDeletion.js';
import { cleanupStagedPlannerFocusSnapshot } from './plannerFocusSnapshotStaging.js';
import { removeTask } from './taskRegistry.js';

export interface DeleteDropboxItemOptions {
  queueName: string;
  repoRoot?: string;
}

export async function deleteDropboxItem(
  options: DeleteDropboxItemOptions,
): Promise<void> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);
  const queueName = normalizeQueueName(options.queueName);
  const targetPath = join(queuePaths.dropboxDir, queueName);

  const deletedTaskId = queueName.replace(/\.md$/, '');
  await withDirLock(queuePaths.queueLockDir, 'Delete dropbox item', async () => {
    await cleanupDeletedChildTaskChainTask(repoRoot, deletedTaskId, async () => {
      try {
        await unlink(targetPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Delete dropbox item blocked: "${queueName}" does not exist in dropbox/.`);
        }
        throw err;
      }
      await cleanupStagedPlannerFocusSnapshot(repoRoot, deletedTaskId);
    });
    try { await removeTask(repoRoot, deletedTaskId); } catch { /* best-effort */ }
  });

  // Defense in depth: open tasks have not been activated, so no worktree should
  // exist. Call the discard helper anyway — it's idempotent and a no-op when
  // no .task.json sidecar / dirs / branches are present, and it forecloses any
  // ordering bug where a dropbox item somehow got bound to forensic state.
  await discardRetainedTaskWorktrees(deletedTaskId, repoRoot);
}

function normalizeQueueName(queueName: string): string {
  const trimmed = queueName.trim();
  if (!trimmed || trimmed.startsWith('.')) {
    throw new Error('Delete dropbox item blocked: queue item name must be a visible markdown file.');
  }
  const normalized = basename(trimmed);
  if (!normalized.endsWith('.md')) {
    throw new Error('Delete dropbox item blocked: queue item name must end with .md.');
  }
  return normalized;
}
