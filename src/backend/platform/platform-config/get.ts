import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { PlatformConfig } from './types.js';
import { loadPlatformConfig } from './load.js';
import { resolveContainerRuntime } from './resolve.js';

const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';

/**
 * The two env vars that are tracked in the cache key's env snapshot.
 * MUST stay in lockstep with the override-layer entries in applyEnvOverrides.
 */
const ENV_SNAPSHOT_KEYS = [
  'TASKSAIL_MAX_PARALLEL_TASKS',
  'CONTAINER_RUNTIME',
] as const;

interface CacheEntry {
  mtimeMs: number;
  envSnapshot: string;
  config: PlatformConfig;
}

const cache = new Map<string, CacheEntry>();

/** Internal counter: incremented each time loadPlatformConfig is actually called (cache miss). */
let _readCount = 0;

function captureEnvSnapshot(): string {
  return JSON.stringify([
    process.env['TASKSAIL_MAX_PARALLEL_TASKS'] ?? '',
    process.env['CONTAINER_RUNTIME'] ?? '',
  ] satisfies [string, string]);
}

async function getFileMtime(filePath: string): Promise<number> {
  const s = await stat(filePath);
  return s.mtimeMs;
}

async function applyEnvOverrides(
  config: PlatformConfig,
  repoRoot: string,
): Promise<PlatformConfig> {
  const result = { ...config };

  // TASKSAIL_MAX_PARALLEL_TASKS override (fail-closed on invalid)
  const rawMaxParallel = process.env['TASKSAIL_MAX_PARALLEL_TASKS'];
  if (rawMaxParallel !== undefined && rawMaxParallel !== '') {
    const parsed = Number(rawMaxParallel);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      throw new Error(
        `TASKSAIL_MAX_PARALLEL_TASKS="${rawMaxParallel}" is not a valid positive integer ≥ 1. ` +
          'Fix or unset the env var.',
      );
    }
    result.max_parallel_tasks = parsed;
  }

  // CONTAINER_RUNTIME override — delegate to resolveContainerRuntime which
  // already implements this logic (env-var check + JSON fallback + docker default).
  result.container_runtime = await resolveContainerRuntime(repoRoot);

  return result;
}

/**
 * Return the active platform config for the given repo root.
 *
 * Reads `.platform-state/platform.json`, applies env-var overrides, and
 * memoizes the result keyed by file mtime + env snapshot so hot paths do not
 * re-read the file on every call. Cache invalidates on mtime change or env
 * snapshot change.
 *
 * Throws if the runtime config file is missing or invalid, or if an env-var
 * override is unparseable (fail-closed).
 */
export async function getPlatformConfig(repoRoot: string): Promise<PlatformConfig> {
  const configPath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);
  const envSnapshot = captureEnvSnapshot();

  let mtimeMs: number;
  try {
    mtimeMs = await getFileMtime(configPath);
  } catch (err: unknown) {
    // File missing — fall through to loadPlatformConfig which gives a clear error
    mtimeMs = -1;
  }

  const cacheKey = repoRoot;
  const cached = cache.get(cacheKey);
  if (
    cached !== undefined
    && cached.mtimeMs === mtimeMs
    && cached.envSnapshot === envSnapshot
    && mtimeMs !== -1
  ) {
    return cached.config;
  }

  _readCount += 1;
  const result = await loadPlatformConfig(configPath);
  if (!result.valid) {
    const details = result.errors
      .map((e) => `${e.field}: ${e.message} (${e.fix})`)
      .join('; ');
    throw new Error(`Invalid platform config at ${configPath}: ${details}`);
  }

  const config = await applyEnvOverrides(result.config, repoRoot);

  cache.set(cacheKey, { mtimeMs, envSnapshot, config });
  return config;
}

/**
 * Exposed for tests: clear the internal memoization cache and reset the read counter.
 */
export function _clearPlatformConfigCache(): void {
  cache.clear();
  _readCount = 0;
}

/**
 * Exposed for tests: return the number of times loadPlatformConfig was invoked
 * (i.e., cache miss count). Use this to verify cache hit/miss behavior without
 * spying on ESM native node builtins.
 */
export function _getReadCount(): number {
  return _readCount;
}

/**
 * Exposed for tests: assert that ENV_SNAPSHOT_KEYS is in sync with the
 * override-layer fields applied in applyEnvOverrides.
 */
export const _ENV_SNAPSHOT_KEYS: ReadonlyArray<string> = ENV_SNAPSHOT_KEYS;
