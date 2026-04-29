export type {
  ComposeOptions,
  ServiceHealthSpec,
  HealthResult,
  BootstrapOptions,
  SeedOptions,
  ContainerRuntime,
  ContainerBackend,
  ContainerEngineHost,
} from './types.js';

export { DEFAULT_COMPOSE_FILE } from './types.js';
export { resolveDefaultComposeFile } from './types.js';

export { buildComposeCommand, detectComposeCommand, validateComposeConfig } from './compose.js';

export { checkServiceHealth, checkAllServices } from './healthcheck.js';
export {
  ContextPackNotMountedError,
  createSharedMcpBootstrapEnv,
  ensureSharedMcpRunning,
  generateSharedMcpComposeOverride,
  getSharedMcpHealthUrl,
  getSharedMcpPort,
  getSharedMcpUrl,
  resolveContextPackContainerPath,
  sweepLegacyPortAllocationsOnce,
} from './sharedMcp.js';

export { bootstrapServices } from './bootstrap.js';

export { seedIndex } from './seedIndex.js';

export { DockerRuntime } from './docker.js';

export { PodmanRuntime } from './podman.js';

export { createRuntime } from './runtime.js';
export { createRuntimeFromConfig } from './runtime.js';
