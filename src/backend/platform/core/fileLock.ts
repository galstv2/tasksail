import path from 'node:path';

const lockTails = new Map<string, Promise<unknown>>();

function noop(): void {
  /* swallow — a failed critical section must not block the queue for its key */
}

/**
 * Serialize async read-modify-write sequences that target the same file within
 * this process. Each distinct (resolved) path gets its own FIFO queue, so two
 * concurrent callers cannot interleave their read → modify → write and clobber
 * each other's update.
 *
 * This complements {@link writeTextFileAtomic}: atomic rename prevents a torn
 * destination file, while this lock prevents lost updates from a read-modify-write
 * race. It does not change persisted file locations or formats, and holds no OS
 * handle — so a crash cannot leave a stale lock file behind. Use it for in-process
 * read-modify-write seams (the realistic concurrency for these platform-state
 * writers, which run inside a single backend process).
 */
export async function withFileLock<T>(
  lockKey: string,
  critical: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(lockKey);
  const prior = lockTails.get(key) ?? Promise.resolve();
  // Run after the prior holder settles, regardless of whether it resolved or
  // rejected, so one failed section does not deadlock the rest of the queue.
  const run = prior.then(critical, critical) as Promise<T>;
  const tail = run.then(noop, noop);
  lockTails.set(key, tail);
  // Drop the map entry once we are the last queued caller, to bound growth.
  void tail.then(() => {
    if (lockTails.get(key) === tail) {
      lockTails.delete(key);
    }
  });
  return run;
}
