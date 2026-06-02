import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { killWindowsProcessTree, terminateProcessTree } from '../processTree.js';

function fakeChild(pid: number | undefined, overrides: { exitCode?: number | null; signalCode?: NodeJS.Signals | null } = {}): ChildProcess & { kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
  (child as { pid?: number }).pid = pid;
  (child as { exitCode: number | null }).exitCode = overrides.exitCode ?? null;
  (child as { signalCode: NodeJS.Signals | null }).signalCode = overrides.signalCode ?? null;
  child.kill = vi.fn();
  return child;
}

describe('killWindowsProcessTree', () => {
  it('invokes taskkill /PID <pid> /T /F with the tree force flags', () => {
    const spawnFn = vi.fn();
    killWindowsProcessTree(4242, spawnFn as never);
    expect(spawnFn).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '4242', '/T', '/F'],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('no-ops when the pid is unknown', () => {
    const spawnFn = vi.fn();
    killWindowsProcessTree(undefined, spawnFn as never);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe('terminateProcessTree', () => {
  it('kills the whole tree via taskkill on Windows, never just child.kill', () => {
    const spawnFn = vi.fn();
    const child = fakeChild(4242);
    terminateProcessTree(child, { platform: 'win32', spawn: spawnFn as never });
    expect(spawnFn).toHaveBeenCalledWith('taskkill.exe', ['/PID', '4242', '/T', '/F'], expect.anything());
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('escalates SIGTERM then SIGKILL on POSIX when the child is still running', () => {
    vi.useFakeTimers();
    const child = fakeChild(4242);
    terminateProcessTree(child, { platform: 'linux', graceMs: 1000 });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    vi.advanceTimersByTime(1000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    vi.useRealTimers();
  });

  it('does not SIGKILL on POSIX once the child has already exited', () => {
    vi.useFakeTimers();
    const child = fakeChild(4242, { exitCode: 0 });
    terminateProcessTree(child, { platform: 'linux', graceMs: 1000 });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    vi.advanceTimersByTime(1000);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    vi.useRealTimers();
  });
});
