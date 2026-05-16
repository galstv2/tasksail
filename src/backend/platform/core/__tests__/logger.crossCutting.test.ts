import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ContainerError,
  createLogger,
  flushLoggers,
  installProcessHandlers,
  newSpanId,
} from '../index.js';

const RESERVED_KEYS = [
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
] as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  flushLoggers();
  vi.restoreAllMocks();
});

describe('logger cross-cutting invariants', () => {
  it('emits complete reserved schema fields for every level', async () => {
    await withLogDir((logDir) => {
      process.env.LOG_LEVEL = 'debug';
      const logger = createLogger('platform/core/cross-cutting');

      logger.debug('event.debug');
      logger.info('event.info');
      logger.warn('event.warn');
      logger.error('event.error', new Error('boom'));

      const lines = readAllJsonLines(logDir);
      expect(lines.map((line) => line.level).sort()).toEqual(['debug', 'error', 'info', 'warn']);
      for (const line of lines) {
        expect(Object.keys(line)).toEqual(expect.arrayContaining([...RESERVED_KEYS]));
        expect(line.task_id).toBeNull();
        expect(line.agent_id).toBeNull();
        expect(line.provider_id).toBeNull();
        expect(line.span_id).toBeNull();
      }
    });
  });

  it('drops reserved keys from extra and warns once per process key', async () => {
    await withLogDir(() => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const logger = createLogger('platform/core/cross-cutting', { taskId: 'canonical-task' });

      logger.info('event.one', { task_id: 'bad-task', msg: 'bad-msg', ok: true });
      logger.info('event.two', { task_id: 'still-bad', msg: 'still-bad', ok: false });

      const lines = readAllJsonLines(process.env.LOG_DIR!);
      expect(lines[0]).toMatchObject({
        task_id: 'canonical-task',
        msg: 'event.one',
        extra: { ok: true },
      });
      expect(lines[0].extra).not.toHaveProperty('task_id');
      expect(lines[0].extra).not.toHaveProperty('msg');

      const warnings = stderr.mock.calls.flat().map(String).join('\n');
      expect(warnings.match(/\[logger\] dropped reserved extra key\(s\):/g)).toHaveLength(1);
    });
  });

  it('writes byte-identical JSON to the level file and per-task shard', async () => {
    await withLogDir((logDir) => {
      createLogger('platform/core/cross-cutting')
        .child({ taskId: 'task-1', agentId: 'dalton', providerId: 'copilot', spanId: 'span-1' })
        .error('event.error', new Error('boom'), { value: 1 });

      const levelLine = readRawLines(findLogFile(path.join(logDir, 'error'), 'backend-ts-'))[0];
      const shardLine = readRawLines(path.join(logDir, 'agent', 'task-1', 'dalton.jsonl'))[0];

      expect(shardLine).toBe(levelLine);
      expect(JSON.parse(shardLine!)).toEqual(JSON.parse(levelLine!));
    });
  });

  it('isolates module names and child context across logger instances', async () => {
    await withLogDir((logDir) => {
      const a = createLogger('platform/a').child({ taskId: 'task-a' });
      const b = createLogger('platform/b');

      a.info('event.shared');
      b.info('event.shared');

      const lines = readAllJsonLines(logDir).sort((left, right) => String(left.module).localeCompare(String(right.module)));
      expect(lines).toMatchObject([
        { module: 'platform/a', task_id: 'task-a', agent_id: null },
        { module: 'platform/b', task_id: null, agent_id: null },
      ]);
      expect(lines[1]).not.toHaveProperty('extra');
    });
  });

  it('maps uncaught ContainerError through process handlers to EX_UNAVAILABLE', async () => {
    await withLogDir((logDir) => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const uninstall = installProcessHandlers('platform/core/process-test');

      process.emit('uncaughtException', new ContainerError('container down', {
        code: 'CONTAINER_DOWN',
        category: 'external',
      }));

      uninstall();
      expect(exit).toHaveBeenCalledWith(69);
      expect(readAllJsonLines(logDir)[0]).toMatchObject({
        msg: 'process.uncaught_exception',
        err: {
          name: 'ContainerError',
          code: 'CONTAINER_DOWN',
          category: 'external',
        },
      });
    });
  });

  it('generates unique UUID v4 span ids', () => {
    const ids = Array.from({ length: 1000 }, () => newSpanId());

    expect(new Set(ids)).toHaveLength(1000);
    for (const id of ids) {
      expect(id).toMatch(UUID_V4);
    }
  });
});

async function withLogDir(fn: (logDir: string) => void | Promise<void>): Promise<void> {
  const logDir = mkdtempSync(path.join(tmpdir(), 'logger-cross-cutting-'));
  const previousLogDir = process.env.LOG_DIR;
  const previousLevel = process.env.LOG_LEVEL;
  const previousRetention = process.env.TASKSAIL_LOG_RETENTION_DAYS;
  try {
    process.env.LOG_DIR = logDir;
    delete process.env.LOG_LEVEL;
    delete process.env.TASKSAIL_LOG_RETENTION_DAYS;
    flushLoggers();
    await fn(logDir);
  } finally {
    flushLoggers();
    if (previousLogDir === undefined) {
      delete process.env.LOG_DIR;
    } else {
      process.env.LOG_DIR = previousLogDir;
    }
    if (previousLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLevel;
    }
    if (previousRetention === undefined) {
      delete process.env.TASKSAIL_LOG_RETENTION_DAYS;
    } else {
      process.env.TASKSAIL_LOG_RETENTION_DAYS = previousRetention;
    }
    rmSync(logDir, { recursive: true, force: true });
  }
}

function readAllJsonLines(logDir: string): Array<Record<string, unknown>> {
  return ['info', 'warn', 'error']
    .flatMap((level) => {
      const levelDir = path.join(logDir, level);
      if (!existsSync(levelDir)) {
        return [];
      }
      return readdirSync(levelDir)
        .filter((name) => name.endsWith('.jsonl'))
        .flatMap((name) => readRawLines(path.join(levelDir, name)));
    })
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readRawLines(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
}

function findLogFile(logDir: string, prefix: string): string {
  return path.join(logDir, readdirSync(logDir).find((name) => name.startsWith(prefix))!);
}
