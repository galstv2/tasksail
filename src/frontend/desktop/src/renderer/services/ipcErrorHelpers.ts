/**
 * Shared IPC error-handling utilities used by renderer hooks that call the
 * main process.  Extracted from duplicated helpers in usePlannerFlow,
 * useFollowUpFlow, and useObservedState.
 */

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

/**
 * Format a structured IPC error result into a single display string.
 * Replaces the identical `formatPlannerFlowError` / `formatFollowUpFlowError`.
 */
export function formatIpcError(result: { error: string; details?: string[] }): string {
  return result.details && result.details.length > 0
    ? `${result.error} ${result.details.join(' ')}`
    : result.error;
}

/**
 * Normalize a caught value into a user-facing error string.
 * Replaces `normalizePlannerFlowThrownError`, `normalizeFollowUpFlowThrownError`,
 * and `normalizeObservedStateError`.
 */
export function normalizeIpcThrownError(
  error: unknown,
  fallbackMessage = 'IPC call failed unexpectedly.',
): string {
  return error instanceof Error ? error.message : fallbackMessage;
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

export class IpcTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`IPC call "${label}" timed out after ${timeoutMs}ms.`);
    this.name = 'IpcTimeoutError';
  }
}

export const DEFAULT_IPC_TIMEOUT_MS = 30_000;

/**
 * Race `promise` against a configurable timer.  The timer is cleaned up on
 * resolution so it never leaks.
 */
export function withIpcTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'unknown',
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      reject(new IpcTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  });
}
