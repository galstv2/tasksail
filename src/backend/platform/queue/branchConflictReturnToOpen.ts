import path from 'node:path';
import { existsSync } from 'node:fs';

import { ensureDir, moveFile, createLogger } from '../core/index.js';
import type { QueuePaths } from './paths.js';
import { removeFromQueueOrderManifest } from './queueOrderManifest.js';
import { transitionTask } from './taskRegistry.js';
import type { ActivationBranchConflict } from './activeBranchConflictGuard.js';

const log = createLogger('platform/queue/branchConflictReturnToOpen');

export async function returnPendingTaskToOpenForBranchConflict(args: {
  repoRoot: string;
  queuePaths: QueuePaths;
  taskId: string;
  queueName: string;
  pendingItemPath: string;
  conflict: ActivationBranchConflict;
  now?: Date;
}): Promise<{ movedItem: string; openItemPath: string }> {
  const queueName = path.basename(args.queueName);
  if (!queueName.endsWith('.md') || queueName.startsWith('.')) {
    throw new Error(`activation-branch-conflict-return-open-failed for task "${args.taskId}": invalid queue item`);
  }
  if (queueName !== path.basename(args.pendingItemPath)) {
    throw new Error(`activation-branch-conflict-return-open-failed for task "${args.taskId}": queue item mismatch`);
  }

  const expectedPendingPath = path.join(args.queuePaths.pendingDir, queueName);
  if (path.resolve(args.pendingItemPath) !== path.resolve(expectedPendingPath)) {
    throw new Error(`activation-branch-conflict-return-open-failed for task "${args.taskId}": pending item is outside pendingitems`);
  }

  await ensureDir(args.queuePaths.dropboxDir);
  const openItemPath = path.join(args.queuePaths.dropboxDir, queueName);
  if (existsSync(openItemPath)) {
    throw new Error(`activation-branch-conflict-return-open-failed for task "${args.taskId}": dropbox item already exists`);
  }

  await moveFile(args.pendingItemPath, openItemPath);
  await removeFromQueueOrderManifest(args.queuePaths.queueOrderPath, queueName);

  try {
    await transitionTask(args.repoRoot, args.taskId, 'pending', 'open');
  } catch (err) {
    log.warn('branch_conflict_return_open.registry_transition_failed', {
      taskId: args.taskId,
      openItemPath,
      conflictingTaskId: args.conflict.conflictingTaskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { movedItem: queueName, openItemPath };
}
