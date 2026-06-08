// @vitest-environment node

import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
const spawn = vi.fn();

vi.mock('../log/logger', () => ({
  createLogger: vi.fn(() => ({ warn })),
}));

vi.mock('node:child_process', () => ({
  spawn,
}));

// Minimal writable stand-in for the ChildProcess properties terminateProcessTree reads.
type ChildLike = {
  pid: number;
  exitCode: number | null;
  signalCode: string | null;
  kill: ReturnType<typeof vi.fn>;
};

function makeChild(pid: number): ChildLike {
  return { pid, exitCode: null, signalCode: null, kill: vi.fn() };
}

describe('main.services diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('CONTAINER_RUNTIME', 'docker');
  });

  it('logs unexpected auto-start failures before preserving unhealthy state', async () => {
    spawn.mockImplementation(() => {
      throw new Error('spawn unavailable');
    });

    const { autoStartBackendServices, readBackendServiceStatus } = await import('./services');

    await autoStartBackendServices('/tmp/repo');

    expect(warn).toHaveBeenCalledWith('services.auto-start.failed', {
      reason: 'spawn unavailable',
    });
    expect(readBackendServiceStatus()).toEqual(expect.objectContaining({
      status: 'unhealthy',
      error: 'Unexpected error during auto-start.',
    }));
  });
});

describe('spawnCli timeout cleanup — terminateProcessTree behaviour', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('on Windows, terminates via taskkill /PID /T /F (not a bare child.kill)', async () => {
    const { terminateProcessTree } = await import('../../../../backend/platform/core/processTree.js');
    const child = makeChild(5678);

    terminateProcessTree(child as unknown as ChildProcess, { platform: 'win32' });

    expect(spawn).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '5678', '/T', '/F'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true }),
    );
    // child.kill must NOT be called — only taskkill is used on Windows.
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('on POSIX, sends SIGTERM then SIGKILL after grace period', async () => {
    const { terminateProcessTree } = await import('../../../../backend/platform/core/processTree.js');
    const child = makeChild(9999);

    terminateProcessTree(child as unknown as ChildProcess, { platform: 'linux', graceMs: 5000 });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5001);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.kill).toHaveBeenCalledTimes(2);
  });

  it('on POSIX, skips SIGKILL if process already exited before grace period ends', async () => {
    const { terminateProcessTree } = await import('../../../../backend/platform/core/processTree.js');
    const child = makeChild(7777);

    terminateProcessTree(child as unknown as ChildProcess, { platform: 'linux', graceMs: 5000 });

    // Simulate process exited via exitCode becoming non-null before the timer fires.
    child.exitCode = 0;
    vi.advanceTimersByTime(5001);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('checkContainerRuntimeAvailable — three-way runtime branching', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it('docker: probes the docker binary and succeeds when exit code is 0', async () => {
    vi.stubEnv('CONTAINER_RUNTIME', 'docker');

    const mockChild = {
      on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
        if (event === 'close') cb(0);
      }),
      stdout: null,
      stderr: null,
    };
    spawn.mockReturnValue(mockChild);

    const { checkContainerRuntimeAvailable } = await import('./services');
    const result = await checkContainerRuntimeAvailable('/tmp/repo');

    expect(result).toEqual({ ok: true, runtimeBinary: 'docker' });
    expect(spawn).toHaveBeenCalledWith(
      'docker',
      ['version', '--format', 'json'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('podman: probes the podman binary and succeeds when exit code is 0', async () => {
    vi.stubEnv('CONTAINER_RUNTIME', 'podman');

    const mockChild = {
      on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
        if (event === 'close') cb(0);
      }),
      stdout: null,
      stderr: null,
    };
    spawn.mockReturnValue(mockChild);

    const { checkContainerRuntimeAvailable } = await import('./services');
    const result = await checkContainerRuntimeAvailable('/tmp/repo');

    expect(result).toEqual({ ok: true, runtimeBinary: 'podman' });
    expect(spawn).toHaveBeenCalledWith(
      'podman',
      ['version', '--format', 'json'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('direct on non-Windows: skips the binary probe and resolves ok', async () => {
    vi.stubEnv('CONTAINER_RUNTIME', 'direct');
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    try {
      const { checkContainerRuntimeAvailable } = await import('./services');
      const result = await checkContainerRuntimeAvailable('/tmp/repo');

      expect(result).toEqual({ ok: true, runtimeBinary: 'direct' });
      // No docker/podman binary probe — spawn must not have been called.
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('direct on native Windows: skips the binary probe and resolves ok (supported now)', async () => {
    vi.stubEnv('CONTAINER_RUNTIME', 'direct');
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      const { checkContainerRuntimeAvailable } = await import('./services');
      const result = await checkContainerRuntimeAvailable('/tmp/repo');

      expect(result).toEqual({ ok: true, runtimeBinary: 'direct' });
      // No docker/podman binary probe — spawn must not have been called.
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('docker: fails when binary exits non-zero', async () => {
    vi.stubEnv('CONTAINER_RUNTIME', 'docker');

    const mockChild = {
      on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
        if (event === 'close') cb(1);
      }),
      stdout: null,
      stderr: null,
    };
    spawn.mockReturnValue(mockChild);

    const { checkContainerRuntimeAvailable } = await import('./services');
    const result = await checkContainerRuntimeAvailable('/tmp/repo');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('docker');
    }
  });
});

describe('stopBackendServicesDetached', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('CONTAINER_RUNTIME', 'docker');
  });

  it('on Windows, spawns via cmd.exe resolver (not bare npx)', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const mockChild = { unref: vi.fn() };
    spawn.mockReturnValue(mockChild);

    try {
      const { stopBackendServicesDetached } = await import('./services');
      stopBackendServicesDetached('/repo');

      expect(spawn).toHaveBeenCalledTimes(1);
      const [command, args] = spawn.mock.calls[0] as [string, string[], unknown];

      // Must route through cmd.exe, not bare 'npx'.
      expect(command).not.toBe('npx');
      expect(command).toMatch(/cmd(\.exe)?$/i);
      expect(args).toContain('/c');
      expect(args).toContain('npx');
      expect(args).toContain('tsx');
      expect(args).toContain('down');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('on POSIX, spawns npx directly', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const mockChild = { unref: vi.fn() };
    spawn.mockReturnValue(mockChild);

    try {
      const { stopBackendServicesDetached } = await import('./services');
      stopBackendServicesDetached('/repo');

      expect(spawn).toHaveBeenCalledTimes(1);
      const [command, args] = spawn.mock.calls[0] as [string, string[], unknown];

      expect(command).toBe('npx');
      expect(args).toContain('tsx');
      expect(args).toContain('down');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('does not throw if spawn fails', async () => {
    spawn.mockImplementation(() => { throw new Error('spawn failed'); });

    const { stopBackendServicesDetached } = await import('./services');
    expect(() => stopBackendServicesDetached('/repo')).not.toThrow();
  });
});
