// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';

const emitStreamEvent = vi.fn();
const refreshStreamTaskMetadataForScope = vi.fn(async () => undefined);

vi.mock('./main.stream', () => ({
  emitStreamEvent,
  refreshStreamTaskMetadataForScope,
}));

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry: vi.fn(async () => ({
    schema_version: 2,
    tasks: {
      'pack-a': {
        open: [],
        pending: [],
        active: [{
          taskId: 'active-task',
          fileName: 'active-task.md',
          title: 'Active Task',
          state: 'active',
          contextPackId: 'pack-a',
          contextPackDir: '/packs/pack-a',
          scopeMode: 'focused',
          selectedRepoIds: [],
          selectedFocusIds: [],
          createdAt: null,
          completedAt: null,
          archivePath: null,
        }],
        failed: [],
        completed: [],
      },
    },
  })),
}));

function taskMarkdown(taskId: string, packId = 'pack-a'): string {
  return `# ${taskId}

## Context Pack Binding

- Context Pack Dir: /packs/${packId}
- Context Pack ID: ${packId}
- Scope Mode: focused
`;
}

function terminalEvent(taskId: string, message: string): string {
  return JSON.stringify({
    events: [{
      eventId: `activation.blocked.dirty-repos:${taskId}`,
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
      message,
    }],
  });
}

describe('failed task runtime terminal replay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitStreamEvent.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a dirty-guard terminal event once for a newly visible error item', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    let errorItems: string[] = [];
    const callbacks: Array<() => void> = [];
    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('AgentWorkSpace/error-items/failed-task.md')) {
          return taskMarkdown('failed-task');
        }
        if (filePath.endsWith('.platform-state/runtime/tasks/failed-task/terminal-events.json')) {
          return terminalEvent('failed-task', 'Unable to activate Failed Task due to uncommitted changes in target repo app, please resolve and try again.');
        }
        throw Object.assign(new Error(`Unexpected readFile: ${filePath}`), { code: 'ENOENT' });
      }),
      readdir: vi.fn(async (dirPath: string) => {
        if (dirPath.endsWith('AgentWorkSpace/pendingitems/.active-items')) return [];
        if (dirPath.endsWith('AgentWorkSpace/error-items')) return errorItems;
        if (dirPath.endsWith('.platform-state/runtime/realignment')) return [];
        throw Object.assign(new Error(`Unexpected readdir: ${dirPath}`), { code: 'ENOENT' });
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };
    const watchFactory = vi.fn((target: string, _: { persistent: false }, callback: () => void) => {
      if (target.endsWith('AgentWorkSpace/error-items')) {
        callbacks.push(callback);
      }
      return { close: vi.fn() } as unknown as FSWatcher;
    });

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot: vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] }),
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
      scopeProvider: () => ({ contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'Pack A' }),
    });
    await vi.runAllTimersAsync();
    expect(emitStreamEvent).not.toHaveBeenCalled();

    errorItems = ['failed-task.md'];
    callbacks[0]?.();
    await vi.advanceTimersByTimeAsync(200);
    expect(emitStreamEvent).toHaveBeenCalledTimes(1);
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'failed-task',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
    }));

    callbacks[0]?.();
    await vi.advanceTimersByTimeAsync(200);
    expect(emitStreamEvent).toHaveBeenCalledTimes(1);
    stop();
  });

  it('honors context-pack scope for failed task replay', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    let errorItems = ['failed-task.md'];
    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('AgentWorkSpace/error-items/failed-task.md')) {
          return taskMarkdown('failed-task', 'pack-b');
        }
        throw Object.assign(new Error(`Unexpected readFile: ${filePath}`), { code: 'ENOENT' });
      }),
      readdir: vi.fn(async (dirPath: string) => {
        if (dirPath.endsWith('AgentWorkSpace/pendingitems/.active-items')) return [];
        if (dirPath.endsWith('AgentWorkSpace/error-items')) return errorItems;
        if (dirPath.endsWith('.platform-state/runtime/realignment')) return [];
        throw Object.assign(new Error(`Unexpected readdir: ${dirPath}`), { code: 'ENOENT' });
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot: vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] }),
      watchFactory: vi.fn(() => ({ close: vi.fn() }) as unknown as FSWatcher) as unknown as typeof import('node:fs').watch,
      scopeProvider: () => ({ contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'Pack A' }),
    });

    await vi.runAllTimersAsync();
    expect(emitStreamEvent).not.toHaveBeenCalled();
    errorItems = [];
    stop();
  });

  it('continues to replay active-task terminal events', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('.platform-state/runtime/tasks/active-task/terminal-events.json')) {
          return terminalEvent('active-task', 'Active task event.');
        }
        throw Object.assign(new Error(`Unexpected readFile: ${filePath}`), { code: 'ENOENT' });
      }),
      readdir: vi.fn(async (dirPath: string) => {
        if (dirPath.endsWith('AgentWorkSpace/pendingitems/.active-items')) return ['active-task'];
        if (dirPath.endsWith('AgentWorkSpace/error-items')) return [];
        if (dirPath.endsWith('.platform-state/runtime/realignment')) return [];
        throw Object.assign(new Error(`Unexpected readdir: ${dirPath}`), { code: 'ENOENT' });
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot: vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] }),
      watchFactory: vi.fn(() => ({ close: vi.fn() }) as unknown as FSWatcher) as unknown as typeof import('node:fs').watch,
      scopeProvider: () => ({ contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'Pack A' }),
    });

    await vi.runAllTimersAsync();
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'active-task',
      message: 'Active task event.',
    }));
    stop();
  });
});
