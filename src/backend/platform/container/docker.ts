import type {
  ComposeOptions,
  ContainerRuntime,
  ServiceHealthSpec,
  HealthResult,
  BootstrapOptions,
  SeedOptions,
} from './types.js';
import type { ContainerBackend, ContainerEngineHost } from '../core/index.js';
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
  readonly engineHost: ContainerEngineHost;
  readonly wslDistro: string | null;

  constructor(
    backend: ContainerBackend,
    engineHost: ContainerEngineHost = 'auto',
    wslDistro: string | null = null,
  ) {
    this.backend = backend;
    this.engineHost = engineHost;
    this.wslDistro = wslDistro;
  }

  async composeUp(options: ComposeOptions): Promise<void> {
    const cmd = buildComposeCommand(this.backend, 'up', {
      ...options,
      detach: options.detach !== false,
      engineHost: options.engineHost ?? this.engineHost,
      wslDistro: 'wslDistro' in options ? options.wslDistro : this.wslDistro,
    });
    await execCommand(cmd[0], cmd.slice(1), undefined, options.env);
  }

  async composeDown(options: ComposeOptions): Promise<void> {
    const cmd = buildComposeCommand(this.backend, 'down', {
      ...options,
      engineHost: options.engineHost ?? this.engineHost,
      wslDistro: 'wslDistro' in options ? options.wslDistro : this.wslDistro,
    });
    await execCommand(cmd[0], cmd.slice(1), undefined, options.env);
  }

  async healthcheck(services: ServiceHealthSpec[]): Promise<HealthResult[]> {
    return checkAllServices(services);
  }

  async bootstrap(options: BootstrapOptions): Promise<void> {
    await bootstrapServices(this, {
      ...options,
      engineHost: options.engineHost ?? this.engineHost,
      wslDistro: 'wslDistro' in options ? options.wslDistro : this.wslDistro,
    });
  }

  async seedIndex(options: SeedOptions): Promise<void> {
    await seedIndex(options);
  }
}

/**
 * Docker-backed container runtime implementation.
 */
export class DockerRuntime extends BaseContainerRuntime {
  constructor(
    engineHost: ContainerEngineHost = 'auto',
    wslDistro: string | null = null,
  ) {
    super('docker', engineHost, wslDistro);
  }
}

/**
 * Podman-backed container runtime implementation (experimental).
 */
export class PodmanRuntime extends BaseContainerRuntime {
  constructor(
    engineHost: ContainerEngineHost = 'auto',
    wslDistro: string | null = null,
  ) {
    super('podman', engineHost, wslDistro);
  }
}
