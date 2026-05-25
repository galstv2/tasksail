import path from 'node:path';
import { resolveQueuePaths, type QueuePaths } from './paths.js';
import { acquireDirLockOrThrow } from './dirLock.js';
import { createLogger, emitTaskProgressEvent, ensureDir } from '../core/index.js';
import {
  activateNextPendingItemIfReady,
  moveDropboxItemsOnce,
  type ActivateNextPendingItemResult,
} from './operations.js';

const log = createLogger('platform/queue/publishPendingItem');

export interface PublishPendingItemOptions {
  /**
   * The publish call. Must return the destination path of the newly-written
   * pending item (e.g., the value `createDropboxTask` or `createFollowupTask`
   * resolves to). Called exactly once, inside the queue mutation lock.
   */
  publish: () => Promise<string>;
  /** Repo root used to resolve queue paths and platform config. */
  repoRoot: string;
  /**
   * Optional context-pack directory forwarded to the activation call.
   * If omitted, activation resolves the active context pack from platform state.
   */
  contextPackDir?: string;
  /**
   * Diagnostic name surfaced if lock acquisition fails. Use the IPC action
   * name or CLI command name for traceability (e.g., 'planner.finalizeSpec',
   * 'cli.new-task').
   */
  lockOperationName: string;
}

export interface PublishPendingItemResult {
  /** Destination path returned by the `publish` call. */
  destinationPath: string;
  /**
   * Outcome of the post-publish activation attempt. Best-effort: an
   * activation failure does NOT cause `publishPendingItem` itself to throw.
   * The caller decides whether to log, retry, or ignore.
   */
  activation: ActivateNextPendingItemResult;
}

/**
 * Atomic publish-then-activate transaction.
 *
 * Acquires the queue mutation lock, calls the supplied `publish` function,
 * then attempts `activateNextPendingItemIfReady`. Activation is best-effort;
 * if it throws or returns `{ activated: false }`, the published file remains
 * on disk and the failure is surfaced via the returned `activation` field.
 *
 * Callers replace the pattern:
 *   const path = await createDropboxTask({...});
 * With:
 *   const { destinationPath: path, activation } = await publishPendingItem({
 *     publish: () => createDropboxTask({...}),
 *     repoRoot: REPO_ROOT,
 *     lockOperationName: 'caller.id',
 *   });
 */
export async function publishPendingItem(
  options: PublishPendingItemOptions,
): Promise<PublishPendingItemResult> {
  const { publish, repoRoot, contextPackDir, lockOperationName } = options;
  const paths: QueuePaths = resolveQueuePaths(repoRoot);
  await ensureDir(paths.pendingDir);
  let destinationPath: string;
  const release = await acquireDirLockOrThrow(paths.queueLockDir, lockOperationName);
  try {
    destinationPath = await publish();
    // Bridge: createDropboxTask/createFollowupTask write into dropbox/, but the
    // activation gate only sees pendingitems/. Sweep before activating so the
    // freshly-published item is visible.
    await moveDropboxItemsOnce(paths.dropboxDir, paths.pendingDir);
  } finally {
    await release();
  }

  let activation: ActivateNextPendingItemResult;
  try {
    activation = await activateNextPendingItemIfReady({
      paths,
      repoRoot,
      contextPackDir,
    });
  } catch (activationError) {
    const message = activationError instanceof Error
      ? activationError.message
      : String(activationError);
    const shortReason = message.replace(/\s+/g, ' ').trim().slice(0, 120) || 'unknown';
    const reason = `activation-error:${shortReason}`;
    const taskId = path.basename(destinationPath, '.md');
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'queue.active.skipped', input: { reason } },
    });
    activation = {
      activated: false,
      reason: `activation-error: ${shortReason}`,
    };
  }

  return { destinationPath, activation };
}
