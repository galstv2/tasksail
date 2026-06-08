/**
 * Computes the queue-lock acquisition retry budget for closeout paths
 * (completePendingItem and moveFailedItemToErrorItems).
 *
 * The budget is sized so that up to max_parallel_tasks simultaneous closeouts
 * can each wait their turn without exhausting retries — even if every other
 * task is holding the lock across a full archive + git finalization round.
 *
 * We deliberately keep all queue-state mutations inside the lock and widen
 * the acquisition wait budget to cover the worst-case serialized hold time.
 */

/**
 * Mirrors the timeout used by fileTaskArchive (archive.ts: timeout 60_000).
 * If that constant changes, update this value in lockstep.
 */
export const ARCHIVE_TIMEOUT_MS = 60_000;

/**
 * Headroom for git snapshot, branch-verify, auto-merge, and worktree
 * finalization that run inside the same lock hold.
 */
export const CLOSEOUT_GIT_HEADROOM_MS = 30_000;

/** dirLock default retry count — budget must never go below this. */
const DIR_LOCK_DEFAULT_MAX_RETRIES = 30;

/**
 * Compute the total worst-case wait time (ms) for a given retry budget.
 *
 * acquireDirLock sleeps waitMs before each retry attempt, starting at
 * backoffMs and doubling each time up to a 2000ms cap. This function sums
 * the full series so tests can assert the budget inequality without relying
 * on implementation details of acquireDirLock's sleep loop.
 *
 * @param maxRetries - Number of retry attempts (acquireDirLock loop iterations).
 * @param backoffMs  - Initial backoff in ms (doubles each step, cap 2000ms).
 */
export function totalWaitMs(maxRetries: number, backoffMs: number): number {
  let total = 0;
  let wait = backoffMs;
  for (let i = 0; i < maxRetries; i++) {
    total += wait;
    wait = Math.min(wait * 2, 2000);
  }
  return total;
}

/**
 * Return a lock-acquisition retry budget for closeout operations that is
 * guaranteed to exceed the worst-case serialized hold time for
 * max_parallel_tasks simultaneous closeouts.
 *
 * The worst-case hold per closeout is ARCHIVE_TIMEOUT_MS + CLOSEOUT_GIT_HEADROOM_MS.
 * The budget is sized so totalWaitMs(budget) >= maxParallelTasks * perHoldCeilingMs,
 * and never returns fewer retries than the dirLock default of 30.
 *
 * @param maxParallelTasks - The configured maximum number of concurrently active tasks.
 */
export function closeoutQueueLockBudget(maxParallelTasks: number): {
  maxRetries: number;
  backoffMs: number;
} {
  const perHoldCeilingMs = ARCHIVE_TIMEOUT_MS + CLOSEOUT_GIT_HEADROOM_MS;
  const targetWaitMs = maxParallelTasks * perHoldCeilingMs;

  // Start with the dirLock default initial backoff.
  const backoffMs = 50;

  // Find the minimum maxRetries such that totalWaitMs >= targetWaitMs.
  // The series converges once backoff saturates at 2000ms, so we can solve
  // analytically after that point, but a simple linear search is correct and
  // cheap for the sizes involved (result is on the order of hundreds).
  let retries = DIR_LOCK_DEFAULT_MAX_RETRIES;
  while (totalWaitMs(retries, backoffMs) < targetWaitMs) {
    retries += 1;
  }

  return { maxRetries: retries, backoffMs };
}
