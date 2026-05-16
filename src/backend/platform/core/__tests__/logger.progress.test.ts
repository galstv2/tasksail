import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createLogger,
  flushLoggers,
  type ProgressEvent,
} from '../logger.js';

const LOG_ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'LOG_DIR',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
  'TASKSAIL_LOG_PROGRESS',
  'TASKSAIL_LOG_PROGRESS_FORCE',
  'NO_COLOR',
  'CI',
] as const;

const PROGRESS_EVENTS: ProgressEvent[] = [
  'queue.dropbox.arrived',
  'queue.pending.promoted',
  'queue.active.activated',
  'queue.active.skipped',
  'queue.branch.created',
  'queue.error_items.moved',
  'auto_merge.applied',
  'auto_merge.skipped',
  'auto_merge.disabled',
  'closeout.finalized',
  'closeout.stranded.resumed',
  'agent.launch.started',
  'agent.launch.terminal',
  'pipeline.phase',
  'dalton_verification.launching',
  'closeout_remediation.launching',
];

type WriteSpy = ReturnType<typeof vi.spyOn>;

let logDir: string;
let stderrWrite: WriteSpy;
let stdoutWrite: WriteSpy;
let ttyDescriptor: PropertyDescriptor | undefined;
let realLogSnapshot: string[];

beforeEach(() => {
  realLogSnapshot = snapshotRealLogs();
  logDir = mkdtempSync(path.join(tmpdir(), 'logger-progress-test-'));
  for (const key of LOG_ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv('LOG_DIR', logDir);
  flushLoggers();
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  process.exitCode = 0;
});

afterEach(() => {
  restoreStderrTty();
  stderrWrite.mockRestore();
  stdoutWrite.mockRestore();
  flushLoggers();
  rmSync(logDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  process.exitCode = 0;
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('Logger.progress', () => {
  it('writes info progress to file only when TTY is off and mode is unset', () => {
    stubStderrTty(false);

    createLogger('platform/test')
      .child({ taskId: 't1' })
      .progress({
        level: 'info',
        event: 'queue.pending.promoted',
        text: '[queue] promoted to pending t1',
      });

    expect(readLevel('info')).toMatchObject([
      { msg: 'queue.pending.promoted', task_id: 't1' },
    ]);
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('emits info progress to stderr when TTY is on and CI is unset', () => {
    stubStderrTty(true);
    vi.stubEnv('CI', '');

    createLogger('platform/test')
      .child({ taskId: 't1' })
      .progress({
        level: 'info',
        event: 'queue.pending.promoted',
        text: '[queue] promoted to pending t1',
      });

    expect(stderrChunks()).toHaveLength(1);
    expect(stripAnsi(stderrChunks()[0]!)).toBe('[queue] promoted to pending t1\n');
  });

  it('emits warn progress as JSON and human stderr lines', () => {
    stubStderrTty(true);
    vi.stubEnv('CI', '');

    createLogger('platform/test')
      .child({ taskId: 't1' })
      .progress({
        level: 'warn',
        event: 'closeout.stranded.resumed',
        extra: { drove: 'sweep' },
        text: '[queue] resumed stranded closeout for t1',
      });

    const chunks = stderrChunks();
    expect(chunks).toHaveLength(2);
    expect(JSON.parse(chunks[0]!)).toMatchObject({
      level: 'warn',
      msg: 'closeout.stranded.resumed',
      extra: { drove: 'sweep' },
    });
    expect(stripAnsi(chunks[1]!)).toBe('[queue] resumed stranded closeout for t1\n');
  });

  it('suppresses the human line when progress mode is off', () => {
    stubStderrTty(true);
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'off');

    createLogger('platform/test')
      .child({ taskId: 't1' })
      .progress({
        level: 'info',
        event: 'queue.pending.promoted',
        text: '[queue] promoted to pending t1',
      });

    expect(readLevel('info')).toHaveLength(1);
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('plain mode emits an uncolored human line when TTY is off', () => {
    stubStderrTty(false);
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'plain');

    createLogger('platform/test')
      .child({ taskId: 't1' })
      .progress({
        level: 'info',
        event: 'queue.pending.promoted',
        text: '[queue] promoted to pending t1',
      });

    expect(stderrChunks()).toEqual(['[queue] promoted to pending t1\n']);
    expect(stderrChunks()[0]).not.toContain('\x1b');
  });

  it('color mode in CI is silent unless forced', () => {
    stubStderrTty(true);
    vi.stubEnv('CI', '1');
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'color');

    createLogger('platform/test')
      .child({ taskId: 't1' })
      .progress({
        level: 'info',
        event: 'queue.pending.promoted',
        text: '[queue] promoted to pending t1',
      });

    expect(stderrWrite).not.toHaveBeenCalled();
    stderrWrite.mockClear();
    vi.stubEnv('TASKSAIL_LOG_PROGRESS_FORCE', '1');

    createLogger('platform/test')
      .child({ taskId: 't1' })
      .progress({
        level: 'info',
        event: 'queue.pending.promoted',
        text: '[queue] promoted to pending t1',
      });

    expect(stderrChunks()).toHaveLength(1);
    expect(stderrChunks()[0]).toContain('\x1b');
  });

  it('NO_COLOR disables ANSI color in color mode outside CI', () => {
    stubStderrTty(true);
    vi.stubEnv('CI', '');
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'color');
    vi.stubEnv('NO_COLOR', '1');

    createLogger('platform/test')
      .child({ taskId: 't1' })
      .progress({
        level: 'info',
        event: 'queue.pending.promoted',
        text: '[queue] promoted to pending t1',
      });

    expect(stderrChunks()).toEqual(['[queue] promoted to pending t1\n']);
    expect(stderrChunks()[0]).not.toContain('\x1b');
  });

  it('drops reserved keys from progress extra', () => {
    stubStderrTty(false);

    createLogger('platform/test')
      .child({ taskId: 'x' })
      .progress({
        level: 'info',
        event: 'queue.dropbox.arrived',
        extra: {
          msg: 'evil',
          ts: 'evil',
          path: '/tmp/x.md',
          via: 'create-task',
        },
        text: '[queue] dropbox arrived x',
      });

    expect(readLevel('info')[0]).toMatchObject({
      task_id: 'x',
      extra: {
        path: '/tmp/x.md',
        via: 'create-task',
      },
    });
    expect(readLevel('info')[0]?.extra).not.toMatchObject({
      msg: 'evil',
      ts: 'evil',
    });
    expect(stderrChunks()).toEqual([
      expect.stringContaining('[logger] dropped reserved extra key(s):'),
    ]);
  });

  it('colors prefix and terminal status tag without coloring the body', () => {
    stubStderrTty(true);
    vi.stubEnv('CI', '');
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'color');

    createLogger('platform/test')
      .child({ taskId: 't1', agentId: 'dalton' })
      .progress({
        level: 'info',
        event: 'agent.launch.terminal',
        text: '[agent] exited dalton success in 87s [ok]',
      });

    const line = stderrChunks()[0]!;
    expect(line).toContain('\x1b[35m[agent]\x1b[0m');
    expect(line).toContain('\x1b[1;32m[ok]\x1b[0m');
    expect(line).toContain(' exited dalton success in 87s ');
    expect(line).not.toContain('\x1b[35m[agent]\x1b[0m\x1b');
  });

  it('suppresses info progress completely under LOG_LEVEL=warn', () => {
    stubStderrTty(true);
    vi.stubEnv('LOG_LEVEL', 'warn');
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'plain');

    const logger = createLogger('platform/test').child({ taskId: 't1' });
    logger.progress({
      level: 'info',
      event: 'queue.pending.promoted',
      text: '[queue] promoted to pending t1',
    });

    expect(readLevel('info')).toHaveLength(0);
    expect(stderrWrite).not.toHaveBeenCalled();

    logger.progress({
      level: 'warn',
      event: 'closeout.stranded.resumed',
      text: '[queue] resumed stranded closeout for t1',
    });

    expect(readLevel('warn')).toMatchObject([
      { msg: 'closeout.stranded.resumed', task_id: 't1' },
    ]);
    expect(stderrChunks()).toHaveLength(2);
    expect(JSON.parse(stderrChunks()[0]!)).toMatchObject({
      level: 'warn',
      msg: 'closeout.stranded.resumed',
    });
    expect(stderrChunks()[1]).toBe('[queue] resumed stranded closeout for t1\n');
  });

  it('never writes progress to process.stdout', () => {
    stubStderrTty(true);
    vi.stubEnv('CI', '');
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'plain');
    const logger = createLogger('platform/test').child({ taskId: 't1' });

    for (const event of PROGRESS_EVENTS) {
      logger.progress({
        level: 'info',
        event,
        text: '[pipeline] progress event',
      });
    }

    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

function stubStderrTty(value: boolean): void {
  Object.defineProperty(process.stderr, 'isTTY', {
    configurable: true,
    value,
  });
}

function restoreStderrTty(): void {
  if (ttyDescriptor) {
    Object.defineProperty(process.stderr, 'isTTY', ttyDescriptor);
  } else {
    delete (process.stderr as Partial<typeof process.stderr>).isTTY;
  }
  ttyDescriptor = undefined;
}

function stderrChunks(): string[] {
  return stderrWrite.mock.calls.map((call) => String(call[0]));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function readLevel(level: 'info' | 'warn' | 'error'): Array<Record<string, unknown>> {
  const dir = path.join(logDir, level);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.jsonl'))
    .flatMap((entry) => readJsonLines(path.join(dir, entry)));
}

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) {
    return [];
  }
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function snapshotRealLogs(): string[] {
  const root = path.join(process.cwd(), '.platform-state', 'logs');
  const rows: string[] = [];
  visitLogFiles(root, rows);
  return rows.sort();
}

function visitLogFiles(dir: string, rows: string[]): void {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      visitLogFiles(fullPath, rows);
    } else if (entry.isFile()) {
      const stat = statSync(fullPath);
      rows.push(`${fullPath.replaceAll(path.sep, '/')} ${stat.size} ${Math.floor(stat.mtimeMs)}`);
    }
  }
}
