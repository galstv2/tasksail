import path from 'node:path';

import type { ContainerBackend, ContainerEngineHost } from '../core/index.js';
import type { PlatformConfigLoadResult } from './types.js';
import { loadPlatformConfig } from './load.js';

const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';
const DEFAULT_PLATFORM_CONFIG_PATH = 'config/platform.default.json';

const VALID_ENGINE_HOSTS: ReadonlySet<ContainerEngineHost> = new Set([
  'auto',
  'native',
  'desktop-linux',
  'wsl',
]);

export interface ResolvedContainerEngineHost {
  host: ContainerEngineHost;
  wslDistro: string | null;
}

/**
 * Resolve the active container runtime.
 *
 * Priority:
 * 1. CONTAINER_RUNTIME env var override
 * 2. .platform-state/platform.json (seeded runtime copy)
 * 3. config/platform.default.json (checked-in default; the runtime copy is
 *    seeded from this on `pnpm run setup` and on `bootstrap`).
 *
 * Fails closed if no resolvable source exists. The previous hard-coded
 * 'docker' fallback contradicted the checked-in default, so a missing runtime
 * file silently overrode operator intent.
 */
export async function resolveContainerRuntime(
  repoRoot: string,
): Promise<ContainerBackend> {
  const envOverride = process.env['CONTAINER_RUNTIME'];
  if (envOverride === 'docker' || envOverride === 'podman') {
    return envOverride;
  }

  return (await resolvePlatformConfig(repoRoot)).container_runtime;
}

export async function resolveContainerEngineHost(
  repoRoot: string,
): Promise<ResolvedContainerEngineHost> {
  const envHost = process.env['CONTAINER_ENGINE_HOST'];
  const envDistro = process.env['CONTAINER_ENGINE_WSL_DISTRO'];

  if (envHost !== undefined) {
    const resolved = {
      host: parseContainerEngineHostEnv(envHost),
      wslDistro: envDistro ?? null,
    };

    validateResolvedContainerEngineHost(resolved.host, resolved.wslDistro);
    return resolved;
  }

  const config = await resolvePlatformConfig(repoRoot);
  const host = config.container_engine_host;
  const wslDistro = envDistro === undefined ? config.container_engine_wsl_distro : envDistro;

  validateResolvedContainerEngineHost(host, wslDistro);
  return { host, wslDistro };
}

async function resolvePlatformConfig(repoRoot: string) {
  const runtimePath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);
  const runtimeResult = await loadPlatformConfig(runtimePath);
  if (runtimeResult.valid) {
    return runtimeResult.config;
  }
  if (!isMissingPlatformConfig(runtimeResult)) {
    throw invalidConfigError(runtimePath, runtimeResult);
  }

  const defaultPath = path.join(repoRoot, DEFAULT_PLATFORM_CONFIG_PATH);
  const defaultResult = await loadPlatformConfig(defaultPath);
  if (defaultResult.valid) {
    return defaultResult.config;
  }
  throw invalidConfigError(defaultPath, defaultResult);
}

function parseContainerEngineHostEnv(value: string): ContainerEngineHost {
  if (VALID_ENGINE_HOSTS.has(value as ContainerEngineHost)) {
    return value as ContainerEngineHost;
  }

  throw new Error(
    `CONTAINER_ENGINE_HOST="${value}" is not valid. Set it to "auto", "native", "desktop-linux", or "wsl", or unset it.`,
  );
}

function validateResolvedContainerEngineHost(host: ContainerEngineHost, wslDistro: string | null): void {
  if (
    host === 'wsl'
    && (
      wslDistro === null
      || wslDistro.trim() === ''
      || /[\\/]/.test(wslDistro)
    )
  ) {
    throw new Error(
      'CONTAINER_ENGINE_WSL_DISTRO must be a non-empty WSL distro name without path separators when container engine host is "wsl".',
    );
  }
}

function isMissingPlatformConfig(result: PlatformConfigLoadResult): boolean {
  if (result.valid) {
    return false;
  }

  return result.errors.length === 1
    && result.errors[0].field === '(file)'
    && result.errors[0].message.includes('not found');
}

function invalidConfigError(
  configPath: string,
  result: Extract<PlatformConfigLoadResult, { valid: false }>,
): Error {
  const details = result.errors
    .map((error) => `${error.field}: ${error.message} (${error.fix})`)
    .join('; ');
  return new Error(`Invalid platform config at ${configPath}: ${details}`);
}
