import path from 'node:path';

import type { ContainerBackend } from '../core/index.js';
import type { PlatformConfigLoadResult } from './types.js';
import { loadPlatformConfig } from './load.js';

const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';
const DEFAULT_PLATFORM_CONFIG_PATH = 'config/platform.default.json';

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

  const runtimePath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);
  const runtimeResult = await loadPlatformConfig(runtimePath);
  if (runtimeResult.valid) {
    return runtimeResult.config.container_runtime;
  }
  if (!isMissingPlatformConfig(runtimeResult)) {
    throw invalidConfigError(runtimePath, runtimeResult);
  }

  const defaultPath = path.join(repoRoot, DEFAULT_PLATFORM_CONFIG_PATH);
  const defaultResult = await loadPlatformConfig(defaultPath);
  if (defaultResult.valid) {
    return defaultResult.config.container_runtime;
  }
  throw invalidConfigError(defaultPath, defaultResult);
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
