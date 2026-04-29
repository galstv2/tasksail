import { EventEmitter } from 'node:events';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  cleanupProcesses,
  gracefulKill,
  waitForAgent,
  waitForAgentDetailed,
} from '../processLifecycle.js';

const spawnedChildren = new Set<ChildProcess>();

function spawnTestChild(script: string): ChildProcess {
  const child = spawn('node', ['-e', script], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  spawnedChildren.add(child);
  child.once('exit', () => {
    spawnedChildren.delete(child);
  });
  return child;
}

async function cleanupSpawnedChildren(): Promise<void> {
  const children = [...spawnedChildren];
  spawnedChildren.clear();

  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    child.kill('SIGKILL');
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }));
}

function setPlatform(platform: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });

  return () => {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await cleanupSpawnedChildren();
});

describe('gracefulKill', () => {
  it('handles an already-exited PID without throwing', async () => {
    // PID 99999999 almost certainly does not exist.
    // gracefulKill should return cleanly when SIGTERM fails because
    // the process does not exist.
    await expect(gracefulKill(99999999, 500)).resolves.toBeUndefined();
  });

  it('accepts a custom timeout parameter', async () => {
    // Verify the function signature accepts timeout without error.
    await expect(gracefulKill(99999999, 100)).resolves.toBeUndefined();
  });
});

describe('waitForAgent', () => {
  it('drains child stdout/stderr to prevent pipe buffer pmckpressure', async () => {
    const child = spawnTestChild('setTimeout(() => {}, 100)');
    // Simulate what launchAgent does post-spawn.
    child.stdout?.resume();
    child.stderr?.resume();
    expect(child.stdout?.readableFlowing).toBe(true);
    expect(child.stderr?.readableFlowing).toBe(true);
    child.kill();
  });

  it('kills the child process when wall-clock timeout expires', async () => {
    const child = spawnTestChild('setTimeout(() => {}, 60000)');
    child.stdout?.resume();
    child.stderr?.resume();

    const exitCode = await waitForAgent(child, { wallClockTimeoutMs: 200 });
    expect(exitCode).not.toBe(0);
  }, 10_000);

  it('clears the timeout timer when child exits normally', async () => {
    const child = spawnTestChild('process.exit(0)');
    child.stdout?.resume();
    child.stderr?.resume();

    const exitCode = await waitForAgent(child, { wallClockTimeoutMs: 30_000 });
    expect(exitCode).toBe(0);
    // If timer leaked, vitest would flag the open handle.
  });

  it('kills the child process when idle timeout expires with no output', async () => {
    // Child sleeps silently — produces no stdout/stderr output.
    const child = spawnTestChild('setTimeout(() => {}, 60000)');

    const exitCode = await waitForAgent(child, { idleTimeoutMs: 200 });
    expect(exitCode).not.toBe(0);
  }, 10_000);

  it('resets idle timeout when child produces output', async () => {
    // Child writes to stdout every 100ms for 500ms, then exits.
    // Idle timeout of 300ms should not fire because output keeps resetting it.
    const script = `
      let count = 0;
      const iv = setInterval(() => {
        process.stdout.write('ping\\n');
        if (++count >= 5) { clearInterval(iv); process.exit(0); }
      }, 100);
    `;
    const child = spawnTestChild(script);

    const exitCode = await waitForAgent(child, { idleTimeoutMs: 300 });
    expect(exitCode).toBe(0);
  }, 10_000);

  it('captures stderr tail and timeout reason', async () => {
    const child = spawnTestChild("process.stderr.write('artifact incomplete\\n'); setTimeout(() => {}, 60000)");

    const summary = await waitForAgentDetailed(child, { idleTimeoutMs: 200 });
    expect(summary.exitCode).not.toBe(0);
    expect(summary.terminationReason).toBe('idle-timeout');
    expect(summary.stderrTail).toContain('artifact incomplete');
  }, 10_000);

  it('kills the child process when an abort signal fires', async () => {
    const controller = new AbortController();
    const child = spawnTestChild('setTimeout(() => {}, 60000)');

    setTimeout(() => controller.abort(), 100);

    const exitCode = await waitForAgent(child, { abortSignal: controller.signal });
    expect(exitCode).toBe(130);
  }, 10_000);

  it('escalates to SIGKILL if the child ignores SIGTERM', async () => {
    vi.useFakeTimers();

    class FakeChild extends EventEmitter {
      exitCode: number | null = null;
      signalCode: NodeJS.Signals | null = null;
      killed = false;
      kill(signal?: NodeJS.Signals): boolean {
        if (signal === 'SIGTERM') {
          this.killed = true;
          return true;
        }
        if (signal === 'SIGKILL') {
          this.signalCode = 'SIGKILL';
          this.emit('close', null);
          return true;
        }
        return true;
      }
    }

    const child = new FakeChild() as unknown as ChildProcess;
    const wait = waitForAgent(child, { wallClockTimeoutMs: 100 });

    await vi.advanceTimersByTimeAsync(5100);

    await expect(wait).resolves.toBe(1);
    expect((child as unknown as FakeChild).signalCode).toBe('SIGKILL');
  });

  it('uses a single terminate call on Windows timeouts', async () => {
    const restorePlatform = setPlatform('win32');
    vi.useFakeTimers();

    class FakeChild extends EventEmitter {
      exitCode: number | null = null;
      signalCode: NodeJS.Signals | null = null;
      killed = false;
      kill = vi.fn((_signal?: NodeJS.Signals) => {
        this.killed = true;
        this.emit('close', 1);
        return true;
      });
    }

    try {
      const child = new FakeChild() as unknown as ChildProcess;
      const wait = waitForAgent(child, { wallClockTimeoutMs: 100 });

      await vi.advanceTimersByTimeAsync(5_100);

      await expect(wait).resolves.toBe(1);
      expect((child as unknown as FakeChild).kill).toHaveBeenCalledTimes(1);
      expect((child as unknown as FakeChild).kill).toHaveBeenCalledWith(undefined);
    } finally {
      restorePlatform();
    }
  });
});

describe('cleanupProcesses', () => {
  it('handles empty PID list', async () => {
    await expect(cleanupProcesses([])).resolves.toBeUndefined();
  });

  it('handles list of non-existent PIDs', async () => {
    await expect(cleanupProcesses([99999998, 99999999], 500)).resolves.toBeUndefined();
  });
});
