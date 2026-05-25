// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';
import type { AgentTerminalSession } from '../src/shared/desktopContract';
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
        pending: ['TASK-A'].map((taskId) => ({
          taskId,
          fileName: `${taskId}.md`,
          title: taskId,
          state: 'pending',
          contextPackId: 'pack-a',
          contextPackDir: '/packs/pack-a',
          scopeMode: 'focused',
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
  })),
}));

describe('main.runtimeStream canonical fallback suppression', () => {
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

  it.each([
    ['running', 'agent.launch.started:provider-builder:initial:launch-1', 'Is running.', 'running', undefined],
    ['completed', 'agent.launch.terminal:provider-builder:initial:launch-2', 'Completed.', 'completed', 'completed'],
    ['failed', 'agent.launch.terminal:provider-builder:initial:launch-3', 'Failed.', 'failed', 'artifact-incomplete'],
  ] as const)('suppresses generic %s fallback when matching canonical backend launch exists', async (_name, eventId, message, terminalState, outcome) => {
    const messages = await runScenario({
      canonicalEvents: [canonicalEvent(eventId, outcome)],
      previousSession: terminalState === 'running' ? undefined : session({ sessionId: sessionIdFromEvent(eventId), terminalState: 'running' }),
      nextSession: session({ sessionId: sessionIdFromEvent(eventId), terminalState }),
    });

    expect(messages).not.toContain(message);
  });

  it('keeps generic fallback when no matching canonical backend launch exists', async () => {
    const messages = await runScenario({
      canonicalEvents: [],
      nextSession: session({
        sessionId: 'role:provider-builder:launch-4',
        terminalState: 'running',
      }),
    });

    expect(messages).toContain('Is running.');
  });

  it('suppresses terminal fallback regardless of canonical terminal outcome', async () => {
    const messages = await runScenario({
      canonicalEvents: [canonicalEvent('agent.launch.terminal:provider-builder:initial:launch-6', 'failed')],
      previousSession: session({ sessionId: 'role:provider-builder:launch-6', terminalState: 'running' }),
      nextSession: session({ sessionId: 'role:provider-builder:launch-6', terminalState: 'completed' }),
    });

    expect(messages).not.toContain('Completed.');
  });

  it('keeps generic fallback when matching canonical backend launch is hidden', async () => {
    const messages = await runScenario({
      canonicalEvents: [{ ...canonicalEvent('agent.launch.started:provider-builder:initial:launch-7'), visible: false }],
      nextSession: session({
        sessionId: 'role:provider-builder:launch-7',
        terminalState: 'running',
      }),
    });

    expect(messages).toContain('Is running.');
  });

  it('keeps stuck and orphaned observations visible with canonical launch events present', async () => {
    const messages = await runScenario({
      canonicalEvents: [canonicalEvent('agent.launch.started:provider-builder:initial:launch-5')],
      previousSession: session({
        sessionId: 'role:provider-builder:launch-5',
        terminalState: 'running',
        stuckState: 'none',
      }),
      nextSession: session({
        sessionId: 'role:provider-builder:launch-5',
        terminalState: 'running',
        stuckState: 'suspected-stuck',
      }),
    });

    expect(messages).toContain('May be stuck.');
  });
});

function canonicalEvent(eventId: string, outcome?: string): Record<string, unknown> {
  return {
    eventId,
    source: 'runtime.agent',
    role: 'agent',
    severity: outcome === undefined || outcome === 'completed' ? 'success' : 'error',
    message: 'Canonical launch event.',
    visible: true,
    ...(outcome ? { extra: { outcome } } : {}),
  };
}

function session(overrides: Partial<AgentTerminalSession>): AgentTerminalSession {
  return {
    taskId: 'TASK-A',
    agentId: 'provider-builder',
    agentLabel: 'Dalton',
    sessionId: 'role:provider-builder:launch-1',
    instanceId: null,
    sliceId: null,
    slicePath: null,
    launchPid: 1234,
    liveness: 'alive',
    stuckState: 'none',
    stuckReason: null,
    launchState: 'started',
    terminalState: 'running',
    lastUpdatedAt: '2026-03-28T22:00:00.000Z',
    latestOutputLines: [],
    stdoutLogPath: null,
    stderrLogPath: null,
    severity: 'info',
    ...overrides,
  };
}

function sessionIdFromEvent(eventId: string): string {
  return `role:provider-builder:${eventId.split(':').at(-1)}`;
}

async function runScenario(options: {
  canonicalEvents: Array<Record<string, unknown>>;
  previousSession?: AgentTerminalSession;
  nextSession: AgentTerminalSession;
}): Promise<string[]> {
  const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
  const transcriptFiles = new Map<string, string>();
  const activeCallbacks: Array<() => void> = [];
  const readSnapshot = vi.fn()
    .mockResolvedValueOnce({ agentTerminalSessions: options.previousSession ? [options.previousSession] : [], guardrails: [] })
    .mockResolvedValueOnce({ agentTerminalSessions: [options.nextSession], guardrails: [] });
  const fsAdapter = {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async (filePath: string) => {
      if (!filePath.endsWith('.platform-state/runtime/tasks/TASK-A/terminal-events.json')) {
        throw Object.assign(new Error(`Unexpected readFile: ${filePath}`), { code: 'ENOENT' });
      }
      const existing = transcriptFiles.get(filePath);
      if (existing !== undefined) return existing;
      if (options.canonicalEvents.length > 0) return JSON.stringify({ events: options.canonicalEvents });
      throw Object.assign(new Error(`Missing transcript: ${filePath}`), { code: 'ENOENT' });
    }),
    readdir: vi.fn(async () => ['TASK-A']),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async (oldPath: string, newPath: string) => {
      const content = transcriptFiles.get(oldPath);
      if (content !== undefined) {
        transcriptFiles.set(newPath, content);
        transcriptFiles.delete(oldPath);
      }
    }),
    rm: vi.fn(async (filePath: string) => {
      transcriptFiles.delete(filePath);
    }),
    writeFile: vi.fn(async (filePath: string, contents: string) => {
      transcriptFiles.set(filePath, contents);
    }),
  };
  const stop = startRuntimeStreamWatcher({
    fsAdapter,
    readSnapshot,
    watchFactory: vi.fn((target: string, _: { persistent: false }, callback: () => void) => {
      if (target.endsWith('AgentWorkSpace/pendingitems/.active-items')) activeCallbacks.push(callback);
      return { close: vi.fn() } as unknown as FSWatcher;
    }) as unknown as typeof import('node:fs').watch,
  });

  await vi.runAllTimersAsync();
  activeCallbacks[0]?.();
  await vi.advanceTimersByTimeAsync(200);
  stop();
  return emitStreamEvent.mock.calls.map(([event]) => event.message);
}
