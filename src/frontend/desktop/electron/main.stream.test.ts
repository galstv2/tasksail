// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DESKTOP_SHELL_STREAM_CHANNEL } from '../src/shared/desktopContract';

const {
  send,
  getAllWindows,
  loadTaskRegistry,
  currentScopeState,
} = vi.hoisted(() => ({
  send: vi.fn(),
  getAllWindows: vi.fn(),
  loadTaskRegistry: vi.fn(),
  currentScopeState: { value: null as { contextPackId: string; contextPackDir: string; contextPackName: string } | null },
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows,
  },
}));

vi.mock('./paths', () => ({
  REPO_ROOT: '/repo',
}));

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry,
}));

vi.mock('./main.contextPackTaskVisibility', () => ({
  getCurrentActiveContextPackTaskScope: () => currentScopeState.value,
  setCurrentActiveContextPackTaskScope: (scope: typeof currentScopeState.value) => {
    currentScopeState.value = scope;
    return { previous: null, changed: true };
  },
  isRegistryEntryVisibleForScope: (
    entry: { contextPackId?: string | null; contextPackDir?: string | null },
    scope: typeof currentScopeState.value,
  ) => {
    if (!scope) {
      return false;
    }
    return (entry.contextPackId?.trim() || null)
      ? entry.contextPackId === scope.contextPackId
      : entry.contextPackDir === scope.contextPackDir;
  },
}));

type StreamModule = typeof import('./main.stream');

async function importStreamWithRegistry(registry: unknown): Promise<StreamModule> {
  loadTaskRegistry.mockResolvedValue(registry);
  const stream = await import('./main.stream');
  await stream.refreshStreamTaskMetadataForScope(currentScopeState.value);
  return stream;
}

describe('main.stream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { id: 1, send },
      },
    ]);
    loadTaskRegistry.mockResolvedValue({ schema_version: 2, tasks: {} });
    currentScopeState.value = {
      contextPackId: 'pack-a',
      contextPackDir: '/packs/pack-a',
      contextPackName: 'pack-a',
    };
  });

  it('emits ISO timestamps so renderer can format local 24-hour time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T04:19:27.000Z'));
    const { emitStreamEvent } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {},
    });

    emitStreamEvent({
      message: 'Planner session started.',
      source: 'planner.startSession',
      role: 'planner',
    });

    expect(send).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        timestamp: '2026-05-23T04:19:27.000Z',
      }),
    );
  });

  it('prefixes task-scoped terminal messages with a stable registry GUID per task', async () => {
    const { emitStreamEvent } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
             {
                 taskId: 'TASK-A',
                 taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
                 title: 'Task Alpha',
                 contextPackId: 'pack-a',
                 contextPackDir: '/packs/pack-a',
             },
          ],
          pending: [],
          active: [
             {
               taskId: 'TASK-B',
               taskGuid: 'cafef00d-abcd-4abc-9abc-abcdef123456',
               contextPackId: 'pack-a',
               contextPackDir: '/packs/pack-a',
             },
          ],
          failed: [],
          completed: [],
        },
      },
    });

    emitStreamEvent({
      message: 'Completed.',
      source: 'runtime.agentSession',
      role: 'agent',
      taskId: 'TASK-A',
    });
    emitStreamEvent({
      message: 'Code capture completed.',
      source: 'runtime.pipeline',
      role: 'pipeline',
      taskId: 'TASK-A',
    });
    emitStreamEvent({
      message: 'Launch started.',
      source: 'runtime.agentSession',
      role: 'agent',
      taskId: 'TASK-B',
    });

    expect(send).toHaveBeenNthCalledWith(
      1,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-A',
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        taskShortGuid: 'feedbeef',
        taskTitle: 'Task Alpha',
        message: 'Task [feedbeef] - Completed.',
      }),
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-A',
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        taskShortGuid: 'feedbeef',
        taskTitle: 'Task Alpha',
        message: 'Task [feedbeef] - Code capture completed.',
      }),
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-B',
        taskGuid: 'cafef00d-abcd-4abc-9abc-abcdef123456',
        taskShortGuid: 'cafef00d',
        taskTitle: null,
        message: 'Task [cafef00d] - Launch started.',
      }),
    );
  });

  it('does not reload the registry while emitting repeated events after metadata refresh', async () => {
    const { emitStreamEvent } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
            {
              taskId: 'TASK-A',
              taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
              title: 'Task Alpha',
              contextPackId: 'pack-a',
              contextPackDir: '/packs/pack-a',
            },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    expect(loadTaskRegistry).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 100; index += 1) {
      emitStreamEvent({
        message: `Event ${index}`,
        source: 'test',
        role: 'pipeline',
        taskId: 'TASK-A',
      });
    }

    expect(loadTaskRegistry).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(100);
  });

  it('includes the actor after the task GUID for task-scoped actor messages', async () => {
    const { emitStreamEvent } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
            {
              taskId: 'TASK-A',
              taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
              contextPackId: 'pack-a',
              contextPackDir: '/packs/pack-a',
            },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });

    emitStreamEvent({
      message: 'Is running.',
      source: 'runtime.agentSession',
      role: 'agent',
      taskId: 'TASK-A',
      actorName: 'Alice (Product Manager)',
    });

    expect(send).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-A',
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        taskShortGuid: 'feedbeef',
        taskTitle: null,
        actorName: 'Alice (Product Manager)',
        message: 'Task [feedbeef] - Alice (Product Manager): Is running.',
      }),
    );
  });

  it('leaves non-task and already-prefixed messages unchanged', async () => {
    const { emitStreamEvent } = await import('./main.stream');

    emitStreamEvent({
      message: 'Backend services started.',
      source: 'services.startBackend',
      role: 'system',
    });
    emitStreamEvent({
      message: 'Task [deadbeef] - Already tagged.',
      source: 'runtime.pipeline',
      role: 'pipeline',
      taskId: 'TASK-C',
    });

    expect(send).toHaveBeenNthCalledWith(
      1,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'N/A',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        message: 'Backend services started.',
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('drops task-scoped events when task registry lookup misses', async () => {
    const { emitStreamEvent } = await import('./main.stream');

    emitStreamEvent({
      message: 'Completed.',
      source: 'runtime.agentSession',
      role: 'agent',
      taskId: 'TASK-MISSING',
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('drops task-scoped events that belong to a hidden context pack', async () => {
    const { emitStreamEvent } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
            {
              taskId: 'TASK-A',
              taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
              title: 'Alpha',
              contextPackId: 'pack-a',
              contextPackDir: '/packs/pack-a',
            },
            {
              taskId: 'TASK-B',
              taskGuid: 'cafef00d-abcd-4abc-9abc-abcdef123456',
              title: 'Beta',
              contextPackId: 'pack-b',
              contextPackDir: '/packs/pack-b',
            },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });

    emitStreamEvent({ message: 'A1.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    emitStreamEvent({ message: 'B1.', source: 'test', role: 'pipeline', taskId: 'TASK-B' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-A',
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
      }),
    );
  });

  it('filters future events per webContents task scope and replays matching history', async () => {
    const {
      emitStreamEvent,
      setTerminalTaskScopeForWebContents,
    } = await importStreamWithRegistry({
      tasks: {
        _unbound: {
          open: [
            { taskId: 'TASK-A', taskGuid: 'feedbeef-1234-4234-9234-123456789abc', title: 'Alpha', contextPackId: 'pack-a', contextPackDir: '/packs/pack-a' },
            { taskId: 'TASK-B', taskGuid: 'cafef00d-abcd-4abc-9abc-abcdef123456', title: 'Beta', contextPackId: 'pack-a', contextPackDir: '/packs/pack-a' },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });

    emitStreamEvent({ message: 'A1.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    emitStreamEvent({ message: 'B1.', source: 'test', role: 'pipeline', taskId: 'TASK-B' });

    const replay = setTerminalTaskScopeForWebContents(
      1,
      'feedbeef-1234-4234-9234-123456789abc',
    );
    expect(replay.selectedTaskGuid).toBe('feedbeef-1234-4234-9234-123456789abc');
    expect(replay.events.map((event) => event.taskId)).toEqual(['TASK-A']);
    expect(replay.taskScopes.map((scope) => scope.title)).toEqual(['Alpha', 'Beta']);

    send.mockClear();
    getAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { id: 1, send } },
      { isDestroyed: () => false, webContents: { id: 2, send } },
    ]);
    emitStreamEvent({ message: 'B2.', source: 'test', role: 'pipeline', taskId: 'TASK-B' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({ taskId: 'TASK-B' }),
    );
  });

  it('keeps different task scopes isolated per webContents id', async () => {
    const {
      emitStreamEvent,
      setTerminalTaskScopeForWebContents,
    } = await importStreamWithRegistry({
      tasks: {
        _unbound: {
          open: [
            { taskId: 'TASK-A', taskGuid: 'feedbeef-1234-4234-9234-123456789abc', title: 'Alpha', contextPackId: 'pack-a', contextPackDir: '/packs/pack-a' },
            { taskId: 'TASK-B', taskGuid: 'cafef00d-abcd-4abc-9abc-abcdef123456', title: 'Beta', contextPackId: 'pack-a', contextPackDir: '/packs/pack-a' },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });
    const sendA = vi.fn();
    const sendB = vi.fn();

    emitStreamEvent({ message: 'A1.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    emitStreamEvent({ message: 'B1.', source: 'test', role: 'pipeline', taskId: 'TASK-B' });
    setTerminalTaskScopeForWebContents(1, 'feedbeef-1234-4234-9234-123456789abc');
    setTerminalTaskScopeForWebContents(2, 'cafef00d-abcd-4abc-9abc-abcdef123456');

    getAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { id: 1, send: sendA } },
      { isDestroyed: () => false, webContents: { id: 2, send: sendB } },
    ]);

    emitStreamEvent({ message: 'A2.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    emitStreamEvent({ message: 'B2.', source: 'test', role: 'pipeline', taskId: 'TASK-B' });

    expect(sendA).toHaveBeenCalledTimes(1);
    expect(sendA).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({ taskId: 'TASK-A' }),
    );
    expect(sendB).toHaveBeenCalledTimes(1);
    expect(sendB).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({ taskId: 'TASK-B' }),
    );
  });

  it('unknown task scope resets to all tasks and clear removes only one window scope', async () => {
    const {
      clearTerminalTaskScopeForWebContents,
      emitStreamEvent,
      setTerminalTaskScopeForWebContents,
    } = await importStreamWithRegistry({
      tasks: {
        _unbound: {
          open: [
            { taskId: 'TASK-A', taskGuid: 'feedbeef-1234-4234-9234-123456789abc', title: 'Alpha', contextPackId: 'pack-a', contextPackDir: '/packs/pack-a' },
            { taskId: 'TASK-B', taskGuid: 'cafef00d-abcd-4abc-9abc-abcdef123456', title: 'Beta', contextPackId: 'pack-a', contextPackDir: '/packs/pack-a' },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });

    emitStreamEvent({ message: 'A1.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    emitStreamEvent({ message: 'B1.', source: 'test', role: 'pipeline', taskId: 'TASK-B' });
    setTerminalTaskScopeForWebContents(1, 'feedbeef-1234-4234-9234-123456789abc');
    setTerminalTaskScopeForWebContents(2, 'cafef00d-abcd-4abc-9abc-abcdef123456');

    const unknown = setTerminalTaskScopeForWebContents(1, 'missing-guid');
    expect(unknown.selectedTaskGuid).toBeNull();
    expect(unknown.events).toHaveLength(2);
    expect(unknown.message).toBe('Unknown terminal task scope; reset to all tasks.');

    clearTerminalTaskScopeForWebContents(2);
    send.mockClear();
    getAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { id: 1, send } },
      { isDestroyed: () => false, webContents: { id: 2, send } },
    ]);
    emitStreamEvent({ message: 'A2.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('resetStreamState clears history, task metadata, and per-window scopes', async () => {
    const {
      emitStreamEvent,
      resetStreamState,
      setTerminalTaskScopeForWebContents,
    } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
            {
              taskId: 'TASK-A',
              taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
              title: 'Alpha',
              contextPackId: 'pack-a',
              contextPackDir: '/packs/pack-a',
            },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });

    emitStreamEvent({ message: 'A1.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    expect(setTerminalTaskScopeForWebContents(1, 'feedbeef-1234-4234-9234-123456789abc')).toEqual(
      expect.objectContaining({
        selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        events: [expect.objectContaining({ taskId: 'TASK-A' })],
        taskScopes: [expect.objectContaining({ taskGuid: 'feedbeef-1234-4234-9234-123456789abc' })],
      }),
    );

    resetStreamState();

    expect(setTerminalTaskScopeForWebContents(1, null)).toEqual(
      expect.objectContaining({
        selectedTaskGuid: null,
        events: [],
        taskScopes: [],
      }),
    );
    send.mockClear();
    emitStreamEvent({ message: 'A2.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns terminal task scope options only for visible context-pack tasks', async () => {
    const {
      emitStreamEvent,
      setTerminalTaskScopeForWebContents,
    } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
            {
              taskId: 'TASK-A',
              taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
              title: 'Alpha',
              contextPackId: 'pack-a',
              contextPackDir: '/packs/pack-a',
            },
            {
              taskId: 'TASK-B',
              taskGuid: 'cafef00d-abcd-4abc-9abc-abcdef123456',
              title: 'Beta',
              contextPackId: 'pack-b',
              contextPackDir: '/packs/pack-b',
            },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    });

    emitStreamEvent({ message: 'A1.', source: 'test', role: 'pipeline', taskId: 'TASK-A' });
    emitStreamEvent({ message: 'B1.', source: 'test', role: 'pipeline', taskId: 'TASK-B' });

    expect(setTerminalTaskScopeForWebContents(1, null).taskScopes).toEqual([
      expect.objectContaining({
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        taskId: 'TASK-A',
        title: 'Alpha',
      }),
    ]);
  });

  it('propagates optional realignmentId on emitted events when provided', async () => {
    const { emitStreamEvent: emit } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {},
    });

    emit({
      message: 'Realignment analysis archived.',
      source: 'runtime.realignment',
      role: 'workflow',
      taskId: 'N/A',
      realignmentId: 'RA-77',
    });

    expect(send).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({ realignmentId: 'RA-77', source: 'runtime.realignment' }),
    );
  });

  it('omits realignmentId from emitted events when not provided', async () => {
    const { emitStreamEvent: emit } = await importStreamWithRegistry({
      schema_version: 2,
      tasks: {},
    });

    emit({
      message: 'System event without realignmentId.',
      source: 'system.test',
      role: 'system',
    });

    const emittedEvent = send.mock.calls[0]?.[1] as { realignmentId?: string };
    expect(emittedEvent.realignmentId).toBeUndefined();
  });
});
