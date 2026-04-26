import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Acquire a directory-based lock using mkdir atomicity.
 * Returns a release function on success, or null if the lock could not be acquired.
 */
export async function acquireDirLock(
  lockDir: string,
  maxRetries = 30,
  backoffMs = 50,
): Promise<(() => Promise<void>) | null> {
  let waitMs = backoffMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await mkdir(lockDir);
      const ownerPath = path.join(lockDir, 'owner.json');
      try {
        await writeFile(ownerPath, `${JSON.stringify({ pid: process.pid })}\n`, 'utf-8');
      } catch {
        try {
          await unlink(ownerPath);
        } catch {
          // Owner marker may not have been created
        }
        try {
          await rmdir(lockDir);
        } catch {
          // Lock dir may already be removed
        }
        continue;
      }
      return async () => {
        try {
          await unlink(ownerPath);
        } catch {
          // Owner marker may already be removed
        }
        try {
          await rmdir(lockDir);
        } catch {
          // Lock dir may already be removed
        }
      };
    } catch {
      // Expected: lock held by another process
    }

    await sleep(waitMs);
    waitMs = Math.min(waitMs * 2, 2000);
  }

  return null;
}

/**
 * Acquire the queue lock or throw. Convenience wrapper for callers that
 * must hold the lock and should fail loudly if it is unavailable.
 */
export async function acquireDirLockOrThrow(
  lockDir: string,
  operationName: string,
): Promise<() => Promise<void>> {
  const release = await acquireDirLock(lockDir);
  if (!release) {
    throw new Error(
      `${operationName} blocked: could not acquire queue lock. Another operation may be in progress.`,
    );
  }
  return release;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
