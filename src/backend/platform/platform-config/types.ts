import type { ContainerBackend } from '../core/index.js';

export const CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION = 1;

export interface PlatformConfig {
  schema_version: number;
  container_runtime: ContainerBackend;
}

export interface PlatformConfigValidationError {
  field: string;
  message: string;
  fix: string;
}

export type PlatformConfigLoadResult =
  | { valid: true; config: PlatformConfig }
  | { valid: false; errors: PlatformConfigValidationError[] };
