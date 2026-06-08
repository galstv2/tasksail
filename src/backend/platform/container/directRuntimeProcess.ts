import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createLogger, killWindowsProcessTree, loadEnv } from '../core/index.js';
import { classifyPythonVersion, formatPythonVersion, resolveInterpreter, resolveRuntimePython } from '../core/pythonResolver.js';
import { isWindowsPlatform } from '../core/platform.js';
import { ensureDir, writeTextFileAtomic } from '../core/io.js';
import { acquireDirLock } from '../queue/dirLock.js';
import { checkServiceHealth } from './healthcheck.js';
import { createSharedMcpBootstrapEnv } from './sharedMcp.js';

const log = createLogger('platform/container/directRuntimeProcess');

const PID_REL_PATH = '.platform-state/runtime/repo-context-mcp.pid';
const LOG_REL_PATH = '.platform-state/runtime/repo-context-mcp.log';
const SPAWN_LOCK_REL_PATH = '.platform-state/runtime/repo-context-mcp-spawn.lock';

interface PidRecord {
  pid: number;
  startedAt?: string;
  host?: string;
}

/** Parse the PID file. Supports both legacy bare-numeric and new JSON formats. */
function parsePidRecord(raw: string): PidRecord | undefined {
  const trimmed = raw.trim();
  // Try JSON first (new format: { pid, startedAt, host }).
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'pid' in parsed &&
        typeof (parsed as { pid: unknown }).pid === 'number'
      ) {
        const rec = parsed as { pid: number; startedAt?: unknown; host?: unknown };
        const pid = rec.pid;
        if (!Number.isInteger(pid) || pid <= 0) return undefined;
        return {
          pid,
          startedAt: typeof rec.startedAt === 'string' ? rec.startedAt : undefined,
          host: typeof rec.host === 'string' ? rec.host : undefined,
        };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  // Legacy: bare numeric PID.
  const pid = Number.parseInt(trimmed, 10);
  return Number.isInteger(pid) && pid > 0 ? { pid } : undefined;
}

function readPidRecord(pidPath: string): PidRecord | undefined {
  if (!existsSync(pidPath)) return undefined;
  return parsePidRecord(readFileSync(pidPath, 'utf-8'));
}

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
  const lockDir = path.join(opts.repoRoot, SPAWN_LOCK_REL_PATH);
  await ensureDir(path.dirname(pidPath));

  // Fast path: if healthy before acquiring the cross-process lock, skip everything.
  if (await isExistingProcessHealthy(pidPath, opts.port)) {
    return;
  }

  // Acquire cross-process filesystem lock to serialize spawners across processes.
  const release = await acquireDirLock(lockDir);
  if (release === null) {
    // Could not acquire within budget — fall back to unguarded behavior.
    log.warn('repo_context_mcp.spawn_lock_unavailable', {
      message: 'Could not acquire spawn lock; proceeding without cross-process serialization.',
      lockDir,
    });
    await spawnDirectMcpInner(pidPath, logPath, opts);
    return;
  }

  try {
    // Double-checked: re-check health after lock acquisition; a peer may have spawned while we waited.
    if (await isExistingProcessHealthy(pidPath, opts.port)) {
      return;
    }
    await spawnDirectMcpInner(pidPath, logPath, opts);
  } finally {
    await release();
  }
}

async function spawnDirectMcpInner(
  pidPath: string,
  logPath: string,
  opts: DirectProcessSpawnOptions,
): Promise<void> {
  await killStaleProcessIfPresent(pidPath);
  await assertPortAvailable(opts.port);

  warnIfContainerOnlyContextPath(opts.env);
  const env = await buildDirectRuntimeEnv(opts);
  const python = resolveDirectRuntimePython(opts);
  const logFd = openSync(logPath, 'a');
  const child = spawn(
    python.bin,
    [...python.baseArgs, '-m', 'src.backend.mcp.repo_context_mcp'],
    {
      cwd: opts.repoRoot,
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      // Keep the daemon off a visible console on Windows; harmless elsewhere.
      windowsHide: true,
    },
  );
  // Release the parent's copy of the inherited log fd; the child holds its own.
  closeSync(logFd);

  if (child.pid === undefined) {
    throw new Error('Failed to spawn repo-context-mcp: no PID returned by spawn().');
  }

  const pidRecord: PidRecord = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    host: os.hostname(),
  };
  await writeTextFileAtomic(pidPath, `${JSON.stringify(pidRecord)}\n`);

  let exitedEarly = false;
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    exitedEarly = true;
    log.warn('repo_context_mcp.exited_early', { code, signal, logPath });
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

function resolveDirectRuntimePython(opts: DirectProcessSpawnOptions): { bin: string; baseArgs: string[] } {
  const resolved = opts.pythonBinary
    ? resolveInterpreter([{ bin: opts.pythonBinary, baseArgs: [], source: 'pythonBinary option' }])
    : resolveRuntimePython({ repoRoot: opts.repoRoot });
  const classification = classifyPythonVersion(resolved.version);
  if (classification === 'reject') {
    throw new Error(
      `TaskSail requires Python 3.12+; resolved ${formatPythonVersion(resolved.version)} from ${resolved.candidate.source}. Set TASKSAIL_PYTHON_312_BIN to a Python 3.12+ interpreter.`,
    );
  }
  if (classification === 'compatible') {
    log.warn('repo_context_mcp.python.compatible_fallback', {
      message: `Using compatible fallback Python ${formatPythonVersion(resolved.version)} from ${resolved.candidate.source}; Python 3.12 is preferred.`,
    });
  }
  return {
    bin: resolved.candidate.bin,
    baseArgs: resolved.candidate.baseArgs,
  };
}

/**
 * Terminate the daemon on Windows. Windows has no POSIX signals, so a graceful
 * SIGTERM is meaningless; taskkill /PID <pid> /T /F kills the whole process tree
 * (any child processes the interpreter spawned) forcefully. Retried once if the
 * process is still alive after the grace period.
 */
async function killWindowsDaemonTree(pid: number): Promise<void> {
  killWindowsProcessTree(pid);
  await waitForExit(pid, SHUTDOWN_GRACE_MS);
  if (isAlive(pid)) {
    killWindowsProcessTree(pid);
  }
}

export async function stopDirectMcp(repoRoot: string): Promise<void> {
  const pidPath = path.join(repoRoot, PID_REL_PATH);
  if (!existsSync(pidPath)) return;
  const record = readPidRecord(pidPath);
  if (record === undefined) {
    unlinkMissingOk(pidPath);
    return;
  }
  // Do not kill a process whose recorded host differs from the current host.
  if (record.host !== undefined && record.host !== os.hostname()) {
    log.warn('repo_context_mcp.stop_skipped_foreign_host', {
      recordedHost: record.host,
      currentHost: os.hostname(),
    });
    return;
  }
  const { pid } = record;
  if (isWindowsPlatform()) {
    if (isAlive(pid)) {
      await killWindowsDaemonTree(pid);
    }
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
    // Default-on GET-auth in direct mode, mirroring the compose environment.
    // (Direct mode never reads the compose files.) Operator-overridable via
    // REPO_CONTEXT_MCP_REQUIRE_GET_AUTH in .env / shell.
    REPO_CONTEXT_MCP_REQUIRE_GET_AUTH: baseEnv.REPO_CONTEXT_MCP_REQUIRE_GET_AUTH ?? '1',
    REPO_CONTEXT_MCP_HOST: '127.0.0.1',
    REPO_CONTEXT_MCP_PORT: String(opts.port),
    REPO_CONTEXT_MCP_CONTAINER_PORT: '8811',
  };
}

async function isExistingProcessHealthy(pidPath: string, port: number): Promise<boolean> {
  const record = readPidRecord(pidPath);
  if (record === undefined || !isAlive(record.pid)) return false;
  const result = await checkServiceHealth({
    name: 'repo-context-mcp',
    url: `http://127.0.0.1:${port}/health`,
    maxRetries: 1,
    retryIntervalMs: 0,
  });
  return result.healthy;
}

async function killStaleProcessIfPresent(pidPath: string): Promise<void> {
  const record = readPidRecord(pidPath);
  if (record === undefined) {
    if (existsSync(pidPath)) unlinkMissingOk(pidPath);
    return;
  }
  // Do not kill a process whose recorded host differs from the current host.
  if (record.host !== undefined && record.host !== os.hostname()) {
    log.warn('repo_context_mcp.stale_kill_skipped_foreign_host', {
      recordedHost: record.host,
      currentHost: os.hostname(),
    });
    return;
  }
  const { pid } = record;
  if (isAlive(pid)) {
    if (isWindowsPlatform()) {
      await killWindowsDaemonTree(pid);
    } else {
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
    log.warn('active_context_pack_dir.container_only', { activeContextPackDir });
  }
}
