import type {
  ComposeOptions,
  ContainerRuntime,
  ServiceHealthSpec,
  HealthResult,
  BootstrapOptions,
  SeedOptions,
} from './types.js';
import type { ContainerBackend } from '../core/index.js';
import { buildComposeCommand, execCommand } from './compose.js';
import { checkAllServices } from './healthcheck.js';
import { bootstrapServices } from './bootstrap.js';
import { seedIndex } from './seedIndex.js';

/**
 * Base container runtime implementation parameterized by backend.
 * Used by both Docker and Podman — the only difference is the binary name.
 */
class BaseContainerRuntime implements ContainerRuntime {
  readonly backend: ContainerBackend;

  constructor(backend: ContainerBackend) {
    this.backend = backend;
  }

  async composeUp(options: ComposeOptions): Promise<void> {
    const cmd = buildComposeCommand(this.backend, 'up', {
      ...options,
      detach: options.detach !== false,
    });
    await execCommand(cmd[0], cmd.slice(1));
  }

  async composeDown(options: ComposeOptions): Promise<void> {
    const cmd = buildComposeCommand(this.backend, 'down', options);
    await execCommand(cmd[0], cmd.slice(1));
  }

  async healthcheck(services: ServiceHealthSpec[]): Promise<HealthResult[]> {
    return checkAllServices(services);
  }

  async bootstrap(options: BootstrapOptions): Promise<void> {
    await bootstrapServices(this, options);
  }

  async seedIndex(options: SeedOptions): Promise<void> {
    await seedIndex(options);
  }
}

/**
 * Docker-backed container runtime implementation.
 */
export class DockerRuntime extends BaseContainerRuntime {
  constructor() {
    super('docker');
  }
}

/**
 * Podman-backed container runtime implementation (experimental).
 */
export class PodmanRuntime extends BaseContainerRuntime {
  constructor() {
    super('podman');
  }
}
