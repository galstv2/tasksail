import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadLogConfig } from '../logConfig.js';

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

let repoRoot: string;
const ORIGINAL_CWD = process.cwd();

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'log-config-test-'));
  for (const key of LOG_ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  rmSync(repoRoot, { recursive: true, force: true });
  for (const key of LOG_ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('loadLogConfig', () => {
  it('returns defaults when no env is set', () => {
    expect(loadLogConfig(repoRoot)).toEqual({
      level: 'info',
      format: 'json',
      dir: path.join(repoRoot, '.platform-state', 'logs'),
      maxBytes: 52_428_800,
      retentionDays: 30,
    });
  });

  it('accepts uppercase LOG_LEVEL and normalizes it', () => {
    writeFileSync(path.join(repoRoot, '.env'), 'LOG_LEVEL=DEBUG\n');

    expect(loadLogConfig(repoRoot).level).toBe('debug');
  });

  it('falls back to info for invalid LOG_LEVEL values', () => {
    writeFileSync(path.join(repoRoot, '.env'), 'LOG_LEVEL=verbose\n');

    expect(loadLogConfig(repoRoot).level).toBe('info');
  });

  it('falls back to 30 for non-numeric retention days', () => {
    writeFileSync(path.join(repoRoot, '.env'), 'TASKSAIL_LOG_RETENTION_DAYS=forever\n');

    expect(loadLogConfig(repoRoot).retentionDays).toBe(30);
  });

  it('lets process env override .env values', () => {
    writeFileSync(
      path.join(repoRoot, '.env'),
      [
        'LOG_LEVEL=warn',
        'LOG_FORMAT=text',
        'LOG_DIR=/from-file',
        'TASKSAIL_LOG_MAX_BYTES=12',
        'TASKSAIL_LOG_RETENTION_DAYS=7',
      ].join('\n'),
    );
    process.env.LOG_LEVEL = 'error';
    process.env.LOG_DIR = '/from-process';

    expect(loadLogConfig(repoRoot)).toEqual({
      level: 'error',
      format: 'text',
      dir: '/from-process',
      maxBytes: 12,
      retentionDays: 7,
    });
  });

  it('does not throw when .env parsing fails', () => {
    writeFileSync(path.join(repoRoot, '.env'), 'not-a-valid-line\n');

    expect(loadLogConfig(repoRoot).level).toBe('info');
  });

  it('reads the repository .env when called from a subdirectory without repoRoot', () => {
    const subdir = path.join(repoRoot, 'src', 'backend', 'platform', 'core');
    mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
    mkdirSync(subdir, { recursive: true });
    writeFileSync(path.join(repoRoot, '.env'), 'LOG_LEVEL=debug\n');
    process.chdir(subdir);

    expect(loadLogConfig()).toMatchObject({
      level: 'debug',
      dir: path.join(realpathSync(repoRoot), '.platform-state', 'logs'),
    });
  });

  it('uses process env LOG_DIR when repo discovery is unavailable', () => {
    const outsideRepo = mkdtempSync(path.join(tmpdir(), 'log-config-outside-repo-'));
    process.env.LOG_DIR = '/from-process';
    process.chdir(outsideRepo);

    try {
      expect(loadLogConfig()).toMatchObject({
        level: 'info',
        dir: '/from-process',
      });
    } finally {
      process.chdir(ORIGINAL_CWD);
      rmSync(outsideRepo, { recursive: true, force: true });
    }
  });
});
