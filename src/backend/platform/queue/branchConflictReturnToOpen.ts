import path from 'node:path';

import type { QueuePaths } from './paths.js';
import type { ActivationBranchConflict } from './activeBranchConflictGuard.js';
import { clearActivationProgress } from './activationProgress.js';
import { movePendingItemToDropboxAlreadyLocked } from './pendingReturnToOpen.js';
import { createLogger } from '../core/index.js';

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
  const queueName = path.basename(args.queueName.trim());
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

  try {
    await clearActivationProgress(args.queuePaths, args.taskId);
  } catch (err) {
    log.warn('branch_conflict_return_open.activation_progress_clear_failed', {
      taskId: args.taskId,
      marker: `${args.taskId}.json`,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    return await movePendingItemToDropboxAlreadyLocked({
      repoRoot: args.repoRoot,
      fileName: queueName,
      reason: 'activation-branch-conflict',
    });
  } catch (err) {
    throw new Error(
      `activation-branch-conflict-return-open-failed for task "${args.taskId}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}
