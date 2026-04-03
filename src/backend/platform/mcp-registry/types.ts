/**
 * Internal MCP registry types.
 *
 * These types describe the schema for platform-managed internal MCP services.
 * They are NOT intended for third-party MCP onboarding, agent registration,
 * or remote endpoints.
 */

/** Volume mount definition within a compose service. */
export interface McpVolumeMount {
  host: string;
  container: string;
  mode: 'ro' | 'rw';
}

/** Compose-facing metadata for a single MCP service. */
export interface McpComposeMetadata {
  serviceName: string;
  containerName: string;
  image: string;
  dockerfile: string;
  buildContext: string;
  hostBind: string;
  hostPort: number;
  containerPort: number;
  envFileRefs: string[];
  environment: Record<string, string>;
  volumes: McpVolumeMount[];
  memoryLimit: string;
  cpuLimit: string;
  stopGracePeriod: string;
}

/** Health check definition for a single MCP service. */
export interface McpHealthSpec {
  url: string;
  maxRetries: number;
  retryIntervalMs: number;
}

/** Allowed values for the service transport kind. */
export type McpServiceKind = 'container-http';

/** A single MCP service entry in the registry. */
export interface McpServiceEntry {
  id: string;
  displayName: string;
  kind: McpServiceKind;
  enabled: boolean;
  builtin: boolean;
  compose: McpComposeMetadata;
  health: McpHealthSpec;
}

/** Top-level MCP registry document. */
export interface McpRegistry {
  schema_version: number;
  services: McpServiceEntry[];
}

/** A single validation error with location and fix guidance. */
export interface McpRegistryValidationError {
  field: string;
  message: string;
  fix: string;
}

/** Result of loading and validating the MCP registry. */
export type McpRegistryLoadResult =
  | { ok: true; registry: McpRegistry }
  | { ok: false; errors: McpRegistryValidationError[] };

/** Current supported schema version. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Allowed env file references. */
export const ALLOWED_ENV_FILE_REFS: readonly string[] = ['.env', '.env.local', '.env.test'];
