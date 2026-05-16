export type ErrorCategory = 'user' | 'system' | 'external' | 'invariant';

export interface FrontendErrorOptions {
  code: string;
  category: ErrorCategory;
  retryable?: boolean;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export class FrontendError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;

  constructor(message: string, opts: FrontendErrorOptions) {
    super(message, { cause: opts.cause });
    this.name = new.target?.name ?? 'FrontendError';
    this.code = opts.code;
    this.category = opts.category;
    this.retryable = opts.retryable ?? false;
    this.context = opts.context ?? {};
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}

export class IpcError extends FrontendError {}
export class DesktopContractError extends FrontendError {}
export class RendererError extends FrontendError {}

export interface ErrorEnvelope {
  name: string;
  code: string | null;
  category: ErrorCategory | null;
  retryable: boolean | null;
  message: string;
  stack: string;
  context?: Record<string, unknown>;
  cause: ErrorEnvelope | null;
}

export function serializeError(err: unknown): ErrorEnvelope {
  return serializeErrorInner(err, new Set<object>());
}

export function exitCodeFor(err: unknown): number {
  if (!(err instanceof FrontendError)) {
    return 1;
  }

  if (
    err.category === 'user' &&
    (err.code === 'CONFIG_MISSING' || err.code === 'CONFIG_INVALID')
  ) {
    return 78;
  }

  switch (err.category) {
    case 'user':
      return 64;
    case 'external':
      return 69;
    case 'system':
    case 'invariant':
      return 70;
  }
}

function serializeErrorInner(
  err: unknown,
  seen: Set<object>,
): ErrorEnvelope {
  if (err instanceof FrontendError) {
    const envelope = baseErrorEnvelope(err, {
      code: err.code,
      category: err.category,
      retryable: err.retryable,
    });
    envelope.context = err.context;
    envelope.cause = serializeCause(err, seen);
    return envelope;
  }

  if (err instanceof Error) {
    const envelope = baseErrorEnvelope(err, {
      code: null,
      category: null,
      retryable: null,
    });
    envelope.cause = serializeCause(err, seen);
    return envelope;
  }

  return {
    name: 'NonError',
    code: null,
    category: null,
    retryable: null,
    message: String(err),
    stack: '',
    cause: null,
  };
}

function baseErrorEnvelope(
  err: Error,
  fields: Pick<ErrorEnvelope, 'code' | 'category' | 'retryable'>,
): ErrorEnvelope {
  return {
    name: err.name,
    code: fields.code,
    category: fields.category,
    retryable: fields.retryable,
    message: err.message,
    stack: err.stack ?? '',
    cause: null,
  };
}

function serializeCause(err: Error, seen: Set<object>): ErrorEnvelope | null {
  if (seen.has(err)) {
    return null;
  }

  seen.add(err);
  return 'cause' in err && err.cause !== undefined
    ? serializeErrorInner(err.cause, seen)
    : null;
}
