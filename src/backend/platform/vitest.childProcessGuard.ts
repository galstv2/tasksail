import { execSync } from 'node:child_process';
import { afterEach } from 'vitest';

function childPids(): string[] {
  if (process.platform === 'win32') return [];

  try {
    const raw = execSync(`pgrep -P ${process.pid}`, { encoding: 'utf8' }).trim();
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
      return execSync(`ps -p ${pid} -o pid=,command=`, {
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
