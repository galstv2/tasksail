// @vitest-environment node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO_ROOT } from '../../paths';
import type { IpcError as IpcErrorType } from '../../../src/shared/errors';
import type { ForeignLogLine } from '../logger';

type LoggerModule = typeof import('../logger');

const appMock = vi.hoisted(() => ({
  exit: vi.fn(),
  isPackaged: false,
  getPath: vi.fn(() => '/fake/logs'),
}));

vi.mock('electron', () => ({
  app: appMock,
}));

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
let uninstallProcessHandlers: (() => void) | undefined;
let realLogSnapshot: Map<string, { mtimeMs: number; size: number }>;
let acceptForeignLine: LoggerModule['acceptForeignLine'];
let createLogger: LoggerModule['createLogger'];
let flushLoggers: LoggerModule['flushLoggers'] | undefined;
let installProcessHandlers: LoggerModule['installProcessHandlers'];
let newSpanId: LoggerModule['newSpanId'];
let IpcError: typeof IpcErrorType;

beforeEach(async () => {
  realLogSnapshot = snapshotRealLogs();
  logDir = mkdtempSync(path.join(tmpdir(), 'electron-logger-test-'));
  for (const key of LOG_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.LOG_DIR = logDir;
  vi.resetModules();
  ({ IpcError } = await import('../../../src/shared/errors'));
  ({
    acceptForeignLine,
    createLogger,
    flushLoggers,
    installProcessHandlers,
    newSpanId,
  } = await import('../logger'));
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  flushLoggers?.();
  appMock.exit.mockClear();
  appMock.isPackaged = false;
  appMock.getPath.mockReturnValue('/fake/logs');
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  uninstallProcessHandlers?.();
  uninstallProcessHandlers = undefined;
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

describe('createLogger', () => {
  it('writes one info line to the info split file', () => {
    createLogger('electron/test').info('event.info');

    expect(readLevel('electron', 'info')).toHaveLength(1);
    expect(readLevel('electron', 'warn')).toHaveLength(0);
    expect(readLevel('electron', 'error')).toHaveLength(0);
  });

  it('writes one warn line to the warn split file', () => {
    createLogger('electron/test').warn('event.warn');

    expect(readLevel('electron', 'info')).toHaveLength(0);
    expect(readLevel('electron', 'warn')).toHaveLength(1);
    expect(readLevel('electron', 'error')).toHaveLength(0);
  });

  it('writes one error line to the error split file', () => {
    createLogger('electron/test').error('event.error', new Error('boom'));

    expect(readLevel('electron', 'info')).toHaveLength(0);
    expect(readLevel('electron', 'warn')).toHaveLength(0);
    expect(readLevel('electron', 'error')).toHaveLength(1);
  });

  it('suppresses info and debug under LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    const logger = createLogger('electron/test');

    logger.debug('event.debug');
    logger.info('event.info');
    logger.warn('event.warn');

    expect(readLevel('electron', 'info')).toHaveLength(0);
    expect(readLevel('electron', 'warn')).toHaveLength(1);
  });

  it('writes debug lines to the info file when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';

    createLogger('electron/test').debug('event.debug');

    expect(readLevel('electron', 'info')).toMatchObject([{ level: 'debug' }]);
  });

  it('fans out task and agent context to the per-task shard', () => {
    createLogger('electron/test')
      .child({ taskId: 't1', agentId: 'a1' })
      .warn('event.warn');

    expect(readLevel('electron', 'warn')).toHaveLength(1);
    expect(readShard('t1', 'a1')).toMatchObject([{ msg: 'event.warn' }]);
  });

  it('writes all levels to the unified per-task shard', () => {
    process.env.LOG_LEVEL = 'debug';
    const logger = createLogger('electron/test').child({ taskId: 't1', agentId: 'a1' });

    logger.debug('event.debug');
    logger.info('event.info');
    logger.warn('event.warn');
    logger.error('event.error', new Error('boom'));

    expect(readShard('t1', 'a1').map((line) => line.level)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
    ]);
  });

  it('emits canonical schema fields with null context defaults', () => {
    createLogger('electron/test').info('event.info', { value: 1 });

    expect(readLevel('electron', 'info')[0]).toMatchObject({
      ts: NOW.toISOString(),
      level: 'info',
      stack: 'electron',
      module: 'electron/test',
      msg: 'event.info',
      pid: process.pid,
      task_id: null,
      agent_id: null,
      provider_id: null,
      span_id: null,
      extra: { value: 1 },
    });
  });

  it('uses the electron stack on main logger lines', () => {
    createLogger('electron/test').info('event.info');

    expect(readLevel('electron', 'info')[0].stack).toBe('electron');
  });

  it('serializes frontend error envelopes for actual error values', () => {
    createLogger('electron/test').error(
      'event.error',
      new IpcError('boom', { code: 'X', category: 'system' }),
    );

    expect(readLevel('electron', 'error')[0].err).toMatchObject({
      name: 'IpcError',
      code: 'X',
      category: 'system',
    });
  });

  it('treats plain objects passed to error as extra', () => {
    createLogger('electron/test').error('event.error', { extra1: 1 });

    const line = readLevel('electron', 'error')[0];
    expect(line.err).toBeUndefined();
    expect(line.extra).toEqual({ extra1: 1 });
  });

  it('drops reserved keys from extra', () => {
    createLogger('electron/test').info('event.info', {
      msg: 'override',
      extra1: 1,
      level: 'error',
    });

    expect(readLevel('electron', 'info')[0]).toMatchObject({
      msg: 'event.info',
      level: 'info',
      extra: { extra1: 1 },
    });
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('[logger] dropped reserved extra key(s):'),
    );
  });

  it('does not mutate parent context when creating a child logger', () => {
    const parent = createLogger('electron/test', { taskId: 'parent' });
    const child = parent.child({ taskId: 'child', agentId: 'a1' });

    child.info('event.child');
    parent.info('event.parent');

    expect(readLevel('electron', 'info').map((line) => line.task_id)).toEqual([
      'child',
      'parent',
    ]);
  });

  it('rotates level-split files when the max byte threshold is exceeded', () => {
    process.env.TASKSAIL_LOG_MAX_BYTES = '512';
    const logger = createLogger('electron/test');

    for (let i = 0; i < 50; i += 1) {
      logger.info('event.info', { i, payload: 'x'.repeat(20) });
    }

    expect(
      existsSync(path.join(logDir, 'info', `frontend-electron-${DATE_STAMP}.1.jsonl`)),
    ).toBe(true);
  });

  it('prunes old jsonl files on first writer initialization', () => {
    process.env.TASKSAIL_LOG_RETENTION_DAYS = '1';
    const oldFile = path.join(logDir, 'info', 'frontend-electron-20200101.jsonl');
    mkdirSync(path.dirname(oldFile), { recursive: true });
    writeFileSync(oldFile, '{}\n');
    const oldDate = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(oldFile, oldDate, oldDate);

    createLogger('electron/test').info('event.info');

    expect(existsSync(oldFile)).toBe(false);
  });
});

describe('installProcessHandlers', () => {
  it('logs unhandled rejections before exiting', () => {
    uninstallProcessHandlers = installProcessHandlers();
    const err = new IpcError('boom', { code: 'X', category: 'system' });
    const promise = Promise.reject(err);
    promise.catch(() => undefined);

    process.emit('unhandledRejection', err, promise);

    expect(readLevel('electron', 'error')[0]).toMatchObject({
      msg: 'process.unhandled_rejection',
      err: { name: 'IpcError', message: 'boom' },
    });
    expect(appMock.exit).toHaveBeenCalledWith(70);
  });

  it('ignores terminal stdio EIO and EPIPE errors', () => {
    uninstallProcessHandlers = installProcessHandlers();
    const stderrError = new Error('write EIO') as NodeJS.ErrnoException;
    stderrError.code = 'EIO';
    const stdoutError = new Error('write EPIPE') as NodeJS.ErrnoException;
    stdoutError.code = 'EPIPE';

    process.stderr.emit('error', stderrError);
    process.stdout.emit('error', stdoutError);

    expect(appMock.exit).not.toHaveBeenCalled();
    expect(readLevel('electron', 'error')).toHaveLength(0);
  });

  it('is idempotent when installed twice', () => {
    const before = process.listenerCount('unhandledRejection');
    uninstallProcessHandlers = installProcessHandlers();
    installProcessHandlers();

    expect(process.listenerCount('unhandledRejection')).toBe(before + 1);
  });
});

describe('newSpanId', () => {
  it('returns RFC-4122 v4 UUIDs', () => {
    expect(newSpanId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(newSpanId()).toHaveLength(36);
  });
});

describe('acceptForeignLine', () => {
  it('writes renderer lines to renderer split files', () => {
    acceptForeignLine(rendererLine({ msg: 'renderer.event' }));

    expect(readLevel('renderer', 'info')).toMatchObject([
      { msg: 'renderer.event', stack: 'renderer' },
    ]);
    expect(readLevel('electron', 'info')).toHaveLength(0);
  });

  it('preserves renderer-stamped fields verbatim', () => {
    acceptForeignLine(
      rendererLine({
        ts: '2026-05-12T01:02:03.004Z',
        pid: 0,
        module: 'src/renderer/log/logger',
      }),
    );

    expect(readLevel('renderer', 'info')[0]).toMatchObject({
      ts: '2026-05-12T01:02:03.004Z',
      pid: 0,
      module: 'src/renderer/log/logger',
    });
  });

  it('fans renderer task and agent context out to the per-task shard', () => {
    acceptForeignLine(rendererLine({ task_id: 't1', agent_id: 'a1' }));

    expect(readShard('t1', 'a1')).toMatchObject([
      { stack: 'renderer', task_id: 't1', agent_id: 'a1' },
    ]);
  });
});

function rendererLine(overrides: Partial<ForeignLogLine> = {}): ForeignLogLine {
  return {
    ts: NOW.toISOString(),
    level: 'info',
    stack: 'renderer',
    module: 'src/renderer/test',
    msg: 'renderer.info',
    pid: 0,
    task_id: null,
    agent_id: null,
    provider_id: null,
    span_id: null,
    ...overrides,
  };
}

function readLevel(
  source: 'electron' | 'renderer',
  level: 'info' | 'warn' | 'error',
): Array<Record<string, unknown>> {
  return readJsonLines(path.join(logDir, level, `frontend-${source}-${DATE_STAMP}.jsonl`));
}

function readShard(taskId: string, agentId: string): Array<Record<string, unknown>> {
  return readJsonLines(path.join(logDir, 'agent', taskId, `${agentId}.jsonl`));
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
