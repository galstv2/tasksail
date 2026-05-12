import { spawn, type ChildProcess } from 'node:child_process';
import { isWindowsPlatform } from '../core/platform.js';
import { getActiveProvider } from '../cli-provider/index.js';
import type { RunSummary, TerminationReason } from '../cli-provider/types.js';
import { buildTaskLaunchBaseEnv } from './launchEnv.js';

/** Options for launching an agent CLI process. */
export interface LaunchOptions {
  repoRoot?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Idle timeout in seconds. Used for monitoring. */
  idleTimeoutS?: number;
  /** Wall clock timeout in seconds. */
  wallClockTimeoutS?: number;
}

function terminateChildProcess(
  child: ChildProcess,
  signal?: NodeJS.Signals,
): void {
  child.kill(isWindowsPlatform() ? undefined : signal);
}

function signalProcess(
  pid: number,
  signal: NodeJS.Signals | 0 = 'SIGTERM',
): boolean {
  try {
    if (signal === 0 || !isWindowsPlatform()) {
      process.kill(pid, signal);
    } else {
      process.kill(pid);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch an agent CLI process with the given arguments.
 * Sets up SIGTERM/SIGINT signal forwarding so the child process
 * is cleaned up when the parent is terminated.
 */
export function launchAgent(
  args: string[],
  options: LaunchOptions = {},
): ChildProcess {
  const repoRoot = options.repoRoot ?? options.cwd ?? process.cwd();
  const provider = getActiveProvider(repoRoot);
  const env: Record<string, string> = {
    ...buildTaskLaunchBaseEnv(process.env, provider.controlledEnvKeys()),
    ...options.env,
  };

  const child = spawn(provider.resolveCommand(), args, {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Forward termination signals to the child process.
  const onSigterm = (): void => {
    if (child.pid && !child.killed) terminateChildProcess(child, 'SIGTERM');
  };
  const onSigint = (): void => {
    if (child.pid && !child.killed) terminateChildProcess(child, 'SIGINT');
  };

  process.on('SIGTERM', onSigterm);
  process.on('SIGINT', onSigint);

  // Remove listeners when the child exits to prevent leaks.
  child.on('close', () => {
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
  });

  // Drain stdout/stderr to prevent pipe buffer backpressure deadlocks.
  // The agent CLI output is not captured by the platform layer.
  child.stdout?.resume();
  child.stderr?.resume();

  return child;
}

/** Options for awaiting an agent CLI child process. */
export interface WaitOptions {
  /** Hard wall-clock deadline in milliseconds. */
  wallClockTimeoutMs?: number;
  /** Idle timeout in milliseconds — resets on every stdout/stderr chunk. */
  idleTimeoutMs?: number;
  /** Optional external cancellation signal. */
  abortSignal?: AbortSignal;
}

export type { TerminationReason, RunSummary };

const MAX_OUTPUT_TAIL_CHARS = 4000;

function appendTail(existing: string, chunk: Buffer | string): string {
  const next = existing + chunk.toString();
  if (next.length <= MAX_OUTPUT_TAIL_CHARS) {
    return next;
  }
  return next.slice(-MAX_OUTPUT_TAIL_CHARS);
}

/**
  * Wait for an agent CLI child process to exit.
  * Returns the exit code (0 on success, non-zero on failure).
  */
export function waitForAgentDetailed(
  child: ChildProcess,
  options: WaitOptions = {},
): Promise<RunSummary> {
  return new Promise((resolve) => {
    let settled = false;
    let stdoutTail = '';
    let stderrTail = '';
    let terminationReason: TerminationReason = 'exited';

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
      terminateChildProcess(child, 'SIGTERM');
      if (isWindowsPlatform()) {
        return;
      }
      graceTimer = setTimeout(() => {
        // child.killed only reflects that .kill() was called. A process is
        // still running only while both exitCode and signalCode are null.
        if (child.exitCode === null && child.signalCode === null) {
          terminateChildProcess(child, 'SIGKILL');
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

export async function waitForAgent(
  child: ChildProcess,
  options: WaitOptions = {},
): Promise<number> {
  const summary = await waitForAgentDetailed(child, options);
  return summary.exitCode;
}

/**
 * Send SIGTERM to a process, wait for it to exit within the grace period,
 * then SIGKILL if it has not exited.
 *
 * On Windows, the first termination is already a hard kill, so the Unix-style
 * SIGTERM→SIGKILL escalation collapses to a single terminate call.
 */
export async function gracefulKill(
  pid: number,
  timeoutMs = 3000,
): Promise<void> {
  if (!signalProcess(pid, 'SIGTERM')) {
    // Process already exited or PID invalid — nothing to do.
    return;
  }

  if (isWindowsPlatform()) {
    return;
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!signalProcess(pid, 0)) {
      // Process has exited.
      return;
    }
    await sleep(100);
  }

  // Process still alive — force kill.
  signalProcess(pid, 'SIGKILL');
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
    signalProcess(pid, 'SIGTERM');
  }

  if (isWindowsPlatform()) {
    return;
  }

  const deadline = Date.now() + timeoutMs;

  // Poll until all are gone or timeout.
  while (Date.now() < deadline) {
    const alive = pids.filter((pid) => {
      return signalProcess(pid, 0);
    });

    if (alive.length === 0) {
      return;
    }

    await sleep(100);
  }

  // SIGKILL any survivors.
  for (const pid of pids) {
    signalProcess(pid, 'SIGKILL');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
