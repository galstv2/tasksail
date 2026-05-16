import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO_ROOT } from '../../../../electron/paths';
import type { LogEmitPayload } from '../../../shared/desktopContractLogging';

const REAL_LOG_DIR = path.join(REPO_ROOT, '.platform-state', 'logs');
const NOW = new Date('2026-05-12T14:23:01.482Z');
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

let emit: ReturnType<typeof vi.fn>;
let getBootstrapInfo: ReturnType<typeof vi.fn>;
let realLogSnapshot: Map<string, { mtimeMs: number; size: number }>;

beforeEach(() => {
  realLogSnapshot = snapshotRealLogs();
  emit = vi.fn(() => Promise.resolve({ ok: true }));
  getBootstrapInfo = vi.fn(() => Promise.resolve({
    appName: 'TaskSail',
    platform: 'test',
    logLevel: 'debug',
    rendererForwardLevel: 'debug',
    versions: { chrome: undefined, electron: undefined, node: 'test' },
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  installDesktopShellMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('renderer logger cross-cutting invariants', () => {
  it('emits complete schema payloads for every level', async () => {
    const { createLogger } = await importFreshLogger();
    const log = createLogger('src/renderer/cross');
    await Promise.resolve();

    log.debug('cross.debug');
    log.info('cross.info', {});
    log.warn('cross.warn', { value: 1 });
    log.error('cross.error', new Error('boom'));

    const lines = payloads();
    expect(lines.map((line) => line.level)).toEqual(['debug', 'info', 'warn', 'error']);
    for (const line of lines) {
      expect(new Set(BASE_KEYS.filter((key) => key in line))).toEqual(new Set(BASE_KEYS));
      expect(line.stack).toBe('renderer');
      expect(line.pid).toBe(0);
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

  it('drops reserved extra keys without overriding canonical fields', async () => {
    const { createLogger } = await importFreshLogger();

    createLogger('src/renderer/cross', { taskId: 'canonical' }).info('cross.info', {
      task_id: 'injected',
      msg: 'bad',
      safe: true,
    });

    expect(firstPayload()).toMatchObject({
      msg: 'cross.info',
      task_id: 'canonical',
      extra: { safe: true },
    });
  });

  it('filters below rendererForwardLevel after bootstrap resolves', async () => {
    getBootstrapInfo.mockImplementation(() => Promise.resolve({
      appName: 'TaskSail',
      platform: 'test',
      logLevel: 'debug',
      rendererForwardLevel: 'error',
      versions: { chrome: undefined, electron: undefined, node: 'test' },
    }));
    const { createLogger } = await importFreshLogger();
    const log = createLogger('src/renderer/cross');
    await Promise.resolve();

    log.debug('cross.debug');
    log.info('cross.info');
    log.warn('cross.warn');
    log.error('cross.error', new Error('boom'));

    expect(payloads()).toHaveLength(1);
    expect(firstPayload()).toMatchObject({ level: 'error', msg: 'cross.error' });
  });

  it('passes warn and error through to DevTools console.error', async () => {
    const { createLogger } = await importFreshLogger();
    const log = createLogger('src/renderer/cross');

    log.warn('cross.warn');
    log.error('cross.error', new Error('boom'));

    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('keeps child logger context isolated from the parent logger', async () => {
    const { createLogger } = await importFreshLogger();
    const parent = createLogger('src/renderer/cross');
    const child = parent.child({ taskId: 'task-1', agentId: 'dalton' });

    child.info('cross.child');
    parent.info('cross.parent');

    expect(payloads().map((line) => [line.msg, line.task_id, line.agent_id])).toEqual([
      ['cross.child', 'task-1', 'dalton'],
      ['cross.parent', null, null],
    ]);
  });
});

async function importFreshLogger(): Promise<typeof import('../logger')> {
  vi.resetModules();
  installDesktopShellMock();
  return import('../logger');
}

function installDesktopShellMock(): void {
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      log: { emit },
      getBootstrapInfo,
    },
  });
}

function firstPayload(): LogEmitPayload {
  return payloads()[0];
}

function payloads(): LogEmitPayload[] {
  return emit.mock.calls.map((call) => call[0] as LogEmitPayload);
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
