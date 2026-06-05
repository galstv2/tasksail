// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DESKTOP_SHELL_INVOKE_CHANNEL } from '../src/shared/desktopContract';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

type DesktopApi = Record<string, (...args: unknown[]) => Promise<unknown>>;

async function loadApi(): Promise<DesktopApi> {
  const { exposeDesktopShell } = await import('./preload');
  exposeDesktopShell();
  const call = exposeInMainWorld.mock.calls.at(-1);
  return call?.[1] as DesktopApi;
}

describe('preload log explorer bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue({ ok: true });
  });

  it('listLogFiles invokes the standard action channel with no payload', async () => {
    const api = await loadApi();

    await api.listLogFiles();

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'logExplorer.listFiles',
    });
  });

  it('readLogFile forwards only allowed selector, paging, and filter fields', async () => {
    const api = await loadApi();

    await api.readLogFile({
      category: 'info',
      fileName: 'tasksail.jsonl',
      startLine: 10,
      beforeLine: 20,
      limit: 100,
      tail: false,
      levelFilter: 'debug',
      absolutePath: '/tmp/tasksail.jsonl',
      logRoot: '/tmp/logs',
      rootPath: '/tmp',
    });

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'logExplorer.readFile',
      payload: {
        category: 'info',
        fileName: 'tasksail.jsonl',
        startLine: 10,
        beforeLine: 20,
        limit: 100,
        tail: false,
        levelFilter: 'debug',
      },
    });
    expect(JSON.stringify(invoke.mock.calls.at(-1)?.[1])).not.toMatch(/absolutePath|logRoot|rootPath|\/tmp/u);
  });
});
