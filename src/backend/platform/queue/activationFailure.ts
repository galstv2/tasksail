import path from 'node:path';
import { rm, unlink, writeFile } from 'node:fs/promises';

import {
  createLogger,
  emitTaskProgressEvent,
  ensureDir,
  getErrorMessage,
  moveFile,
} from '../core/index.js';
import { clearActivationProgress } from './activationProgress.js';
import { markChildTaskChainTaskFailed } from './childTaskChainFailure.js';
import { removeFromQueueOrderManifest } from './queueOrderManifest.js';
import type { QueuePaths } from './paths.js';
import { transitionTask } from './taskRegistry.js';

export const ACTIVATION_BRANCH_CHAIN_BASE_UNRESOLVED_REASON = 'activation-branch-chain-base-unresolved';

const log = createLogger('platform/queue/activationFailure');

export function isBranchChainBaseUnresolvedActivationError(error: unknown): boolean {
  return getErrorMessage(error).startsWith(`${ACTIVATION_BRANCH_CHAIN_BASE_UNRESOLVED_REASON} for task `);
}

export async function failPendingActivationForBranchChainBaseUnresolved(args: {
  repoRoot: string;
  paths: QueuePaths;
  taskId: string;
  pendingItemPath: string;
  content: string;
  error: unknown;
}): Promise<{ errorItemPath: string }> {
  const fileName = `${args.taskId}.md`;
  const errorItemPath = path.join(args.paths.errorItemsDir, fileName);
  const taskWorkspacePath = path.join(args.repoRoot, 'AgentWorkSpace', 'tasks', args.taskId);
  const activeMarkerPath = path.join(args.paths.activeItemsDir, args.taskId);

  await clearActivationProgress(args.paths, args.taskId).catch((error: unknown) => {
    log.warn('branch_chain_base_unresolved.activation_progress_clear_failed', {
      taskId: args.taskId,
      error: getErrorMessage(error),
    });
  });
  await unlink(activeMarkerPath).catch(() => {});
  await rm(taskWorkspacePath, { recursive: true, force: true });
  await ensureDir(args.paths.errorItemsDir);

  try {
    await moveFile(args.pendingItemPath, errorItemPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
    await writeFile(errorItemPath, `${args.content.trimEnd()}\n`, 'utf-8');
  }

  await removeFromQueueOrderManifest(args.paths.queueOrderPath, fileName);

  try {
    await transitionTask(args.repoRoot, args.taskId, 'pending', 'failed');
  } catch (error: unknown) {
    log.warn('branch_chain_base_unresolved.registry_transition_failed', {
      taskId: args.taskId,
      error: getErrorMessage(error),
    });
  }

  try {
    await markChildTaskChainTaskFailed({ repoRoot: args.repoRoot, taskId: args.taskId });
  } catch (error: unknown) {
    log.error('branch_chain_base_unresolved.child_chain_mark_failed_failed', error, {
      taskId: args.taskId,
    });
  }

  const taskLog = log.child({ taskId: args.taskId });
  await emitTaskProgressEvent({
    logger: taskLog,
    repoRoot: args.repoRoot,
    taskId: args.taskId,
    event: {
      type: 'activation.failed',
      input: { reason: ACTIVATION_BRANCH_CHAIN_BASE_UNRESOLVED_REASON },
    },
  });
  await emitTaskProgressEvent({
    logger: taskLog,
    repoRoot: args.repoRoot,
    taskId: args.taskId,
    event: { type: 'queue.task.failed' },
  });
  await emitTaskProgressEvent({
    logger: taskLog,
    repoRoot: args.repoRoot,
    taskId: args.taskId,
    event: {
      type: 'queue.error_items.moved',
      input: { errorPath: errorItemPath, reason: ACTIVATION_BRANCH_CHAIN_BASE_UNRESOLVED_REASON },
    },
  });

  log.warn('branch_chain_base_unresolved.moved_to_failed', {
    taskId: args.taskId,
    errorItemPath,
    error: getErrorMessage(args.error),
  });

  return { errorItemPath };
}
