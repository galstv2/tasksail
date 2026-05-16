import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  logsDir,
  logFile,
  taskAgentLogFile,
  logFileWithSuffix,
} from '../paths.js';

const ORIGINAL_LOG_DIR = process.env.LOG_DIR;

beforeEach(() => {
  delete process.env.LOG_DIR;
});

afterEach(() => {
  if (ORIGINAL_LOG_DIR === undefined) {
    delete process.env.LOG_DIR;
  } else {
    process.env.LOG_DIR = ORIGINAL_LOG_DIR;
  }
});

describe('log path resolvers', () => {
  it('returns the backend level-split log file path', () => {
    expect(logFile('ts', 'info', new Date('2026-05-12T14:23:01.482Z'), '/repo')).toBe(
      path.join('/repo', '.platform-state', 'logs', 'info', 'backend-ts-20260512.jsonl'),
    );
  });

  it('formats log dates in UTC', () => {
    expect(logFile('py', 'warn', new Date('2026-05-12T23:30:00.000-02:00'), '/repo')).toBe(
      path.join('/repo', '.platform-state', 'logs', 'warn', 'backend-py-20260513.jsonl'),
    );
  });

  it('returns the per-task agent log file path', () => {
    expect(taskAgentLogFile('20260512t142301z_x', 'dalton', '/repo')).toBe(
      path.join('/repo', '.platform-state', 'logs', 'agent', '20260512t142301z_x', 'dalton.jsonl'),
    );
  });

  it('adds rotation suffixes before the jsonl extension', () => {
    expect(logFileWithSuffix('/x/y.jsonl', 1)).toBe('/x/y.1.jsonl');
  });

  it('respects LOG_DIR for all log path resolvers', () => {
    process.env.LOG_DIR = path.join('/tmp', 'logs');

    expect(logsDir('/repo')).toBe(path.join('/tmp', 'logs'));
    expect(logFile('ts', 'error', new Date('2026-05-12T14:23:01.482Z'), '/repo')).toBe(
      path.join('/tmp', 'logs', 'error', 'backend-ts-20260512.jsonl'),
    );
    expect(taskAgentLogFile('task-1', 'agent-1', '/repo')).toBe(
      path.join('/tmp', 'logs', 'agent', 'task-1', 'agent-1.jsonl'),
    );
  });
});
