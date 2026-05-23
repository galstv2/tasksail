import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { ProgressEvent } from '../logger.js';

const PROGRESS_EVENTS: ProgressEvent[] = [
  'queue.dropbox.arrived',
  'queue.pending.promoted',
  'queue.active.activated',
  'queue.active.skipped',
  'queue.branch.created',
  'queue.error_items.moved',
  'child_chain_failure_branch.rollback_preflight_failed',
  'child_chain_failure_branch.rollback_completed',
  'child_chain_failure_branch.rollback_failed',
  'child_chain_failure_branch.branch_delete_skipped',
  'startup_recovery.branch_delete.skipped_child_chain',
  'auto_merge.applied',
  'auto_merge.skipped',
  'auto_merge.skipped_child_chain',
  'auto_merge.disabled',
  'closeout.finalized',
  'closeout.stranded.resumed',
  'agent.launch.started',
  'agent.launch.terminal',
  'pipeline.phase',
  'dalton_verification.launching',
  'closeout_remediation.launching',
];

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

let logDir: string;
let ttyDescriptor: PropertyDescriptor | undefined;
let stderrWrite: ReturnType<typeof vi.spyOn>;
let realLogSnapshot: string[];

beforeEach(() => {
  vi.resetModules();
  realLogSnapshot = snapshotRealLogs();
  logDir = mkdtempSync(path.join(tmpdir(), 'progress-protocol-invariant-'));
  for (const key of LOG_ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv('LOG_DIR', logDir);
  vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'plain');
  vi.stubEnv('CI', '');
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.doMock('../protocolOutput.js', () => ({
    writeProtocolStdout: vi.fn(() => {
      throw new Error('writeProtocolStdout must not be called by Logger.progress');
    }),
    writeProtocolStderr: vi.fn(() => {
      throw new Error('writeProtocolStderr must not be called by Logger.progress');
    }),
    writeProtocolJson: vi.fn(() => {
      throw new Error('writeProtocolJson must not be called by Logger.progress');
    }),
  }));
});

afterEach(async () => {
  const { flushLoggers } = await import('../logger.js');
  flushLoggers();
  restoreStderrTty();
  stderrWrite.mockRestore();
  rmSync(logDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../protocolOutput.js');
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('Logger.progress protocol output invariant', () => {
  it('does not route progress through protocolOutput helpers', async () => {
    const { createLogger, flushLoggers } = await import('../logger.js');
    const protocolOutput = await import('../protocolOutput.js');
    const logger = createLogger('platform/test').child({ taskId: 'task-progress' });

    for (const event of PROGRESS_EVENTS) {
      logger.progress({
        level: 'info',
        event,
        text: `[queue] ${event}`,
      });
    }
    flushLoggers();

    expect(protocolOutput.writeProtocolStdout).not.toHaveBeenCalled();
    expect(protocolOutput.writeProtocolStderr).not.toHaveBeenCalled();
    expect(protocolOutput.writeProtocolJson).not.toHaveBeenCalled();
  });
});

function restoreStderrTty(): void {
  if (ttyDescriptor) {
    Object.defineProperty(process.stderr, 'isTTY', ttyDescriptor);
  } else {
    delete (process.stderr as Partial<typeof process.stderr>).isTTY;
  }
  ttyDescriptor = undefined;
}

function snapshotRealLogs(): string[] {
  const root = path.resolve(process.cwd(), '.platform-state/logs');
  if (!existsSync(root)) {
    return [];
  }
  const entries: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const filePath = path.join(dir, entry);
      const relative = path.relative(root, filePath);
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        entries.push(`${relative}/`);
        visit(filePath);
      } else {
        entries.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  visit(root);
  return entries;
}
