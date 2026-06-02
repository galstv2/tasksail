import { spawn, type ChildProcess } from 'node:child_process';

export interface TerminateProcessTreeOptions {
  /** Platform override for tests; defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** POSIX grace period before escalating SIGTERM to SIGKILL (default 5000ms). */
  graceMs?: number;
  /** spawn override for tests. */
  spawn?: typeof spawn;
}

/**
 * Force-kill an entire process tree on Windows with `taskkill /PID <pid> /T /F`.
 * On Windows, killing only a `cmd.exe` shell wrapper orphans its npx/tsx/node
 * descendants, which keep holding ports, files, and locks; /T kills the tree and
 * /F forces it. No-op when the pid is unknown.
 */
export function killWindowsProcessTree(
  pid: number | undefined,
  spawnFn: typeof spawn = spawn,
): void {
  if (pid === undefined) {
    return;
  }
  const killer = spawnFn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  // Swallow ENOENT when taskkill is unavailable (e.g. a non-Windows host); an
  // unhandled spawn 'error' event would otherwise crash the process.
  killer?.on?.('error', () => {
    /* taskkill unavailable; caller's own child termination is the fallback */
  });
}

/**
 * Terminate a child process and its descendants cross-platform.
 *
 * - Windows: taskkill /T /F on the whole tree.
 * - POSIX: SIGTERM, then SIGKILL after `graceMs` if the child is still running.
 *
 * Fire-and-forget; the optional SIGKILL timer is unref'd so it never keeps the
 * event loop alive.
 */
export function terminateProcessTree(
  child: ChildProcess,
  options: TerminateProcessTreeOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    killWindowsProcessTree(child.pid, options.spawn ?? spawn);
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    /* already exited */
  }
  const graceMs = options.graceMs ?? 5000;
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already exited */
      }
    }
  }, graceMs);
  timer.unref?.();
}
