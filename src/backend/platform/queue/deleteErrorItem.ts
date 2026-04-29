import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { findRepoRoot } from '../core/index.js';
import { discardRetainedTaskWorktrees } from '../core/worktreeFinalize.js';
import { resolveQueuePaths } from './paths.js';
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

  try {
    await unlink(targetPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Delete error item blocked: "${queueName}" does not exist in error-items/.`);
    }
    throw err;
  }

  const deletedTaskId = queueName.replace(/\.md$/, '');
  try { await removeTask(repoRoot, deletedTaskId); } catch { /* best-effort */ }

  // Failed tasks reach error-items via moveFailedItemToErrorItems, which calls
  // finalizeTaskWorktrees. With retain_failed_task_worktrees=true that helper
  // KEEPS the worktree dir, the task/<taskId> branch in each origin, and the
  // .platform-state/runtime/tasks/<taskId>/ subtree for forensic inspection.
  // Operator-initiated delete is the signal that this forensic affordance is
  // no longer needed — mirrors the requeueErrorItem and moveErrorItemToDropbox
  // disposal contracts.
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
