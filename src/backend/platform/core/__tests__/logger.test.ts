import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ContainerError } from '../errors.js';
import {
  createLogger,
  flushLoggers,
  installProcessHandlers,
  newSpanId,
} from '../logger.js';

const LOG_ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'LOG_DIR',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  LOG_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const NOW = new Date('2026-05-12T14:23:01.482Z');
const DATE_STAMP = '20260512';
const ORIGINAL_CWD = process.cwd();

let logDir: string;
let uninstallProcessHandlers: (() => void) | undefined;
let stderrWrite: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logDir = mkdtempSync(path.join(tmpdir(), 'logger-test-'));
  for (const key of LOG_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.LOG_DIR = logDir;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  flushLoggers();
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  uninstallProcessHandlers?.();
  uninstallProcessHandlers = undefined;
  stderrWrite.mockRestore();
  vi.useRealTimers();
  flushLoggers();
  rmSync(logDir, { recursive: true, force: true });
  for (const key of LOG_ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('createLogger', () => {
  it('writes one info line to the info split file', () => {
    createLogger('platform/test').info('event.info');

    expect(readLevel('info')).toHaveLength(1);
    expect(readLevel('warn')).toHaveLength(0);
    expect(readLevel('error')).toHaveLength(0);
  });

  it('writes one warn line to the warn split file', () => {
    createLogger('platform/test').warn('event.warn');

    expect(readLevel('info')).toHaveLength(0);
    expect(readLevel('warn')).toHaveLength(1);
    expect(readLevel('error')).toHaveLength(0);
  });

  it('writes one error line to the error split file', () => {
    createLogger('platform/test').error('event.error', new Error('boom'));

    expect(readLevel('info')).toHaveLength(0);
    expect(readLevel('warn')).toHaveLength(0);
    expect(readLevel('error')).toHaveLength(1);
  });

  it('suppresses info and debug under LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    const logger = createLogger('platform/test');

    logger.debug('event.debug');
    logger.info('event.info');
    logger.warn('event.warn');

    expect(readLevel('info')).toHaveLength(0);
    expect(readLevel('warn')).toHaveLength(1);
  });

  it('writes debug lines to the info file when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';

    createLogger('platform/test').debug('event.debug');

    expect(readLevel('info')).toMatchObject([{ level: 'debug' }]);
  });

  it('fans out task and agent context to the per-task shard', () => {
    createLogger('platform/test')
      .child({ taskId: 't1', agentId: 'a1' })
      .warn('event.warn');

    expect(readLevel('warn')).toHaveLength(1);
    expect(readShard('t1', 'a1')).toMatchObject([{ msg: 'event.warn' }]);
  });

  it('writes all levels to the unified per-task shard', () => {
    process.env.LOG_LEVEL = 'debug';
    const logger = createLogger('platform/test').child({ taskId: 't1', agentId: 'a1' });

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
    createLogger('platform/test').info('event.info', { value: 1 });

    expect(readLevel('info')[0]).toMatchObject({
      ts: NOW.toISOString(),
      level: 'info',
      stack: 'ts',
      module: 'platform/test',
      msg: 'event.info',
      pid: process.pid,
      task_id: null,
      agent_id: null,
      provider_id: null,
      span_id: null,
      extra: { value: 1 },
    });
  });

  it('serializes error envelopes for actual error values', () => {
    createLogger('platform/test').error(
      'event.error',
      new ContainerError('boom', { code: 'X', category: 'external' }),
    );

    expect(readLevel('error')[0].err).toMatchObject({
      name: 'ContainerError',
      code: 'X',
      category: 'external',
    });
  });

  it('treats plain objects passed to error as extra', () => {
    createLogger('platform/test').error('event.error', { extra1: 1 });

    const line = readLevel('error')[0];
    expect(line.err).toBeUndefined();
    expect(line.extra).toEqual({ extra1: 1 });
  });

  it('drops reserved keys from extra', () => {
    createLogger('platform/test').info('event.info', {
      msg: 'override',
      extra1: 1,
      level: 'error',
    });

    expect(readLevel('info')[0]).toMatchObject({
      msg: 'event.info',
      level: 'info',
      extra: { extra1: 1 },
    });
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('[logger] dropped reserved extra key(s):'),
    );
  });

  it('does not mutate parent context when creating a child logger', () => {
    const parent = createLogger('platform/test', { taskId: 'parent' });
    const child = parent.child({ taskId: 'child', agentId: 'a1' });

    child.info('event.child');
    parent.info('event.parent');

    expect(readLevel('info').map((line) => line.task_id)).toEqual([
      'child',
      'parent',
    ]);
  });

  it('rotates level-split files when the max byte threshold is exceeded', () => {
    process.env.TASKSAIL_LOG_MAX_BYTES = '512';
    const logger = createLogger('platform/test');

    for (let i = 0; i < 50; i += 1) {
      logger.info('event.info', { i, payload: 'x'.repeat(20) });
    }

    expect(existsSync(path.join(logDir, 'info', `backend-ts-${DATE_STAMP}.1.jsonl`))).toBe(true);
  });

  it('prunes old jsonl files on first writer initialization', () => {
    process.env.TASKSAIL_LOG_RETENTION_DAYS = '1';
    const oldFile = path.join(logDir, 'info', 'backend-ts-20200101.jsonl');
    mkdirSync(path.dirname(oldFile), { recursive: true });
    writeFileSync(oldFile, '{}\n');
    const oldDate = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(oldFile, oldDate, oldDate);

    createLogger('platform/test').info('event.info');

    expect(existsSync(oldFile)).toBe(false);
  });

  it('honors LOG_DIR from repo .env when process.env.LOG_DIR is unset', () => {
    delete process.env.LOG_DIR;
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'logger-env-repo-'));
    const envLogDir = mkdtempSync(path.join(tmpdir(), 'logger-env-logs-'));
    const subdir = path.join(repoRoot, 'src', 'backend');

    try {
      mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
      mkdirSync(subdir, { recursive: true });
      writeFileSync(path.join(repoRoot, '.env'), `LOG_DIR=${envLogDir}\n`);
      process.chdir(subdir);

      createLogger('platform/test').info('event.info');

      expect(readJsonLines(path.join(envLogDir, 'info', `backend-ts-${DATE_STAMP}.jsonl`))).toHaveLength(1);
      expect(existsSync(path.join(repoRoot, '.platform-state', 'logs'))).toBe(false);
    } finally {
      process.chdir(ORIGINAL_CWD);
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(envLogDir, { recursive: true, force: true });
    }
  });
});

describe('installProcessHandlers', () => {
  it('logs unhandled rejections before exiting', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    uninstallProcessHandlers = installProcessHandlers('platform/process-test');

    process.emit('unhandledRejection', 'boom', Promise.resolve());

    expect(readLevel('error')[0]).toMatchObject({
      msg: 'process.unhandled_rejection',
      err: { name: 'NonError', message: 'boom' },
    });
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });

  it('is idempotent when installed twice', () => {
    const before = process.listenerCount('unhandledRejection');
    uninstallProcessHandlers = installProcessHandlers('platform/process-test');
    installProcessHandlers('platform/process-test');

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

function readLevel(level: 'info' | 'warn' | 'error'): Array<Record<string, unknown>> {
  return readJsonLines(path.join(logDir, level, `backend-ts-${DATE_STAMP}.jsonl`));
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
