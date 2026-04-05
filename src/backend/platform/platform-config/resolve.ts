import path from 'node:path';

import type { ContainerBackend } from '../core/index.js';
import type { PlatformConfigLoadResult } from './types.js';
import { loadPlatformConfig } from './load.js';

const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';

/**
 * Resolve the active container runtime.
 *
 * Priority:
 * 1. CONTAINER_RUNTIME env var override
 * 2. .platform-state/platform.json
 * 3. docker fallback only when the runtime config is missing
 */
export async function resolveContainerRuntime(
  repoRoot: string,
): Promise<ContainerBackend> {
  const envOverride = process.env['CONTAINER_RUNTIME'];
  if (envOverride === 'docker' || envOverride === 'podman') {
    return envOverride;
  }

  const configPath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);
  const result = await loadPlatformConfig(configPath);
  if (result.valid) {
    return result.config.container_runtime;
  }

  if (isMissingPlatformConfig(result)) {
    return 'docker';
  }

  const details = result.errors
    .map((error) => `${error.field}: ${error.message} (${error.fix})`)
    .join('; ');
  throw new Error(`Invalid platform config at ${configPath}: ${details}`);
}

function isMissingPlatformConfig(result: PlatformConfigLoadResult): boolean {
  if (result.valid) {
    return false;
  }

  return result.errors.length === 1
    && result.errors[0].field === '(file)'
    && result.errors[0].message.includes('not found');
}
