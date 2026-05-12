import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const spawnMock = vi.hoisted(() => vi.fn());
const checkServiceHealthMock = vi.hoisted(() => vi.fn());
const createServerMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../healthcheck.js', () => ({
  checkServiceHealth: checkServiceHealthMock,
}));

vi.mock('node:net', () => ({
  default: { createServer: createServerMock },
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
    checkServiceHealthMock.mockReset();
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

    expect(fs.readFileSync(path.join(tmpDir, '.platform-state/runtime/repo-context-mcp.pid'), 'utf-8')).toBe('4242\n');
    expect(spawnMock).toHaveBeenCalledWith(
      'python3',
      ['-m', 'src.backend.mcp.repo_context_mcp'],
      expect.objectContaining({
        cwd: tmpDir,
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

    expect(fs.readFileSync(path.join(runtimeDir, 'repo-context-mcp.pid'), 'utf-8')).toBe('4242\n');
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
});
