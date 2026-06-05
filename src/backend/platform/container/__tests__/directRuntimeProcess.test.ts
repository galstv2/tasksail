import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());
const checkServiceHealthMock = vi.hoisted(() => vi.fn());
const createServerMock = vi.hoisted(() => vi.fn());
const acquireDirLockMock = vi.hoisted(() => vi.fn<Parameters<typeof import('../../queue/dirLock.js').acquireDirLock>, ReturnType<typeof import('../../queue/dirLock.js').acquireDirLock>>());

// Pass through the real module and override only spawn. A bare { spawn } mock
// omits execFile, which a transitively-loaded module (agent-extensions) calls
// via promisify() at load time — that crashes module collection before any
// test runs.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock('../healthcheck.js', () => ({
  checkServiceHealth: checkServiceHealthMock,
}));

vi.mock('node:net', () => ({
  default: { createServer: createServerMock },
}));

vi.mock('../../queue/dirLock.js', () => ({
  acquireDirLock: acquireDirLockMock,
}));

const { isDirectMcpHealthy, spawnDirectMcp, stopDirectMcp } = await import('../directRuntimeProcess.js');

class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly unref = vi.fn();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

describe('direct runtime process supervisor', () => {
  let tmpDir: string;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-runtime-process-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'FROM_DOTENV=yes\nREPO_CONTEXT_MCP_PORT=9999\n', 'utf-8');
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation((bin: string) => ({
      status: 0,
      stdout: bin === 'python3.12' ? '3.12' : '3.13',
      stderr: '',
    }));
    checkServiceHealthMock.mockReset();
    acquireDirLockMock.mockReset();
    // Default: immediately acquire (no-op release).
    acquireDirLockMock.mockResolvedValue(async () => { /* no-op */ });
    createServerMock.mockImplementation(() => {
      const server = new EventEmitter() as EventEmitter & {
        listen: (port: number, host: string, cb: () => void) => void;
        close: (cb?: () => void) => void;
      };
      server.listen = (_port, _host, cb) => cb();
      server.close = (cb) => { cb?.(); };
      return server;
    });
    killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0 && pid === 4242) return true;
      const err = Object.assign(new Error('missing'), { code: 'ESRCH' });
      throw err;
    }) as typeof process.kill);
  });

  afterEach(() => {
    killSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('spawns Python, writes a PID file, merges env, and waits for health', async () => {
    spawnMock.mockReturnValue(new FakeChild(4242));
    checkServiceHealthMock.mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    await spawnDirectMcp({
      repoRoot: tmpDir,
      port: 8819,
      env: {
        TASKSAIL_REPO_ROOT: tmpDir,
        ACTIVE_CONTEXT_PACK_DIR: '/workspace/bad',
      },
    });

    const pidRaw = fs.readFileSync(path.join(tmpDir, '.platform-state/runtime/repo-context-mcp.pid'), 'utf-8');
    const pidRecord = JSON.parse(pidRaw.trim());
    expect(pidRecord.pid).toBe(4242);
    expect(typeof pidRecord.startedAt).toBe('string');
    expect(typeof pidRecord.host).toBe('string');
    expect(spawnMock).toHaveBeenCalledWith(
      'python3.12',
      ['-m', 'src.backend.mcp.repo_context_mcp'],
      expect.objectContaining({
        cwd: tmpDir,
        windowsHide: true,
        env: expect.objectContaining({
          FROM_DOTENV: 'yes',
          REPO_CONTEXT_MCP_HOST: '127.0.0.1',
          REPO_CONTEXT_MCP_PORT: '8819',
          REPO_CONTEXT_MCP_CONTAINER_PORT: '8811',
          TASKSAIL_REPO_ROOT: tmpDir,
        }),
      }),
    );
    expect(spawnMock.mock.calls[0][2].env).not.toHaveProperty('ACTIVE_CONTEXT_PACK_DIR');
  });

  it('uses a compatible fallback when Python 3.12 discovery is unavailable', async () => {
    spawnSyncMock.mockImplementation((bin: string) => ({
      status: bin === 'python3.12' ? 1 : 0,
      stdout: bin === 'python3.12' ? '' : '3.13',
      stderr: '',
    }));
    spawnMock.mockReturnValue(new FakeChild(4242));
    checkServiceHealthMock.mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    await spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } });

    expect(spawnMock).toHaveBeenCalledWith(
      'python3',
      ['-m', 'src.backend.mcp.repo_context_mcp'],
      expect.anything(),
    );
  });

  it('rejects below-floor Python before spawning the daemon', async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '3.11', stderr: '' });

    await expect(
      spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } }),
    ).rejects.toThrow('Python 3.12+');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('no-ops when the PID file process is alive and healthy', async () => {
    const runtimeDir = path.join(tmpDir, '.platform-state/runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), '4242\n');
    checkServiceHealthMock.mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    await spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } });

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reports direct MCP healthy only with an alive PID and passing health probe', async () => {
    const runtimeDir = path.join(tmpDir, '.platform-state/runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), '4242\n');
    checkServiceHealthMock.mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    await expect(isDirectMcpHealthy(tmpDir, 8819)).resolves.toBe(true);
    expect(checkServiceHealthMock).toHaveBeenCalledWith({
      name: 'repo-context-mcp',
      url: 'http://127.0.0.1:8819/health',
      maxRetries: 1,
      retryIntervalMs: 0,
    });
  });

  it('cleans stale PID files before spawning', async () => {
    const runtimeDir = path.join(tmpDir, '.platform-state/runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), '9999\n');
    spawnMock.mockReturnValue(new FakeChild(4242));
    checkServiceHealthMock.mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    await spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } });

    const newPidRaw = fs.readFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), 'utf-8');
    const newPidRecord = JSON.parse(newPidRaw.trim());
    expect(newPidRecord.pid).toBe(4242);
  });

  it('rejects when the port probe reports EADDRINUSE', async () => {
    createServerMock.mockImplementation(() => {
      const server = new EventEmitter() as EventEmitter & {
        listen: (port: number, host: string, cb: () => void) => void;
        close: (cb?: () => void) => void;
      };
      server.listen = () => {
        queueMicrotask(() => server.emit('error', Object.assign(new Error('busy'), { code: 'EADDRINUSE' })));
      };
      server.close = (cb) => { cb?.(); };
      return server;
    });

    await expect(
      spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } }),
    ).rejects.toThrow('already in use');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects when the child exits before health passes', async () => {
    const child = new FakeChild(4242);
    spawnMock.mockReturnValue(child);
    checkServiceHealthMock.mockImplementation(async () => {
      child.emit('exit', 1, null);
      return { service: 'repo-context-mcp', healthy: false, attempts: 1 };
    });

    await expect(
      spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } }),
    ).rejects.toThrow('exited before health check passed');
  });

  it('coalesces concurrent spawns in one process', async () => {
    spawnMock.mockReturnValue(new FakeChild(4242));
    checkServiceHealthMock.mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    await Promise.all([
      spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } }),
      spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } }),
    ]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('stopDirectMcp unlinks the PID file after process exit', async () => {
    const runtimeDir = path.join(tmpDir, '.platform-state/runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), '4242\n');
    let alive = true;
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (alive) return true;
        throw Object.assign(new Error('missing'), { code: 'ESRCH' });
      }
      alive = false;
      return true;
    }) as typeof process.kill);

    await stopDirectMcp(tmpDir);

    expect(fs.existsSync(path.join(runtimeDir, 'repo-context-mcp.pid'))).toBe(false);
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('reads a legacy bare-numeric PID file without error (backward compatibility)', async () => {
    const runtimeDir = path.join(tmpDir, '.platform-state/runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    // Legacy bare-numeric format.
    fs.writeFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), '4242\n');
    checkServiceHealthMock.mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    // isDirectMcpHealthy reads the file; pid 4242 is alive per killSpy; health passes.
    await expect(isDirectMcpHealthy(tmpDir, 8819)).resolves.toBe(true);
  });

  it('killStaleProcessIfPresent does NOT kill a process with a foreign-host record', async () => {
    const runtimeDir = path.join(tmpDir, '.platform-state/runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    // Plant a PID file with a foreign host.
    const foreignRecord = JSON.stringify({ pid: 4242, startedAt: new Date().toISOString(), host: 'other-machine' });
    fs.writeFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), `${foreignRecord}\n`);
    spawnMock.mockReturnValue(new FakeChild(9999));
    checkServiceHealthMock
      // isExistingProcessHealthy fast path: pid 4242 alive but health fails
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 })
      // post-lock health re-check: also fails (so spawn would proceed if not blocked)
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 })
      // waitForHealthy
      .mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    // killSpy: pid 4242 alive; but foreign-host check should prevent kill.
    let killCalled = false;
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0 && pid === 4242) return true;
      if (pid === 4242 && signal !== 0) {
        killCalled = true;
        return true;
      }
      const err = Object.assign(new Error('missing'), { code: 'ESRCH' });
      throw err;
    }) as typeof process.kill);

    // spawnDirectMcp will encounter a foreign-host record in killStaleProcessIfPresent;
    // it should skip killing and the PID file should remain (not cleaned).
    // We don't assert spawn outcome here — the focus is no kill of 4242.
    // Actually spawnDirectMcp will call killStaleProcessIfPresent before port-probe which
    // may fail. We mock port probe to pass.
    await spawnDirectMcp({
      repoRoot: tmpDir,
      port: 8819,
      env: { TASKSAIL_REPO_ROOT: tmpDir },
    });

    expect(killCalled).toBe(false);
  });

  it('killStaleProcessIfPresent cleans a current-host dead PID record', async () => {
    const runtimeDir = path.join(tmpDir, '.platform-state/runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    // Plant a PID file with the current host and a dead PID (9999 is dead per killSpy default).
    const currentRecord = JSON.stringify({ pid: 9999, startedAt: new Date().toISOString(), host: os.hostname() });
    fs.writeFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), `${currentRecord}\n`);
    spawnMock.mockReturnValue(new FakeChild(4242));
    checkServiceHealthMock.mockResolvedValue({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

    await spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } });

    // 9999 is dead (ESRCH per killSpy default); killStaleProcessIfPresent should have cleaned the old file
    // and spawn wrote a new JSON PID file with pid 4242.
    const newPidRaw = fs.readFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), 'utf-8');
    const newPidRecord = JSON.parse(newPidRaw.trim());
    expect(newPidRecord.pid).toBe(4242);
    expect(newPidRecord.host).toBe(os.hostname());
  });

  it('cross-process serialization: second spawner does not call spawn after post-lock health re-check succeeds', async () => {
    // Acid test: if acquireDirLock is removed from spawnDirectMcpUncoalesced
    // both callers proceed concurrently and spawnMock is called twice.  With the
    // lock in place only caller A spawns; caller B's post-lock re-check finds an
    // existing healthy process and returns early.
    //
    // Distinct repoRoots bypass the in-process spawnInFlight coalescing map so
    // both calls actually reach acquireDirLock.  The mock serializes them:
    //   A acquires → A spawns → A's release writes B's PID file + unblocks B
    //   B acquires → B post-lock re-check finds alive process → B skips spawn.
    const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-runtime-process-b-'));
    try {
      fs.writeFileSync(path.join(tmpDirB, '.env'), 'FROM_DOTENV=yes\nREPO_CONTEXT_MCP_PORT=9999\n', 'utf-8');

      // Deferred: B's acquireDirLock blocks until A's release fires.
      // We identify callers by lockDir (contains repoRoot) rather than arrival
      // order to avoid races when both calls reach the mock concurrently.
      let unblockB!: () => void;
      const bCanAcquire = new Promise<void>((r) => { unblockB = r; });
      const SPAWN_LOCK_REL = '.platform-state/runtime/repo-context-mcp-spawn.lock';
      const lockDirA = path.join(tmpDir, SPAWN_LOCK_REL);
      const lockDirB = path.join(tmpDirB, SPAWN_LOCK_REL);

      acquireDirLockMock.mockImplementation(async (calledLockDir: string) => {
        if (calledLockDir === lockDirA) {
          // Caller A: acquired immediately.  On release, write B's PID file and unblock B.
          return async () => {
            const bRuntimeDir = path.join(tmpDirB, '.platform-state/runtime');
            fs.mkdirSync(bRuntimeDir, { recursive: true });
            const bPidRecord = JSON.stringify({ pid: 4242, startedAt: new Date().toISOString(), host: os.hostname() });
            fs.writeFileSync(path.join(bRuntimeDir, 'repo-context-mcp.pid'), `${bPidRecord}\n`);
            unblockB();
          };
        }
        if (calledLockDir === lockDirB) {
          // Caller B: blocks until A's release fires.
          await bCanAcquire;
          return async () => { /* no-op */ };
        }
        return async () => { /* unexpected path */ };
      });

      spawnMock.mockReturnValue(new FakeChild(4242));
      checkServiceHealthMock
        // A: waitForHealthy after spawn
        .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: true, attempts: 1 })
        // B: post-lock isExistingProcessHealthy (pid 4242 alive) calls checkServiceHealth
        .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: true, attempts: 1 });

      // Launch both concurrently. Distinct repoRoots → both bypass spawnInFlight
      // and both reach acquireDirLock.
      const callA = spawnDirectMcp({ repoRoot: tmpDir, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDir } });
      const callB = spawnDirectMcp({ repoRoot: tmpDirB, port: 8819, env: { TASKSAIL_REPO_ROOT: tmpDirB } });

      await Promise.all([callA, callB]);

      // Both callers must have reached acquireDirLock (proves lock was exercised).
      expect(acquireDirLockMock).toHaveBeenCalledTimes(2);
      // Same lock-dir identity (H3): production locks on the repo-scoped path
      // <repoRoot>/.platform-state/runtime/repo-context-mcp-spawn.lock. A same-REPO
      // two-caller contention test is infeasible in one vitest process (the
      // in-process spawnInFlight map coalesces same-repo calls before they reach
      // the filesystem lock); the real acquireDirLock filesystem mutual exclusion
      // is covered by queue/__tests__/dirLock.test.ts.
      expect(acquireDirLockMock).toHaveBeenCalledWith(lockDirA);
      expect(acquireDirLockMock).toHaveBeenCalledWith(lockDirB);
      // Spawn happened exactly once: B's post-lock re-check found a healthy process.
      // Without the lock, both callers see unhealthy pre-lock and spawn → called twice.
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(tmpDirB, { recursive: true, force: true });
    }
  });

  it('stopDirectMcp kills the process tree via taskkill on Windows, not SIGTERM', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const runtimeDir = path.join(tmpDir, '.platform-state/runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), '4242\n');

    let alive = true;
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (alive) return true;
        throw Object.assign(new Error('missing'), { code: 'ESRCH' });
      }
      return true;
    }) as typeof process.kill);
    // taskkill (spawned) terminates the daemon; flip liveness when it runs.
    spawnMock.mockImplementation(((cmd: string) => {
      if (cmd === 'taskkill.exe') alive = false;
      return new FakeChild(0);
    }) as never);

    try {
      await stopDirectMcp(tmpDir);

      expect(spawnMock).toHaveBeenCalledWith(
        'taskkill.exe',
        ['/PID', '4242', '/T', '/F'],
        expect.anything(),
      );
      expect(killSpy).not.toHaveBeenCalledWith(4242, 'SIGTERM');
      expect(killSpy).not.toHaveBeenCalledWith(4242, 'SIGKILL');
      expect(fs.existsSync(path.join(runtimeDir, 'repo-context-mcp.pid'))).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
