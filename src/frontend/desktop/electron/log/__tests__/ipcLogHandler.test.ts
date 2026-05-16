// @vitest-environment node

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO_ROOT } from '../../paths';
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
const REAL_LOG_DIR = path.join(REPO_ROOT, '.platform-state', 'logs');

let logDir: string;
let realLogSnapshot: Map<string, { mtimeMs: number; size: number }>;
let acceptForeignLineMock: ReturnType<typeof vi.fn>;
let flushLoggers: LoggerModule['flushLoggers'] | undefined;
let registeredHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined;

beforeEach(async () => {
  realLogSnapshot = snapshotRealLogs();
  logDir = mkdtempSync(path.join(tmpdir(), 'electron-ipc-log-test-'));
  for (const key of LOG_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.LOG_DIR = logDir;
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
  for (const key of LOG_ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
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

    await expect(invoke(payload)).resolves.toEqual({ ok: true });

    expect(acceptForeignLineMock).toHaveBeenCalledWith(payload);
  });

  it('rejects missing task_id and emits a drop warn line', async () => {
    const { task_id: _taskId, ...payload } = validPayload();

    await expect(invoke(payload)).resolves.toMatchObject({ ok: false });

    expect(readLevel('warn')[0]).toMatchObject({
      msg: 'ipc.log.emit.drop',
      extra: { reason: 'payload.task_id is required.' },
    });
    expect(acceptForeignLineMock).not.toHaveBeenCalled();
  });

  it('rejects non-renderer stack values', async () => {
    await expect(invoke({ ...validPayload(), stack: 'electron' })).resolves.toMatchObject({
      ok: false,
      reason: 'payload.stack must be renderer.',
    });
  });

  it('rejects invalid levels', async () => {
    await expect(invoke({ ...validPayload(), level: 'verbose' })).resolves.toMatchObject({
      ok: false,
      reason: 'payload.level must be debug, info, warn, or error.',
    });
  });

  it('rejects invalid timestamps', async () => {
    await expect(invoke({ ...validPayload(), ts: 'bad-time' })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects invalid pid values', async () => {
    await expect(invoke({ ...validPayload(), pid: Number.NaN })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects invalid extra values', async () => {
    await expect(invoke({ ...validPayload(), extra: null })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects incomplete error envelopes', async () => {
    await expect(invoke({ ...validPayload(), err: { name: 'Error' } })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('preserves task and agent fields on accepted payloads', async () => {
    const payload = validPayload({ task_id: 't1', agent_id: 'a1' });

    await invoke(payload);

    expect(acceptForeignLineMock).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 't1', agent_id: 'a1' }),
    );
  });

  it('catches acceptForeignLine failures and emits a drop warn', async () => {
    acceptForeignLineMock.mockImplementation(() => {
      throw new Error('writer failed');
    });

    await expect(invoke(validPayload())).resolves.toEqual({
      ok: false,
      reason: 'writer failed',
    });

    expect(readLevel('warn')[0]).toMatchObject({
      msg: 'ipc.log.emit.drop',
      extra: { reason: 'writer failed' },
    });
  });

  it('does not throw for validation failures', async () => {
    await expect(invoke({ level: 'verbose' })).resolves.toMatchObject({ ok: false });
  });
});

async function invoke(payload: unknown): Promise<unknown> {
  if (!registeredHandler) throw new Error('IPC handler was not registered.');
  return registeredHandler({}, payload);
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

function snapshotRealLogs(): Map<string, { mtimeMs: number; size: number }> {
  const snapshot = new Map<string, { mtimeMs: number; size: number }>();
  if (!existsSync(REAL_LOG_DIR)) {
    return snapshot;
  }

  for (const filePath of walkFiles(REAL_LOG_DIR)) {
    const stat = statSync(filePath);
    snapshot.set(path.relative(REAL_LOG_DIR, filePath), {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
  }
  return snapshot;
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}
