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

export type ExternalMcpTransport = 'http' | 'sse';

export interface ExternalMcpAgentScope {
  mode: 'allowlist';
  agent_ids: string[];
}

export interface ExternalMcpServer {
  id: string;
  display_name: string;
  purpose: string;
  preferred_for?: string[];
  fallback_description?: string;
  enabled: boolean;
  transport: ExternalMcpTransport;
  url: string;
  headers?: Record<string, string>;
  agent_scope: ExternalMcpAgentScope;
}

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

export const ALLOWED_TRANSPORTS: readonly ExternalMcpTransport[] = ['http', 'sse'];

export const MAX_PURPOSE_LENGTH = 200;

export const MAX_PREFERRED_FOR_ITEM_LENGTH = 100;

export const MAX_PREFERRED_FOR_ITEMS = 10;

export const MAX_FALLBACK_DESCRIPTION_LENGTH = 500;
