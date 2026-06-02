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

describe('preload systemSettings bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue({ ok: true });
  });

  it('readSystemSettings invokes the standard action channel with no payload', async () => {
    const api = await loadApi();
    await api.readSystemSettings();
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'systemSettings.read',
    });
  });

  it('saveSystemSettings forwards the hash + config payload without injecting file paths', async () => {
    const api = await loadApi();
    const payload = { baseDefaultFileHash: 'h', config: { schema_version: 1 } };

    await api.saveSystemSettings(payload);

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'systemSettings.save',
      payload,
    });
    const sent = JSON.stringify(invoke.mock.calls.at(-1)?.[1]);
    expect(sent).not.toContain('platform.default.json');
    expect(sent).not.toContain('.platform-state');
  });

  it('restartTaskSail invokes the standard action channel with no payload', async () => {
    const api = await loadApi();
    await api.restartTaskSail();
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'systemSettings.restart',
    });
  });
});
