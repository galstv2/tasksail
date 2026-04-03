/**
 * Atomic external MCP registry writer.
 *
 * Writes the registry to a temporary file first, then renames
 * into place to avoid partial writes.
 */
import path from 'node:path';

import { ensureDir, writeTextFile, moveFile } from '../core/io.js';

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
  const dir = path.dirname(registryPath);
  await ensureDir(dir);

  const tmpPath = `${registryPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeTextFile(tmpPath, JSON.stringify(registry, null, 2) + '\n');
  await moveFile(tmpPath, registryPath);
}
