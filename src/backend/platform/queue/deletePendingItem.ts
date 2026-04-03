import path from 'node:path';
import { basename } from 'node:path';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { findRepoRoot, readTextFile } from '../core/index.js';
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

  const claimedItem = (await readTextFile(queuePaths.activeItemLink))?.trim() || null;
  if (claimedItem === queueName) {
    throw new Error(
      `Delete pending item blocked: "${queueName}" is the active task.`,
    );
  }

  await unlink(targetPath);

  // Remove from the task registry
  const deletedTaskId = queueName.replace(/\.md$/, '');
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
}
