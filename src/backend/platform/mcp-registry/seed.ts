/**
 * Runtime registry seeding.
 *
 * Seeds `.platform-state/mcp-registry.json` from the checked-in default
 * file during setup. Does not overwrite an existing runtime registry
 * unless the schema version is stale.
 *
 * Fail-closed: invalid runtime state is an error, not silently re-seeded.
 */
import path from 'node:path';

import type { McpRegistry, McpRegistryValidationError } from './types.js';
import { CURRENT_SCHEMA_VERSION } from './types.js';
import {
  loadDefaultRegistry,
  loadMcpRegistry,
  RUNTIME_REGISTRY_PATH,
} from './load.js';
import { saveMcpRegistry } from './save.js';

export type SeedResult =
  | { action: 'created'; registry: McpRegistry }
  | { action: 'up-to-date'; registry: McpRegistry }
  | { action: 'failed'; errors: McpRegistryValidationError[] };

/**
 * Seed the runtime MCP registry from the checked-in default.
 *
 * Behavior:
 * - If the runtime file does not exist: create it from the default.
 * - If the runtime file exists and validates successfully with the
 *   current schema version: return it.
 * - If the runtime file exists but is corrupt, invalid, or has a
 *   mismatched schema version: fail with actionable errors.
 * - If the default registry itself is invalid: fail.
 *
 * Returns the validated registry on success so callers can use it
 * directly without re-reading from disk.
 */
export async function seedMcpRegistry(repoRoot: string): Promise<SeedResult> {
  const runtimePath = path.join(repoRoot, RUNTIME_REGISTRY_PATH);

  // Try loading the runtime file through full validation.
  const runtimeResult = await loadMcpRegistry(runtimePath);

  if (runtimeResult.ok) {
    // Runtime file exists and is valid — verify schema version
    if (runtimeResult.registry.schema_version === CURRENT_SCHEMA_VERSION) {
      return { action: 'up-to-date', registry: runtimeResult.registry };
    }

    // Valid structure but wrong version — fail (operator must re-seed)
    return {
      action: 'failed',
      errors: [{
        field: 'schema_version',
        message: `Runtime registry schema version ${runtimeResult.registry.schema_version} does not match current version ${CURRENT_SCHEMA_VERSION}.`,
        fix: 'Delete .platform-state/mcp-registry.json and re-run "pnpm run setup" to re-seed.',
      }],
    };
  }

  // Runtime file is missing, corrupt, or invalid.
  // If it's simply missing (not-found), seed from default.
  // If it exists but is corrupt/invalid, fail — don't silently overwrite.
  const isMissing = runtimeResult.errors.length === 1
    && runtimeResult.errors[0].field === '(file)'
    && runtimeResult.errors[0].message.includes('not found');

  if (!isMissing) {
    // Runtime file exists but is corrupt or invalid — fail closed
    return { action: 'failed', errors: runtimeResult.errors };
  }

  // No runtime file — load default and create it
  const defaultResult = await loadDefaultRegistry(repoRoot);
  if (!defaultResult.ok) {
    return { action: 'failed', errors: defaultResult.errors };
  }

  await saveMcpRegistry(runtimePath, defaultResult.registry);
  return { action: 'created', registry: defaultResult.registry };
}
