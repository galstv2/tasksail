import path from 'node:path';

import { ensureDir, readTextFile, safeJsonParse, writeTextFileAtomic } from '../core/index.js';

export const DEFAULT_DEEP_FOCUS_IGNORE_PATH = 'config/deep-focus-ignore.default.json';
export const RUNTIME_DEEP_FOCUS_IGNORE_PATH = '.platform-state/deep-focus-ignore.json';

export type DeepFocusIgnoreSeedResult =
  | { action: 'created' }
  | { action: 'up-to-date' }
  | { action: 'failed'; error: string };

function isValidIgnoreConfig(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const extensionsValid = Array.isArray(record.extensions)
    && record.extensions.every((entry) => typeof entry === 'string');
  const patternsValid = Array.isArray(record.patterns)
    && record.patterns.every((entry) => typeof entry === 'string');
  return extensionsValid && patternsValid;
}

export async function seedDeepFocusIgnoreConfig(
  repoRoot: string,
): Promise<DeepFocusIgnoreSeedResult> {
  const runtimePath = path.join(repoRoot, RUNTIME_DEEP_FOCUS_IGNORE_PATH);
  const existingRuntime = await readTextFile(runtimePath);
  if (existingRuntime !== undefined) {
    return { action: 'up-to-date' };
  }

  const defaultPath = path.join(repoRoot, DEFAULT_DEEP_FOCUS_IGNORE_PATH);
  const defaultConfig = await readTextFile(defaultPath);
  if (defaultConfig === undefined) {
    return { action: 'failed', error: `Missing deep focus ignore seed: ${defaultPath}` };
  }

  let parsed: unknown;
  try {
    parsed = safeJsonParse(defaultConfig, defaultPath);
  } catch (error: unknown) {
    return {
      action: 'failed',
      error: error instanceof Error ? error.message : 'Deep focus ignore seed is invalid JSON.',
    };
  }

  if (!isValidIgnoreConfig(parsed)) {
    return {
      action: 'failed',
      error: 'Deep focus ignore seed must contain string-array extensions and patterns fields.',
    };
  }

  await ensureDir(path.dirname(runtimePath));
  await writeTextFileAtomic(runtimePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return { action: 'created' };
}
