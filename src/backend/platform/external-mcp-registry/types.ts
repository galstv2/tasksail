/**
 * External MCP registry types.
 *
 * These types describe the schema for operator-configured third-party MCP
 * servers that are injected into agent launches via the active CLI provider's
 * MCP config injection mechanism.
 *
 * This module is intentionally separate from the internal MCP registry
 * (src/backend/platform/mcp-registry/) which handles platform-owned
 * container services only.
 */

export type ExternalMcpTransport = 'http' | 'sse' | 'local';

export interface ExternalMcpAgentScope {
  mode: 'allowlist';
  agent_ids: string[];
}

interface ExternalMcpServerBase {
  id: string;
  display_name: string;
  purpose: string;
  preferred_for?: string[];
  fallback_description?: string;
  enabled: boolean;
  agent_scope: ExternalMcpAgentScope;
}

/** URL-based remote MCP server (http/sse). */
export interface ExternalMcpUrlServer extends ExternalMcpServerBase {
  transport: 'http' | 'sse';
  /** Absolute URL; https for remote, http only for localhost. */
  url: string;
  /** Header values are literals or whole-value ${ENV_VAR} references. */
  headers?: Record<string, string>;
  /** Optional tool allowlist; omit = all tools (current behavior). '*' permitted. */
  tools?: string[];
}

/** Local (stdio) MCP server launched by the CLI as a child process. */
export interface ExternalMcpLocalServer extends ExternalMcpServerBase {
  transport: 'local';
  /** Operator-authored launch command, resolved on PATH by the CLI at launch. */
  command: string;
  args?: string[];
  /** Env values are literals or whole-value ${ENV_VAR} references. */
  env?: Record<string, string>;
  /** Optional working directory; must be absolute when present. */
  cwd?: string;
  /** Required, non-empty tool allowlist. Must not contain '*'. */
  tools: string[];
}

export type ExternalMcpServer = ExternalMcpUrlServer | ExternalMcpLocalServer;

export interface ExternalMcpRegistry {
  schema_version: number;
  external_servers: ExternalMcpServer[];
}

export interface ExternalMcpValidationError {
  field: string;
  message: string;
  fix: string;
}

export type ExternalMcpRegistryLoadResult =
  | { ok: true; registry: ExternalMcpRegistry }
  | { ok: false; errors: ExternalMcpValidationError[] };

export const CURRENT_SCHEMA_VERSION = 1;

export const ALLOWED_TRANSPORTS: readonly ExternalMcpTransport[] = ['http', 'sse', 'local'];

export const MAX_PURPOSE_LENGTH = 200;

export const MIN_PURPOSE_LENGTH = 20;

export const MAX_PREFERRED_FOR_ITEM_LENGTH = 100;

export const MAX_PREFERRED_FOR_ITEMS = 10;

export const MAX_FALLBACK_DESCRIPTION_LENGTH = 500;

// Local (stdio) server limits — bound the operator-authored launch surface.
export const MAX_COMMAND_LENGTH = 500;

export const MAX_ARGS_ITEMS = 50;

export const MAX_ENV_VARS = 50;

export const MAX_TOOLS_ITEMS = 100;
