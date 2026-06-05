/**
 * Atomic runtime registry writer.
 *
 * Writes the registry to a temporary file first, then renames
 * into place. This avoids partial writes that could leave consumers with
 * a corrupt file.
 */
import { writeTextFileAtomic } from '../core/io.js';

import type { McpRegistry } from './types.js';

/**
 * Persist a validated MCP registry to the given path atomically.
 *
 * The caller is responsible for validating the registry before calling.
 * This function trusts the typed McpRegistry input.
 */
export async function saveMcpRegistry(
  registryPath: string,
  registry: McpRegistry,
): Promise<void> {
  await writeTextFileAtomic(registryPath, JSON.stringify(registry, null, 2) + '\n');
}
