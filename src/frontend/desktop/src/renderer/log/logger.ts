import type { LogEmitPayload, LogLevel } from '../../shared/desktopContractLogging';
import { serializeError } from '../../shared/errors';

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

type RendererLogConfig = {
  logLevel: LogLevel;
  rendererForwardLevel: LogLevel;
};

const FALLBACK_CONFIG: RendererLogConfig = {
  logLevel: 'info',
  rendererForwardLevel: 'info',
};

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

let activeConfig = FALLBACK_CONFIG;
let bootstrapPromise: Promise<void> | undefined;

// DevTools pass-through: renderer logs also go to IPC, but operators need live browser visibility.
const devToolsConsoleError = console.error.bind(console);

export function createLogger(module: string, ctx: LogContext = {}): Logger {
  ensureBootstrapConfig();
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

function ensureBootstrapConfig(): void {
  if (bootstrapPromise) return;

  bootstrapPromise = window.desktopShell.getBootstrapInfo()
    .then((info) => {
      activeConfig = {
        logLevel: normalizeLevel(info.logLevel, FALLBACK_CONFIG.logLevel),
        rendererForwardLevel: normalizeLevel(
          info.rendererForwardLevel,
          normalizeLevel(info.logLevel, FALLBACK_CONFIG.logLevel),
        ),
      };
    })
    .catch(() => undefined);
}

function emit(
  module: string,
  ctx: LogContext,
  level: LogLevel,
  msg: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[activeConfig.rendererForwardLevel]) {
    return;
  }

  const payload = buildPayload(module, ctx, level, msg, err, extra);
  void window.desktopShell.log.emit(payload).catch(() => undefined);

  if (level === 'warn' || level === 'error') {
    devToolsConsoleError(msg, err ?? extra ?? '');
  }
}

function buildPayload(
  module: string,
  ctx: LogContext,
  level: LogLevel,
  msg: string,
  err: unknown,
  extra?: Record<string, unknown>,
): LogEmitPayload {
  const payload: LogEmitPayload = {
    ts: new Date().toISOString(),
    level,
    stack: 'renderer',
    module,
    msg,
    // Renderer has no OS process id; main-process validation accepts 0 as the sentinel.
    pid: 0,
    task_id: ctx.taskId ?? null,
    agent_id: ctx.agentId ?? null,
    provider_id: ctx.providerId ?? null,
    span_id: ctx.spanId ?? null,
  };

  if (err !== undefined) {
    payload.err = serializeError(err);
  }

  const cleanExtra = sanitizeExtra(extra);
  if (cleanExtra) {
    payload.extra = cleanExtra;
  }

  return payload;
}

function sanitizeExtra(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extra) return undefined;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!RESERVED_KEYS.has(key)) {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function normalizeLevel(value: unknown, fallback: LogLevel): LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : fallback;
}

function isPlainExtra(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !(value instanceof Error);
}
