import type { ContainerBackend, ContainerEngineHost } from '../core/index.js';

export type { ContainerBackend, ContainerEngineHost };

/** Options for docker/podman compose up/down. */
export interface ComposeOptions {
  composeFile?: string;
  composeFiles?: string[];
  projectName?: string;
  services?: string[];
  build?: boolean;
  detach?: boolean;
  env?: NodeJS.ProcessEnv;
  engineHost?: ContainerEngineHost;
  wslDistro?: string | null;
}

/** Health check specification for a single service endpoint. */
export interface ServiceHealthSpec {
  name: string;
  url: string;
  maxRetries?: number;
  retryIntervalMs?: number;
}

/** Result of a single service health check. */
export interface HealthResult {
  service: string;
  healthy: boolean;
  attempts: number;
  error?: string;
}

/** Options for bootstrapping container services. */
export interface BootstrapOptions {
  repoRoot: string;
  composeFile?: string;
  composeFiles?: string[];
  build?: boolean;
  env?: NodeJS.ProcessEnv;
  engineHost?: ContainerEngineHost;
  wslDistro?: string | null;
}

/** Options for QMD index seeding. */
export interface SeedOptions {
  repoRoot: string;
  contextPackDir: string;
  manifest?: string;
  planFile?: string;
  planMode?: 'prefer-plan' | 'require-plan' | 'manifest-only';
  writePlan?: boolean;
}

/** Abstraction over a container runtime (Docker or Podman). */
export interface ContainerRuntime {
  readonly backend: ContainerBackend;
  readonly engineHost: ContainerEngineHost;
  readonly wslDistro: string | null;
  readonly requiresComposeFile: boolean;
  composeUp(options: ComposeOptions): Promise<void>;
  composeDown(options: ComposeOptions): Promise<void>;
  healthcheck(services: ServiceHealthSpec[]): Promise<HealthResult[]>;
  bootstrap(options: BootstrapOptions): Promise<void>;
  seedIndex(options: SeedOptions): Promise<void>;
}

const DEFAULT_COMPOSE_FILES: Partial<Record<ContainerBackend, string>> = {
  docker: 'runtime/docker/compose/docker-compose.yml',
  podman: 'runtime/podman/compose/podman-compose.yml',
};

/** Default compose file path relative to repo root, based on backend. */
export function resolveDefaultComposeFile(backend: ContainerBackend): string | undefined {
  return DEFAULT_COMPOSE_FILES[backend];
}

/** @deprecated Use resolveDefaultComposeFile(backend) instead. */
export const DEFAULT_COMPOSE_FILE = 'runtime/docker/compose/docker-compose.yml';
