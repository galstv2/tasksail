export type FrontendLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface FrontendLogConfig {
  level: FrontendLogLevel;
  rendererForwardLevel: FrontendLogLevel;
  format: 'json' | 'text';
  maxBytes: number;
  retentionDays: number;
}

const DEFAULT_LEVEL: FrontendLogLevel = 'info';
const DEFAULT_FORMAT: FrontendLogConfig['format'] = 'json';
const DEFAULT_MAX_BYTES = 52_428_800;
const DEFAULT_RETENTION_DAYS = 30;
const LOG_LEVELS = new Set<FrontendLogLevel>([
  'debug',
  'info',
  'warn',
  'error',
]);
const LOG_FORMATS = new Set<FrontendLogConfig['format']>(['json', 'text']);

export function loadFrontendLogConfig(): FrontendLogConfig {
  const level = normalizeLogLevel(process.env.LOG_LEVEL, DEFAULT_LEVEL);

  return {
    level,
    rendererForwardLevel: normalizeLogLevel(
      process.env.LOG_RENDERER_FORWARD_LEVEL,
      level,
    ),
    format: normalizeLogFormat(process.env.LOG_FORMAT),
    maxBytes: normalizePositiveInteger(
      process.env.TASKSAIL_LOG_MAX_BYTES,
      DEFAULT_MAX_BYTES,
    ),
    retentionDays: normalizePositiveInteger(
      process.env.TASKSAIL_LOG_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
    ),
  };
}

function normalizeLogLevel(
  value: string | undefined,
  fallback: FrontendLogLevel,
): FrontendLogLevel {
  const normalized = value?.toLowerCase();
  return normalized && LOG_LEVELS.has(normalized as FrontendLogLevel)
    ? (normalized as FrontendLogLevel)
    : fallback;
}

function normalizeLogFormat(
  value: string | undefined,
): FrontendLogConfig['format'] {
  const normalized = value?.toLowerCase();
  return normalized && LOG_FORMATS.has(normalized as FrontendLogConfig['format'])
    ? (normalized as FrontendLogConfig['format'])
    : DEFAULT_FORMAT;
}

function normalizePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
