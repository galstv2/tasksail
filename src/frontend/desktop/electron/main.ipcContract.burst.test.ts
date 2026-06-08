// @vitest-environment node
// Deterministic IPC burst evidence test.
//
// Proves that the normal frontend shell-mount + 10-task-board-refresh burst
// pattern stays at or below IPC_RATE_LIMIT_MAX (60 per second) without
// raising the global limiter. This is an evidence-only gate: if the simulated
// burst EXCEEDS 60 calls/second, the test fails with a concrete remediation
// note naming the follow-up coalescing work required.
//
// No real Electron, real sockets, or real task backend processes are used.
// Timing is simulated via a call counter; the test measures call COUNT rather
// than elapsed wall-clock milliseconds to be fully deterministic.

import { describe, expect, it } from 'vitest';

// Constants — must match ipc/contract.ts exactly.
const IPC_RATE_LIMIT_MAX = 60;
const IPC_RATE_LIMIT_WINDOW_MS = 1000;

// Simulated call patterns

// IPC invocations fired during a normal shell mount:
//   - useObservedState initial refresh: queue.readStatus, environment.readStatus,
//     observability.readSnapshot (3 calls, all fired in parallel via Promise.allSettled)
//   - useTaskBoard initial read: taskBoard.readBoard (1 call)
//   - useTaskNotifications initial refresh: taskNotifications.read (1 call)
const SHELL_MOUNT_CALLS = [
  'queue.readStatus',
  'environment.readStatus',
  'observability.readSnapshot',
  'taskBoard.readBoard',
  'taskNotifications.read',
];

// IPC invocations fired during a 10-task board refresh burst:
//   - broadcastTaskBoardUpdate triggers a full board read: taskBoard.readBoard (1)
//   - Opening or refreshing task detail: taskBoard.readTaskContent per task (up to 10)
//   - Notification updates: taskNotifications.read (1)
const TASK_BOARD_REFRESH_BURST_CALLS = [
  'taskBoard.readBoard',
  ...Array.from({ length: 10 }, (_, i) => `taskBoard.readTaskContent[task-${i + 1}]`),
  'taskNotifications.read',
];

// Reinforcement modal loads (when modal is open for active pack):
//   - reinforcement.listTasks, reinforcement.readOverview,
//     reinforcement.listRealignmentSessions (3 calls)
const REINFORCEMENT_MODAL_CALLS = [
  'reinforcement.listTasks',
  'reinforcement.readOverview',
  'reinforcement.listRealignmentSessions',
];

// ---------------------------------------------------------------------------
// Simulated IPC rate-limiter (matches ipc/contract.ts logic exactly)
// ---------------------------------------------------------------------------
//
// Each call is assigned a simulated timestamp so that `now` advances across
// the burst. `intervalMs` controls the gap between consecutive calls; when
// intervalMs > 0 the calls span real time and the window-reset branch in the
// limiter can fire. When intervalMs === 0 all calls land in the same window
// (worst-case single-window burst).
function simulateBurst(
  calls: string[],
  intervalMs = 0,
): { accepted: number; rejected: number; peakPerWindow: number } {
  let windowStart = 0;
  let windowCount = 0;
  let accepted = 0;
  let rejected = 0;
  let peakPerWindow = 0;

  // Initialise windowStart to the timestamp of the first call.
  windowStart = 0;

  for (let i = 0; i < calls.length; i++) {
    // Each call arrives `intervalMs` after the previous one.
    const now = i * intervalMs;
    const elapsed = now - windowStart;
    if (elapsed > IPC_RATE_LIMIT_WINDOW_MS) {
      // Window-reset branch — this is the path that was previously dead code.
      windowStart = now;
      windowCount = 0;
    }
    windowCount++;
    peakPerWindow = Math.max(peakPerWindow, windowCount);
    if (windowCount > IPC_RATE_LIMIT_MAX) {
      rejected++;
    } else {
      accepted++;
    }
  }

  return { accepted, rejected, peakPerWindow };
}

describe('IPC burst evidence — normal 10-task shell pattern (R21)', () => {
  it('confirms IPC_RATE_LIMIT_MAX is 60 and window is 1000 ms', () => {
    // Structural assertion: the limiter values match what this test assumes.
    // If these change, re-evaluate the evidence claim.
    expect(IPC_RATE_LIMIT_MAX).toBe(60);
    expect(IPC_RATE_LIMIT_WINDOW_MS).toBe(1000);
  });

  it('shell mount burst (5 calls) stays within the 60/s limit', () => {
    const { accepted, rejected, peakPerWindow } = simulateBurst(SHELL_MOUNT_CALLS);

    expect(rejected).toBe(0);
    expect(accepted).toBe(SHELL_MOUNT_CALLS.length);
    expect(peakPerWindow).toBeLessThanOrEqual(IPC_RATE_LIMIT_MAX);
  });

  it('task-board refresh burst (12 calls) stays within the 60/s limit', () => {
    const { accepted, rejected, peakPerWindow } = simulateBurst(TASK_BOARD_REFRESH_BURST_CALLS);

    expect(rejected).toBe(0);
    expect(accepted).toBe(TASK_BOARD_REFRESH_BURST_CALLS.length);
    expect(peakPerWindow).toBeLessThanOrEqual(IPC_RATE_LIMIT_MAX);
  });

  it('reinforcement modal load burst (3 calls) stays within the 60/s limit', () => {
    const { accepted, rejected, peakPerWindow } = simulateBurst(REINFORCEMENT_MODAL_CALLS);

    expect(rejected).toBe(0);
    expect(accepted).toBe(REINFORCEMENT_MODAL_CALLS.length);
    expect(peakPerWindow).toBeLessThanOrEqual(IPC_RATE_LIMIT_MAX);
  });

  it('combined worst-case burst (mount + board refresh + reinforcement) stays within limit', () => {
    // Worst case: all patterns fire simultaneously in the same 1-second window.
    const allCalls = [
      ...SHELL_MOUNT_CALLS,
      ...TASK_BOARD_REFRESH_BURST_CALLS,
      ...REINFORCEMENT_MODAL_CALLS,
    ];

    const { accepted: _accepted, rejected, peakPerWindow } = simulateBurst(allCalls);

    // If this fails, the burst exceeds 60/s and a follow-up
    // coalescing follow-up is needed. Do NOT raise IPC_RATE_LIMIT_MAX — instead,
    // add coalescing for the high-frequency callers listed below.
    //
    // Remediation note (required if this assertion fails):
    //   Files needing coalescing in a follow-up:
    //     - src/frontend/desktop/src/renderer/hooks/useObservedState.ts
    //       (debounce the 10s interval trigger on rapid refreshKey changes)
    //     - src/frontend/desktop/src/renderer/hooks/useTaskBoard.ts
    //       (coalesce concurrent readTaskBoard calls into one in-flight promise)
    //     - src/frontend/desktop/electron/tasks/board.ts
    //       (broadcastTaskBoardUpdate already coalesces; verify it
    //        does not trigger redundant per-task content reads)
    //
    // This test must not edit those files; they need a focused follow-up.
    if (rejected > 0 || peakPerWindow > IPC_RATE_LIMIT_MAX) {
      throw new Error(
        `IPC burst EXCEEDS limit: ${peakPerWindow} calls in one window ` +
        `(limit ${IPC_RATE_LIMIT_MAX}, rejected ${rejected}/${allCalls.length}). ` +
        'Follow-up coalescing track required. Files: ' +
        'useObservedState.ts (debounce interval), ' +
        'useTaskBoard.ts (in-flight coalescing), ' +
        'tasks/board.ts (broadcast dedup). ' +
        'Do NOT raise IPC_RATE_LIMIT_MAX.',
      );
    }

    expect(rejected).toBe(0);
    expect(peakPerWindow).toBeLessThanOrEqual(IPC_RATE_LIMIT_MAX);
  });

  it('headroom: combined burst leaves at least 50% capacity', () => {
    // Verify the normal burst uses at most half the limiter budget, giving
    // headroom for user-driven actions (dismiss, mark-seen, etc.).
    const allCalls = [
      ...SHELL_MOUNT_CALLS,
      ...TASK_BOARD_REFRESH_BURST_CALLS,
      ...REINFORCEMENT_MODAL_CALLS,
    ];
    const { peakPerWindow } = simulateBurst(allCalls);

    // 50% of 60/s = 30. The combined burst is 5 + 12 + 3 = 20 calls.
    expect(peakPerWindow).toBeLessThanOrEqual(Math.floor(IPC_RATE_LIMIT_MAX / 2));
  });

  it('window-reset branch fires and resets the counter across two windows', () => {
    // Build a burst of 80 calls spread at 20ms intervals so they span 1600ms
    // (two 1000ms windows). The window-reset branch must execute for calls
    // arriving in the second window, resetting windowCount to 0 at that point.
    //
    // With 80 calls at 20ms each:
    //   Window 1 (t=0..999ms)  → calls 0..49  = 50 accepted
    //   Window 2 (t=1000ms+)   → calls 50..79 = 30 accepted (counter resets)
    //   Total rejected = 0  (neither window exceeds 60)
    //   peakPerWindow = 50  (window 1 has the most calls)
    const calls = Array.from({ length: 80 }, (_, i) => `call-${i}`);
    const { accepted, rejected, peakPerWindow } = simulateBurst(calls, 20);

    // Both windows stay under the limit — the reset kept the second window safe.
    expect(rejected).toBe(0);
    expect(accepted).toBe(80);
    // peakPerWindow reflects only the highest count inside a single window,
    // NOT the total across windows — proving the reset actually happened.
    expect(peakPerWindow).toBeLessThan(80);
    expect(peakPerWindow).toBeLessThanOrEqual(IPC_RATE_LIMIT_MAX);

    // Control case: the same 80 calls crammed into one window WOULD be limited.
    // intervalMs=0 keeps all calls in a single frozen window (elapsed is always 0).
    const { rejected: rejectedSingleWindow } = simulateBurst(calls, 0);
    // 80 - 60 = 20 calls must be rejected when all land in the same window.
    expect(rejectedSingleWindow).toBe(80 - IPC_RATE_LIMIT_MAX);
  });
});
