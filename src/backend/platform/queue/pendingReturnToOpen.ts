import path from 'node:path';
import { existsSync } from 'node:fs';
import { lstat } from 'node:fs/promises';

import { createLogger, ensureDir, findRepoRoot, getErrorMessage, moveFile } from '../core/index.js';
import { clearActivationProgress } from './activationProgress.js';
import { withDirLock } from './dirLock.js';
import { resolveQueuePaths, type QueuePaths } from './paths.js';
import { removeFromQueueOrderManifest } from './queueOrderManifest.js';
import { transitionTask } from './taskRegistry.js';
import { observeKillRequest } from './killTask.js';

const log = createLogger('platform/queue/pendingReturnToOpen');

type PendingReturnReason = 'operator-drag-return-open' | 'activation-branch-conflict';

function normalizeVisibleMarkdownFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed || trimmed.startsWith('.') || trimmed !== path.basename(trimmed) || !trimmed.endsWith('.md')) {
    throw new Error('pending-return-open-failed: queue item must be a visible markdown basename.');
  }
  return trimmed;
}

async function assertRegularVisibleFile(filePath: string, fileName: string): Promise<void> {
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    throw new Error(`pending-return-open-failed: "${fileName}" does not exist in pendingitems/.`);
  }
  if (!stat.isFile()) {
    throw new Error(`pending-return-open-failed: "${fileName}" is not a regular file.`);
  }
}

async function assertNoStartedTaskEvidence(paths: QueuePaths, taskId: string, fileName: string): Promise<void> {
  const evidence = [
    { label: 'active marker', path: path.join(paths.activeItemsDir, taskId) },
    { label: 'activating marker', path: path.join(paths.activatingItemsDir, `${taskId}.json`) },
    { label: '.task.json', path: paths.taskContextPackSidecar(taskId) },
    { label: 'task workspace', path: paths.taskWorktree(taskId) },
  ];
  for (const item of evidence) {
    if (existsSync(item.path)) {
      throw new Error(`pending-return-open-failed: "${fileName}" has started-task evidence (${item.label}).`);
    }
  }
  const killRequest = await observeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId });
  if (killRequest) {
    throw new Error(`pending-return-open-failed: "${fileName}" has started-task evidence (kill request marker).`);
  }
}

async function movePendingItemToDropboxBody(options: {
  repoRoot: string;
  paths: QueuePaths;
  fileName: string;
  reason: PendingReturnReason;
}): Promise<{ movedItem: string; openItemPath: string }> {
  const start = Date.now();
  const fileName = normalizeVisibleMarkdownFileName(options.fileName);
  const taskId = fileName.replace(/\.md$/, '');
  const pendingItemPath = path.join(options.paths.pendingDir, fileName);
  const openItemPath = path.join(options.paths.dropboxDir, fileName);
  log.info('taskboard.pending_return_open.started', { taskId, fileName, reason: options.reason });
  try {
    await assertRegularVisibleFile(pendingItemPath, fileName);
    if (existsSync(openItemPath)) {
      throw new Error(`pending-return-open-failed: dropbox item already exists for "${fileName}".`);
    }
    await assertNoStartedTaskEvidence(options.paths, taskId, fileName);
    await ensureDir(options.paths.dropboxDir);
    await moveFile(pendingItemPath, openItemPath);
    await removeFromQueueOrderManifest(options.paths.queueOrderPath, fileName);
    try {
      await transitionTask(options.repoRoot, taskId, 'pending', 'open');
    } catch (err) {
      log.warn('taskboard.pending_return_open.registry_transition_failed', {
        taskId,
        fileName,
        reason: options.reason,
        error: getErrorMessage(err),
      });
    }
    try {
      await clearActivationProgress(options.paths, taskId);
    } catch {
      // No activation marker should exist after the evidence check; this is best-effort cleanup only.
    }
    log.info('taskboard.pending_return_open.completed', {
      taskId,
      fileName,
      reason: options.reason,
      elapsedMs: Date.now() - start,
    });
    return { movedItem: fileName, openItemPath };
  } catch (err) {
    log.warn('taskboard.pending_return_open.failed', {
      taskId,
      fileName,
      reason: options.reason,
      elapsedMs: Date.now() - start,
      error: getErrorMessage(err),
    });
    throw err;
  }
}

export async function movePendingItemToDropboxAlreadyLocked(options: {
  repoRoot: string;
  fileName: string;
  reason: PendingReturnReason;
}): Promise<{ movedItem: string; openItemPath: string }> {
  return movePendingItemToDropboxBody({
    repoRoot: options.repoRoot,
    paths: resolveQueuePaths(options.repoRoot),
    fileName: options.fileName,
    reason: options.reason,
  });
}

export async function movePendingItemToDropbox(options: {
  repoRoot?: string;
  fileName: string;
  reason: PendingReturnReason;
}): Promise<{ movedItem: string; openItemPath: string }> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const paths = resolveQueuePaths(repoRoot);
  return withDirLock(paths.queueLockDir, 'Move pending item to open', () =>
    movePendingItemToDropboxBody({
      repoRoot,
      paths,
      fileName: options.fileName,
      reason: options.reason,
    }),
  );
}
