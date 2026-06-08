// @vitest-environment node
/**
 * Terminal events resilience: corrupt task file isolation, metadata-lag safety.
 * Covers: R17 (corrupt terminal-events.json suppression), R18 (metadata-lag early-event loss).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';
import { setCurrentActiveContextPackTaskScope } from '../contextPack/taskVisibility';

vi.mock('../../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
  startPipeline: vi.fn(async () => ({ status: 'started', pid: 9999 })),
  stopPipeline: vi.fn(async () => undefined),
  stopAll: vi.fn(async () => undefined),
  listActivePipelines: vi.fn(() => []),
  recoverOnStartup: vi.fn(async () => undefined),
}));

const emitStreamEvent = vi.fn(() => ({ emitAccepted: true }));
const refreshStreamTaskMetadataForScope = vi.fn(async () => undefined);

vi.mock('./stream', () => ({
  emitStreamEvent,
  refreshStreamTaskMetadataForScope,
}));

const logWarn = vi.fn();

vi.mock('../log/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: logWarn,
    error: vi.fn(),
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: logWarn,
      error: vi.fn(),
    }),
  }),
}));

function makeRegistryWithTasks(taskIds: string[]) {
  return {
    schema_version: 2,
    tasks: {
      'pack-a': {
        open: [],
        pending: taskIds.map((taskId) => ({
          taskId,
          fileName: `${taskId}.md`,
          title: taskId,
          state: 'pending' as const,
          contextPackId: 'pack-a',
          contextPackDir: '/packs/pack-a',
          scopeMode: 'focused' as const,
          selectedRepoIds: [],
          selectedFocusIds: [],
          createdAt: null,
          completedAt: null,
          archivePath: null,
        })),
        active: [],
        failed: [],
        completed: [],
      },
    },
  };
}

vi.mock('../../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry: vi.fn(async () => ({
    schema_version: 2,
    tasks: {},
  })),
}));

import { loadTaskRegistry } from '../../../../backend/platform/queue/taskRegistry.js';

function makeValidTerminalEvent(eventId: string, message: string): object {
  return {
    eventId,
    source: 'runtime.pipeline',
    role: 'pipeline',
    severity: 'info',
    visible: true,
    message,
  };
}

function makeTerminalEventsJson(events: object[]): string {
  return JSON.stringify({ events });
}

/** Build a minimal fsAdapter for the watcher test. */
function makeFsAdapter(options: {
  taskIds: string[];
  corruptTaskId?: string;
  terminalEventsByTaskId: Map<string, object[]>;
}) {
  const { taskIds, corruptTaskId, terminalEventsByTaskId } = options;

  return {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async (path: string) => {
      if (corruptTaskId && path.includes(`/tasks/${corruptTaskId}/terminal-events.json`)) {
        const err = new Error('corrupt JSON, not ENOENT');
        (err as NodeJS.ErrnoException).code = 'EPARSE';
        throw err;
      }
      for (const taskId of taskIds) {
        if (path.includes(`/tasks/${taskId}/terminal-events.json`)) {
          const events = terminalEventsByTaskId.get(taskId) ?? [];
          return makeTerminalEventsJson(events);
        }
        if (path.includes(`/tasks/${taskId}/pipeline-phase.json`)) {
          return JSON.stringify({ phase: null });
        }
      }
      return '';
    }),
    readdir: vi.fn(async (path: string) => {
      if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
        return taskIds;
      }
      if (path.endsWith('AgentWorkSpace/pendingitems')) {
        // Return task md files for visibility filter
        return taskIds.map((id) => `${id}.md`);
      }
      if (path.endsWith('.platform-state/runtime/realignment')) {
        return [];
      }
      if (path.endsWith('AgentWorkSpace/error-items')) {
        return [];
      }
      return [];
    }),
    stat: vi.fn(async (path: string) => {
      // Return stat for any pending task files
      for (const taskId of taskIds) {
        if (path.endsWith(`${taskId}.md`)) {
          return { isFile: () => true };
        }
      }
      return { isFile: () => false };
    }),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
}

describe('main.runtimeStream terminal resilience', () => {
  beforeEach(() => {
    emitStreamEvent.mockReset();
    emitStreamEvent.mockReturnValue({ emitAccepted: true });
    refreshStreamTaskMetadataForScope.mockClear();
    logWarn.mockReset();
    vi.useFakeTimers();
    setCurrentActiveContextPackTaskScope({
      contextPackId: 'pack-a',
      contextPackDir: '/packs/pack-a',
      contextPackName: 'pack-a',
    });
  });

  afterEach(() => {
    setCurrentActiveContextPackTaskScope(null);
    vi.useRealTimers();
  });

  it('corrupt task A terminal-events.json does not suppress healthy task events', async () => {
    const { startRuntimeStreamWatcher } = await import('./runtimeStream');
    const corruptTaskId = 'TASK-A';
    const healthyTaskIds = ['TASK-B', 'TASK-C', 'TASK-D'];
    const allTaskIds = [corruptTaskId, ...healthyTaskIds];

    // Registry includes all tasks so they pass filterActiveTaskIdsForScope.
    vi.mocked(loadTaskRegistry).mockResolvedValue(makeRegistryWithTasks(allTaskIds));

    const terminalEventsByTaskId = new Map<string, object[]>();
    for (const taskId of healthyTaskIds) {
      terminalEventsByTaskId.set(taskId, [
        makeValidTerminalEvent(`evt-${taskId}-1`, `Event from ${taskId}`),
      ]);
    }
    // Corrupt task has no valid events (simulated by throwing in readFile above).

    const callbacks: Array<() => void> = [];
    const watchFactory = vi.fn((_: string, __: { persistent: false }, callback: () => void) => {
      callbacks.push(callback);
      return { close: vi.fn() } as unknown as FSWatcher;
    });

    const fsAdapter = makeFsAdapter({ taskIds: allTaskIds, corruptTaskId, terminalEventsByTaskId });
    const readSnapshot = vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] });

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    // Allow ensureWatchers to run.
    await vi.runAllTimersAsync();

    // Fire all watcher callbacks to trigger checkRuntimeTerminalEvents.
    for (const callback of callbacks) {
      callback();
    }
    await vi.advanceTimersByTimeAsync(300);

    // Healthy tasks B-D must have emitted events.
    for (const taskId of healthyTaskIds) {
      expect(emitStreamEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Event from ${taskId}`,
          taskId,
        }),
      );
    }

    // Corrupt task A must not have emitted events.
    expect(emitStreamEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskId: corruptTaskId }),
    );

    // The read_failed log must have been emitted for the corrupt task.
    expect(logWarn).toHaveBeenCalledWith(
      'runtime_terminal_events.read_failed',
      expect.objectContaining({ taskId: corruptTaskId }),
    );

    stop();
  });

  it('corrupt file error is logged with taskId and reason, peers continue emitting', async () => {
    const { startRuntimeStreamWatcher } = await import('./runtimeStream');
    const corruptTaskId = 'TASK-X';
    const healthyTaskIds = ['TASK-Y', 'TASK-Z'];
    const allTaskIds = [corruptTaskId, ...healthyTaskIds];

    vi.mocked(loadTaskRegistry).mockResolvedValue(makeRegistryWithTasks(allTaskIds));

    const terminalEventsByTaskId = new Map<string, object[]>();
    for (const taskId of healthyTaskIds) {
      terminalEventsByTaskId.set(taskId, [
        makeValidTerminalEvent(`evt-${taskId}-1`, `Event from ${taskId}`),
      ]);
    }

    const callbacks: Array<() => void> = [];
    const watchFactory = vi.fn((_: string, __: { persistent: false }, callback: () => void) => {
      callbacks.push(callback);
      return { close: vi.fn() } as unknown as FSWatcher;
    });

    const fsAdapter = makeFsAdapter({ taskIds: allTaskIds, corruptTaskId, terminalEventsByTaskId });
    const readSnapshot = vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] });

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();
    for (const callback of callbacks) {
      callback();
    }
    await vi.advanceTimersByTimeAsync(300);

    // The warn log must include bounded context (taskId + reason).
    expect(logWarn).toHaveBeenCalledWith(
      'runtime_terminal_events.read_failed',
      expect.objectContaining({
        taskId: corruptTaskId,
        reason: expect.any(String),
      }),
    );

    // Healthy peers still emit.
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'TASK-Y' }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'TASK-Z' }),
    );

    stop();
  });

  it('event IDs are not marked seen when emitStreamEvent returns emitAccepted=false (metadata lag)', async () => {
    const { startRuntimeStreamWatcher } = await import('./runtimeStream');
    const taskId = 'TASK-LAGGED';
    const allTaskIds = [taskId];

    vi.mocked(loadTaskRegistry).mockResolvedValue(makeRegistryWithTasks(allTaskIds));

    const terminalEventsByTaskId = new Map<string, object[]>([
      [taskId, [makeValidTerminalEvent('evt-lag-1', 'Early event from lagged task')]],
    ]);

    // First poll: emitStreamEvent returns emitAccepted=false (metadata missing).
    // Subsequent polls: emitStreamEvent returns emitAccepted=true.
    emitStreamEvent
      .mockReturnValueOnce({ emitAccepted: false })
      .mockReturnValue({ emitAccepted: true });

    const callbacks: Array<() => void> = [];
    const watchFactory = vi.fn((_: string, __: { persistent: false }, callback: () => void) => {
      callbacks.push(callback);
      return { close: vi.fn() } as unknown as FSWatcher;
    });

    const fsAdapter = makeFsAdapter({ taskIds: allTaskIds, terminalEventsByTaskId });
    const readSnapshot = vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] });

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    // First poll — emitStreamEvent returns emitAccepted=false.
    await vi.runAllTimersAsync();
    for (const cb of callbacks) {
      cb();
    }
    await vi.advanceTimersByTimeAsync(300);

    // emitStreamEvent was called but returned false — event ID must NOT be marked seen.
    const allCalls = emitStreamEvent.mock.calls as unknown as Array<[{ message?: string }]>;
    const callsForLaggedEvent = allCalls.filter(
      (c) => c[0]?.message === 'Early event from lagged task',
    );
    expect(callsForLaggedEvent.length).toBeGreaterThanOrEqual(1);

    // Second poll — emitStreamEvent returns emitAccepted=true.
    for (const cb of callbacks) {
      cb();
    }
    await vi.advanceTimersByTimeAsync(300);

    // The event must have been retried (called again) because not marked seen.
    const totalCalls = emitStreamEvent.mock.calls as unknown as Array<[{ message?: string }]>;
    const totalCallsForLaggedEvent = totalCalls.filter(
      (c) => c[0]?.message === 'Early event from lagged task',
    );
    // Must have been called at least twice (first poll rejected, second poll accepted).
    expect(totalCallsForLaggedEvent.length).toBeGreaterThanOrEqual(2);

    stop();
  });
});
