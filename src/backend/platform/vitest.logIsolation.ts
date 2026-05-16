import { afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { flushLoggers } from './core/logger.js';

const isolatedLogDir = mkdtempSync(path.join(tmpdir(), `tasksail-vitest-logs-${process.pid}-`));

process.env.LOG_DIR = isolatedLogDir;

process.once('exit', () => {
  rmSync(isolatedLogDir, { recursive: true, force: true });
});

afterEach(() => {
  flushLoggers();
  process.env.LOG_DIR = isolatedLogDir;
});
