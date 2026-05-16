import { describe, expect, it } from 'vitest';
import {
  AgentRunError,
  ConfigError,
  ContainerError,
  ContextPackError,
  InvariantError,
  MCPError,
  PlatformError,
  QueueError,
  ValidationError,
  exitCodeFor,
  serializeError,
  type ErrorCategory,
  type PlatformErrorOptions,
} from '../errors.js';

const CASES: Array<{
  ctor: new (message: string, opts: PlatformErrorOptions) => PlatformError;
  name: string;
  category: ErrorCategory;
}> = [
  { ctor: ConfigError, name: 'ConfigError', category: 'user' },
  { ctor: ValidationError, name: 'ValidationError', category: 'user' },
  { ctor: ContainerError, name: 'ContainerError', category: 'external' },
  { ctor: MCPError, name: 'MCPError', category: 'external' },
  { ctor: AgentRunError, name: 'AgentRunError', category: 'system' },
  { ctor: QueueError, name: 'QueueError', category: 'system' },
  { ctor: ContextPackError, name: 'ContextPackError', category: 'system' },
  { ctor: InvariantError, name: 'InvariantError', category: 'invariant' },
];

describe('PlatformError subclasses', () => {
  it.each(CASES)('constructs $name with typed fields', ({ ctor, name, category }) => {
    const err = new ctor('failed', {
      code: `${name.toUpperCase()}_CODE`,
      category,
      retryable: true,
      context: { taskId: 'task-1' },
    });

    expect(err).toBeInstanceOf(PlatformError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(name);
    expect(err.code).toBe(`${name.toUpperCase()}_CODE`);
    expect(err.category).toBe(category);
    expect(err.retryable).toBe(true);
    expect(err.context).toEqual({ taskId: 'task-1' });
  });

  it('defaults retryable and context', () => {
    const err = new QueueError('queue failed', {
      code: 'QUEUE_FAILED',
      category: 'system',
    });

    expect(err.retryable).toBe(false);
    expect(err.context).toEqual({});
  });
});

describe('serializeError', () => {
  it('serializes PlatformError cause chains', () => {
    const err = new ContainerError('outer', {
      code: 'CONTAINER_FAILED',
      category: 'external',
      retryable: true,
      context: { container: 'repo-context' },
      cause: new Error('inner'),
    });

    expect(serializeError(err)).toMatchObject({
      name: 'ContainerError',
      code: 'CONTAINER_FAILED',
      category: 'external',
      retryable: true,
      message: 'outer',
      context: { container: 'repo-context' },
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
    [new ValidationError('x', { code: 'BAD_INPUT', category: 'user' }), 64],
    [new ConfigError('x', { code: 'CONFIG_MISSING', category: 'user' }), 78],
    [new ConfigError('x', { code: 'BAD_INPUT', category: 'user' }), 64],
    [new ContainerError('x', { code: 'CONTAINER_DOWN', category: 'external' }), 69],
    [new MCPError('x', { code: 'MCP_DOWN', category: 'external' }), 69],
    [new AgentRunError('x', { code: 'AGENT_FAILED', category: 'system' }), 70],
    [new QueueError('x', { code: 'QUEUE_FAILED', category: 'system' }), 70],
    [new ContextPackError('x', { code: 'PACK_FAILED', category: 'system' }), 70],
    [new InvariantError('x', { code: 'BUG', category: 'invariant' }), 70],
    [new Error('x'), 1],
    [null, 1],
  ])('maps %o to %i', (err, code) => {
    expect(exitCodeFor(err)).toBe(code);
  });
});
