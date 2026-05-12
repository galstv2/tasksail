import {
  mkdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { isMissingPathError, sleep, writeTextFileAtomic } from '../core/index.js';

const OWNER_FILENAME = 'owner.json';
const STALE_LOCK_DIR_TTL_MS = 5 * 60 * 1000;

/**
 * Acquire a directory-based lock using mkdir atomicity.
 * Returns a release function on success, or null if the lock could not be acquired.
 *
 * If the existing lock's owner PID is dead (the previous holder crashed without
 * releasing), the lock is reclaimed and the next acquire attempt proceeds. PID
 * reuse is theoretically possible; the release function defends against it by
 * verifying ownership before removing the lock dir.
 */
export async function acquireDirLock(
  lockDir: string,
  maxRetries = 30,
  backoffMs = 50,
  staleLockDirTtlMs = STALE_LOCK_DIR_TTL_MS,
): Promise<(() => Promise<void>) | null> {
  let waitMs = backoffMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await mkdir(lockDir);
      const ownerPath = path.join(lockDir, OWNER_FILENAME);
      try {
        await writeTextFileAtomic(ownerPath, `${JSON.stringify({ pid: process.pid })}\n`);
      } catch {
        await removeLockDir(lockDir);
        continue;
      }
      return makeRelease(lockDir, ownerPath, process.pid);
    } catch {
      // Expected: lock held by another process (or a stale orphan).
      const reclaimed = await tryReclaimStaleLock(lockDir, staleLockDirTtlMs);
      if (reclaimed) {
        // Skip the backoff; we just freed the lock and want to retry immediately.
        continue;
      }
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

/**
 * Run `fn` while holding the directory lock at `lockDir`. Releases the lock
 * even if `fn` throws. Use for the standard acquire → try → finally → release
 * pattern around queue-mutating operations.
 */
export async function withDirLock<T>(
  lockDir: string,
  operationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireDirLockOrThrow(lockDir, operationName);
  try {
    return await fn();
  } finally {
    await release();
  }
}

function makeRelease(
  lockDir: string,
  ownerPath: string,
  ownerPid: number,
): () => Promise<void> {
  return async () => {
    // Re-read the owner file before removing. If another acquirer reclaimed
    // this lock as stale (after we were reaped, or due to PID reuse), the
    // owner.json now belongs to someone else and we must not delete it.
    let stillOurs = true;
    try {
      const raw = await readFile(ownerPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'pid' in parsed &&
        typeof (parsed as { pid: unknown }).pid === 'number' &&
        (parsed as { pid: number }).pid !== ownerPid
      ) {
        stillOurs = false;
      }
    } catch {
      // Owner file missing or unreadable; treat as best-effort and proceed.
    }

    if (!stillOurs) {
      return;
    }

    await removeLockDir(lockDir);
  };
}

/**
 * If the lock dir exists and its recorded owner PID is dead, remove the lock
 * dir so the next acquire attempt can claim it. Returns true if reclamation
 * occurred. Conservative: any uncertainty (missing owner file, unparseable
 * JSON, missing PID, alive PID, permission denied) leaves the lock alone.
 */
async function tryReclaimStaleLock(
  lockDir: string,
  staleLockDirTtlMs: number,
): Promise<boolean> {
  const ownerPath = path.join(lockDir, OWNER_FILENAME);
  let pid: number | null;
  try {
    const raw = await readFile(ownerPath, 'utf-8');
    pid = extractOwnerPid(raw);
  } catch {
    let lockDirStat;
    try {
      lockDirStat = await stat(lockDir);
    } catch (err: unknown) {
      if (isMissingPathError(err)) {
        return false;
      }
      throw err;
    }

    if (Date.now() - lockDirStat.mtimeMs < staleLockDirTtlMs) {
      return false;
    }

    await removeLockDir(lockDir);
    return true;
  }

  if (pid === null || !isHolderDead(pid)) {
    return false;
  }

  await removeLockDir(lockDir);
  return true;
}

async function removeLockDir(lockDir: string): Promise<void> {
  // Recursive force handles legacy temp files (e.g. `owner.json.tmp` from older
  // releases or hard-killed atomic writes) without a separate cleanup step,
  // and silently no-ops if the dir is already gone.
  await rm(lockDir, { recursive: true, force: true });
}

function extractOwnerPid(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'pid' in parsed &&
      typeof (parsed as { pid: unknown }).pid === 'number' &&
      Number.isInteger((parsed as { pid: number }).pid) &&
      (parsed as { pid: number }).pid > 0
    ) {
      return (parsed as { pid: number }).pid;
    }
  } catch {
    // Not JSON
  }
  return null;
}

function isHolderDead(pid: number): boolean {
  try {
    // Signal 0 performs error checks but doesn't actually send a signal.
    // ESRCH means no such process; EPERM means alive but inaccessible.
    process.kill(pid, 0);
    return false;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ESRCH') {
      return true;
    }
    // EPERM (alive, different uid) or anything else: treat as alive to avoid
    // wrongly reclaiming a healthy lock.
    return false;
  }
}
