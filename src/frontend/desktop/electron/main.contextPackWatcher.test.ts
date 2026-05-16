// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const watchMock = vi.hoisted(() => vi.fn());
const readdirMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: watchMock,
}));

vi.mock('node:fs/promises', () => ({
  readdir: readdirMock,
}));

type WatchCallback = (eventType: string, filename: string | Buffer | null) => void;

describe('main.contextPackWatcher', () => {
  let callbacks: WatchCallback[];
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    callbacks = [];
    closeMock = vi.fn();
    watchMock.mockReset();
    readdirMock.mockReset();
    watchMock.mockImplementation((_root, _options, callback: WatchCallback) => {
      callbacks.push(callback);
      return {
        on: vi.fn(),
        close: closeMock,
      };
    });
  });

  afterEach(async () => {
    const { stopContextPackCatalogWatcher } = await import('./main.contextPackWatcher');
    stopContextPackCatalogWatcher();
    vi.useRealTimers();
  });

  it('ignores pack-writer lock and atomic temp-file watcher noise', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const onChange = vi.fn();
    const { startContextPackCatalogWatcher } = await import('./main.contextPackWatcher');

    startContextPackCatalogWatcher({
      catalogRoots: ['/repo/contextpacks'],
      onChange,
    });

    callbacks[0]('change', 'demo/.pack-writer.lock');
    callbacks[0]('rename', 'demo/qmd/.repo-sources.json.abc123.tmp');
    vi.advanceTimersByTime(600);

    expect(onChange).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();

    debugSpy.mockRestore();
  });

  it('still emits one debounced event for real catalog file changes', async () => {
    const onChange = vi.fn();
    const { startContextPackCatalogWatcher } = await import('./main.contextPackWatcher');

    startContextPackCatalogWatcher({
      catalogRoots: ['/repo/contextpacks'],
      onChange,
    });

    callbacks[0]('rename', 'demo/qmd/.repo-sources.json.abc123.tmp');
    callbacks[0]('change', 'demo/qmd/repo-sources.json');
    callbacks[0]('change', 'demo/workspace-counts.json');
    vi.advanceTimersByTime(600);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      changedRoot: '/repo/contextpacks',
      reason: 'unknown',
    });
  });

  it('skips missing catalog roots and keeps watching readable roots', async () => {
    const infoSpy = vi.fn();
    vi.doMock('./log/logger', () => ({
      createLogger: () => ({
        debug: vi.fn(),
        info: infoSpy,
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    }));
    const onChange = vi.fn();
    watchMock.mockImplementation((root, _options, callback: WatchCallback) => {
      if (root === '/repo/missing-contextpacks') {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      callbacks.push(callback);
      return {
        on: vi.fn(),
        close: closeMock,
      };
    });
    const { startContextPackCatalogWatcher } = await import('./main.contextPackWatcher');

    startContextPackCatalogWatcher({
      catalogRoots: ['/repo/missing-contextpacks', '/repo/contextpacks'],
      onChange,
    });

    expect(infoSpy).toHaveBeenCalledWith('context-pack.watcher.skipped', {
      root: '/repo/missing-contextpacks',
      reason: 'missing-root',
    });
    expect(watchMock).toHaveBeenCalledTimes(2);
    expect(callbacks).toHaveLength(1);
    vi.doUnmock('./log/logger');
  });

  it('propagates non-missing catalog root watch failures', async () => {
    const onChange = vi.fn();
    watchMock.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    const { startContextPackCatalogWatcher } = await import('./main.contextPackWatcher');

    expect(() => startContextPackCatalogWatcher({
      catalogRoots: ['/repo/contextpacks'],
      onChange,
    })).toThrow('denied');
  });

  it('logs a structured error before propagating non-missing watch failures', async () => {
    const errorSpy = vi.fn();
    vi.doMock('./log/logger', () => ({
      createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: errorSpy,
        child: vi.fn(),
      }),
    }));
    const onChange = vi.fn();
    watchMock.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    const { startContextPackCatalogWatcher } = await import('./main.contextPackWatcher');

    expect(() => startContextPackCatalogWatcher({
      catalogRoots: ['/repo/contextpacks'],
      onChange,
    })).toThrow('denied');
    expect(errorSpy).toHaveBeenCalledWith(
      'context-pack.watcher.start.failed',
      expect.any(Error),
      { root: '/repo/contextpacks' },
    );
    vi.doUnmock('./log/logger');
  });
});
