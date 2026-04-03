/**
 * Atomic runtime registry writer.
 *
 * Writes the registry to a temporary file first, then renames
 * into place. This avoids partial writes that could leave consumers with
 * a corrupt file.
 */
import path from 'node:path';

import { ensureDir, writeTextFile, moveFile } from '../core/io.js';

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
  const dir = path.dirname(registryPath);
  await ensureDir(dir);

  const tmpPath = `${registryPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeTextFile(tmpPath, JSON.stringify(registry, null, 2) + '\n');
  await moveFile(tmpPath, registryPath);
}
