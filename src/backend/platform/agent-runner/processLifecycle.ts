import { spawn, type ChildProcess } from 'node:child_process';

/** Options for launching a copilot agent process. */
export interface LaunchOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Idle timeout in seconds. Used for monitoring. */
  idleTimeoutS?: number;
  /** Wall clock timeout in seconds. */
  wallClockTimeoutS?: number;
}

/**
 * Launch a copilot CLI process with the given arguments.
 * Sets up SIGTERM/SIGINT signal forwarding so the child process
 * is cleaned up when the parent is terminated.
 */
export function launchCopilot(
  args: string[],
  options: LaunchOptions = {},
): ChildProcess {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...options.env,
  };

  const child = spawn('copilot', args, {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Forward termination signals to the child process.
  const onSigterm = (): void => {
    if (child.pid && !child.killed) child.kill('SIGTERM');
  };
  const onSigint = (): void => {
    if (child.pid && !child.killed) child.kill('SIGINT');
  };

  process.on('SIGTERM', onSigterm);
  process.on('SIGINT', onSigint);

  // Remove listeners when the child exits to prevent leaks.
  child.on('close', () => {
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
  });

  // Drain stdout/stderr to prevent pipe buffer pmckpressure deadlocks.
  // The copilot agent output is not captured by the platform layer.
  child.stdout?.resume();
  child.stderr?.resume();

  return child;
}

/** Options for awaiting a copilot child process. */
export interface WaitOptions {
  /** Hard wall-clock deadline in milliseconds. */
  wallClockTimeoutMs?: number;
  /** Idle timeout in milliseconds — resets on every stdout/stderr chunk. */
  idleTimeoutMs?: number;
  /** Optional external cancellation signal. */
  abortSignal?: AbortSignal;
}

export type CopilotTerminationReason =
  | 'exited'
  | 'wall-clock-timeout'
  | 'idle-timeout'
  | 'aborted'
  | 'spawn-error';

export interface CopilotRunSummary {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  terminationReason: CopilotTerminationReason;
  signalCode: NodeJS.Signals | null;
}

const MAX_OUTPUT_TAIL_CHARS = 4000;

function appendTail(existing: string, chunk: Buffer | string): string {
  const next = existing + chunk.toString();
  if (next.length <= MAX_OUTPUT_TAIL_CHARS) {
    return next;
  }
  return next.slice(-MAX_OUTPUT_TAIL_CHARS);
}

/**
 * Wait for a copilot child process to exit.
 * Returns the exit code (0 on success, non-zero on failure).
 */
export function waitForCopilotDetailed(
  child: ChildProcess,
  options: WaitOptions = {},
): Promise<CopilotRunSummary> {
  return new Promise((resolve) => {
    let settled = false;
    let stdoutTail = '';
    let stderrTail = '';
    let terminationReason: CopilotTerminationReason = 'exited';

    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode: code,
        stdoutTail: stdoutTail.trim(),
        stderrTail: stderrTail.trim(),
        terminationReason,
        signalCode: child.signalCode,
      });
    };

    // Tracked timers: wall-clock and SIGKILL grace only.
    let wallTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    // Idle timer tracked separately — resets on every data chunk.
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let resetIdle: (() => void) | undefined;
    let aborted = false;

    let termSent = false;
    const killChild = (): void => {
      if (termSent) return;
      termSent = true;
      child.kill('SIGTERM');
      graceTimer = setTimeout(() => {
        // child.killed only reflects that .kill() was called. A process is
        // still running only while both exitCode and signalCode are null.
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000);
    };

    let cleanup = (): void => {
      if (wallTimer) clearTimeout(wallTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (idleTimer) clearTimeout(idleTimer);
      options.abortSignal?.removeEventListener('abort', onAbort);
    };

    const onAbort = (): void => {
      aborted = true;
      terminationReason = 'aborted';
      killChild();
    };

    // Wall-clock timeout — absolute deadline.
    if (options.wallClockTimeoutMs !== undefined && options.wallClockTimeoutMs > 0) {
      wallTimer = setTimeout(() => {
        terminationReason = 'wall-clock-timeout';
        killChild();
      }, options.wallClockTimeoutMs);
    }

    // Idle timeout — resets on every stdout/stderr data event.
    if (options.idleTimeoutMs !== undefined && options.idleTimeoutMs > 0) {
      idleTimer = setTimeout(() => {
        terminationReason = 'idle-timeout';
        killChild();
      }, options.idleTimeoutMs);

      resetIdle = (): void => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          terminationReason = 'idle-timeout';
          killChild();
        }, options.idleTimeoutMs!);
      };
    }

    const onStdoutData = (chunk: Buffer | string): void => {
      stdoutTail = appendTail(stdoutTail, chunk);
      resetIdle?.();
    };
    const onStderrData = (chunk: Buffer | string): void => {
      stderrTail = appendTail(stderrTail, chunk);
      resetIdle?.();
    };
    child.stdout?.on('data', onStdoutData);
    child.stderr?.on('data', onStderrData);

    // Register listeners before checking exitCode to avoid a TOCTOU race
    // where the child exits between the check and listener registration.
    child.on('close', (code: number | null) => {
      settle(aborted ? 130 : (code ?? 1));
    });

    child.on('error', () => {
      terminationReason = 'spawn-error';
      settle(aborted ? 130 : 1);
    });

    if (options.abortSignal?.aborted) {
      onAbort();
    } else {
      options.abortSignal?.addEventListener('abort', onAbort, { once: true });
    }

    if (child.exitCode !== null) {
      settle(child.exitCode);
    }

    const originalCleanup = cleanup;
    cleanup = (): void => {
      originalCleanup();
      child.stdout?.removeListener('data', onStdoutData);
      child.stderr?.removeListener('data', onStderrData);
    };
  });
}

export async function waitForCopilot(
  child: ChildProcess,
  options: WaitOptions = {},
): Promise<number> {
  const summary = await waitForCopilotDetailed(child, options);
  return summary.exitCode;
}

/**
 * Send SIGTERM to a process, wait for it to exit within the grace period,
 * then SIGKILL if it has not exited.
 *
 * On Windows, SIGTERM is not supported so we use child.kill() directly.
 */
export async function gracefulKill(
  pid: number,
  timeoutMs = 3000,
): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process already exited or PID invalid — nothing to do.
    return;
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      // Signal 0 tests whether the process exists without sending a signal.
      process.kill(pid, 0);
    } catch {
      // Process has exited.
      return;
    }
    await sleep(100);
  }

  // Process still alive — force kill.
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already exited between the check and the kill.
  }
}

/**
 * Gracefully terminate a list of PIDs.
 * Sends SIGTERM to all, waits, then SIGKILL any survivors.
 */
export async function cleanupProcesses(
  pids: number[],
  timeoutMs = 3000,
): Promise<void> {
  // Send SIGTERM to all.
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore — process may have already exited.
    }
  }

  const deadline = Date.now() + timeoutMs;

  // Poll until all are gone or timeout.
  while (Date.now() < deadline) {
    const alive = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

    if (alive.length === 0) {
      return;
    }

    await sleep(100);
  }

  // SIGKILL any survivors.
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
