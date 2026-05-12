import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { loadEnv } from '../core/index.js';
import { ensureDir, writeTextFileAtomic } from '../core/io.js';
import { checkServiceHealth } from './healthcheck.js';
import { createSharedMcpBootstrapEnv } from './sharedMcp.js';

const PID_REL_PATH = '.platform-state/runtime/repo-context-mcp.pid';
const LOG_REL_PATH = '.platform-state/runtime/repo-context-mcp.log';
const SHUTDOWN_GRACE_MS = 15_000;
export const DIRECT_RUNTIME_READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_INTERVAL_MS = 250;
const PORT_PROBE_TIMEOUT_MS = 1_000;
const spawnInFlight = new Map<string, Promise<void>>();

export interface DirectProcessSpawnOptions {
  repoRoot: string;
  port: number;
  env: NodeJS.ProcessEnv;
  pythonBinary?: string;
}

export async function isDirectMcpHealthy(repoRoot: string, port: number): Promise<boolean> {
  const pidPath = path.join(repoRoot, PID_REL_PATH);
  return isExistingProcessHealthy(pidPath, port);
}

export async function spawnDirectMcp(opts: DirectProcessSpawnOptions): Promise<void> {
  const spawnKey = path.resolve(opts.repoRoot);
  const existingSpawn = spawnInFlight.get(spawnKey);
  if (existingSpawn) {
    await existingSpawn;
    return;
  }
  const spawnPromise = spawnDirectMcpUncoalesced(opts);
  spawnInFlight.set(spawnKey, spawnPromise);
  try {
    await spawnPromise;
  } finally {
    spawnInFlight.delete(spawnKey);
  }
}

async function spawnDirectMcpUncoalesced(opts: DirectProcessSpawnOptions): Promise<void> {
  const pidPath = path.join(opts.repoRoot, PID_REL_PATH);
  const logPath = path.join(opts.repoRoot, LOG_REL_PATH);
  await ensureDir(path.dirname(pidPath));

  if (await isExistingProcessHealthy(pidPath, opts.port)) {
    return;
  }
  await killStaleProcessIfPresent(pidPath);
  await assertPortAvailable(opts.port);

  warnIfContainerOnlyContextPath(opts.env);
  const env = await buildDirectRuntimeEnv(opts);
  const logFd = openSync(logPath, 'a');
  const child = spawn(
    opts.pythonBinary ?? 'python3',
    ['-m', 'src.backend.mcp.repo_context_mcp'],
    {
      cwd: opts.repoRoot,
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  );
  // Release the parent's copy of the inherited log fd; the child holds its own.
  closeSync(logFd);

  if (child.pid === undefined) {
    throw new Error('Failed to spawn repo-context-mcp: no PID returned by spawn().');
  }

  await writeTextFileAtomic(pidPath, `${child.pid}\n`);

  let exitedEarly = false;
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    exitedEarly = true;
    process.stderr.write(
      `[directRuntimeProcess] repo-context-mcp exited prematurely (code=${code} signal=${signal}); see ${logPath}\n`,
    );
  };
  child.once('exit', onExit);

  try {
    await waitForHealthy(opts.port, () => exitedEarly, logPath);
  } finally {
    // Detach the child so the bootstrap CLI can exit while the daemon keeps running.
    child.removeListener('exit', onExit);
    child.unref();
  }
}

export async function stopDirectMcp(repoRoot: string): Promise<void> {
  const pidPath = path.join(repoRoot, PID_REL_PATH);
  if (!existsSync(pidPath)) return;
  const pid = readPid(pidPath);
  if (pid === undefined) {
    unlinkMissingOk(pidPath);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      unlinkMissingOk(pidPath);
      return;
    }
    throw err;
  }
  await waitForExit(pid, SHUTDOWN_GRACE_MS);
  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process may have exited between the liveness check and kill.
    }
  }
  unlinkMissingOk(pidPath);
}

async function buildDirectRuntimeEnv(opts: DirectProcessSpawnOptions): Promise<NodeJS.ProcessEnv> {
  const fileEnv = await loadEnv(path.join(opts.repoRoot, '.env'));
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...Object.fromEntries(fileEnv) };
  for (const [key, value] of Object.entries(opts.env)) {
    if (value !== undefined) {
      baseEnv[key] = value;
    }
  }
  return {
    ...createSharedMcpBootstrapEnv(opts.port, baseEnv),
    REPO_CONTEXT_MCP_HOST: '127.0.0.1',
    REPO_CONTEXT_MCP_PORT: String(opts.port),
    REPO_CONTEXT_MCP_CONTAINER_PORT: '8811',
  };
}

async function isExistingProcessHealthy(pidPath: string, port: number): Promise<boolean> {
  const pid = readPid(pidPath);
  if (pid === undefined || !isAlive(pid)) return false;
  const result = await checkServiceHealth({
    name: 'repo-context-mcp',
    url: `http://127.0.0.1:${port}/health`,
    maxRetries: 1,
    retryIntervalMs: 0,
  });
  return result.healthy;
}

async function killStaleProcessIfPresent(pidPath: string): Promise<void> {
  const pid = readPid(pidPath);
  if (pid === undefined) {
    if (existsSync(pidPath)) unlinkMissingOk(pidPath);
    return;
  }
  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Continue to PID cleanup; the process may have exited.
    }
    await waitForExit(pid, SHUTDOWN_GRACE_MS);
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Continue to PID cleanup; the process may have exited.
      }
    }
  }
  unlinkMissingOk(pidPath);
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    const timer = setTimeout(() => {
      probe.close();
      reject(new Error(`Port-probe timed out for ${port} after ${PORT_PROBE_TIMEOUT_MS}ms`));
    }, PORT_PROBE_TIMEOUT_MS);
    probe.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      probe.close();
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${port} is already in use. Free it (lsof -i :${port}) or change mcp_port in config/platform.default.json.`,
        ));
        return;
      }
      reject(err);
    });
    probe.listen(port, '127.0.0.1', () => {
      clearTimeout(timer);
      probe.close(() => resolve());
    });
  });
}

async function waitForHealthy(port: number, exitedEarly: () => boolean, logPath: string): Promise<void> {
  const deadline = Date.now() + DIRECT_RUNTIME_READINESS_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}/health`;
  while (Date.now() < deadline) {
    if (exitedEarly()) {
      throw new Error(`repo-context-mcp exited before health check passed; see ${logPath} for details.`);
    }
    const ok = await checkServiceHealth({
      name: 'repo-context-mcp',
      url,
      maxRetries: 1,
      retryIntervalMs: 0,
    });
    if (ok.healthy) return;
    if (exitedEarly()) {
      throw new Error(`repo-context-mcp exited before health check passed; see ${logPath} for details.`);
    }
    await delay(READINESS_POLL_INTERVAL_MS);
  }
  throw new Error(
    `repo-context-mcp did not become healthy at ${url} within ${DIRECT_RUNTIME_READINESS_TIMEOUT_MS}ms; see ${logPath} for details.`,
  );
}

async function waitForExit(pid: number, graceMs: number): Promise<void> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await delay(100);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function readPid(pidPath: string): number | undefined {
  if (!existsSync(pidPath)) return undefined;
  const pid = Number.parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function unlinkMissingOk(pidPath: string): void {
  try {
    unlinkSync(pidPath);
  } catch {
    // PID cleanup is best-effort when another process already removed it.
  }
}

function warnIfContainerOnlyContextPath(env: NodeJS.ProcessEnv): void {
  const activeContextPackDir = env['ACTIVE_CONTEXT_PACK_DIR'];
  if (
    activeContextPackDir !== undefined
    && (activeContextPackDir.startsWith('/workspace') || activeContextPackDir.startsWith('/context-pack-roots/'))
  ) {
    process.stderr.write(
      `[directRuntimeProcess] WARNING: ACTIVE_CONTEXT_PACK_DIR is set to a container-only path (${activeContextPackDir}); in DirectRuntime mode it must be a host path. Requests using this value will fail until it is updated.\n`,
    );
  }
}
