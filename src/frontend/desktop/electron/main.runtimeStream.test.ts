// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';

// Mock pipelineSupervisor so its module-load side effects don't run during these unit tests.
const mockListActivePipelines = vi.fn(() => [] as Array<{ taskId: string; pid: number; startedAt: string }>);

vi.mock('../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
  startPipeline: vi.fn(async () => ({ status: 'started', pid: 9999 })),
  stopPipeline: vi.fn(async () => undefined),
  stopAll: vi.fn(async () => undefined),
  listActivePipelines: mockListActivePipelines,
  recoverOnStartup: vi.fn(async () => undefined),
}));

import type {
  AgentTerminalSession,
  GuardrailObservation,
} from '../src/shared/desktopContract';

const emitStreamEvent = vi.fn();

vi.mock('./main.stream', () => ({
  emitStreamEvent,
}));

function makeSession(
  overrides: Partial<AgentTerminalSession> = {},
): AgentTerminalSession {
  return {
    taskId: 'CAP-001',
    agentId: 'provider-builder',
    agentLabel: 'Dalton · dalton-1',
    sessionId: 'parallel:dalton-1',
    instanceId: 'dalton-1',
    launchPid: 1234,
    liveness: 'alive',
    stuckState: 'none',
    stuckReason: null,
    sliceId: 'slice-01',
    slicePath: 'AgentWorkSpace/tasks/task-test-001/ImplementationSteps/slice-01.md',
    launchState: 'started',
    terminalState: 'running',
    lastUpdatedAt: '2026-03-28T22:00:00.000Z',
    latestOutputLines: ['working'],
    stdoutLogPath: null,
    stderrLogPath: null,
    severity: 'info',
    ...overrides,
  };
}

function makeGuardrail(
  overrides: Partial<GuardrailObservation> = {},
): GuardrailObservation {
  return {
    receiptPath: '.platform-state/runtime/tasks/CAP-001/guardrails/provider-builder-dalton-1.json',
    sessionId: 'parallel:dalton-1',
    agentId: 'provider-builder',
    agentLabel: 'Dalton · dalton-1',
    instanceId: 'dalton-1',
    status: 'allowed',
    severity: 'info',
    summary: 'Compliant runtime launch recorded.',
    validatorMode: 'runtime',
    launchSeam: 'desktop',
    expectedAgentId: 'provider-builder',
    requiredModel: 'gpt-4.1',
    activeModel: 'gpt-4.1',
    violationCount: 0,
    violations: [],
    ...overrides,
  };
}

describe('main.runtimeStream', () => {
  beforeEach(() => {
    emitStreamEvent.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a workflow event for a newly observed runtime session', async () => {
    const { diffRuntimeStreamEvents } = await import('./main.runtimeStream');

    const events = diffRuntimeStreamEvents(
      { agentTerminalSessions: [], guardrails: [] },
      { agentTerminalSessions: [makeSession()], guardrails: [] },
    );

    expect(events).toEqual([
      expect.objectContaining({
        role: 'workflow',
        source: 'runtime.agentSession',
        actorName: 'Dalton · dalton-1',
        taskId: 'CAP-001',
        message: 'Is running.',
        sessionContext: expect.objectContaining({
          sessionId: 'parallel:dalton-1',
          instanceId: 'dalton-1',
          sliceId: 'slice-01',
          launchState: 'started',
          terminalState: 'running',
        }),
      }),
    ]);
  });

  it('emits a new running event for a confinement retry runtime session', async () => {
    const { diffRuntimeStreamEvents } = await import('./main.runtimeStream');

    const initial = makeSession({
      agentId: 'dalton',
      agentLabel: 'Dalton (Software Engineer)',
      sessionId: 'role:dalton:initial-launch',
      instanceId: null,
      terminalState: 'completed',
      launchState: 'started',
    });
    const retry = makeSession({
      agentId: 'dalton',
      agentLabel: 'Dalton (Software Engineer) — Confinement retry',
      sessionId: 'role:dalton:retry-launch',
      instanceId: null,
      terminalState: 'running',
      launchState: 'started',
    });

    const events = diffRuntimeStreamEvents(
      { agentTerminalSessions: [initial], guardrails: [] },
      { agentTerminalSessions: [initial, retry], guardrails: [] },
    );

    expect(events).toEqual([
      expect.objectContaining({
        source: 'runtime.agentSession',
        actorName: 'Dalton (Software Engineer) — Confinement retry',
        message: 'Is running.',
        sessionContext: expect.objectContaining({
          sessionId: 'role:dalton:retry-launch',
        }),
      }),
    ]);
  });

  it('does not emit for rewrites that only change timestamps or output lines', async () => {
    const { diffRuntimeStreamEvents } = await import('./main.runtimeStream');

    const previous = makeSession();
    const next = makeSession({
      lastUpdatedAt: '2026-03-28T22:00:05.000Z',
      latestOutputLines: ['still working'],
    });

    const events = diffRuntimeStreamEvents(
      { agentTerminalSessions: [previous], guardrails: [] },
      { agentTerminalSessions: [next], guardrails: [] },
    );

    expect(events).toEqual([]);
  });

  it('emits and dedupes realignment job status transitions', async () => {
    const { diffRuntimeStreamEvents } = await import('./main.runtimeStream');

    expect(diffRuntimeStreamEvents(
      { agentTerminalSessions: [], guardrails: [], realignmentJobs: [] },
      {
        agentTerminalSessions: [],
        guardrails: [],
        realignmentJobs: [{
          jobId: 'realignment:RA-1',
          realignmentId: 'RA-1',
          status: 'running',
        }],
      },
    )).toEqual([
      expect.objectContaining({
        role: 'workflow',
        source: 'runtime.realignment',
        actorName: 'Ron - Realignment',
        taskId: 'N/A',
        message: 'Realignment analysis is running.',
      }),
    ]);

    expect(diffRuntimeStreamEvents(
      {
        agentTerminalSessions: [],
        guardrails: [],
        realignmentJobs: [{
          jobId: 'realignment:RA-1',
          realignmentId: 'RA-1',
          status: 'running',
        }],
      },
      {
        agentTerminalSessions: [],
        guardrails: [],
        realignmentJobs: [{
          jobId: 'realignment:RA-1',
          realignmentId: 'RA-1',
          status: 'running',
        }],
      },
    )).toEqual([]);

    expect(diffRuntimeStreamEvents(
      {
        agentTerminalSessions: [],
        guardrails: [],
        realignmentJobs: [{
          jobId: 'realignment:RA-1',
          realignmentId: 'RA-1',
          status: 'running',
        }],
      },
      {
        agentTerminalSessions: [],
        guardrails: [],
        realignmentJobs: [{
          jobId: 'realignment:RA-1',
          realignmentId: 'RA-1',
          status: 'archived',
          globalRealignmentVersion: 5,
        }],
      },
    )).toEqual([
      expect.objectContaining({
        source: 'runtime.realignment',
        severity: 'success',
        message: 'Realignment analysis archived.',
      }),
    ]);
  });

  it('watches realignment runtime receipts and emits terminal stream events', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    let realignmentEntries: string[] = [];
    const realignmentCallbacks: Array<() => void> = [];

    const watchFactory = vi.fn((target: string, _: { persistent: false }, callback: () => void) => {
      if (target.endsWith('.platform-state/runtime/realignment')) {
        realignmentCallbacks.push(callback);
      }
      return { close: vi.fn() } as unknown as FSWatcher;
    });

    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/realignment/RA-1/job.json')) {
          return JSON.stringify({
            jobId: 'realignment:RA-1',
            realignmentId: 'RA-1',
            status: 'error',
            reason: 'ron_failed',
          });
        }
        return '';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
          return [] as string[];
        }
        if (path.endsWith('.platform-state/runtime/realignment')) {
          return realignmentEntries;
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot: vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] }),
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();
    expect(emitStreamEvent).not.toHaveBeenCalled();

    realignmentEntries = ['RA-1'];
    realignmentCallbacks[0]?.();
    await vi.advanceTimersByTimeAsync(200);

    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'runtime.realignment',
        role: 'workflow',
        taskId: 'N/A',
        actorName: 'Ron - Realignment',
        severity: 'error',
        message: 'Realignment analysis failed. ron_failed',
      }),
    );

    stop();
  });

  it('emits a guardrail milestone when a receipt is newly observed', async () => {
    const { diffRuntimeStreamEvents } = await import('./main.runtimeStream');

    const session = makeSession();
    const guardrail = makeGuardrail({
      status: 'denied',
      severity: 'error',
      summary: 'Launch denied by repository guardrails.',
      violationCount: 2,
    });

    const events = diffRuntimeStreamEvents(
      { agentTerminalSessions: [session], guardrails: [] },
      { agentTerminalSessions: [session], guardrails: [guardrail] },
    );

    expect(events).toEqual([
      expect.objectContaining({
        role: 'system',
        source: 'runtime.guardrail',
        actorName: 'Dalton · dalton-1',
        severity: 'error',
        message: 'Launch denied by repository guardrails.',
        taskId: 'CAP-001',
      }),
    ]);
  });

  it('baselines the first snapshot and emits after a watched runtime transition', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    const callbacks: Array<() => void> = [];
    const closers: Array<ReturnType<typeof vi.fn>> = [];
    const watchFactory = vi.fn((_: string, __: { persistent: false }, callback: () => void) => {
      callbacks.push(callback);
      const close = vi.fn();
      closers.push(close);
      return { close } as unknown as FSWatcher;
    });

    const readSnapshot = vi.fn()
      .mockResolvedValueOnce({ agentTerminalSessions: [], guardrails: [] })
      .mockResolvedValueOnce({ agentTerminalSessions: [makeSession()], guardrails: [] });

    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async () => ''),
      readdir: vi.fn(async () => [] as string[]),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();
    expect(emitStreamEvent).not.toHaveBeenCalled();
    expect(callbacks.length).toBeGreaterThan(0);

    callbacks[0]?.();
    await vi.advanceTimersByTimeAsync(200);

    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'runtime.agentSession',
        actorName: 'Dalton · dalton-1',
        message: 'Is running.',
      }),
    );

    stop();
    for (const close of closers) {
      expect(close).toHaveBeenCalled();
    }
  });

  it('derives watch targets from .active-items/<taskId> markers', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    let activeEntries = ['TASK-A'];
    const watchedPaths: string[] = [];
    const activeCallbacks: Array<() => void> = [];
    const closeByPath = new Map<string, ReturnType<typeof vi.fn>>();

    const watchFactory = vi.fn((target: string, _: { persistent: false }, callback: () => void) => {
      watchedPaths.push(target);
      if (target.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
        activeCallbacks.push(callback);
      }
      const close = vi.fn();
      closeByPath.set(target, close);
      return { close } as unknown as FSWatcher;
    });

    const readSnapshot = vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] });
    const fsAdapter = {
      access: vi.fn(async (path: string) => {
        const allowed =
          path.endsWith('.platform-state') ||
          path.endsWith('.platform-state/runtime') ||
          path.endsWith('.platform-state/runtime/tasks') ||
          path.endsWith('AgentWorkSpace/pendingitems') ||
          path.endsWith('AgentWorkSpace/pendingitems/.active-items') ||
          path.includes('.platform-state/runtime/tasks/TASK-A');
        if (!allowed) {
          throw Object.assign(new Error(`Unexpected watch target: ${path}`), { code: 'ENOENT' });
        }
      }),
      readFile: vi.fn(async () => ''),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
          return activeEntries;
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();

    const roleSessionsPath = watchedPaths.find((path) =>
      path.endsWith('.platform-state/runtime/tasks/TASK-A/role-sessions'),
    );
    expect(roleSessionsPath).toBeDefined();
    expect(activeCallbacks.length).toBeGreaterThan(0);

    activeEntries = [];

    for (let i = 0; i < 3; i += 1) {
      activeCallbacks[0]?.();
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(closeByPath.get(roleSessionsPath ?? '')).toHaveBeenCalled();

    stop();
  });

  it('keeps removed active markers in the final-drain snapshot refresh', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    let activeEntries = ['TASK-A'];
    const activeCallbacks: Array<() => void> = [];

    const watchFactory = vi.fn((target: string, _: { persistent: false }, callback: () => void) => {
      if (target.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
        activeCallbacks.push(callback);
      }
      return { close: vi.fn() } as unknown as FSWatcher;
    });

    const readSnapshot = vi.fn()
      .mockResolvedValueOnce({
        agentTerminalSessions: [makeSession({ taskId: 'TASK-A', terminalState: 'running' })],
        guardrails: [],
      })
      .mockResolvedValueOnce({
        agentTerminalSessions: [makeSession({ taskId: 'TASK-A', terminalState: 'completed' })],
        guardrails: [],
      });

    const fsAdapter = {
      access: vi.fn(async (path: string) => {
        const allowed =
          path.endsWith('.platform-state') ||
          path.endsWith('.platform-state/runtime') ||
          path.endsWith('.platform-state/runtime/tasks') ||
          path.endsWith('AgentWorkSpace/pendingitems') ||
          path.endsWith('AgentWorkSpace/pendingitems/.active-items') ||
          path.includes('.platform-state/runtime/tasks/TASK-A');
        if (!allowed) {
          throw Object.assign(new Error(`Unexpected watch target: ${path}`), { code: 'ENOENT' });
        }
      }),
      readFile: vi.fn(async () => ''),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
          return activeEntries;
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();

    activeEntries = [];
    activeCallbacks[0]?.();
    await vi.advanceTimersByTimeAsync(200);

    expect(readSnapshot).toHaveBeenNthCalledWith(2, fsAdapter, expect.arrayContaining(['TASK-A']));
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Completed.',
        source: 'runtime.agentSession',
        taskId: 'TASK-A',
      }),
    );

    stop();
  });

  it('emits task-scoped pipeline phase events for each active task', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    const callbacksByPath = new Map<string, Array<(_: string, filename: string) => void>>();

    const watchFactory = vi.fn((
      target: string,
      _: { persistent: false },
      callback: (_eventType: string, filename: string) => void,
    ) => {
      callbacksByPath.set(target, [...(callbacksByPath.get(target) ?? []), callback]);
      return { close: vi.fn() } as unknown as FSWatcher;
    });

    const fsAdapter = {
      access: vi.fn(async (path: string) => {
        const allowed =
          path.endsWith('.platform-state') ||
          path.endsWith('.platform-state/runtime') ||
          path.endsWith('.platform-state/runtime/tasks') ||
          path.endsWith('AgentWorkSpace/pendingitems') ||
          path.endsWith('AgentWorkSpace/pendingitems/.active-items') ||
          path.includes('.platform-state/runtime/tasks/TASK-A') ||
          path.includes('.platform-state/runtime/tasks/TASK-B');
        if (!allowed) {
          throw Object.assign(new Error(`Unexpected watch target: ${path}`), { code: 'ENOENT' });
        }
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/tasks/TASK-A/pipeline-phase.json')) {
          return JSON.stringify({ phase: 'test-capture-started' });
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-B/pipeline-phase.json')) {
          return JSON.stringify({ phase: 'test-capture-completed' });
        }
        throw Object.assign(new Error(`Unexpected readFile: ${path}`), { code: 'ENOENT' });
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
          return ['TASK-A', 'TASK-B'];
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot: vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] }),
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();

    for (const [path, callbacks] of callbacksByPath) {
      if (
        path.endsWith('.platform-state/runtime/tasks/TASK-A') ||
        path.endsWith('.platform-state/runtime/tasks/TASK-B')
      ) {
        for (const callback of callbacks) {
          callback('change', 'pipeline-phase.json');
        }
      }
    }
    await vi.runAllTimersAsync();

    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Capturing test evidence.',
        source: 'runtime.pipeline',
        taskId: 'TASK-A',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Test evidence captured.',
        source: 'runtime.pipeline',
        taskId: 'TASK-B',
      }),
    );

    stop();
  });
});
