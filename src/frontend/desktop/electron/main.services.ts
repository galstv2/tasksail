/**
 * Backend MCP service management — start, stop, health-check container services.
 *
 * Shells out to `src/backend/platform/container/cli.ts` via `npx tsx` to avoid
 * import-path incompatibilities between the Electron/Vite build and the backend
 * ESM module graph.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  BackendServiceStatus,
  ServicesReadStatusResponse,
} from '../src/shared/desktopContract';

type BackendServiceState = {
  status: BackendServiceStatus;
  lastCheckedAt: string | null;
  error: string | null;
};

let state: BackendServiceState = {
  status: 'idle',
  lastCheckedAt: null,
  error: null,
};

function updateState(patch: Partial<BackendServiceState>): void {
  state = { ...state, ...patch };
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const CLI_PATH = 'src/backend/platform/container/cli.ts';
const PLATFORM_CONFIG_PATH = '.platform-state/platform.json';
const DEFAULT_PLATFORM_CONFIG_PATH = 'config/platform.default.json';
const DEFAULT_TIMEOUT_MS = 120_000;
const RUNTIME_CHECK_TIMEOUT_MS = 15_000;
const SIGKILL_GRACE_MS = 5_000;

type ContainerRuntimeBinary = 'docker' | 'podman';
type RuntimeResolution =
  | { ok: true; runtimeBinary: ContainerRuntimeBinary }
  | { ok: false; error: string };

type SpawnResult = { exitCode: number; stdout: string; stderr: string };
type CliCommand = { command: string; args: string[] };

function isWindowsPlatform(): boolean {
  return process.platform === 'win32';
}

function resolveCliCommand(
  cliAbsPath: string,
  subcommand: string,
  args: string[],
): CliCommand {
  if (isWindowsPlatform()) {
    return {
      command: process.env['ComSpec'] ?? process.env['COMSPEC'] ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'npx', 'tsx', cliAbsPath, subcommand, ...args],
    };
  }

  return {
    command: 'npx',
    args: ['tsx', cliAbsPath, subcommand, ...args],
  };
}

function spawnCli(
  repoRoot: string,
  subcommand: string,
  args: string[] = [],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const cliAbsPath = join(repoRoot, CLI_PATH);
    const cliCommand = resolveCliCommand(cliAbsPath, subcommand, args);
    const child: ChildProcess = spawn(
      cliCommand.command,
      cliCommand.args,
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // Escalate from SIGTERM → SIGKILL if the process does not exit.
    const timer = setTimeout(() => {
      if (isWindowsPlatform()) {
        child.kill();
        return;
      }

      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, SIGKILL_GRACE_MS);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf-8').trim(),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
      });
    });
  });
}

function isSupportedRuntime(value: unknown): value is ContainerRuntimeBinary {
  return value === 'docker' || value === 'podman';
}

function describeRuntimeInstall(runtimeBinary: ContainerRuntimeBinary): string {
  return runtimeBinary === 'podman'
    ? 'Podman is installed and the machine or service is running.'
    : 'Docker Desktop is installed and the daemon is running.';
}

function readRuntimeFromConfigFile(
  configPath: string,
  relPath: string,
): RuntimeResolution {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown parse error.';
    return {
      ok: false,
      error:
        `Invalid container runtime configuration in ${relPath}: ${detail} ` +
        'Delete .platform-state/platform.json and re-run pnpm run setup.',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error:
        `Invalid container runtime configuration in ${relPath}: expected a JSON object. ` +
        'Delete .platform-state/platform.json and re-run pnpm run setup.',
    };
  }

  const runtimeCandidate = (parsed as Record<string, unknown>)['container_runtime'];
  if (!isSupportedRuntime(runtimeCandidate)) {
    const renderedValue =
      typeof runtimeCandidate === 'undefined' ? 'missing' : JSON.stringify(runtimeCandidate);
    return {
      ok: false,
      error:
        `Invalid container runtime configuration in ${relPath}: ` +
        `container_runtime must be "docker" or "podman" (received ${renderedValue}). ` +
        'Delete .platform-state/platform.json and re-run pnpm run setup.',
    };
  }

  return { ok: true, runtimeBinary: runtimeCandidate };
}

function resolveRuntimeBinary(repoRoot: string): RuntimeResolution {
  const envOverride = process.env['CONTAINER_RUNTIME'];
  if (envOverride) {
    if (isSupportedRuntime(envOverride)) {
      return { ok: true, runtimeBinary: envOverride };
    }

    return {
      ok: false,
      error: `Invalid CONTAINER_RUNTIME value "${envOverride}". Expected "docker" or "podman".`,
    };
  }

  const runtimePath = join(repoRoot, PLATFORM_CONFIG_PATH);
  if (existsSync(runtimePath)) {
    return readRuntimeFromConfigFile(runtimePath, PLATFORM_CONFIG_PATH);
  }

  // Fall back to the checked-in default. Bootstrap will seed the runtime
  // copy from this same file, but we may be called before bootstrap has
  // run on a fresh checkout. The default is the source of truth — never
  // hard-code 'docker' here, as that contradicts platform.default.json.
  const defaultPath = join(repoRoot, DEFAULT_PLATFORM_CONFIG_PATH);
  if (existsSync(defaultPath)) {
    return readRuntimeFromConfigFile(defaultPath, DEFAULT_PLATFORM_CONFIG_PATH);
  }

  return {
    ok: false,
    error:
      `No platform configuration found. Expected ${PLATFORM_CONFIG_PATH} ` +
      `or ${DEFAULT_PLATFORM_CONFIG_PATH}. Run "pnpm run setup".`,
  };
}

export function checkContainerRuntimeAvailable(
  repoRoot: string,
): Promise<RuntimeResolution> {
  return new Promise((resolve) => {
    const runtime = resolveRuntimeBinary(repoRoot);
    if (!runtime.ok) {
      resolve(runtime);
      return;
    }

    let settled = false;
    const unavailableResult: RuntimeResolution = {
      ok: false,
      error:
        `${runtime.runtimeBinary} is not available. Ensure ${describeRuntimeInstall(runtime.runtimeBinary)}`,
    };

    function settle(result: RuntimeResolution): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    const child = spawn(runtime.runtimeBinary, ['version', '--format', 'json'], {
      stdio: 'ignore',
    });

    const timer = setTimeout(() => {
      if (isWindowsPlatform()) {
        child.kill();
      } else {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, SIGKILL_GRACE_MS);
      }
      settle(unavailableResult);
    }, RUNTIME_CHECK_TIMEOUT_MS);

    child.on('close', (code) => {
      settle(code === 0 ? runtime : unavailableResult);
    });
    child.on('error', () => {
      settle(unavailableResult);
    });
  });
}

export async function startBackendServices(
  repoRoot: string,
): Promise<ServicesReadStatusResponse> {
  updateState({ status: 'starting', error: null });

  const runtimeAvailability = await checkContainerRuntimeAvailable(repoRoot);
  if (!runtimeAvailability.ok) {
    updateState({
      status: 'unavailable',
      error: runtimeAvailability.error,
      lastCheckedAt: nowIso(),
    });
    return readBackendServiceStatus();
  }

  const result = await spawnCli(repoRoot, 'bootstrap');

  if (result.exitCode === 0) {
    updateState({ status: 'healthy', error: null, lastCheckedAt: nowIso() });
  } else {
    const errorMsg = result.stderr || result.stdout || 'Bootstrap failed with no output.';
    updateState({ status: 'unhealthy', error: errorMsg, lastCheckedAt: nowIso() });
  }
  return readBackendServiceStatus();
}

export async function stopBackendServices(
  repoRoot: string,
): Promise<ServicesReadStatusResponse> {
  updateState({ status: 'stopping', error: null });

  const runtime = resolveRuntimeBinary(repoRoot);
  if (!runtime.ok) {
    updateState({
      status: 'unavailable',
      error: runtime.error,
      lastCheckedAt: nowIso(),
    });
    return readBackendServiceStatus();
  }

  const result = await spawnCli(repoRoot, 'down');

  if (result.exitCode === 0) {
    updateState({ status: 'idle', error: null, lastCheckedAt: nowIso() });
  } else {
    const errorMsg = result.stderr || result.stdout || 'Stop failed.';
    updateState({ status: 'unhealthy', error: errorMsg, lastCheckedAt: nowIso() });
  }
  return readBackendServiceStatus();
}

/**
 * Fire-and-forget teardown of backend MCP services on UI quit. Spawns the
 * existing `cli.ts down` subcommand detached so quit is not blocked by a hung
 * container runtime.
 */
export function stopBackendServicesDetached(repoRoot: string): void {
  try {
    const child = spawn(
      'npx',
      ['tsx', CLI_PATH, 'down'],
      {
        cwd: repoRoot,
        detached: true,
        stdio: 'ignore',
      },
    );
    child.unref();
  } catch {
    // Best-effort — quit must not be blocked by spawn failures.
  }
}

export async function checkBackendHealth(
  repoRoot: string,
): Promise<ServicesReadStatusResponse> {
  const runtime = resolveRuntimeBinary(repoRoot);
  if (!runtime.ok) {
    updateState({
      status: 'unavailable',
      error: runtime.error,
      lastCheckedAt: nowIso(),
    });
    return readBackendServiceStatus();
  }

  const result = await spawnCli(repoRoot, 'healthcheck', [], 30_000);

  if (result.exitCode === 0) {
    updateState({ status: 'healthy', error: null, lastCheckedAt: nowIso() });
  } else {
    const errorMsg = result.stderr || result.stdout || 'Health check failed.';
    updateState({ status: 'unhealthy', error: errorMsg, lastCheckedAt: nowIso() });
  }
  return readBackendServiceStatus();
}

export function readBackendServiceStatus(): ServicesReadStatusResponse {
  const msg =
    state.status === 'idle' ? 'Backend services not started.' :
    state.status === 'starting' ? 'Backend services are starting...' :
    state.status === 'healthy' ? 'Backend services are running.' :
    state.status === 'unhealthy' ? `Backend services unhealthy: ${state.error ?? 'unknown'}` :
    state.status === 'unavailable' ? `Configured container runtime unavailable: ${state.error ?? 'unknown'}` :
    state.status === 'stopping' ? 'Backend services are stopping...' :
    'Unknown state.';

  return {
    action: 'services.readStatus',
    mode: 'observed',
    status: state.status,
    lastCheckedAt: state.lastCheckedAt,
    error: state.error,
    message: msg,
  };
}

export async function autoStartBackendServices(repoRoot: string): Promise<void> {
  try {
    await startBackendServices(repoRoot);
  } catch {
    // Fire-and-forget — never crash the app on service start failure.
    updateState({
      status: 'unhealthy',
      error: 'Unexpected error during auto-start.',
      lastCheckedAt: nowIso(),
    });
  }
}
