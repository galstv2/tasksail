import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../pythonHelpers.js', () => ({
  planQmdSeeding: vi.fn(),
}));

import { flushLoggers } from '../../core/index.js';
import { planQmdSeeding } from '../pythonHelpers.js';
import { main } from '../qmdSeedDryRun.js';

const mockedPlanQmdSeeding = vi.mocked(planQmdSeeding);
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

describe('qmdSeedDryRun', () => {
  let logDir: string;
  let stderr = '';
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    vi.clearAllMocks();
    flushLoggers();
    for (const key of LOG_ENV_KEYS) {
      delete process.env[key];
    }
    logDir = mkdtempSync(path.join(tmpdir(), 'qmd-seed-dry-run-logs-'));
    process.env.LOG_DIR = logDir;
    stderr = '';
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    process.exitCode = 0;
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

  it('logs Python helper failures while preserving protocol stderr', async () => {
    mockedPlanQmdSeeding.mockRejectedValueOnce(new Error('helper failed'));

    await main(['--context-pack-dir', '/tmp/context-pack']);

    expect(mockedPlanQmdSeeding).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('Error: helper failed');

    const lines = readErrorLines(logDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      module: 'platform/context-pack/qmdSeedDryRun',
      msg: 'qmd.seed.dry.run.failed',
      err: {
        message: 'helper failed',
      },
      extra: {
        contextPackDir: '/tmp/context-pack',
        writePlan: false,
      },
    });
  });
});

function readErrorLines(logDir: string): Array<Record<string, unknown>> {
  const errorDir = path.join(logDir, 'error');
  return readdirSync(errorDir)
    .filter((entry) => entry.endsWith('.jsonl'))
    .flatMap((entry) => (
      readFileSync(path.join(errorDir, entry), 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    ));
}
