// @vitest-environment node

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOG_EMIT_CHANNEL,
  logEmitValidationError,
  validateLogEmitPayload,
  type LogEmitPayload,
} from '../../../src/shared/desktopContractLogging';

type LoggerModule = typeof import('../logger');

const electronMock = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    exit: vi.fn(),
    isPackaged: false,
    getPath: vi.fn(() => '/fake/logs'),
  },
}));

vi.mock('electron', () => electronMock);

const LOG_ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'LOG_DIR',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
  'LOG_RENDERER_FORWARD_LEVEL',
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  LOG_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const NOW = new Date('2026-05-12T14:23:01.482Z');
const DATE_STAMP = '20260512';

let logDir: string;
let acceptForeignLineMock: ReturnType<typeof vi.fn>;
let flushLoggers: LoggerModule['flushLoggers'] | undefined;
let registeredHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined;

// Authorized sender event: senderFrame.url set to VITE_DEV_SERVER_URL origin so
// validateDesktopInvokeSender passes in dev mode.
function authorizedEvent(): { senderFrame: { url: string } } {
  return { senderFrame: { url: process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173' } };
}

// Unauthorized event: no frame / empty URL.
function unauthorizedEvent(): { senderFrame: { url: string } } {
  return { senderFrame: { url: 'file:///some/other/path/evil.html' } };
}

beforeEach(async () => {
  logDir = mkdtempSync(path.join(tmpdir(), 'electron-ipc-log-test-'));
  for (const key of LOG_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.LOG_DIR = logDir;
  // Force the sender auth to use dev-server URL validation (avoids needing a real dist dir).
  process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
  vi.resetModules();
  electronMock.ipcMain.handle.mockReset();
  electronMock.app.exit.mockClear();
  electronMock.app.isPackaged = false;
  electronMock.app.getPath.mockReturnValue('/fake/logs');
  acceptForeignLineMock = vi.fn();
  vi.doMock('../logger', async () => {
    const actual = await vi.importActual<LoggerModule>('../logger');
    return {
      ...actual,
      acceptForeignLine: acceptForeignLineMock,
    };
  });
  ({ flushLoggers } = await import('../logger'));
  const { registerIpcLogHandler } = await import('../ipcLogHandler');
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  registerIpcLogHandler();
  registeredHandler = electronMock.ipcMain.handle.mock.calls.at(0)?.[1] as
    | ((event: unknown, payload: unknown) => Promise<unknown>)
    | undefined;
});

afterEach(() => {
  vi.doUnmock('../logger');
  vi.restoreAllMocks();
  vi.useRealTimers();
  flushLoggers?.();
  rmSync(logDir, { recursive: true, force: true });
  delete process.env.VITE_DEV_SERVER_URL;
  for (const key of LOG_ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('log emit contract validation', () => {
  it('accepts a valid payload', () => {
    expect(validateLogEmitPayload(validPayload())).toBe(true);
    expect(logEmitValidationError(validPayload())).toBeNull();
  });

  it('rejects invalid payloads with specific reasons', () => {
    expect(logEmitValidationError({ ...validPayload(), ts: 'not-a-date' })).toContain('ts');
    expect(logEmitValidationError({ ...validPayload(), pid: Number.POSITIVE_INFINITY })).toContain('pid');
    expect(logEmitValidationError({ ...validPayload(), extra: [] })).toContain('extra');
    expect(logEmitValidationError({ ...validPayload(), err: { name: 'Error' } })).toContain('err');
  });
});

describe('registerIpcLogHandler', () => {
  it('registers the log emit channel', () => {
    expect(electronMock.ipcMain.handle).toHaveBeenCalledWith(
      LOG_EMIT_CHANNEL,
      expect.any(Function),
    );
  });

  it('passes valid payloads to acceptForeignLine and returns ok', async () => {
    const payload = validPayload();

    await expect(invoke(authorizedEvent(), payload)).resolves.toEqual({ ok: true });

    expect(acceptForeignLineMock).toHaveBeenCalledWith(payload);
  });

  it('rejects missing task_id and emits a drop warn line', async () => {
    const { task_id: _taskId, ...payload } = validPayload();

    await expect(invoke(authorizedEvent(), payload)).resolves.toMatchObject({ ok: false });

    expect(readLevel('warn')[0]).toMatchObject({
      msg: 'ipc.log.emit.drop',
      extra: { reason: 'payload.task_id is required.' },
    });
    expect(acceptForeignLineMock).not.toHaveBeenCalled();
  });

  it('rejects non-renderer stack values', async () => {
    await expect(invoke(authorizedEvent(), { ...validPayload(), stack: 'electron' })).resolves.toMatchObject({
      ok: false,
      reason: 'payload.stack must be renderer.',
    });
  });

  it('rejects invalid levels', async () => {
    await expect(invoke(authorizedEvent(), { ...validPayload(), level: 'verbose' })).resolves.toMatchObject({
      ok: false,
      reason: 'payload.level must be debug, info, warn, or error.',
    });
  });

  it('rejects invalid timestamps', async () => {
    await expect(invoke(authorizedEvent(), { ...validPayload(), ts: 'bad-time' })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects invalid pid values', async () => {
    await expect(invoke(authorizedEvent(), { ...validPayload(), pid: Number.NaN })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects invalid extra values', async () => {
    await expect(invoke(authorizedEvent(), { ...validPayload(), extra: null })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects incomplete error envelopes', async () => {
    await expect(invoke(authorizedEvent(), { ...validPayload(), err: { name: 'Error' } })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('preserves task and agent fields on accepted payloads', async () => {
    const payload = validPayload({ task_id: 't1', agent_id: 'a1' });

    await invoke(authorizedEvent(), payload);

    expect(acceptForeignLineMock).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 't1', agent_id: 'a1' }),
    );
  });

  it('catches acceptForeignLine failures and emits a drop warn', async () => {
    acceptForeignLineMock.mockImplementation(() => {
      throw new Error('writer failed');
    });

    await expect(invoke(authorizedEvent(), validPayload())).resolves.toEqual({
      ok: false,
      reason: 'writer failed',
    });

    expect(readLevel('warn')[0]).toMatchObject({
      msg: 'ipc.log.emit.drop',
      extra: { reason: 'writer failed' },
    });
  });

  it('does not throw for validation failures', async () => {
    await expect(invoke(authorizedEvent(), { level: 'verbose' })).resolves.toMatchObject({ ok: false });
  });
});

describe('sender authentication (RG-02-logipc)', () => {
  it('drops unauthorized sender and does not call acceptForeignLine', async () => {
    const result = await invoke(unauthorizedEvent(), validPayload());

    expect(result).toMatchObject({ ok: false });
    expect(acceptForeignLineMock).not.toHaveBeenCalled();
  });

  it('returns ok for authorized sender with valid payload', async () => {
    const result = await invoke(authorizedEvent(), validPayload());

    expect(result).toEqual({ ok: true });
    expect(acceptForeignLineMock).toHaveBeenCalledTimes(1);
  });

  it('unauthorized sender response carries a reason string', async () => {
    const result = await invoke(unauthorizedEvent(), validPayload()) as { ok: boolean; reason?: string };

    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});

describe('rate limiting (RG-02-logipc)', () => {
  it('allows up to the max and drops excess within the same window', async () => {
    const MAX = 60;
    // Send exactly MAX — all should succeed.
    for (let i = 0; i < MAX; i++) {
      const result = await invoke(authorizedEvent(), validPayload()) as { ok: boolean };
      expect(result.ok).toBe(true);
    }
    // Send one more — must be dropped.
    const overflow = await invoke(authorizedEvent(), validPayload()) as { ok: boolean; reason?: string };
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toContain('rate limit');
    // acceptForeignLine called exactly MAX times — not for the overflow.
    expect(acceptForeignLineMock).toHaveBeenCalledTimes(MAX);
  });

  it('resets the window after IPC_RATE_LIMIT_WINDOW_MS', async () => {
    const MAX = 60;
    // Exhaust the window.
    for (let i = 0; i < MAX + 1; i++) {
      await invoke(authorizedEvent(), validPayload());
    }
    // Advance time past the window.
    vi.advanceTimersByTime(1001);
    // First call in new window must succeed.
    const result = await invoke(authorizedEvent(), validPayload()) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it('emits at most one rate-limit warning per window (bounded output)', async () => {
    const MAX = 60;
    // Exhaust the window and send multiple excess calls.
    for (let i = 0; i < MAX + 5; i++) {
      await invoke(authorizedEvent(), validPayload());
    }
    // Rate-limit warn lines must be exactly 1 (warn once per window).
    const warnLines = readLevel('warn').filter((l) => l.msg === 'ipc.log.emit.rate_limit');
    expect(warnLines.length).toBe(1);
  });

  it('does not call acceptForeignLine for dropped excess calls', async () => {
    const MAX = 60;
    for (let i = 0; i < MAX + 3; i++) {
      await invoke(authorizedEvent(), validPayload());
    }
    // Only the first MAX calls should have reached acceptForeignLine.
    expect(acceptForeignLineMock).toHaveBeenCalledTimes(MAX);
  });

  it('rate-limit drop returns { ok: false, reason } — preserves response shape', async () => {
    const MAX = 60;
    for (let i = 0; i < MAX; i++) {
      await invoke(authorizedEvent(), validPayload());
    }
    const result = await invoke(authorizedEvent(), validPayload()) as { ok: boolean; reason?: string };
    expect(result).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});

async function invoke(event: unknown, payload: unknown): Promise<unknown> {
  if (!registeredHandler) throw new Error('IPC handler was not registered.');
  return registeredHandler(event, payload);
}

function validPayload(overrides: Partial<LogEmitPayload> = {}): LogEmitPayload {
  return {
    ts: '2026-05-12T14:23:01.482Z',
    level: 'info',
    stack: 'renderer',
    module: 'src/renderer/log/logger',
    msg: 'renderer.info',
    pid: 0,
    task_id: null,
    agent_id: null,
    provider_id: null,
    span_id: null,
    ...overrides,
  };
}

function readLevel(level: 'info' | 'warn' | 'error'): Array<Record<string, unknown>> {
  return readJsonLines(path.join(logDir, level, `frontend-electron-${DATE_STAMP}.jsonl`));
}

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
