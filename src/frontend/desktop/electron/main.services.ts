/**
 * Backend MCP service management — start, stop, health-check Docker services.
 *
 * Shells out to `src/backend/platform/container/cli.ts` via `npx tsx` to avoid
 * import-path incompatibilities between the Electron/Vite build and the backend
 * ESM module graph.
 */
import { spawn, type ChildProcess } from 'node:child_process';
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
const DEFAULT_TIMEOUT_MS = 120_000;
const SIGKILL_GRACE_MS = 5_000;

type SpawnResult = { exitCode: number; stdout: string; stderr: string };

function spawnCli(
  repoRoot: string,
  subcommand: string,
  args: string[] = [],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const cliAbsPath = join(repoRoot, CLI_PATH);
    const child: ChildProcess = spawn(
      'npx',
      ['tsx', cliAbsPath, subcommand, ...args],
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
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
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

const runtimeBinary = process.env['CONTAINER_RUNTIME'] || 'docker';

export function checkDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(runtimeBinary, ['version', '--format', 'json'], {
      stdio: 'ignore',
    });

    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export async function startBackendServices(
  repoRoot: string,
): Promise<ServicesReadStatusResponse> {
  updateState({ status: 'starting', error: null });

  const dockerOk = await checkDockerAvailable();
  if (!dockerOk) {
    updateState({
      status: 'unavailable',
      error: `${runtimeBinary} is not available. Install Docker Desktop or ensure the daemon is running.`,
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

  const result = await spawnCli(repoRoot, 'down');

  if (result.exitCode === 0) {
    updateState({ status: 'idle', error: null, lastCheckedAt: nowIso() });
  } else {
    const errorMsg = result.stderr || result.stdout || 'Stop failed.';
    updateState({ status: 'unhealthy', error: errorMsg, lastCheckedAt: nowIso() });
  }
  return readBackendServiceStatus();
}

export async function checkBackendHealth(
  repoRoot: string,
): Promise<ServicesReadStatusResponse> {
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
    state.status === 'unavailable' ? `Docker is not available: ${state.error ?? 'unknown'}` :
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
