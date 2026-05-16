import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { sleep } from './io.js';

export type TaskTerminalEventsLockFs = {
  mkdir: (dirPath: string, options?: { recursive?: boolean }) => Promise<unknown>;
  rm: (dirPath: string, options: { recursive: true; force: true }) => Promise<unknown>;
};

const DEFAULT_LOCK_RETRIES = 40;
const DEFAULT_LOCK_BACKOFF_MS = 10;

const nodeLockFs: TaskTerminalEventsLockFs = {
  mkdir,
  rm,
};

export function taskTerminalEventsLockPath(repoRoot: string, taskId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'tasks',
    taskId,
    'terminal-events.lock',
  );
}

export async function withTaskTerminalEventsLock<T>(
  repoRoot: string,
  taskId: string,
  fn: () => Promise<T>,
  fsAdapter: TaskTerminalEventsLockFs = nodeLockFs,
): Promise<T> {
  const lockDir = taskTerminalEventsLockPath(repoRoot, taskId);
  await fsAdapter.mkdir(path.dirname(lockDir), { recursive: true });
  const release = await acquireTaskTerminalEventsLock(lockDir, fsAdapter);
  if (!release) {
    throw new Error(`Could not acquire terminal events lock for task "${taskId}".`);
  }

  try {
    return await fn();
  } finally {
    await release();
  }
}

async function acquireTaskTerminalEventsLock(
  lockDir: string,
  fsAdapter: TaskTerminalEventsLockFs,
): Promise<(() => Promise<void>) | null> {
  let waitMs = DEFAULT_LOCK_BACKOFF_MS;
  for (let attempt = 0; attempt < DEFAULT_LOCK_RETRIES; attempt++) {
    try {
      await fsAdapter.mkdir(lockDir);
      return async () => {
        await fsAdapter.rm(lockDir, { recursive: true, force: true });
      };
    } catch {
      await sleep(waitMs);
      waitMs = Math.min(waitMs * 2, 250);
    }
  }
  return null;
}
