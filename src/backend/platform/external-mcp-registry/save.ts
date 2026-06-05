/**
 * Atomic external MCP registry writer.
 *
 * Writes the registry to a temporary file first, then renames
 * into place to avoid partial writes.
 */
import { writeTextFileAtomic } from '../core/io.js';

import type { ExternalMcpRegistry } from './types.js';

/**
 * Persist a validated external MCP registry to the given path atomically.
 *
 * The caller is responsible for validating the registry before calling.
 */
export async function saveExternalMcpRegistry(
  registryPath: string,
  registry: ExternalMcpRegistry,
): Promise<void> {
  await writeTextFileAtomic(registryPath, JSON.stringify(registry, null, 2) + '\n');
}
