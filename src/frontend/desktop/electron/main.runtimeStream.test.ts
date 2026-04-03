// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';

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
    agentId: 'software-engineer',
    agentLabel: 'Dalton · dalton-1',
    sessionId: 'parallel:dalton-1',
    instanceId: 'dalton-1',
    launchPid: 1234,
    liveness: 'alive',
    stuckState: 'none',
    stuckReason: null,
    sliceId: 'slice-01',
    slicePath: 'AgentWorkSpace/ImplementationSteps/slice-01.md',
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
    receiptPath: '.platform-state/runtime/guardrails/software-engineer-dalton-1.json',
    sessionId: 'parallel:dalton-1',
    agentId: 'software-engineer',
    agentLabel: 'Dalton · dalton-1',
    instanceId: 'dalton-1',
    status: 'allowed',
    severity: 'info',
    summary: 'Compliant runtime launch recorded.',
    validatorMode: 'runtime',
    launchSeam: 'desktop',
    expectedAgentId: 'software-engineer',
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
});
