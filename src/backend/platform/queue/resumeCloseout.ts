import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';

import { createLogger } from '../core/index.js';
import { finalizeTaskWorktrees } from '../core/worktreeFinalize.js';
import { syncRetrospectiveRequiredMetadata } from './retrospectiveFlag.js';
import { transitionTask } from './taskRegistry.js';
import { acquireDirLockOrThrow } from './dirLock.js';
import { resolveQueuePaths } from './paths.js';
import {
  writeDeferredRetrospectiveMarker,
  type CompletingSentinelPayload,
} from './completePendingItem.js';

const log = createLogger('platform/queue/resumeCloseout');

export interface ResumeCloseoutResult {
  status: 'completed' | 'no-sentinel' | 'no-archive-record' | 'still-failing';
  drove: Array<'retrospective-sync' | 'finalize-worktrees' | 'unlink-marker' | 'unlink-sentinel'>;
  error?: string;
}

function readSentinel(sentinelPath: string): CompletingSentinelPayload | null {
  if (!existsSync(sentinelPath)) return null;
  try {
    return JSON.parse(readFileSync(sentinelPath, 'utf-8')) as CompletingSentinelPayload;
  } catch {
    return { ts: Date.now() };
  }
}

async function unlinkIfPresent(targetPath: string): Promise<boolean> {
  try {
    await unlink(targetPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

export async function resumeCloseoutFromSentinel(
  taskId: string,
  repoRoot: string,
): Promise<ResumeCloseoutResult> {
  const queuePaths = resolveQueuePaths(repoRoot);
  const sentinelPath = path.join(queuePaths.activeItemsDir, `${taskId}.completing`);
  const preLockPayload = readSentinel(sentinelPath);
  if (!preLockPayload) {
    return { status: 'no-sentinel', drove: [] };
  }
  if (preLockPayload.archiveSucceeded !== true || typeof preLockPayload.archivePath !== 'string') {
    return { status: 'no-archive-record', drove: [] };
  }

  const drove: ResumeCloseoutResult['drove'] = [];
  const release = await acquireDirLockOrThrow(queuePaths.queueLockDir, 'Resume closeout');
  try {
    const payload = readSentinel(sentinelPath);
    if (!payload) {
      return { status: 'no-sentinel', drove: [] };
    }
    if (payload.archiveSucceeded !== true || typeof payload.archivePath !== 'string') {
      return { status: 'no-archive-record', drove: [] };
    }

    const contextPackDir = payload.contextPackDir;
    if (payload.retrospectiveSynced !== true && contextPackDir) {
      try {
        await syncRetrospectiveRequiredMetadata({
          repoRoot,
          handoffsDir: queuePaths.taskHandoffs(taskId),
          contextPackDir,
          taskId,
        });
        drove.push('retrospective-sync');
      } catch (err) {
        // Per spec §4 Fix B step 5: tolerate retro-sync failure (re-stamp sentinel
        // as Fix A does in completePendingItem) and continue with finalize/unlinks.
        // Aborting here would re-create the strand 173443z hit (§1).
        const reason = err instanceof Error ? err.message : String(err);
        log.warn('retrospective_sync.deferred', { taskId, reason });
        writeDeferredRetrospectiveMarker({
          repoRoot,
          taskId,
          contextPackDir,
          handoffsDir: queuePaths.taskHandoffs(taskId),
        });
      }
    }

    await transitionTask(repoRoot, taskId, 'active', 'completed', {
      completedAt: new Date().toISOString(),
      archivePath: payload.archivePath,
    }).catch(() => {});
    await transitionTask(repoRoot, taskId, 'failed', 'completed', {
      completedAt: new Date().toISOString(),
      archivePath: payload.archivePath,
    }).catch(() => {});

    const { completeActiveItem } = await import('./operations.js');
    await completeActiveItem({
      pendingDir: queuePaths.pendingDir,
      taskId,
      handoffsDir: queuePaths.taskHandoffs(taskId),
      templatesDir: queuePaths.templatesDir,
      implementationStepsDir: queuePaths.taskImplementationSteps(taskId),
    });

    await finalizeTaskWorktrees(taskId, 'completed', repoRoot);
    drove.push('finalize-worktrees');

    if (await unlinkIfPresent(path.join(queuePaths.activeItemsDir, taskId))) {
      drove.push('unlink-marker');
    }
    if (await unlinkIfPresent(sentinelPath)) {
      drove.push('unlink-sentinel');
    }
  } finally {
    await release();
  }

  const { activateNextPendingItemIfReady } = await import('./operations.js');
  await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
  return { status: 'completed', drove };
}
