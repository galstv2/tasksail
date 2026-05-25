// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';
import { setCurrentActiveContextPackTaskScope } from './main.contextPackTaskVisibility';

const emitStreamEvent = vi.fn();

vi.mock('./main.stream', () => ({
  emitStreamEvent,
  refreshStreamTaskMetadataForScope: vi.fn(async () => undefined),
}));

vi.mock('../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
  startPipeline: vi.fn(async () => ({ status: 'started', pid: 9999 })),
  stopPipeline: vi.fn(async () => undefined),
  stopAll: vi.fn(async () => undefined),
  listActivePipelines: vi.fn(() => []),
  recoverOnStartup: vi.fn(async () => undefined),
}));

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry: vi.fn(async () => ({
    schema_version: 2,
    tasks: {
      'pack-a': {
        open: [],
        pending: [{
          taskId: 'TASK-A',
          fileName: 'TASK-A.md',
          title: 'TASK-A',
          state: 'pending',
          contextPackId: 'pack-a',
          contextPackDir: '/packs/pack-a',
          scopeMode: 'focused',
          selectedRepoIds: [],
          selectedFocusIds: [],
          createdAt: null,
          completedAt: null,
          archivePath: null,
        }],
        active: [],
        failed: [],
        completed: [],
      },
    },
  })),
}));

describe('main.runtimeStream agent lifecycle terminal events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitStreamEvent.mockClear();
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

  it('forwards visible canonical agent lifecycle records as Agent events with actor identity', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (filePath: string) => {
        if (!filePath.endsWith('.platform-state/runtime/tasks/TASK-A/terminal-events.json')) {
          throw Object.assign(new Error(`Unexpected readFile: ${filePath}`), { code: 'ENOENT' });
        }
        return JSON.stringify({
          events: [
            terminalEvent('agent.launch.started:ron:cleanup:launch-1', 'Started Ron (cleanup).'),
            terminalEvent('agent.cleanup.started:ron:cleanup:launch-1', 'Agent cleanup started.', 'Ron (cleanup)'),
          ],
        });
      }),
      readdir: vi.fn(async () => ['TASK-A']),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };
    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot: vi.fn(async () => ({ agentTerminalSessions: [], guardrails: [] })),
      watchFactory: vi.fn(() => ({ close: vi.fn() }) as unknown as FSWatcher) as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();
    stop();

    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'runtime.agent',
      role: 'agent',
      message: 'Started Ron (cleanup).',
    }));
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'runtime.agent',
      role: 'agent',
      actorName: 'Ron (cleanup)',
      message: 'Agent cleanup started.',
    }));
  });
});

function terminalEvent(eventId: string, message: string, actorName?: string): Record<string, unknown> {
  return {
    eventId,
    source: 'runtime.agent',
    role: 'agent',
    severity: 'info',
    visible: true,
    message,
    createdAt: '2026-05-25T00:00:00.000Z',
    ...(actorName ? { actorName } : {}),
  };
}
