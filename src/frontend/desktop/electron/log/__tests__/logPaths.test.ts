// @vitest-environment node

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({
  isPackaged: false,
  getPath: vi.fn(() => '/fake/logs'),
}));

vi.mock('electron', () => ({
  app: appMock,
}));

describe('frontend log paths', () => {
  const originalLogDir = process.env.LOG_DIR;

  beforeEach(() => {
    vi.resetModules();
    appMock.isPackaged = false;
    appMock.getPath.mockReturnValue('/fake/logs');
    delete process.env.LOG_DIR;
  });

  afterEach(() => {
    if (originalLogDir === undefined) {
      delete process.env.LOG_DIR;
    } else {
      process.env.LOG_DIR = originalLogDir;
    }
  });

  it('resolves electron info files with UTC dates', async () => {
    const { frontendLogFile } = await import('../logPaths');

    const logFile = frontendLogFile(
      'electron',
      'info',
      new Date('2026-05-12T14:23:01.482Z'),
    );

    expect(logFile).toContain(path.join('info', 'frontend-electron-20260512.jsonl'));
  });

  it('formats dates in UTC', async () => {
    const { frontendLogFile } = await import('../logPaths');

    const logFile = frontendLogFile(
      'electron',
      'info',
      new Date('2026-05-12T23:59:59.999-10:00'),
    );

    expect(logFile).toContain('frontend-electron-20260513.jsonl');
  });

  it('uses the renderer prefix for renderer log files', async () => {
    const { frontendLogFile } = await import('../logPaths');

    const logFile = frontendLogFile(
      'renderer',
      'warn',
      new Date('2026-05-12T14:23:01.482Z'),
    );

    expect(logFile).toContain(path.join('warn', 'frontend-renderer-20260512.jsonl'));
  });

  it('resolves per-task agent shard files', async () => {
    const { frontendTaskAgentLogFile } = await import('../logPaths');

    expect(frontendTaskAgentLogFile('task1', 'dalton')).toContain(
      path.join('agent', 'task1', 'dalton.jsonl'),
    );
  });

  it('adds rotation suffixes before the jsonl extension', async () => {
    const { frontendLogFileWithSuffix } = await import('../logPaths');

    expect(frontendLogFileWithSuffix('/x/y.jsonl', 2)).toBe('/x/y.2.jsonl');
  });

  it('honors LOG_DIR over app packaging mode', async () => {
    process.env.LOG_DIR = '/tmp/tasksail-logs';
    appMock.isPackaged = true;
    const { frontendLogsDir, frontendLogFile } = await import('../logPaths');

    expect(frontendLogsDir()).toBe('/tmp/tasksail-logs');
    expect(frontendLogFile('electron', 'error', new Date('2026-05-12T00:00:00Z'))).toBe(
      path.join('/tmp/tasksail-logs', 'error', 'frontend-electron-20260512.jsonl'),
    );
    expect(appMock.getPath).not.toHaveBeenCalled();
  });
});
