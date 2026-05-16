import { describe, expect, it } from 'vitest';

import {
  DesktopContractError,
  FrontendError,
  IpcError,
  RendererError,
  exitCodeFor,
  serializeError,
  type ErrorCategory,
  type FrontendErrorOptions,
} from '../errors';

const CASES: Array<{
  ctor: new (message: string, opts: FrontendErrorOptions) => FrontendError;
  name: string;
  category: ErrorCategory;
}> = [
  { ctor: IpcError, name: 'IpcError', category: 'system' },
  {
    ctor: DesktopContractError,
    name: 'DesktopContractError',
    category: 'invariant',
  },
  { ctor: RendererError, name: 'RendererError', category: 'system' },
];

describe('FrontendError subclasses', () => {
  it.each(CASES)('constructs $name with typed fields', ({ ctor, name, category }) => {
    const err = new ctor('failed', {
      code: `${name.toUpperCase()}_CODE`,
      category,
      retryable: true,
      context: { action: 'test' },
    });

    expect(err).toBeInstanceOf(FrontendError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(name);
    expect(err.code).toBe(`${name.toUpperCase()}_CODE`);
    expect(err.category).toBe(category);
    expect(err.retryable).toBe(true);
    expect(err.context).toEqual({ action: 'test' });
  });

  it('constructs the root class and defaults retryable and context', () => {
    const err = new FrontendError('failed', {
      code: 'FRONTEND_FAILED',
      category: 'system',
    });

    expect(err).toBeInstanceOf(FrontendError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FrontendError');
    expect(err.code).toBe('FRONTEND_FAILED');
    expect(err.category).toBe('system');
    expect(err.retryable).toBe(false);
    expect(err.context).toEqual({});
  });
});

describe('serializeError', () => {
  it('serializes FrontendError cause chains', () => {
    const err = new IpcError('outer', {
      code: 'IPC_FAIL',
      category: 'system',
      retryable: true,
      context: { channel: 'desktop-shell:invoke' },
      cause: new Error('inner'),
    });

    expect(serializeError(err)).toMatchObject({
      name: 'IpcError',
      code: 'IPC_FAIL',
      category: 'system',
      retryable: true,
      message: 'outer',
      context: { channel: 'desktop-shell:invoke' },
      cause: {
        name: 'Error',
        code: null,
        category: null,
        retryable: null,
        message: 'inner',
        cause: null,
      },
    });
  });

  it('terminates recursive cause cycles', () => {
    const err = new Error('cycle');
    err.cause = err;

    expect(serializeError(err)).toMatchObject({
      name: 'Error',
      message: 'cycle',
      cause: {
        name: 'Error',
        message: 'cycle',
        cause: null,
      },
    });
  });

  it.each([
    ['boom', 'boom'],
    [42, '42'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('serializes non-error value %s', (value, message) => {
    expect(serializeError(value)).toEqual({
      name: 'NonError',
      code: null,
      category: null,
      retryable: null,
      message,
      stack: '',
      cause: null,
    });
  });
});

describe('exitCodeFor', () => {
  it.each([
    [new IpcError('x', { code: 'IPC_FAIL', category: 'system' }), 70],
    [
      new DesktopContractError('x', {
        code: 'CONTRACT_INVALID',
        category: 'invariant',
      }),
      70,
    ],
    [new RendererError('x', { code: 'RENDERER_FAILED', category: 'system' }), 70],
    [
      new FrontendError('x', {
        code: 'CONFIG_MISSING',
        category: 'user',
      }),
      78,
    ],
    [new FrontendError('x', { code: 'BAD_INPUT', category: 'user' }), 64],
    [
      new FrontendError('x', {
        code: 'BRIDGE_UNAVAILABLE',
        category: 'external',
      }),
      69,
    ],
    [new Error('x'), 1],
    [null, 1],
  ])('maps %o to %i', (err, code) => {
    expect(exitCodeFor(err)).toBe(code);
  });
});
