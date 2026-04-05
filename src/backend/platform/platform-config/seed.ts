import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadPlatformConfig } from './load.js';
import type { PlatformConfig, PlatformConfigValidationError } from './types.js';

export type PlatformConfigSeedResult =
  | { action: 'up-to-date'; config: PlatformConfig }
  | { action: 'created'; config: PlatformConfig }
  | { action: 'updated'; config: PlatformConfig }
  | { action: 'failed'; errors: PlatformConfigValidationError[] };

const DEFAULT_PLATFORM_CONFIG_PATH = 'config/platform.default.json';
const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';

/**
 * Seed the runtime platform config from the checked-in default.
 *
 * The checked-in default (`config/platform.default.json`) is authoritative.
 * If the runtime copy exists but differs from the default, it is overwritten.
 * This ensures that changes to the tracked config take effect on the next
 * setup or app start without manual runtime-file edits.
 */
export async function seedPlatformConfig(
  repoRoot: string,
): Promise<PlatformConfigSeedResult> {
  const defaultPath = path.join(repoRoot, DEFAULT_PLATFORM_CONFIG_PATH);
  const defaultResult = await loadPlatformConfig(defaultPath);
  if (!defaultResult.valid) {
    return { action: 'failed', errors: defaultResult.errors };
  }

  const runtimePath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);
  const defaultRaw = defaultResult.raw;

  let runtimeRaw: string | undefined;
  try {
    runtimeRaw = await readFile(runtimePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (runtimeRaw !== undefined) {
    if (runtimeRaw.trim() === defaultRaw.trim()) {
      return { action: 'up-to-date', config: defaultResult.config };
    }
    await writeFile(runtimePath, defaultRaw, 'utf-8');
    return { action: 'updated', config: defaultResult.config };
  }

  await mkdir(path.dirname(runtimePath), { recursive: true });
  await writeFile(runtimePath, defaultRaw, 'utf-8');
  return { action: 'created', config: defaultResult.config };
}
