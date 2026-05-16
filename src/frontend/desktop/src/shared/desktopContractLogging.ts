export const LOG_EMIT_CHANNEL = 'log:emit' as const;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type RendererStack = 'renderer';

export interface LogEmitPayload {
  ts: string;
  level: LogLevel;
  stack: RendererStack;
  module: string;
  msg: string;
  pid: number;
  task_id: string | null;
  agent_id: string | null;
  provider_id: string | null;
  span_id: string | null;
  err?: {
    name: string;
    code: string | null;
    category: string | null;
    retryable: boolean | null;
    message: string;
    stack: string;
    context?: Record<string, unknown>;
    cause: unknown | null;
  };
  extra?: Record<string, unknown>;
}

export type ValidLogEmitPayload = LogEmitPayload & {
  readonly _brand: 'ValidLogEmitPayload';
};

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export function validateLogEmitPayload(
  value: unknown,
): value is ValidLogEmitPayload {
  return logEmitValidationError(value) === null;
}

export function logEmitValidationError(value: unknown): string | null {
  if (!isRecord(value)) return 'payload must be an object.';
  if (!isValidTimestamp(value.ts)) return 'payload.ts must be a valid ISO-8601 timestamp.';
  if (!isOneOf(value.level, LOG_LEVELS)) return 'payload.level must be debug, info, warn, or error.';
  if (value.stack !== 'renderer') return 'payload.stack must be renderer.';
  if (!isNonEmptyString(value.module)) return 'payload.module must be a non-empty string.';
  if (typeof value.msg !== 'string') return 'payload.msg must be a string.';
  if (!isFiniteNumber(value.pid)) return 'payload.pid must be a finite number.';

  for (const field of ['task_id', 'agent_id', 'provider_id', 'span_id'] as const) {
    if (!(field in value)) return `payload.${field} is required.`;
    if (!isStringOrNull(value[field])) return `payload.${field} must be a string or null.`;
  }

  if (value.extra !== undefined && !isRecord(value.extra)) {
    return 'payload.extra must be an object when provided.';
  }

  if (value.err !== undefined) {
    const errMessage = validateErrorEnvelope(value.err);
    if (errMessage) return `payload.err ${errMessage}`;
  }

  return null;
}

function validateErrorEnvelope(value: unknown): string | null {
  if (!isRecord(value)) return 'must be an object when provided.';
  if (typeof value.name !== 'string') return 'must include string name.';
  if (!isStringOrNull(value.code)) return 'must include string or null code.';
  if (!isStringOrNull(value.category)) return 'must include string or null category.';
  if (!isBooleanOrNull(value.retryable)) return 'must include boolean or null retryable.';
  if (typeof value.message !== 'string') return 'must include string message.';
  if (typeof value.stack !== 'string') return 'must include string stack.';
  if (!('cause' in value)) return 'must include cause.';
  if (value.context !== undefined && !isRecord(value.context)) {
    return 'context must be an object when provided.';
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return typeof value === 'boolean' || value === null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(new Date(value).getTime());
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === 'string' && allowed.includes(value as T[number]);
}
