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
import type { ForeignLogLine } from '../logger';

type LoggerModule = typeof import('../logger');
type IpcErrorType = typeof import('../../../src/shared/errors').IpcError;

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
const BASE_KEYS = [
  'ts',
  'level',
  'stack',
  'module',
  'msg',
  'pid',
  'task_id',
  'agent_id',
  'provider_id',
  'span_id',
];
const NOW = new Date('2026-05-12T14:23:01.482Z');
const REAL_LOG_DIR = path.join(REPO_ROOT, '.platform-state', 'logs');

let logDir: string;
let realLogSnapshot: Map<string, { mtimeMs: number; size: number }>;
let uninstallProcessHandlers: (() => void) | undefined;
let acceptForeignLine: LoggerModule['acceptForeignLine'];
let createLogger: LoggerModule['createLogger'];
let flushLoggers: LoggerModule['flushLoggers'] | undefined;
let installProcessHandlers: LoggerModule['installProcessHandlers'];
let newSpanId: LoggerModule['newSpanId'];
let IpcError: IpcErrorType;

beforeEach(async () => {
  realLogSnapshot = snapshotRealLogs();
  logDir = mkdtempSync(path.join(tmpdir(), `electron-logger-cross-${process.pid}-`));
  for (const key of LOG_ENV_KEYS) delete process.env[key];
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
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('electron logger cross-cutting invariants', () => {
  it('emits complete schema fields for every level with optional keys only when applicable', () => {
    process.env.LOG_LEVEL = 'debug';
    const log = createLogger('electron/cross');

    log.debug('cross.debug');
    log.info('cross.info', {});
    log.warn('cross.warn', { value: 1 });
    log.error('cross.error', new Error('boom'));

    const lines = [
      ...readLevel('electron', 'info'),
      ...readLevel('electron', 'warn'),
      ...readLevel('electron', 'error'),
    ];
    expect(lines.map((line) => line.level)).toEqual(['debug', 'info', 'warn', 'error']);
    for (const line of lines) {
      expect(new Set(BASE_KEYS.filter((key) => key in line))).toEqual(new Set(BASE_KEYS));
      expect(line.stack).toBe('electron');
      expect(line.task_id).toBeNull();
      expect(line.agent_id).toBeNull();
      expect(line.provider_id).toBeNull();
      expect(line.span_id).toBeNull();
    }
    expect(lines[0]).not.toHaveProperty('err');
    expect(lines[1]).not.toHaveProperty('extra');
    expect(lines[2]).toMatchObject({ extra: { value: 1 } });
    expect(lines[3].err).toMatchObject({ name: 'Error', message: 'boom' });
  });

  it('preserves renderer stack and routes foreign lines to renderer files', () => {
    acceptForeignLine(rendererLine({
      ts: '2026-05-12T01:02:03.004Z',
      module: 'src/renderer/cross',
      msg: 'renderer.cross',
    }));

    expect(readLevel('renderer', 'info')[0]).toMatchObject({
      ts: '2026-05-12T01:02:03.004Z',
      stack: 'renderer',
      module: 'src/renderer/cross',
    });
    expect(readLevel('electron', 'info')).toHaveLength(0);
  });

  it('drops reserved extra keys without overriding canonical fields', () => {
    createLogger('electron/cross', { taskId: 'canonical' }).info('cross.info', {
      task_id: 'injected',
      msg: 'bad',
      safe: true,
    });

    expect(readLevel('electron', 'info')[0]).toMatchObject({
      msg: 'cross.info',
      task_id: 'canonical',
      extra: { safe: true },
    });
  });

  it('writes byte-identical fan-out lines to level file and task shard', () => {
    createLogger('electron/cross', { taskId: 'task-1', agentId: 'dalton' })
      .error('cross.error', new Error('boom'));

    expect(readRawLevel('error')[0]).toBe(readRawShard('task-1', 'dalton')[0]);
  });

  it('keeps logger instances and child context isolated by module', () => {
    const a = createLogger('electron/a').child({ taskId: 'task-a' });
    const b = createLogger('electron/b');

    a.info('same.event');
    b.info('same.event');

    const [left, right] = readLevel('electron', 'info');
    expect(left).toMatchObject({ module: 'electron/a', task_id: 'task-a' });
    expect(right).toMatchObject({ module: 'electron/b', task_id: null });
  });

  it('exits with EX_SOFTWARE for uncaught IpcError system failures', () => {
    uninstallProcessHandlers = installProcessHandlers();
    process.emit(
      'uncaughtException',
      new IpcError('boom', { code: 'IPC_FAILED', category: 'system' }),
    );

    expect(appMock.exit).toHaveBeenCalledWith(70);
    expect(readLevel('electron', 'error')[0]).toMatchObject({
      msg: 'process.uncaught_exception',
      err: { name: 'IpcError', code: 'IPC_FAILED', category: 'system' },
    });
  });

  it('generates unique UUID v4 span ids', () => {
    const ids = Array.from({ length: 100 }, () => newSpanId());
    expect(new Set(ids)).toHaveLength(100);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});

function rendererLine(overrides: Partial<ForeignLogLine> = {}): ForeignLogLine {
  return {
    ts: NOW.toISOString(),
    level: 'info',
    stack: 'renderer',
    module: 'src/renderer/cross',
    msg: 'renderer.info',
    pid: 0,
    task_id: null,
    agent_id: null,
    provider_id: null,
    span_id: null,
    ...overrides,
  };
}

function readLevel(source: 'electron' | 'renderer', level: 'info' | 'warn' | 'error'): Array<Record<string, unknown>> {
  return readRaw(path.join(logDir, level, `frontend-${source}-${dateStamp(NOW)}.jsonl`))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readRawLevel(level: 'info' | 'warn' | 'error'): string[] {
  return readRaw(path.join(logDir, level, `frontend-electron-${dateStamp(NOW)}.jsonl`));
}

function readRawShard(taskId: string, agentId: string): string[] {
  return readRaw(path.join(logDir, 'agent', taskId, `${agentId}.jsonl`));
}

function readRaw(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
}

function dateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function snapshotRealLogs(): Map<string, { mtimeMs: number; size: number }> {
  const snapshot = new Map<string, { mtimeMs: number; size: number }>();
  if (!existsSync(REAL_LOG_DIR)) return snapshot;
  for (const filePath of walkFiles(REAL_LOG_DIR)) {
    const stat = statSync(filePath);
    snapshot.set(path.relative(REAL_LOG_DIR, filePath), { mtimeMs: stat.mtimeMs, size: stat.size });
  }
  return snapshot;
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files.sort();
}
