import { describe, it, expect } from 'vitest';
import {
  closeoutQueueLockBudget,
  totalWaitMs,
  ARCHIVE_TIMEOUT_MS,
  CLOSEOUT_GIT_HEADROOM_MS,
} from '../closeoutLockBudget.js';

const PER_HOLD_CEILING_MS = ARCHIVE_TIMEOUT_MS + CLOSEOUT_GIT_HEADROOM_MS;
const DIR_LOCK_DEFAULT_MAX_RETRIES = 30;

describe('closeoutQueueLockBudget', () => {
  it('totalWaitMs(budget(10)) >= 10 * perHoldCeiling', () => {
    const budget = closeoutQueueLockBudget(10);
    const wait = totalWaitMs(budget.maxRetries, budget.backoffMs);
    expect(wait).toBeGreaterThanOrEqual(10 * PER_HOLD_CEILING_MS);
  });

  it('budget scales with maxParallelTasks: budget(10) > budget(2)', () => {
    const b10 = closeoutQueueLockBudget(10);
    const b2 = closeoutQueueLockBudget(2);
    expect(b10.maxRetries).toBeGreaterThan(b2.maxRetries);
  });

  it('never returns fewer retries than the dirLock default (30)', () => {
    // Even for a single task, the budget is at least the default.
    const budget = closeoutQueueLockBudget(1);
    expect(budget.maxRetries).toBeGreaterThanOrEqual(DIR_LOCK_DEFAULT_MAX_RETRIES);
  });

  it('returned budget always satisfies the inequality for the given task count', () => {
    for (const n of [1, 2, 5, 10, 20]) {
      const budget = closeoutQueueLockBudget(n);
      const wait = totalWaitMs(budget.maxRetries, budget.backoffMs);
      expect(wait).toBeGreaterThanOrEqual(n * PER_HOLD_CEILING_MS);
    }
  });

  it('totalWaitMs is monotonically increasing with more retries', () => {
    const wait10 = totalWaitMs(10, 50);
    const wait20 = totalWaitMs(20, 50);
    expect(wait20).toBeGreaterThan(wait10);
  });

  it('totalWaitMs caps individual steps at 2000ms', () => {
    // After enough doublings from 50ms, every additional retry adds 2000ms.
    // 50 -> 100 -> 200 -> 400 -> 800 -> 1600 -> 2000 (capped) -> 2000 ...
    const wait100 = totalWaitMs(100, 50);
    const wait101 = totalWaitMs(101, 50);
    expect(wait101 - wait100).toBe(2000);
  });
});
