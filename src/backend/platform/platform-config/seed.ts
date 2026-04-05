import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadPlatformConfig } from './load.js';
import type { PlatformConfig, PlatformConfigValidationError } from './types.js';

export type PlatformConfigSeedResult =
  | { action: 'up-to-date'; config: PlatformConfig }
  | { action: 'created'; config: PlatformConfig }
  | { action: 'failed'; errors: PlatformConfigValidationError[] };

const DEFAULT_PLATFORM_CONFIG_PATH = 'config/platform.default.json';
const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';

/**
 * Seed the runtime platform config from the checked-in default.
 *
 * Existing runtime config is never overwritten automatically. Invalid runtime
 * config fails closed so operator intent is preserved.
 */
export async function seedPlatformConfig(
  repoRoot: string,
): Promise<PlatformConfigSeedResult> {
  const runtimePath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);

  if (existsSync(runtimePath)) {
    const runtimeResult = await loadPlatformConfig(runtimePath);
    if (runtimeResult.valid) {
      return { action: 'up-to-date', config: runtimeResult.config };
    }

    return { action: 'failed', errors: runtimeResult.errors };
  }

  const defaultPath = path.join(repoRoot, DEFAULT_PLATFORM_CONFIG_PATH);
  const defaultResult = await loadPlatformConfig(defaultPath);
  if (!defaultResult.valid) {
    return { action: 'failed', errors: defaultResult.errors };
  }

  await mkdir(path.dirname(runtimePath), { recursive: true });
  const raw = await readFile(defaultPath, 'utf-8');
  await writeFile(runtimePath, raw, 'utf-8');

  return { action: 'created', config: defaultResult.config };
}
