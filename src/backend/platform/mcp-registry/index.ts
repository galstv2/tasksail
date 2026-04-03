/**
 * Internal MCP registry access seam.
 *
 * All platform consumers should import from this pmrrel module.
 * Do not read or parse registry JSON files directly.
 *
 * This module provides:
 * - types: registry schema interfaces and result types
 * - load: registry loader and validator
 * - save: atomic runtime registry writer
 * - seed: runtime registry seeding from checked-in default
 *
 * Consumer-specific mappers (healthSpecs, composeMetadata) are added
 * in later slices.
 */

export type {
  McpVolumeMount,
  McpComposeMetadata,
  McpHealthSpec,
  McpServiceKind,
  McpServiceEntry,
  McpRegistry,
  McpRegistryValidationError,
  McpRegistryLoadResult,
} from './types.js';

export { CURRENT_SCHEMA_VERSION, ALLOWED_ENV_FILE_REFS } from './types.js';

export {
  loadMcpRegistry,
  loadDefaultRegistry,
  validateRegistry,
  RUNTIME_REGISTRY_PATH,
  DEFAULT_REGISTRY_PATH,
} from './load.js';

export { saveMcpRegistry } from './save.js';

export type { SeedResult } from './seed.js';
export { seedMcpRegistry } from './seed.js';

export { toServiceHealthSpecs } from './healthSpecs.js';

export type { EnabledComposeService } from './composeMetadata.js';
export { getEnabledComposeServices } from './composeMetadata.js';
