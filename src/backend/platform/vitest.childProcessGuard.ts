import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach } from 'vitest';

export function parseProcChildPids(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

export function childPids(): string[] {
  if (process.platform === 'win32') return [];

  if (process.platform === 'linux') {
    try {
      return parseProcChildPids(
        readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8'),
      );
    } catch {
      // Fall back to pgrep below on non-standard Linux hosts without /proc.
    }
  }

  try {
    const raw = execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).trim();
    return raw ? raw.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

afterEach(async () => {
  let pids = childPids();
  if (pids.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    pids = childPids();
  }
  if (pids.length === 0) return;

  const details = pids.map((pid) => {
    try {
      return execFileSync('ps', ['-p', pid, '-o', 'pid=,command='], {
        encoding: 'utf8',
      }).trim();
    } catch {
      return pid;
    }
  });

  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {
      // The child may have exited between detection and cleanup.
    }
  }

  throw new Error(
    `Vitest child-process guard: ${pids.length} child process(es) survived a test:\n` +
      `${details.join('\n')}\n` +
      'Move child cleanup into afterEach/afterAll or a non-skippable finally block.',
  );
});
