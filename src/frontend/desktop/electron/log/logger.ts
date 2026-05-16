import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { exitCodeFor, serializeError } from '../../src/shared/errors';
import { loadFrontendLogConfig, type FrontendLogConfig } from './logConfig';
import {
  frontendLogFile,
  frontendLogFileWithSuffix,
  frontendLogsDir,
  frontendTaskAgentLogFile,
} from './logPaths';

export interface LogContext {
  taskId?: string | null;
  agentId?: string | null;
  providerId?: string | null;
  spanId?: string | null;
}

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, errOrExtra?: unknown, extra?: Record<string, unknown>): void;
  child(ctx: Partial<LogContext>): Logger;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type WriteLevel = 'info' | 'warn' | 'error';

export interface ForeignLogLine {
  ts: string;
  level: LogLevel;
  stack: 'renderer';
  module: string;
  msg: string;
  pid: number;
  task_id: string | null;
  agent_id: string | null;
  provider_id: string | null;
  span_id: string | null;
  err?: unknown;
  extra?: Record<string, unknown>;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const RESERVED_KEYS = new Set([
  'ts',
  'level',
  'stack',
  'module',
  'msg',
  'pid',
  'task_id',
  'agent_id',
  'provider_id',
  'span_id',
  'err',
  'extra',
]);

let ensuredDirs = new Set<string>();
let rotationCache = new Map<string, string>();
let warnedReservedKeys = new Set<string>();
let retentionPruned = false;
let installedHandlers:
  | {
      uncaught: (err: Error) => void;
      rejection: (reason: unknown) => void;
    }
  | undefined;

export function createLogger(module: string, ctx: LogContext = {}): Logger {
  const context = { ...ctx };

  return {
    debug: (msg, extra) => emit(module, context, 'debug', msg, undefined, extra),
    info: (msg, extra) => emit(module, context, 'info', msg, undefined, extra),
    warn: (msg, extra) => emit(module, context, 'warn', msg, undefined, extra),
    error: (msg, errOrExtra, extra) => {
      if (isPlainExtra(errOrExtra)) {
        emit(module, context, 'error', msg, undefined, errOrExtra);
        return;
      }
      emit(module, context, 'error', msg, errOrExtra, extra);
    },
    child: (ctx) => createLogger(module, { ...context, ...ctx }),
  };
}

export function installProcessHandlers(): () => void {
  if (installedHandlers) {
    return uninstallProcessHandlers;
  }

  const logger = createLogger('electron/process');
  const uncaught = (err: Error): void => {
    logger.error('process.uncaught_exception', err);
    app.exit(exitCodeFor(err));
  };
  const rejection = (reason: unknown): void => {
    logger.error('process.unhandled_rejection', reason);
    app.exit(exitCodeFor(reason));
  };

  process.on('uncaughtException', uncaught);
  process.on('unhandledRejection', rejection);
  installedHandlers = { uncaught, rejection };
  return uninstallProcessHandlers;
}

export function newSpanId(): string {
  return randomUUID();
}

export function flushLoggers(): void {
  ensuredDirs = new Set();
  rotationCache = new Map();
  warnedReservedKeys = new Set();
  retentionPruned = false;
}

export function acceptForeignLine(line: ForeignLogLine): void {
  const config = loadFrontendLogConfig();
  pruneRetention(config);
  const raw = `${JSON.stringify(line)}\n`;
  writeLine(
    raw,
    new Date(line.ts),
    'renderer',
    line.level,
    line.task_id,
    line.agent_id,
    config,
  );

  if (line.level === 'warn' || line.level === 'error') {
    process.stderr.write(raw);
  }
}

function uninstallProcessHandlers(): void {
  if (!installedHandlers) {
    return;
  }

  process.off('uncaughtException', installedHandlers.uncaught);
  process.off('unhandledRejection', installedHandlers.rejection);
  installedHandlers = undefined;
}

function emit(
  module: string,
  ctx: LogContext,
  level: LogLevel,
  msg: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  const config = loadFrontendLogConfig();
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[config.level]) {
    return;
  }

  pruneRetention(config);
  const date = new Date();
  const line = buildLine(module, ctx, level, msg, date, err, extra);
  const raw = `${JSON.stringify(line)}\n`;
  writeLine(raw, date, 'electron', level, line.task_id, line.agent_id, config);

  if (level === 'warn' || level === 'error') {
    process.stderr.write(raw);
  }
}

function buildLine(
  module: string,
  ctx: LogContext,
  level: LogLevel,
  msg: string,
  date: Date,
  err: unknown,
  extra?: Record<string, unknown>,
): Record<string, unknown> & { task_id: string | null; agent_id: string | null } {
  const line: Record<string, unknown> & {
    task_id: string | null;
    agent_id: string | null;
  } = {
    ts: date.toISOString(),
    level,
    stack: 'electron',
    module,
    msg,
    pid: process.pid,
    task_id: ctx.taskId ?? null,
    agent_id: ctx.agentId ?? null,
    provider_id: ctx.providerId ?? null,
    span_id: ctx.spanId ?? null,
  };

  if (err !== undefined) {
    line.err = serializeError(err);
  }

  const cleanExtra = sanitizeExtra(extra);
  if (cleanExtra) {
    line.extra = cleanExtra;
  }

  return line;
}

function sanitizeExtra(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extra) {
    return undefined;
  }

  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (RESERVED_KEYS.has(key)) {
      dropped.push(key);
      continue;
    }
    clean[key] = value;
  }

  warnDroppedKeys(dropped);
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function warnDroppedKeys(keys: string[]): void {
  const newKeys = keys.filter((key) => !warnedReservedKeys.has(key));
  if (newKeys.length === 0) {
    return;
  }

  for (const key of newKeys) {
    warnedReservedKeys.add(key);
  }
  process.stderr.write(`[logger] dropped reserved extra key(s): ${newKeys.join(',')}\n`);
}

function writeLine(
  raw: string,
  date: Date,
  source: 'electron' | 'renderer',
  level: LogLevel,
  taskId: string | null,
  agentId: string | null,
  config: FrontendLogConfig,
): void {
  const writeLevel: WriteLevel = level === 'debug' ? 'info' : level;
  const basePath = frontendLogFile(source, writeLevel, date);
  appendSafely(resolveRotatedPath(basePath, config.maxBytes), raw);

  if (taskId && agentId) {
    appendSafely(frontendTaskAgentLogFile(taskId, agentId), raw);
  }
}

function resolveRotatedPath(basePath: string, maxBytes: number): string {
  const cached = rotationCache.get(basePath);
  if (cached && !isOverLimit(cached, maxBytes)) {
    return cached;
  }

  if (!isOverLimit(basePath, maxBytes)) {
    rotationCache.set(basePath, basePath);
    return basePath;
  }

  for (let suffix = 1; ; suffix += 1) {
    const candidate = frontendLogFileWithSuffix(basePath, suffix);
    if (!existsSync(candidate) || !isOverLimit(candidate, maxBytes)) {
      rotationCache.set(basePath, candidate);
      return candidate;
    }
  }
}

function isOverLimit(filePath: string, maxBytes: number): boolean {
  try {
    return statSync(filePath).size > maxBytes;
  } catch {
    return false;
  }
}

function appendSafely(filePath: string, raw: string): void {
  try {
    ensureParent(filePath);
    appendFileSync(filePath, raw, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[logger] write-failed path=${filePath}: ${message}\n`);
  }
}

function ensureParent(filePath: string): void {
  const dir = path.dirname(filePath);
  if (ensuredDirs.has(dir)) {
    return;
  }
  mkdirSync(dir, { recursive: true });
  ensuredDirs.add(dir);
}

function pruneRetention(config: FrontendLogConfig): void {
  if (retentionPruned) {
    return;
  }
  retentionPruned = true;

  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  pruneDir(frontendLogsDir(), cutoff);
}

function pruneDir(dir: string, cutoff: number): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pruneDir(fullPath, cutoff);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          rmSync(fullPath, { force: true });
        }
      }
    }
  } catch {
    return;
  }
}

function isPlainExtra(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !(value instanceof Error);
}
