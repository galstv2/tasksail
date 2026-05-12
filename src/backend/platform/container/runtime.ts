import type { ContainerBackend, ContainerEngineHost } from '../core/index.js';
import { resolveContainerEngineHost, resolveContainerRuntime } from '../platform-config/resolve.js';
import type { ContainerRuntime } from './types.js';
import { DockerRuntime } from './docker.js';
import { PodmanRuntime } from './podman.js';
import { DirectRuntime } from './directRuntime.js';

/**
 * Create a container runtime instance.
 *
 * If no backend is specified, reads the CONTAINER_RUNTIME environment variable.
 * Defaults to 'docker' if unset.
 */
export function createRuntime(
  backend?: ContainerBackend,
  engineHost: ContainerEngineHost = 'auto',
  wslDistro: string | null = null,
): ContainerRuntime {
  const resolved = backend ?? (process.env['CONTAINER_RUNTIME'] as ContainerBackend) ?? 'docker';

  switch (resolved) {
    case 'docker':
      return new DockerRuntime(engineHost, wslDistro);
    case 'podman':
      return new PodmanRuntime(engineHost, wslDistro);
    case 'direct':
      return new DirectRuntime();
    default:
      throw new Error(`Unsupported container backend: ${resolved as string}`);
  }
}

/**
 * Create a container runtime instance using the resolved platform config.
 */
export async function createRuntimeFromConfig(
  repoRoot: string,
  backendOverride?: ContainerBackend,
): Promise<ContainerRuntime> {
  const engineHost = await resolveContainerEngineHost(repoRoot);
  const backend = backendOverride ?? await resolveContainerRuntime(repoRoot);
  return createRuntime(backend, engineHost.host, engineHost.wslDistro);
}
