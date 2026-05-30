/**
 * External MCP registry access seam.
 *
 * All platform consumers should import from this barrel module.
 * Do not read or parse external MCP registry JSON files directly.
 *
 * This module is intentionally separate from the internal MCP registry
 * (src/backend/platform/mcp-registry/) which handles platform-owned
 * container services only.
 */

export type {
  ExternalMcpTransport,
  ExternalMcpAgentScope,
  ExternalMcpServer,
  ExternalMcpUrlServer,
  ExternalMcpLocalServer,
  ExternalMcpRegistry,
  ExternalMcpValidationError,
  ExternalMcpRegistryLoadResult,
} from './types.js';

export {
  CURRENT_SCHEMA_VERSION,
  ALLOWED_TRANSPORTS,
  MAX_PURPOSE_LENGTH,
  MAX_PREFERRED_FOR_ITEM_LENGTH,
  MAX_PREFERRED_FOR_ITEMS,
  MAX_FALLBACK_DESCRIPTION_LENGTH,
  MAX_COMMAND_LENGTH,
  MAX_ARGS_ITEMS,
  MAX_ENV_VARS,
  MAX_TOOLS_ITEMS,
} from './types.js';

export {
  loadExternalMcpRegistry,
  loadDefaultExternalRegistry,
  validateExternalMcpRegistry,
  getExternalServersForAgent,
  loadExternalMcpRegistryWithFallback,
  ENV_VAR_REF_PATTERN,
  FILE_NOT_FOUND_FIELD,
  RUNTIME_REGISTRY_PATH,
  DEFAULT_REGISTRY_PATH,
} from './load.js';

export { saveExternalMcpRegistry } from './save.js';

export type { ExternalMcpSeedResult } from './seed.js';
export { seedExternalMcpRegistry } from './seed.js';
