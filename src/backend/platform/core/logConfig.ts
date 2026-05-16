import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from './env.js';
import { findRepoRoot, logsDir } from './paths.js';

export interface LogConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
  dir: string;
  maxBytes: number;
  retentionDays: number;
}

const DEFAULT_LEVEL: LogConfig['level'] = 'info';
const DEFAULT_FORMAT: LogConfig['format'] = 'json';
const DEFAULT_MAX_BYTES = 52_428_800;
const DEFAULT_RETENTION_DAYS = 30;

const LOG_LEVELS = new Set<LogConfig['level']>([
  'debug',
  'info',
  'warn',
  'error',
]);

const LOG_FORMATS = new Set<LogConfig['format']>(['json', 'text']);

export function loadLogConfig(repoRoot?: string): LogConfig {
  const effectiveRepoRoot = resolveLogRepoRoot(repoRoot);
  const env = effectiveRepoRoot === undefined
    ? readProcessLogEnv()
    : readLogEnv(effectiveRepoRoot);
  const level = readEnum(env, 'LOG_LEVEL', LOG_LEVELS, DEFAULT_LEVEL);
  const format = readEnum(env, 'LOG_FORMAT', LOG_FORMATS, DEFAULT_FORMAT);

  return {
    level,
    format,
    dir: env.get('LOG_DIR') ?? logsDir(effectiveRepoRoot),
    maxBytes: readPositiveInteger(env, 'TASKSAIL_LOG_MAX_BYTES', DEFAULT_MAX_BYTES),
    retentionDays: readPositiveInteger(env, 'TASKSAIL_LOG_RETENTION_DAYS', DEFAULT_RETENTION_DAYS),
  };
}

function resolveLogRepoRoot(repoRoot?: string): string | undefined {
  if (repoRoot !== undefined) {
    return repoRoot;
  }

  try {
    return findRepoRoot();
  } catch (error) {
    if (process.env.LOG_DIR !== undefined) {
      return undefined;
    }
    throw error;
  }
}

function readLogEnv(repoRoot: string): Map<string, string> {
  const parsed = new Map<string, string>();
  const envPath = path.join(repoRoot, '.env');

  try {
    if (existsSync(envPath)) {
      for (const [key, value] of parseEnv(readFileSync(envPath, 'utf-8'))) {
        parsed.set(key, value);
      }
    }
  } catch {
    parsed.clear();
  }

  applyProcessLogEnv(parsed);

  return parsed;
}

function readProcessLogEnv(): Map<string, string> {
  const parsed = new Map<string, string>();
  applyProcessLogEnv(parsed);
  return parsed;
}

function applyProcessLogEnv(parsed: Map<string, string>): void {
  for (const key of [
    'LOG_LEVEL',
    'LOG_FORMAT',
    'LOG_DIR',
    'TASKSAIL_LOG_MAX_BYTES',
    'TASKSAIL_LOG_RETENTION_DAYS',
  ]) {
    const value = process.env[key];
    if (value !== undefined) {
      parsed.set(key, value);
    }
  }
}

function readEnum<T extends string>(
  env: Map<string, string>,
  key: string,
  allowed: Set<T>,
  fallback: T,
): T {
  const value = env.get(key)?.toLowerCase();
  return value && allowed.has(value as T) ? (value as T) : fallback;
}

function readPositiveInteger(
  env: Map<string, string>,
  key: string,
  fallback: number,
): number {
  const value = env.get(key);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
