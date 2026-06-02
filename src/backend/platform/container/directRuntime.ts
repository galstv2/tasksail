import type {
  BootstrapOptions,
  ComposeOptions,
  ContainerRuntime,
  HealthResult,
  SeedOptions,
  ServiceHealthSpec,
} from './types.js';
import type { ContainerBackend, ContainerEngineHost } from '../core/index.js';
import { checkAllServices } from './healthcheck.js';
import { bootstrapServices } from './bootstrap.js';
import { seedIndex } from './seedIndex.js';
import { spawnDirectMcp, stopDirectMcp } from './directRuntimeProcess.js';
import { getPlatformConfig } from '../platform-config/get.js';

export class DirectRuntime implements ContainerRuntime {
  readonly backend: ContainerBackend = 'direct';
  readonly engineHost: ContainerEngineHost;
  readonly wslDistro: string | null;
  readonly requiresComposeFile = false;

  constructor(
    engineHost: ContainerEngineHost = 'native',
    wslDistro: string | null = null,
  ) {
    this.engineHost = engineHost;
    this.wslDistro = wslDistro;
  }

  async composeUp(options: ComposeOptions): Promise<void> {
    if (!options.env) {
      throw new Error('DirectRuntime.composeUp: env is required (call via bootstrap()).');
    }
    const repoRoot = options.env['TASKSAIL_REPO_ROOT'];
    if (typeof repoRoot !== 'string' || repoRoot === '') {
      throw new Error('DirectRuntime.composeUp: env.TASKSAIL_REPO_ROOT is required.');
    }
    const config = await getPlatformConfig(repoRoot);
    await spawnDirectMcp({
      repoRoot,
      port: config.mcp_port,
      env: options.env,
    });
  }

  async composeDown(options: ComposeOptions): Promise<void> {
    const repoRoot = options.env?.['TASKSAIL_REPO_ROOT'];
    await stopDirectMcp(typeof repoRoot === 'string' && repoRoot !== '' ? repoRoot : process.cwd());
  }

  async healthcheck(services: ServiceHealthSpec[]): Promise<HealthResult[]> {
    return checkAllServices(services);
  }

  async bootstrap(options: BootstrapOptions): Promise<void> {
    await bootstrapServices(this, {
      ...options,
      env: {
        ...(options.env ?? {}),
        TASKSAIL_REPO_ROOT: options.repoRoot,
      },
    });
  }

  async seedIndex(options: SeedOptions): Promise<void> {
    await seedIndex(options);
  }
}
