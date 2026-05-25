// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WritableRepoFs } from './utils';
import { repoReadWriteFs } from './utils';
import { RuntimeTerminalEvents } from '../../../backend/platform/core/runtimeTerminalEvents.js';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({ warn })),
}));

import {
  appendTaskTerminalTranscriptEvent,
  terminalEventsPath,
} from './main.taskTerminalTranscript';

describe('main.taskTerminalTranscript', () => {
  beforeEach(() => {
    warn.mockReset();
  });

  it('appends a task event to the exact task-local terminal-events path', async () => {
    const fsAdapter = createMemoryFs();
    const repoRoot = '/repo';

    await appendTaskTerminalTranscriptEvent(fsAdapter, repoRoot, {
      taskId: 'task-1',
      eventId: 'event-1',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'info',
      message: 'Code capture started.',
    });

    expect(fsAdapter.mkdir).toHaveBeenCalledWith(
      path.dirname(terminalEventsPath(repoRoot, 'task-1')),
      { recursive: true },
    );
    expect(fsAdapter.files.get(terminalEventsPath(repoRoot, 'task-1'))).toContain('"eventId": "event-1"');
  });

  it('generates createdAt and ignores caller-owned timestamps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:13:14.000Z'));
    const fsAdapter = createMemoryFs();

    await appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', {
      taskId: 'task-1',
      eventId: 'event-1',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'info',
      message: 'Message.',
      createdAt: 'caller-owned',
    } as Parameters<typeof appendTaskTerminalTranscriptEvent>[2] & { createdAt: string });

    expect(readEvents(fsAdapter, '/repo', 'task-1')).toEqual([
      expect.objectContaining({ createdAt: '2026-05-15T12:13:14.000Z' }),
    ]);
    vi.useRealTimers();
  });

  it('preserves actorName and sessionContext', async () => {
    const fsAdapter = createMemoryFs();

    await appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', {
      taskId: 'task-1',
      eventId: 'event-1',
      source: 'runtime.agentSession',
      role: 'agent',
      severity: 'info',
      message: 'Is running.',
      actorName: 'Dalton',
      sessionContext: {
        sessionId: 'session-1',
        instanceId: 'dalton-1',
        sliceId: 'slice-1',
        launchState: 'started',
        terminalState: 'running',
        liveness: 'alive',
        stuckState: 'none',
      },
    });

    expect(readEvents(fsAdapter, '/repo', 'task-1')).toEqual([
      expect.objectContaining({
        actorName: 'Dalton',
        sessionContext: expect.objectContaining({ sessionId: 'session-1' }),
      }),
    ]);
  });

  it('does not append duplicate eventIds', async () => {
    const fsAdapter = createMemoryFs();
    const input = {
      taskId: 'task-1',
      eventId: 'event-1',
      source: 'runtime.pipeline',
      role: 'pipeline' as const,
      severity: 'info' as const,
      message: 'Message.',
    };

    await appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', input);
    await appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', input);

    expect(readEvents(fsAdapter, '/repo', 'task-1')).toHaveLength(1);
  });

  it('rewrites corrupt JSON into a valid events document', async () => {
    const fsAdapter = createMemoryFs();
    fsAdapter.files.set(terminalEventsPath('/repo', 'task-1'), 'not-json');

    await appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', {
      taskId: 'task-1',
      eventId: 'event-1',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'info',
      message: 'Message.',
    });

    expect(JSON.parse(fsAdapter.files.get(terminalEventsPath('/repo', 'task-1')) ?? '')).toEqual({
      events: [expect.objectContaining({ eventId: 'event-1' })],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not write for empty task id or N/A', async () => {
    const fsAdapter = createMemoryFs();
    const baseInput = {
      eventId: 'event-1',
      source: 'runtime.pipeline',
      role: 'pipeline' as const,
      severity: 'info' as const,
      message: 'Message.',
    };

    await appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', { ...baseInput, taskId: '' });
    await appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', { ...baseInput, taskId: '   ' });
    await appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', { ...baseInput, taskId: 'N/A' });

    expect(fsAdapter.writeFile).not.toHaveBeenCalled();
  });

  it('logs one warning and resolves on write failure', async () => {
    const fsAdapter = createMemoryFs({
      writeFile: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });

    await expect(appendTaskTerminalTranscriptEvent(fsAdapter, '/repo', {
      taskId: 'task-1',
      eventId: 'event-1',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'info',
      message: 'Message.',
    })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('task_terminal_transcript.write.failed', expect.objectContaining({
      taskId: 'task-1',
      eventId: 'event-1',
      error: 'disk full',
    }));
  });

  it('preserves all concurrent Electron appends for one task', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'task-transcript-electron-'));
    try {
      await Promise.all(Array.from({ length: 20 }, (_, index) => (
        appendTaskTerminalTranscriptEvent(repoReadWriteFs, repoRoot, {
          taskId: 'task-1',
          eventId: `electron-${index}`,
          source: 'runtime.pipeline',
          role: 'pipeline',
          severity: 'info',
          message: `Message ${index}.`,
        })
      )));

      expect(readRealEvents(repoRoot, 'task-1').map((event) => event.eventId).sort()).toEqual(
        Array.from({ length: 20 }, (_, index) => `electron-${index}`).sort(),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('preserves concurrent backend and Electron appends for one task', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'task-transcript-cross-'));
    try {
      await Promise.all([
        ...Array.from({ length: 10 }, (_, index) => (
          RuntimeTerminalEvents.forTask(repoRoot, 'task-1').branchCreated({
            repo: `repo-${index}`,
            branch: `task/branch-${index}`,
            worktreeRoot: `/tmp/worktree-${index}`,
            materializationStrategy: 'copy',
          })
        )),
        ...Array.from({ length: 10 }, (_, index) => (
          appendTaskTerminalTranscriptEvent(repoReadWriteFs, repoRoot, {
            taskId: 'task-1',
            eventId: `electron-${index}`,
            source: 'runtime.pipeline',
            role: 'pipeline',
            severity: 'info',
            message: `Electron message ${index}.`,
          })
        )),
      ]);

      const eventIds = readRealEvents(repoRoot, 'task-1').map((event) => event.eventId).sort();
      expect(eventIds).toEqual([
        ...Array.from({ length: 10 }, (_, index) => (
          `queue.branch.created:repo-${index}:task/branch-${index}:/tmp/worktree-${index}`
        )),
        ...Array.from({ length: 10 }, (_, index) => `electron-${index}`),
      ].sort());
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('writes different task ids to separate transcript files concurrently', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'task-transcript-different-'));
    try {
      await Promise.all([
        appendTaskTerminalTranscriptEvent(repoReadWriteFs, repoRoot, {
          taskId: 'TASK-A',
          eventId: 'event-a',
          source: 'runtime.pipeline',
          role: 'pipeline',
          severity: 'info',
          message: 'A.',
        }),
        appendTaskTerminalTranscriptEvent(repoReadWriteFs, repoRoot, {
          taskId: 'TASK-B',
          eventId: 'event-b',
          source: 'runtime.pipeline',
          role: 'pipeline',
          severity: 'info',
          message: 'B.',
        }),
      ]);

      expect(readRealEvents(repoRoot, 'TASK-A')).toMatchObject([{ eventId: 'event-a' }]);
      expect(readRealEvents(repoRoot, 'TASK-B')).toMatchObject([{ eventId: 'event-b' }]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

type MemoryFs = WritableRepoFs & {
  files: Map<string, string>;
};

function createMemoryFs(overrides: Partial<WritableRepoFs> = {}): MemoryFs {
  const files = new Map<string, string>();
  return {
    files,
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async (filePath: string) => {
      const content = files.get(filePath);
      if (content === undefined) {
        throw Object.assign(new Error(`Missing file: ${filePath}`), { code: 'ENOENT' });
      }
      return content;
    }),
    readdir: vi.fn(async () => []),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async (oldPath: string, newPath: string) => {
      const content = files.get(oldPath);
      if (content === undefined) {
        throw Object.assign(new Error(`Missing file: ${oldPath}`), { code: 'ENOENT' });
      }
      files.set(newPath, content);
      files.delete(oldPath);
    }),
    rm: vi.fn(async (filePath: string) => {
      files.delete(filePath);
    }),
    writeFile: vi.fn(async (filePath: string, contents: string) => {
      files.set(filePath, contents);
    }),
    ...overrides,
  } as MemoryFs;
}

function readEvents(fsAdapter: MemoryFs, repoRoot: string, taskId: string): Array<Record<string, unknown>> {
  return JSON.parse(fsAdapter.files.get(terminalEventsPath(repoRoot, taskId)) ?? '{"events":[]}').events;
}

function readRealEvents(repoRoot: string, taskId: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(terminalEventsPath(repoRoot, taskId), 'utf-8')).events;
}
