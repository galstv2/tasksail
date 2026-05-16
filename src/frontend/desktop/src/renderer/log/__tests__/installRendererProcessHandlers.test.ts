import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let emit: ReturnType<typeof vi.fn>;
let getBootstrapInfo: ReturnType<typeof vi.fn>;
let cleanupHandlers: (() => void) | undefined;

beforeEach(() => {
  emit = vi.fn().mockResolvedValue({ ok: true });
  getBootstrapInfo = vi.fn().mockResolvedValue({
    appName: 'TaskSail',
    platform: 'test',
    logLevel: 'debug',
    rendererForwardLevel: 'debug',
    versions: { chrome: undefined, electron: undefined, node: 'test' },
  });
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      log: { emit },
      getBootstrapInfo,
    },
  });
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanupHandlers?.();
  cleanupHandlers = undefined;
  vi.restoreAllMocks();
});

describe('installRendererProcessHandlers', () => {
  it('logs window error events', async () => {
    const { installRendererProcessHandlers } = await import('../installRendererProcessHandlers');
    cleanupHandlers = installRendererProcessHandlers();

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'boom',
      error: new Error('boom'),
      filename: 'App.tsx',
      lineno: 10,
    }));

    expect(firstPayload()).toMatchObject({
      level: 'error',
      msg: 'renderer.uncaught.exception',
      extra: { filename: 'App.tsx', lineno: 10 },
    });
  });

  it('logs unhandled rejection events', async () => {
    const { installRendererProcessHandlers } = await import('../installRendererProcessHandlers');
    cleanupHandlers = installRendererProcessHandlers();

    window.dispatchEvent(rejectionEvent(new Error('boom')));

    expect(firstPayload()).toMatchObject({
      level: 'error',
      msg: 'renderer.unhandled.rejection',
    });
  });

  it('cleanup removes installed listeners', async () => {
    const { installRendererProcessHandlers } = await import('../installRendererProcessHandlers');
    cleanupHandlers = installRendererProcessHandlers();
    cleanupHandlers();
    cleanupHandlers = undefined;

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'boom',
    }));

    expect(emit).not.toHaveBeenCalled();
  });

  it('is idempotent while installed', async () => {
    const { installRendererProcessHandlers } = await import('../installRendererProcessHandlers');
    cleanupHandlers = installRendererProcessHandlers();
    installRendererProcessHandlers();

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'boom',
      error: new Error('boom'),
    }));

    expect(emit).toHaveBeenCalledTimes(1);
  });
});

function firstPayload(): Record<string, unknown> {
  return emit.mock.calls[0][0] as Record<string, unknown>;
}

function rejectionEvent(reason: unknown): Event {
  const event = new Event('unhandledrejection') as Event & {
    reason: unknown;
    promise: Promise<unknown>;
  };
  event.reason = reason;
  event.promise = Promise.resolve();
  return event;
}
