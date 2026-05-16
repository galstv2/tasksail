import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { flushLoggers } from '../../../../backend/platform/core/logger.js';

const isolatedLogDir = mkdtempSync(path.join(tmpdir(), `tasksail-vitest-logs-${process.pid}-`));

process.env.LOG_DIR = isolatedLogDir;

process.once('exit', () => {
  flushLoggers();
  rmSync(isolatedLogDir, { recursive: true, force: true });
});

afterEach(() => {
  flushLoggers();
  process.env.LOG_DIR = isolatedLogDir;
});
