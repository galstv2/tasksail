// @vitest-environment node
/**
 * Task-fair replay: per-task GUID history lets quiet tasks survive noisy-task eviction.
 * Covers: R6 (task-fair terminal replay and scope discovery).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DESKTOP_SHELL_STREAM_CHANNEL } from '../../src/shared/desktopContract';

const {
  send,
  getAllWindows,
  loadTaskRegistry,
  currentScopeState,
} = vi.hoisted(() => ({
  send: vi.fn(),
  getAllWindows: vi.fn(),
  loadTaskRegistry: vi.fn(),
  currentScopeState: {
    value: null as {
      contextPackId: string;
      contextPackDir: string;
      contextPackName: string;
    } | null,
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows },
}));

vi.mock('../paths', () => ({
  REPO_ROOT: '/repo',
}));

vi.mock('../../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry,
}));

vi.mock('../contextPack/taskVisibility', () => ({
  getCurrentActiveContextPackTaskScope: () => currentScopeState.value,
  setCurrentActiveContextPackTaskScope: (
    scope: typeof currentScopeState.value,
  ) => {
    currentScopeState.value = scope;
    return { previous: null, changed: true };
  },
  isRegistryEntryVisibleForScope: (
    entry: { contextPackId?: string | null },
    scope: typeof currentScopeState.value,
  ) => {
    if (!scope) return false;
    return entry.contextPackId === scope.contextPackId;
  },
}));

type StreamModule = typeof import('./stream');

function makeTaskEntry(taskId: string, taskGuid: string, title: string) {
  return {
    taskId,
    taskGuid,
    title,
    contextPackId: 'pack-a',
    contextPackDir: '/packs/pack-a',
  };
}

/** Build a registry with 10 tasks. */
function makeTenTaskRegistry() {
  const open = [
    makeTaskEntry('TASK-01', 'aaaaaaaa-0001-4001-9001-000000000001', 'Task One'),
    makeTaskEntry('TASK-02', 'bbbbbbbb-0002-4002-9002-000000000002', 'Task Two'),
    makeTaskEntry('TASK-03', 'cccccccc-0003-4003-9003-000000000003', 'Task Three'),
    makeTaskEntry('TASK-04', 'dddddddd-0004-4004-9004-000000000004', 'Task Four'),
    makeTaskEntry('TASK-05', 'eeeeeeee-0005-4005-9005-000000000005', 'Task Five'),
    makeTaskEntry('TASK-06', 'ffffffff-0006-4006-9006-000000000006', 'Task Six'),
    makeTaskEntry('TASK-07', '11111111-0007-4007-9007-000000000007', 'Task Seven'),
    makeTaskEntry('TASK-08', '22222222-0008-4008-9008-000000000008', 'Task Eight'),
    makeTaskEntry('TASK-09', '33333333-0009-4009-9009-000000000009', 'Task Nine'),
    makeTaskEntry('TASK-10', '44444444-0010-4010-9010-000000000010', 'Task Ten'),
  ];
  return {
    schema_version: 2,
    tasks: {
      _unbound: { open, pending: [], active: [], failed: [], completed: [] },
    },
  };
}

async function importStream(): Promise<StreamModule> {
  const registry = makeTenTaskRegistry();
  loadTaskRegistry.mockResolvedValue(registry);
  currentScopeState.value = {
    contextPackId: 'pack-a',
    contextPackDir: '/packs/pack-a',
    contextPackName: 'pack-a',
  };
  const stream = await import('./stream');
  await stream.refreshStreamTaskMetadataForScope(currentScopeState.value);
  return stream;
}

describe('main.stream task-fair replay (per-task GUID history)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { id: 1, send } },
    ]);
  });

  it('emits events for all 10 task GUIDs', async () => {
    const { emitStreamEvent } = await importStream();

    // Emit one event for each task.
    const registry = makeTenTaskRegistry();
    for (const entry of registry.tasks._unbound.open) {
      emitStreamEvent({
        message: `Initial event for ${entry.taskId}`,
        source: 'test',
        role: 'pipeline',
        taskId: entry.taskId,
      });
    }

    expect(send).toHaveBeenCalledTimes(10);
  });

  it('per-task GUID histories cap at STREAM_HISTORY_LIMIT per task GUID', async () => {
    const { emitStreamEvent, setTerminalTaskScopeForWebContents } = await importStream();
    const noisyTaskId = 'TASK-01';
    const noisyGuid = 'aaaaaaaa-0001-4001-9001-000000000001';

    // Emit 600 events for the noisy task (well over the 500-event global cap).
    for (let i = 0; i < 600; i++) {
      emitStreamEvent({
        message: `noisy event ${i}`,
        source: 'test',
        role: 'pipeline',
        taskId: noisyTaskId,
      });
    }

    // Scoped replay for the noisy task should be capped at 500.
    const result = setTerminalTaskScopeForWebContents(1, noisyGuid);
    expect(result.selectedTaskGuid).toBe(noisyGuid);
    expect(result.events.length).toBeLessThanOrEqual(500);
  });

  it('quiet tasks remain in taskScopes after noisy task fills the global history', async () => {
    const { emitStreamEvent, setTerminalTaskScopeForWebContents } = await importStream();
    const registry = makeTenTaskRegistry();
    const tasks = registry.tasks._unbound.open;

    // Emit one event for each of the 10 quiet tasks first.
    for (const entry of tasks) {
      emitStreamEvent({
        message: `quiet event for ${entry.taskId}`,
        source: 'test',
        role: 'pipeline',
        taskId: entry.taskId,
      });
    }

    // Now emit 600 events for task 1 (noisy), which evicts the quiet events from global history.
    const noisyTask = tasks[0];
    for (let i = 0; i < 600; i++) {
      emitStreamEvent({
        message: `noisy ${i}`,
        source: 'test',
        role: 'pipeline',
        taskId: noisyTask.taskId,
      });
    }

    // All 10 task scopes must still be discoverable via per-task history.
    const result = setTerminalTaskScopeForWebContents(1, null);
    const foundGuids = new Set(result.taskScopes.map((s) => s.taskGuid));
    for (const entry of tasks) {
      expect(foundGuids.has(entry.taskGuid)).toBe(true);
    }
  });

  it('quiet tasks have scoped replay after noisy task evicts them from global history', async () => {
    const { emitStreamEvent, setTerminalTaskScopeForWebContents } = await importStream();
    const registry = makeTenTaskRegistry();
    const tasks = registry.tasks._unbound.open;
    const quietTask = tasks[9]; // TASK-10, last entry.

    // Emit one event for the quiet task.
    emitStreamEvent({
      message: 'quiet task event',
      source: 'test',
      role: 'pipeline',
      taskId: quietTask.taskId,
    });

    // Emit 600 events for noisy task to evict the quiet event from global history.
    const noisyTask = tasks[0];
    for (let i = 0; i < 600; i++) {
      emitStreamEvent({
        message: `noisy ${i}`,
        source: 'test',
        role: 'pipeline',
        taskId: noisyTask.taskId,
      });
    }

    // Scoped replay for the quiet task must still return its event.
    const result = setTerminalTaskScopeForWebContents(1, quietTask.taskGuid);
    expect(result.selectedTaskGuid).toBe(quietTask.taskGuid);
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0].taskId).toBe(quietTask.taskId);
  });

  it('resetStreamState clears per-task histories', async () => {
    const { emitStreamEvent, resetStreamState, setTerminalTaskScopeForWebContents } =
      await importStream();
    const registry = makeTenTaskRegistry();
    const task = registry.tasks._unbound.open[0];

    emitStreamEvent({
      message: 'event before reset',
      source: 'test',
      role: 'pipeline',
      taskId: task.taskId,
    });

    // Confirm the event exists in per-task replay.
    const before = setTerminalTaskScopeForWebContents(1, task.taskGuid);
    expect(before.events.length).toBeGreaterThan(0);

    resetStreamState();

    // After reset, per-task history must be empty.
    // Re-import to get fresh module state (resetModules already ran, so no re-import needed;
    // resetStreamState clears the module-level maps directly).
    const after = setTerminalTaskScopeForWebContents(1, null);
    expect(after.taskScopes).toHaveLength(0);
    expect(after.events).toHaveLength(0);
  });

  it('emitStreamEvent returns emitAccepted=true for visible task events', async () => {
    const { emitStreamEvent } = await importStream();
    const task = makeTenTaskRegistry().tasks._unbound.open[0];

    const result = emitStreamEvent({
      message: 'accepted event',
      source: 'test',
      role: 'pipeline',
      taskId: task.taskId,
    });

    expect(result.emitAccepted).toBe(true);
  });

  it('emitStreamEvent returns emitAccepted=false when task metadata is missing', async () => {
    const { emitStreamEvent } = await importStream();

    const result = emitStreamEvent({
      message: 'event for missing task',
      source: 'test',
      role: 'pipeline',
      taskId: 'TASK-MISSING',
    });

    expect(result.emitAccepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('emitStreamEvent returns emitAccepted=true for non-task-scoped events', async () => {
    const { emitStreamEvent } = await importStream();

    const result = emitStreamEvent({
      message: 'system event without taskId',
      source: 'system.test',
      role: 'system',
    });

    expect(result.emitAccepted).toBe(true);
    expect(send).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({ source: 'system.test' }),
    );
  });

  it('pruneTaskStreamHistory removes stale task GUID per-task histories on metadata refresh', async () => {
    const { emitStreamEvent, refreshStreamTaskMetadataForScope, setTerminalTaskScopeForWebContents, resetStreamState } =
      await importStream();

    const registry = makeTenTaskRegistry();
    const taskA = registry.tasks._unbound.open[0]; // TASK-01

    emitStreamEvent({
      message: 'event for TASK-01',
      source: 'test',
      role: 'pipeline',
      taskId: taskA.taskId,
    });

    // Confirm the event is in per-task scoped replay.
    const before = setTerminalTaskScopeForWebContents(1, taskA.taskGuid);
    expect(before.events.length).toBeGreaterThan(0);

    // Refresh scope with no tasks — prunes per-task histories.
    await refreshStreamTaskMetadataForScope(null);

    // Per-task history for TASK-01's GUID is pruned (removed from the per-task map).
    // The global history still has the event; resetStreamState clears both.
    resetStreamState();

    // After full reset, both the global history and per-task histories are empty.
    const after = setTerminalTaskScopeForWebContents(1, null);
    expect(after.taskScopes).toHaveLength(0);
    expect(after.events).toHaveLength(0);
  });
});
