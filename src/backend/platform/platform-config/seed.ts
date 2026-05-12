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
 * The checked-in default (`config/platform.default.json`) is the source of
 * truth. On every seed (and therefore every `npm run dev` via the predev
 * bootstrap hook), the runtime file at `.platform-state/platform.json` is
 * rewritten so that every key from the default wins over any value previously
 * present in the runtime file. Keys absent from the default but present in
 * the runtime are preserved (so transient runtime-only state added by other
 * subsystems is not destroyed), but for any key the default declares, the
 * default's value is authoritative.
 *
 * Operational consequence: edits to `.platform-state/platform.json` (whether
 * by hand or by an operator UI settings panel) are ephemeral with respect to
 * any key the default also declares — the next startup will overwrite them.
 * To persist a change across restarts, edit `config/platform.default.json`.
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

    const runtimeResult = await loadPlatformConfig(runtimePath);
    if (runtimeResult.valid) {
      const defaultData = JSON.parse(defaultRaw) as Record<string, unknown>;
      const runtimeData = JSON.parse(runtimeResult.raw) as Record<string, unknown>;
      const mergedRaw = JSON.stringify({ ...runtimeData, ...defaultData }, null, 2) + '\n';
      if (runtimeRaw.trim() === mergedRaw.trim()) {
        return { action: 'up-to-date', config: runtimeResult.config };
      }
      await writeFile(runtimePath, mergedRaw, 'utf-8');
      const mergedResult = await loadPlatformConfig(runtimePath);
      if (!mergedResult.valid) {
        return { action: 'failed', errors: mergedResult.errors };
      }
      return { action: 'updated', config: mergedResult.config };
    }

    await writeFile(runtimePath, defaultRaw, 'utf-8');
    return { action: 'updated', config: defaultResult.config };
  }

  await mkdir(path.dirname(runtimePath), { recursive: true });
  await writeFile(runtimePath, defaultRaw, 'utf-8');
  return { action: 'created', config: defaultResult.config };
}
