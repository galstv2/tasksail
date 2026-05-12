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
  readonly requiresComposeFile = true;

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
      ...this.resolveEngineOptions(options),
      detach: options.detach !== false,
    });
    await execCommand(cmd[0], cmd.slice(1), undefined, options.env);
  }

  async composeDown(options: ComposeOptions): Promise<void> {
    const cmd = buildComposeCommand(this.backend, 'down', {
      ...options,
      ...this.resolveEngineOptions(options),
    });
    await execCommand(cmd[0], cmd.slice(1), undefined, options.env);
  }

  async healthcheck(services: ServiceHealthSpec[]): Promise<HealthResult[]> {
    return checkAllServices(services);
  }

  async bootstrap(options: BootstrapOptions): Promise<void> {
    await bootstrapServices(this, {
      ...options,
      ...this.resolveEngineOptions(options),
    });
  }

  /**
   * Merge per-call engine-host/distro overrides with the runtime defaults.
   * `wslDistro` uses an `in` check because `null` is a meaningful explicit
   * value (no distro), distinct from `undefined` (caller didn't say).
   */
  private resolveEngineOptions(
    options: ComposeOptions | BootstrapOptions,
  ): { engineHost: ContainerEngineHost; wslDistro: string | null } {
    return {
      engineHost: options.engineHost ?? this.engineHost,
      wslDistro: 'wslDistro' in options ? options.wslDistro ?? null : this.wslDistro,
    };
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
