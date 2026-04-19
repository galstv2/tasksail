import { watch } from 'node:fs';
import { findRepoRoot, ensureDir } from '../core/index.js';
import { resolveQueuePaths } from './paths.js';
import {
  acquireDirLock,
  activateNextPendingItemIfReady,
} from './operations.js';

export interface PollDropboxOptions {
  interval?: number;
  watchMode?: 'auto' | 'poll';
  repoRoot?: string;
  /** Set to a finite number to limit iterations (for testing). 0 = infinite. */
  maxIterations?: number;
}

/**
 * Long-running loop that watches the pending queue for activation readiness.
 * When the workspace is ready and a pending item exists, activates the next
 * item in queue order. Tasks are moved into pending explicitly by the
 * operator via the Task Board UI — the poll loop no longer auto-sweeps
 * the dropbox.
 *
 * Uses fs.watch when watchMode is 'auto' (default), with a polling
 * fallback. Set watchMode to 'poll' to use interval-based polling only.
 */
export async function pollDropbox(
  options: PollDropboxOptions = {},
): Promise<void> {
  const {
    interval = 1000,
    watchMode = 'auto',
    repoRoot: rawRepoRoot,
    maxIterations = 0,
  } = options;

  const repoRoot = rawRepoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);

  await ensureDir(queuePaths.dropboxDir);
  await ensureDir(queuePaths.pendingDir);

  let iterations = 0;

  const runCycle = async (): Promise<void> => {
    const release = await acquireDirLock(queuePaths.queueLockDir, 3, 100);
    if (!release) return;

    try {
      // Caller-side while-loop: activateNextPendingItemIfReady is one-shot per call.
      // Loop until cap is full or no pending items remain (§4.2).
      while (
        (await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot })).activated
      ) {
        // Continue until concurrency-cap-reached or no pending items
      }
    } finally {
      await release();
    }
  };

  if (watchMode === 'poll' || watchMode !== 'auto') {
    while (maxIterations === 0 || iterations < maxIterations) {
      await runCycle();
      iterations++;
      if (maxIterations > 0 && iterations >= maxIterations) break;
      await sleep(interval);
    }
    return;
  }

  // fs.watch mode with polling fallback
  const watcher = watch(queuePaths.pendingDir, { persistent: true });

  try {
    while (maxIterations === 0 || iterations < maxIterations) {
      await runCycle();
      iterations++;
      if (maxIterations > 0 && iterations >= maxIterations) break;

      // Wait for a filesystem event or fall back to polling interval.
      // Mutual-cancel pattern prevents listener leak when the timer wins.
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const handler = (): void => {
          clearTimeout(timer);
          watcher.removeListener('change', handler);
          resolve();
        };
        watcher.on('change', handler);
        timer = setTimeout(() => {
          watcher.removeListener('change', handler);
          resolve();
        }, interval);
      });
    }
  } finally {
    watcher.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
