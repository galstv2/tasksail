import type { ContainerBackend } from '../core/index.js';

export const CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION = 1;

export interface PlatformConfig {
  schema_version: number;
  container_runtime: ContainerBackend;
  max_parallel_tasks: number;
  retain_failed_task_worktrees: boolean;
  max_retained_failed_task_worktrees: number;
  max_retry_generations_per_slug: number;
  completed_task_runtime_retention_ms: number;
  mcp_port_range: { min: number; max: number };
}

export interface PlatformConfigValidationError {
  field: string;
  message: string;
  fix: string;
}

export type PlatformConfigLoadResult =
  | { valid: true; config: PlatformConfig; raw: string }
  | { valid: false; errors: PlatformConfigValidationError[] };
