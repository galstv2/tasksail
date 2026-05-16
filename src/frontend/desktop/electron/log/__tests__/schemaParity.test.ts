// @vitest-environment node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO_ROOT } from '../../paths';
import type { ForeignLogLine } from '../logger';

type FrontendLoggerModule = typeof import('../logger');
type BackendLoggerModule = typeof import('../../../../../backend/platform/core/logger.js');

const appMock = vi.hoisted(() => ({
  exit: vi.fn(),
  isPackaged: false,
  getPath: vi.fn(() => '/fake/logs'),
}));

vi.mock('electron', () => ({
  app: appMock,
}));

const LOG_ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'LOG_DIR',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
  'LOG_RENDERER_FORWARD_LEVEL',
] as const;
const ORIGINAL_ENV = new Map<string, string | undefined>(
  LOG_ENV_KEYS.map((key) => [key, process.env[key]]),
);
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
const RESERVED_KEYS = [...BASE_KEYS, 'err', 'extra'];
const REAL_LOG_DIR = path.join(REPO_ROOT, '.platform-state', 'logs');

let logDir: string;
let realLogSnapshot: Map<string, { mtimeMs: number; size: number }>;
let acceptForeignLine: FrontendLoggerModule['acceptForeignLine'];
let createElectronLogger: FrontendLoggerModule['createLogger'];
let flushElectronLoggers: FrontendLoggerModule['flushLoggers'] | undefined;
let createBackendLogger: BackendLoggerModule['createLogger'];
let flushBackendLoggers: BackendLoggerModule['flushLoggers'] | undefined;

beforeEach(async () => {
  realLogSnapshot = snapshotRealLogs();
  logDir = mkdtempSync(path.join(tmpdir(), `frontend-schema-parity-${process.pid}-`));
  for (const key of LOG_ENV_KEYS) delete process.env[key];
  process.env.LOG_DIR = logDir;
  vi.resetModules();
  ({
    acceptForeignLine,
    createLogger: createElectronLogger,
    flushLoggers: flushElectronLoggers,
  } = await import('../logger'));
  ({
    createLogger: createBackendLogger,
    flushLoggers: flushBackendLoggers,
  } = await import('../../../../../backend/platform/core/logger.js'));
  flushElectronLoggers?.();
  flushBackendLoggers?.();
  appMock.exit.mockClear();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  flushElectronLoggers?.();
  flushBackendLoggers?.();
  rmSync(logDir, { recursive: true, force: true });
  for (const key of LOG_ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('frontend/backend TypeScript schema parity', () => {
  it('keeps required base keys and optional err/extra behavior aligned', () => {
    createElectronLogger('electron/parity').info('parity.info');
    createBackendLogger('platform/parity').info('parity.info');
    createElectronLogger('electron/parity').error('parity.error', new Error('electron boom'));
    createBackendLogger('platform/parity').error('parity.error', new Error('backend boom'));
    createElectronLogger('electron/parity').info('parity.extra', {
      task_id: 'bad',
      safe: true,
    });
    createBackendLogger('platform/parity').info('parity.extra', {
      task_id: 'bad',
      safe: true,
    });

    const electronLines = readJson(path.join(logDir, 'info', `frontend-electron-${todayStamp()}.jsonl`));
    const electronErrors = readJson(path.join(logDir, 'error', `frontend-electron-${todayStamp()}.jsonl`));
    const backendLines = readJson(path.join(logDir, 'info', `backend-ts-${todayStamp()}.jsonl`));
    const backendErrors = readJson(path.join(logDir, 'error', `backend-ts-${todayStamp()}.jsonl`));

    expect(presentBaseKeys(electronLines[0])).toEqual(presentBaseKeys(backendLines[0]));
    expect(presentBaseKeys(electronLines[0])).toEqual(BASE_KEYS);
    expect(electronLines[0]).not.toHaveProperty('err');
    expect(electronLines[0]).not.toHaveProperty('extra');
    expect(backendLines[0]).not.toHaveProperty('err');
    expect(backendLines[0]).not.toHaveProperty('extra');
    expect(electronErrors[0].err).toMatchObject({ name: 'Error' });
    expect(backendErrors[0].err).toMatchObject({ name: 'Error' });
    expect(electronLines[1].extra).toEqual({ safe: true });
    expect(backendLines[1].extra).toEqual({ safe: true });
    expect(electronLines[0].stack).toBe('electron');
    expect(backendLines[0].stack).toBe('ts');
    for (const key of RESERVED_KEYS.filter((key) => key !== 'err' && key !== 'extra')) {
      expect(electronLines[0]).toHaveProperty(key);
      expect(backendLines[0]).toHaveProperty(key);
    }
  });
});

describe('cross-stack task correlation', () => {
  it('writes electron, renderer, and backend TS lines to the same task shard', () => {
    createElectronLogger('electron/correlation', {
      taskId: 'test-task-1',
      agentId: 'dalton',
    }).info('correlation.electron');
    acceptForeignLine(rendererLine());
    spawnBackendTaskLine();

    const lines = readJson(path.join(logDir, 'agent', 'test-task-1', 'dalton.jsonl'));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const stacks = new Set(lines.map((line) => line.stack));
    expect(stacks.has('electron')).toBe(true);
    expect(stacks.has('renderer')).toBe(true);
    expect(stacks.has('ts')).toBe(true);
    expect(lines.map((line) => line.task_id)).toEqual(
      expect.arrayContaining(['test-task-1', 'test-task-1', 'test-task-1']),
    );
  });
});

function rendererLine(): ForeignLogLine {
  return {
    ts: new Date().toISOString(),
    level: 'info',
    stack: 'renderer',
    module: 'src/renderer/correlation',
    msg: 'correlation.renderer',
    pid: 0,
    task_id: 'test-task-1',
    agent_id: 'dalton',
    provider_id: null,
    span_id: null,
  };
}

function spawnBackendTaskLine(): void {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const script = [
    "void (async () => {",
    "  const { createLogger, flushLoggers } = await import('./src/backend/platform/core/logger.ts');",
    "  const log = createLogger('test', { taskId: 'test-task-1', agentId: 'dalton' });",
    "  log.info('test.cross.stack');",
    "  flushLoggers();",
    "})().catch((err) => { console.error(err); process.exit(1); });",
  ].join('\n');

  execFileSync(npx, ['tsx', '-e', script], {
    cwd: REPO_ROOT,
    env: { ...process.env, LOG_DIR: logDir },
    stdio: 'pipe',
  });
}

function presentBaseKeys(line: Record<string, unknown>): string[] {
  return BASE_KEYS.filter((key) => key in line);
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

function readJson(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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
