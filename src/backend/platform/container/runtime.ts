import type { ContainerBackend } from '../core/index.js';
import { resolveContainerRuntime } from '../platform-config/resolve.js';
import type { ContainerRuntime } from './types.js';
import { DockerRuntime } from './docker.js';
import { PodmanRuntime } from './podman.js';

/**
 * Create a container runtime instance.
 *
 * If no backend is specified, reads the CONTAINER_RUNTIME environment variable.
 * Defaults to 'docker' if unset.
 */
export function createRuntime(backend?: ContainerBackend): ContainerRuntime {
  const resolved = backend ?? (process.env['CONTAINER_RUNTIME'] as ContainerBackend) ?? 'docker';

  switch (resolved) {
    case 'docker':
      return new DockerRuntime();
    case 'podman':
      return new PodmanRuntime();
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
  const backend = backendOverride ?? await resolveContainerRuntime(repoRoot);
  return createRuntime(backend);
}
