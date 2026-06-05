import type { ContainerBackend, ContainerEngineHost } from '../core/index.js';

export const CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION = 1;

export type SliceArtifactFormat = 'markdown' | 'xml';

export const VALID_ENGINE_HOSTS: ReadonlySet<ContainerEngineHost> = new Set([
  'auto',
  'native',
  'desktop-linux',
  'wsl',
]);

/**
 * True when `distro` is a valid WSL distro name for use with
 * `container_engine_host=wsl`. Empty/whitespace and path-separator characters
 * are rejected — distro names must be argv-safe for `wsl.exe -d`.
 */
export function isValidWslDistroName(distro: string | null): boolean {
  if (distro === null) return false;
  if (distro.trim() === '') return false;
  // SEC-TS-10: a leading '-' would be parsed as a flag by `wsl.exe -d <distro>`
  // before the '--' terminator. Real distro names always start alphanumerically.
  if (distro.startsWith('-')) return false;
  return !/[\\/]/.test(distro);
}

export interface PlatformConfig {
  schema_version: number;
  cli_provider: string;
  container_runtime: ContainerBackend;
  container_engine_host: ContainerEngineHost;
  container_engine_wsl_distro: string | null;
  max_parallel_tasks: number;
  retain_failed_task_worktrees: boolean;
  max_retained_failed_task_worktrees: number;
  max_retry_generations_per_slug: number;
  completed_task_runtime_retention_ms: number;
  auto_merge: boolean;
  external_mcp_local_enabled: boolean;
  mcp_port: number;
  repo_context_mcp_external_mount_roots: string[];
  slice_artifact_format: SliceArtifactFormat;
}

export interface PlatformConfigValidationError {
  field: string;
  message: string;
  fix: string;
}

export type PlatformConfigLoadResult =
  | { valid: true; config: PlatformConfig; raw: string }
  | { valid: false; errors: PlatformConfigValidationError[] };
