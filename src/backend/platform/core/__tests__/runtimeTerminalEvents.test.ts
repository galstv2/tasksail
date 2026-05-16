import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeTerminalEvents } from '../runtimeTerminalEvents.js';
import { flushLoggers } from '../logger.js';

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
let logDir: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'runtime-terminal-events-'));
  logDir = mkdtempSync(path.join(tmpdir(), 'runtime-terminal-events-logs-'));
  for (const key of LOG_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.LOG_DIR = logDir;
  flushLoggers();
});

afterEach(() => {
  vi.doUnmock('../io.js');
  vi.resetModules();
  flushLoggers();
  rmSync(repoRoot, { recursive: true, force: true });
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

describe('RuntimeTerminalEvents', () => {
  it('branchCreated writes the exact terminal event fields', async () => {
    await RuntimeTerminalEvents.forTask(repoRoot, 'task-1').branchCreated({
      repo: 'api',
      branch: 'task/task-1',
      worktreeRoot: '/tmp/worktrees/api',
      materializationStrategy: 'copy',
    });

    expect(readEvents('task-1')).toEqual([
      {
        eventId: 'queue.branch.created:api:task/task-1:/tmp/worktrees/api',
        source: 'runtime.branch',
        role: 'pipeline',
        severity: 'info',
        message: 'Created worktree for api on branch task/task-1.',
        createdAt: expect.any(String),
        extra: {
          repo: 'api',
          branch: 'task/task-1',
          worktreeRoot: '/tmp/worktrees/api',
          materializationStrategy: 'copy',
        },
      },
    ]);
  });

  it('appends archive start, completion, and failure events to one file', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-archive');

    await events.archiveStarted();
    await events.archiveCompleted();
    await events.archiveFailed();

    expect(readEvents('task-archive')).toMatchObject([
      {
        eventId: 'archive.started',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'info',
        message: 'Archiving task.',
      },
      {
        eventId: 'archive.completed',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'success',
        message: 'Task archived.',
      },
      {
        eventId: 'archive.failed',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'error',
        message: 'Task archival failed.',
      },
    ]);
  });

  it('writes closeout and auto-merge events as pipeline terminal events', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-closeout');

    await events.autoMergeDisabled();
    await events.autoMergeApplied({ repos: 'api:task/a->main' });
    await events.autoMergeSkipped({ detail: 'blocked: needs review' });
    await events.closeoutFinalized();
    await events.strandedCloseoutResumed({ drove: ['finalize-worktrees'] });

    expect(readEvents('task-closeout')).toMatchObject([
      { eventId: 'auto_merge.disabled', source: 'runtime.closeout', role: 'pipeline' },
      { eventId: 'auto_merge.applied', source: 'runtime.closeout', role: 'pipeline' },
      { eventId: 'auto_merge.skipped', source: 'runtime.closeout', role: 'pipeline' },
      { eventId: 'closeout.finalized', source: 'runtime.closeout', role: 'pipeline' },
      { eventId: 'closeout.stranded.resumed', source: 'runtime.closeout', role: 'pipeline' },
    ]);
  });

  it('writes queue state transition events', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-state');

    await events.taskActivated();
    await events.taskCompleted();
    await events.taskFailed();

    expect(readEvents('task-state')).toMatchObject([
      {
        eventId: 'queue.task.activated',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'info',
        message: 'Moved pending item to active.',
      },
      {
        eventId: 'queue.task.completed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'success',
        message: 'Moved pending item to completed.',
      },
      {
        eventId: 'queue.task.failed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
        message: 'Moved pending item to failed.',
      },
    ]);
  });

  it('does not append duplicate eventIds', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-dup');

    await events.archiveStarted();
    await events.archiveStarted();

    expect(readEvents('task-dup')).toHaveLength(1);
  });

  it('preserves all concurrent branchCreated appends for one task', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      RuntimeTerminalEvents.forTask(repoRoot, 'task-concurrent').branchCreated({
        repo: `repo-${index}`,
        branch: `task/branch-${index}`,
        worktreeRoot: `/tmp/worktree-${index}`,
        materializationStrategy: 'copy',
      })
    )));

    const eventIds = readEvents('task-concurrent').map((event) => event.eventId).sort();
    expect(eventIds).toEqual(
      Array.from({ length: 20 }, (_, index) => (
        `queue.branch.created:repo-${index}:task/branch-${index}:/tmp/worktree-${index}`
      )).sort(),
    );
  });

  it('rewrites corrupt existing JSON as a valid event document', async () => {
    const eventPath = terminalEventsPath('task-corrupt');
    mkdirSync(path.dirname(eventPath), { recursive: true });
    writeFileSync(eventPath, 'not-json', 'utf-8');

    await RuntimeTerminalEvents.forTask(repoRoot, 'task-corrupt').archiveStarted();

    expect(JSON.parse(readFileSync(eventPath, 'utf-8'))).toMatchObject({
      events: [
        {
          eventId: 'archive.started',
          message: 'Archiving task.',
        },
      ],
    });
  });

  it('omits extra when the method has no extra payload', async () => {
    await RuntimeTerminalEvents.forTask(repoRoot, 'task-no-extra').archiveStarted();

    expect(readEvents('task-no-extra')[0]).not.toHaveProperty('extra');
  });

  it('does not reject on write failure and logs one warning', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      vi.resetModules();
      vi.doMock('../io.js', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../io.js')>();
        return {
          ...actual,
          writeTextFileAtomic: vi.fn(async () => {
            throw new Error('disk full');
          }),
        };
      });
      const { RuntimeTerminalEvents: MockedRuntimeTerminalEvents } = await import('../runtimeTerminalEvents.js');
      const { flushLoggers: flushMockedLoggers } = await import('../logger.js');

      await expect(
        MockedRuntimeTerminalEvents.forTask(repoRoot, 'task-fail').archiveStarted(),
      ).resolves.toBeUndefined();
      flushMockedLoggers();

      const warnLines = readWarnLogs().filter((line) => line.msg === 'runtime_terminal_event.write.failed');
      expect(warnLines).toHaveLength(1);
      expect(warnLines[0]).toMatchObject({
        module: 'platform/core/runtimeTerminalEvents',
        extra: {
          taskId: 'task-fail',
          eventId: 'archive.started',
        },
      });
    } finally {
      stderrWrite.mockRestore();
    }
  });
});

function terminalEventsPath(taskId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'tasks',
    taskId,
    'terminal-events.json',
  );
}

function readEvents(taskId: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(terminalEventsPath(taskId), 'utf-8')).events;
}

function readWarnLogs(): Array<Record<string, unknown>> {
  const warnDir = path.join(logDir, 'warn');
  if (!existsSync(warnDir)) {
    return [];
  }
  const [warnFile] = readdirSync(warnDir).filter((entry) => entry.endsWith('.jsonl'));
  if (!warnFile) {
    return [];
  }
  return readFileSync(path.join(warnDir, warnFile), 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
