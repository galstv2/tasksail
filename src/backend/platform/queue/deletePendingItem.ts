import path from 'node:path';
import { basename } from 'node:path';
import { unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { findRepoRoot } from '../core/index.js';
import { discardRetainedTaskWorktrees } from '../core/worktreeFinalize.js';
import { resolveQueuePaths } from './paths.js';
import { readQueueOrderManifest, writeQueueOrderManifest } from './operations.js';
import { removeTask } from './taskRegistry.js';

export interface DeletePendingItemOptions {
  queueName: string;
  repoRoot?: string;
}

function normalizeQueueName(queueName: string): string {
  const trimmed = queueName.trim();
  if (!trimmed || trimmed.startsWith('.')) {
    throw new Error('Delete pending item blocked: queue item name must be a visible markdown file.');
  }
  const normalized = basename(trimmed);
  if (!normalized.endsWith('.md')) {
    throw new Error('Delete pending item blocked: queue item name must end with .md.');
  }
  return normalized;
}

export async function deletePendingItem(
  options: DeletePendingItemOptions,
): Promise<void> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);
  const queueName = normalizeQueueName(options.queueName);
  const targetPath = path.join(queuePaths.pendingDir, queueName);

  if (!existsSync(targetPath)) {
    throw new Error(`Delete pending item blocked: "${queueName}" does not exist in pendingitems/.`);
  }

  // Check if the item to delete is currently active via .active-items/ enumeration
  let activeMarkers: string[] = [];
  if (existsSync(queuePaths.activeItemsDir)) {
    try {
      const entries = await readdir(queuePaths.activeItemsDir);
      activeMarkers = entries.filter((f) => !f.endsWith('.completing'));
    } catch { /* skip */ }
  }
  const deletedTaskId = queueName.replace(/\.md$/, '');
  const isActive = activeMarkers.some((m) => m === deletedTaskId || m === queueName);
  if (isActive) {
    throw new Error(
      `Delete pending item blocked: "${queueName}" is the active task.`,
    );
  }

  await unlink(targetPath);

  // Remove from the task registry (deletedTaskId declared above)
  try { await removeTask(repoRoot, deletedTaskId); } catch { /* best-effort */ }

  // Remove from the queue-order manifest; delete the file when empty
  try {
    const order = await readQueueOrderManifest(queuePaths.queueOrderPath);
    const filtered = order.filter((f) => f !== queueName);
    if (filtered.length > 0) {
      await writeQueueOrderManifest(queuePaths.queueOrderPath, filtered);
    } else {
      await unlink(queuePaths.queueOrderPath);
    }
  } catch { /* best-effort */ }

  // Defense in depth: a pending item that is not the active task should not
  // have a materialized worktree (worktree creation happens at activation,
  // and the active-task guard above blocks deletes of currently-active items).
  // The discard helper is idempotent and a no-op when no forensic state
  // exists, so calling it here costs nothing and forecloses any ordering bug.
  await discardRetainedTaskWorktrees(deletedTaskId, repoRoot);
}
