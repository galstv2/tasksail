// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { loadFrontendLogConfig } from '../logConfig';

const ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
  'LOG_RENDERER_FORWARD_LEVEL',
] as const;

describe('frontend log config', () => {
  const originalEnv = new Map<string, string | undefined>(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = originalEnv.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  it('returns defaults when no env is set', () => {
    for (const key of ENV_KEYS) delete process.env[key];

    expect(loadFrontendLogConfig()).toEqual({
      level: 'info',
      rendererForwardLevel: 'info',
      format: 'json',
      maxBytes: 52_428_800,
      retentionDays: 30,
    });
  });

  it('normalizes uppercase LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'DEBUG';

    expect(loadFrontendLogConfig().level).toBe('debug');
  });

  it('falls back to info for invalid LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'verbose';

    expect(loadFrontendLogConfig().level).toBe('info');
  });

  it('falls back to 30 for non-numeric retention days', () => {
    process.env.TASKSAIL_LOG_RETENTION_DAYS = 'soon';

    expect(loadFrontendLogConfig().retentionDays).toBe(30);
  });

  it('defaults rendererForwardLevel to the resolved level', () => {
    process.env.LOG_LEVEL = 'warn';
    delete process.env.LOG_RENDERER_FORWARD_LEVEL;

    expect(loadFrontendLogConfig().rendererForwardLevel).toBe('warn');
  });
});
