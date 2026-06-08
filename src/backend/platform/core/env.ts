import { readFile, copyFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { isWindowsPlatform } from './platform.js';
import type { EnvMap } from './types.js';

/**
 * Publicly-known placeholder shipped in .env.example. Treated as "no real
 * secret configured" — secureEnvToken rotates it; validation warns on it.
 */
export const PLACEHOLDER_MCP_TOKEN = 'replace-with-local-secret';

/**
 * Parse .env file content into a key-value map.
 * Handles comments, empty lines, and quoted values.
 * Rejects lines containing dynamic content ($() or pmckticks).
 */
export function parseEnv(content: string): EnvMap {
  const result: EnvMap = new Map();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      throw new Error(`Unsupported .env assignment: ${line}`);
    }

    const key = match[1];
    let value = match[2].trim();

    if (value.includes('$(') || value.includes('`')) {
      throw new Error(
        `Refusing to evaluate dynamic content in .env for ${key}`,
      );
    }

    value = stripWrappingQuotes(value);
    result.set(key, value);
  }

  return result;
}

/**
 * Load and parse a .env file. Returns empty map if file does not exist.
 */
export async function loadEnv(filePath: string): Promise<EnvMap> {
  if (!existsSync(filePath)) {
    return new Map();
  }
  const content = await readFile(filePath, 'utf-8');
  return parseEnv(content);
}

/**
 * Read a single env assignment from a file.
 * Returns undefined if the key is not found or the file does not exist.
 */
export async function readEnvAssignment(
  filePath: string,
  key: string,
): Promise<string | undefined> {
  if (!existsSync(filePath)) {
    return undefined;
  }
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  let lastMatch: string | undefined;
  const regex = new RegExp(`^\\s*${key}=(.*)$`);

  for (const line of lines) {
    const m = line.match(regex);
    if (m) {
      lastMatch = stripWrappingQuotes(m[1].trim());
    }
  }

  return lastMatch;
}

/**
 * Copy .env.example to .env if .env does not already exist.
 * Returns true if .env was created, false if it already existed.
 */
export async function ensureEnvFile(repoRoot: string): Promise<boolean> {
  const envFile = path.join(repoRoot, '.env');
  const envExample = path.join(repoRoot, '.env.example');

  try {
    await copyFile(envExample, envFile, constants.COPYFILE_EXCL);
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      if (code === 'ENOENT') {
        throw new Error(`.env.example not found at ${envExample}`);
      }
    }
    throw err;
  }
}

/**
 * Insert or update a key=value pair in an env file.
 */
export async function upsertEnvVar(
  filePath: string,
  key: string,
  value: string,
): Promise<void> {
  const content = existsSync(filePath)
    ? await readFile(filePath, 'utf-8')
    : '';

  const lines = content.split('\n');
  const regex = new RegExp(`^\\s*${key}=`);
  let updated = false;
  const result: string[] = [];

  for (const line of lines) {
    if (regex.test(line)) {
      if (!updated) {
        result.push(`${key}=${value}`);
        updated = true;
      }
    } else {
      result.push(line);
    }
  }

  if (!updated) {
    result.push(`${key}=${value}`);
  }

  await writeFile(filePath, result.join('\n'));
}

/**
 * Harden the repo .env after it exists: generate a fresh random
 * REPO_CONTEXT_MCP_AUTH_TOKEN whenever the current value is missing, empty, or
 * the publicly-known placeholder, and restrict the file to owner-only (0600) on
 * POSIX. A token the operator already customized is left untouched; chmod is
 * skipped on Windows (POSIX mode bits do not apply). Idempotent — safe to call
 * on every setup run.
 */
export async function secureEnvToken(
  repoRoot: string,
): Promise<{ rotated: boolean; restricted: boolean }> {
  const envFile = path.join(repoRoot, '.env');
  if (!existsSync(envFile)) {
    return { rotated: false, restricted: false };
  }

  let rotated = false;
  const current = await readEnvAssignment(envFile, 'REPO_CONTEXT_MCP_AUTH_TOKEN');
  const hasRealToken =
    typeof current === 'string' &&
    current.length > 0 &&
    current !== PLACEHOLDER_MCP_TOKEN;
  if (!hasRealToken) {
    await upsertEnvVar(
      envFile,
      'REPO_CONTEXT_MCP_AUTH_TOKEN',
      randomBytes(32).toString('hex'),
    );
    rotated = true;
  }

  let restricted = false;
  if (!isWindowsPlatform()) {
    await chmod(envFile, 0o600);
    restricted = true;
  }

  return { rotated, restricted };
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
