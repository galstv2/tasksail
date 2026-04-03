/**
 * External MCP registry runtime seeding.
 *
 * Seeds `.platform-state/mcp-registry-external.json` from the checked-in
 * default file. Does not overwrite an existing runtime registry unless
 * the file is missing entirely.
 *
 * Fail-closed: invalid or corrupt runtime state is an error, not
 * silently re-seeded.
 */
import path from 'node:path';

import type { ExternalMcpRegistry, ExternalMcpValidationError } from './types.js';
import {
  FILE_NOT_FOUND_FIELD,
  loadDefaultExternalRegistry,
  loadExternalMcpRegistry,
  RUNTIME_REGISTRY_PATH,
} from './load.js';
import { saveExternalMcpRegistry } from './save.js';

export type ExternalMcpSeedResult =
  | { action: 'created'; registry: ExternalMcpRegistry }
  | { action: 'up-to-date'; registry: ExternalMcpRegistry }
  | { action: 'failed'; errors: ExternalMcpValidationError[] };

/**
 * Seed the runtime external MCP registry from the checked-in default.
 *
 * Behavior:
 * - If the runtime file does not exist: create it from the default.
 * - If the runtime file exists and validates successfully: return it
 *   unchanged. (The validator already enforces the current schema
 *   version, so a successful load implies version alignment.)
 * - If the runtime file exists but is corrupt, invalid, or has a
 *   mismatched schema version: fail with actionable errors.
 * - If the default registry itself is invalid: fail.
 */
export async function seedExternalMcpRegistry(
  repoRoot: string,
): Promise<ExternalMcpSeedResult> {
  const runtimePath = path.join(repoRoot, RUNTIME_REGISTRY_PATH);

  const runtimeResult = await loadExternalMcpRegistry(runtimePath);

  if (runtimeResult.ok) {
    // The validator enforces schema_version === CURRENT_SCHEMA_VERSION,
    // so ok: true guarantees version alignment.
    return { action: 'up-to-date', registry: runtimeResult.registry };
  }

  // Missing, corrupt, or invalid runtime file.
  const isMissing = runtimeResult.errors.length === 1
    && runtimeResult.errors[0].field === FILE_NOT_FOUND_FIELD;

  if (!isMissing) {
    return { action: 'failed', errors: runtimeResult.errors };
  }

  // No runtime file — load default and create it
  const defaultResult = await loadDefaultExternalRegistry(repoRoot);
  if (!defaultResult.ok) {
    return { action: 'failed', errors: defaultResult.errors };
  }

  await saveExternalMcpRegistry(runtimePath, defaultResult.registry);
  return { action: 'created', registry: defaultResult.registry };
}
