// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';
import { setCurrentActiveContextPackTaskScope } from './main.contextPackTaskVisibility';

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
  ContextPackListResponse,
  GuardrailObservation,
} from '../src/shared/desktopContract';
import type { TaskRegistry } from '../../../backend/platform/queue/taskRegistry.js';

const emitStreamEvent = vi.fn();
const refreshStreamTaskMetadataForScope = vi.fn(async () => undefined);

vi.mock('./main.stream', () => ({
  emitStreamEvent,
  refreshStreamTaskMetadataForScope,
}));

function makeDefaultTaskRegistry(): TaskRegistry {
  return {
  schema_version: 2,
  tasks: {
    'pack-a': {
      open: [],
      pending: ['CAP-001', 'TASK-A', 'TASK-B', 'TASK-C', 'TASK-D', 'TASK-E', 'TASK-F'].map((taskId) => ({
        taskId,
        fileName: `${taskId}.md`,
        title: taskId,
        state: 'pending' as const,
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
  };
}

const loadTaskRegistry = vi.fn(async () => makeDefaultTaskRegistry());

function contextPackList(activePackId: string): ContextPackListResponse {
  return {
    action: 'contextPack.list',
    mode: 'read-only',
    message: 'Context packs listed.',
    activeContextPackDir: `/packs/${activePackId}`,
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: [{
      contextPackId: activePackId,
      displayName: `Pack ${activePackId}`,
      contextPackDir: `/packs/${activePackId}`,
      manifestPath: `/packs/${activePackId}/qmd/repo-sources.json`,
      bootstrapReady: true,
      source: 'configured-path',
      isActive: true,
      estateType: null,
      defaultScopeMode: null,
      repoCount: 1,
      primaryWorkingRepoIds: [],
      focusTargets: [],
    }],
  };
}

vi.mock('../../../backend/platform/queue/taskRegistry.js', () => ({
  loadTaskRegistry,
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
    refreshStreamTaskMetadataForScope.mockClear();
    loadTaskRegistry.mockImplementation(async () => makeDefaultTaskRegistry());
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

  it('emits an agent event for a newly observed runtime session', async () => {
    const { diffRuntimeStreamEvents } = await import('./main.runtimeStream');

    const events = diffRuntimeStreamEvents(
      { agentTerminalSessions: [], guardrails: [] },
      { agentTerminalSessions: [makeSession()], guardrails: [] },
    );

    expect(events).toEqual([
      expect.objectContaining({
        role: 'agent',
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
        role: 'agent',
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

  it('still emits Appears orphaned when a running session transitions to orphaned', async () => {
    const { diffRuntimeStreamEvents } = await import('./main.runtimeStream');

    const events = diffRuntimeStreamEvents(
      { agentTerminalSessions: [makeSession({ stuckState: 'none' })], guardrails: [] },
      {
        agentTerminalSessions: [makeSession({
          stuckState: 'orphaned',
          stuckReason: 'No terminal completion observed and the launched PID is no longer present.',
          severity: 'error',
        })],
        guardrails: [],
      },
    );

    expect(events).toEqual([
      expect.objectContaining({
        message: 'Appears orphaned.',
        source: 'runtime.agentSession',
        role: 'agent',
      }),
    ]);
  });

  it('still emits Completed after an orphaned session later completes', async () => {
    const { diffRuntimeStreamEvents } = await import('./main.runtimeStream');

    const events = diffRuntimeStreamEvents(
      {
        agentTerminalSessions: [makeSession({
          stuckState: 'orphaned',
          stuckReason: 'No terminal completion observed and the launched PID is no longer present.',
          severity: 'error',
        })],
        guardrails: [],
      },
      {
        agentTerminalSessions: [makeSession({
          stuckState: 'none',
          stuckReason: null,
          terminalState: 'completed',
          severity: 'success',
        })],
        guardrails: [],
      },
    );

    expect(events).toEqual([
      expect.objectContaining({
        message: 'Completed.',
        source: 'runtime.agentSession',
        role: 'agent',
        severity: 'success',
      }),
    ]);
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
        role: 'workflow',
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
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
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

  it('writes task guardrail diffs to transcript before emitting them', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    const callbacks: Array<() => void> = [];
    const transcriptFiles = new Map<string, string>();
    const session = makeSession();
    const guardrail = makeGuardrail({
      status: 'denied',
      severity: 'error',
      summary: 'Launch denied by repository guardrails.',
      violationCount: 2,
    });
    const updatedGuardrail = makeGuardrail({
      ...guardrail,
      summary: 'Launch denied by updated repository guardrails.',
    });

    const watchFactory = vi.fn((_: string, __: { persistent: false }, callback: () => void) => {
      callbacks.push(callback);
      return { close: vi.fn() } as unknown as FSWatcher;
    });
    const readSnapshot = vi.fn()
      .mockResolvedValueOnce({ agentTerminalSessions: [session], guardrails: [] })
      .mockResolvedValueOnce({ agentTerminalSessions: [session], guardrails: [guardrail] })
      .mockResolvedValueOnce({ agentTerminalSessions: [session], guardrails: [updatedGuardrail] });
    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('terminal-events.json')) {
          const content = transcriptFiles.get(path);
          if (content === undefined) {
            throw Object.assign(new Error(`Missing transcript: ${path}`), { code: 'ENOENT' });
          }
          return content;
        }
        return '';
      }),
      readdir: vi.fn(async () => [] as string[]),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async (oldPath: string, newPath: string) => {
        const content = transcriptFiles.get(oldPath);
        if (content !== undefined) {
          transcriptFiles.set(newPath, content);
          transcriptFiles.delete(oldPath);
        }
      }),
      rm: vi.fn(async (path: string) => {
        transcriptFiles.delete(path);
      }),
      writeFile: vi.fn(async (path: string, contents: string) => {
        transcriptFiles.set(path, contents);
      }),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();
    callbacks[0]?.();
    await vi.advanceTimersByTimeAsync(200);

    expect(fsAdapter.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/CAP-001/terminal-events.json'),
      expect.stringContaining('Launch denied by repository guardrails.'),
      'utf-8',
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'runtime.guardrail',
      role: 'system',
      actorName: 'Dalton · dalton-1',
      severity: 'error',
      message: 'Launch denied by repository guardrails.',
      taskId: 'CAP-001',
    }));

    callbacks[0]?.();
    await vi.advanceTimersByTimeAsync(200);

    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Launch denied by updated repository guardrails.',
      taskId: 'CAP-001',
    }));
    expect(readTranscriptEvents(transcriptFiles, 'CAP-001')).toHaveLength(2);

    stop();
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
    const transcriptFiles = new Map<string, string>();

    const fsAdapter = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('terminal-events.json')) {
          const content = transcriptFiles.get(path);
          if (content === undefined) {
            throw Object.assign(new Error(`Missing transcript: ${path}`), { code: 'ENOENT' });
          }
          return content;
        }
        return '';
      }),
      readdir: vi.fn(async () => [] as string[]),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async (oldPath: string, newPath: string) => {
        const content = transcriptFiles.get(oldPath);
        if (content !== undefined) {
          transcriptFiles.set(newPath, content);
          transcriptFiles.delete(oldPath);
        }
      }),
      rm: vi.fn(async (path: string) => {
        transcriptFiles.delete(path);
      }),
      writeFile: vi.fn(async (path: string, contents: string) => {
        transcriptFiles.set(path, contents);
      }),
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
        role: 'agent',
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
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
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

  it('derives watch targets only from active markers visible to the active context pack', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    setCurrentActiveContextPackTaskScope(null);
    const scope = {
      contextPackId: 'pack-a',
      contextPackDir: '/packs/pack-a',
      contextPackName: 'pack-a',
    };
    const listContextPacks = vi.fn(async () => contextPackList('pack-a'));
    loadTaskRegistry.mockResolvedValueOnce({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [{
            taskId: 'TASK-A',
            fileName: 'TASK-A.md',
            title: 'Task A',
            state: 'pending' as const,
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
        'pack-b': {
          open: [],
          pending: [{
            taskId: 'TASK-B',
            fileName: 'TASK-B.md',
            title: 'Task B',
            state: 'pending' as const,
            contextPackId: 'pack-b',
            contextPackDir: '/packs/pack-b',
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
    });
    const watchedPaths: string[] = [];
    const watchFactory = vi.fn((target: string, _: { persistent: false }, _callback: () => void) => {
      watchedPaths.push(target);
      return { close: vi.fn() } as unknown as FSWatcher;
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
          return ['TASK-A', 'TASK-B'];
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
      scopeProvider: () => scope,
      listContextPacks,
    });

    await vi.runAllTimersAsync();
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(readSnapshot).toHaveBeenCalledWith(fsAdapter, ['TASK-A']);
    expect(listContextPacks).toHaveBeenCalled();
    expect(refreshStreamTaskMetadataForScope).toHaveBeenCalledWith(scope);
    expect(watchedPaths.some((path) => path.includes('/TASK-A/'))).toBe(true);
    expect(watchedPaths.some((path) => path.includes('/TASK-B/'))).toBe(false);

    stop();
  });

  it('refreshes scope from the active catalog before filtering runtime terminal events', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    setCurrentActiveContextPackTaskScope({
      contextPackId: 'pack-a',
      contextPackDir: '/packs/pack-a',
      contextPackName: 'pack-a',
    });
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-b': {
          open: [],
          pending: [],
          active: [{
            taskId: 'TASK-B',
            fileName: 'TASK-B.md',
            title: 'Task B',
            state: 'active' as const,
            contextPackId: 'pack-b',
            contextPackDir: '/packs/pack-b',
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
    });
    const listContextPacks = vi.fn(async () => contextPackList('pack-b'));
    const watchFactory = vi.fn(() => ({ close: vi.fn() }) as unknown as FSWatcher);
    const readSnapshot = vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] });
    const fsAdapter = {
      access: vi.fn(async (path: string) => {
        const allowed =
          path.endsWith('.platform-state') ||
          path.endsWith('.platform-state/runtime') ||
          path.endsWith('.platform-state/runtime/tasks') ||
          path.endsWith('AgentWorkSpace/pendingitems') ||
          path.endsWith('AgentWorkSpace/pendingitems/.active-items') ||
          path.includes('.platform-state/runtime/tasks/TASK-B');
        if (!allowed) {
          throw Object.assign(new Error(`Unexpected watch target: ${path}`), { code: 'ENOENT' });
        }
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/tasks/TASK-B/terminal-events.json')) {
          return JSON.stringify({
            events: [{
              eventId: 'task-b.activated',
              source: 'runtime.queue',
              role: 'queue',
              severity: 'info',
              message: 'Task B visible.',
            }],
          });
        }
        return '';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
          return ['TASK-B'];
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
      listContextPacks,
    });

    await vi.runAllTimersAsync();

    expect(listContextPacks).toHaveBeenCalled();
    expect(readSnapshot).toHaveBeenCalledWith(fsAdapter, ['TASK-B']);
    expect(refreshStreamTaskMetadataForScope).toHaveBeenCalledWith({
      contextPackId: 'pack-b',
      contextPackDir: '/packs/pack-b',
      contextPackName: 'pack-b',
    });
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'TASK-B',
      message: 'Task B visible.',
    }));

    stop();
  });

  it('resets watched task streams when the active context pack changes', async () => {
    const { startRuntimeStreamWatcher } = await import('./main.runtimeStream');
    loadTaskRegistry.mockResolvedValue({
      schema_version: 2,
      tasks: {
        'pack-a': {
          open: [],
          pending: [{
            taskId: 'TASK-A',
            fileName: 'TASK-A.md',
            title: 'Task A',
            state: 'pending' as const,
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
        'pack-b': {
          open: [],
          pending: [{
            taskId: 'TASK-B',
            fileName: 'TASK-B.md',
            title: 'Task B',
            state: 'pending' as const,
            contextPackId: 'pack-b',
            contextPackDir: '/packs/pack-b',
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
    });
    const activeCallbacks: Array<() => void> = [];
    const closeByPath = new Map<string, ReturnType<typeof vi.fn>>();
    const watchFactory = vi.fn((target: string, _: { persistent: false }, callback: () => void) => {
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
          path.includes('.platform-state/runtime/tasks/TASK-A') ||
          path.includes('.platform-state/runtime/tasks/TASK-B');
        if (!allowed) {
          throw Object.assign(new Error(`Unexpected watch target: ${path}`), { code: 'ENOENT' });
        }
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/tasks/TASK-A/terminal-events.json')) {
          return JSON.stringify({
            events: [{
              eventId: 'task-a.started',
              source: 'runtime.pipeline',
              role: 'pipeline',
              severity: 'info',
              message: 'Task A visible.',
            }],
          });
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-B/terminal-events.json')) {
          return JSON.stringify({
            events: [{
              eventId: 'task-b.started',
              source: 'runtime.pipeline',
              role: 'pipeline',
              severity: 'info',
              message: 'Task B visible.',
            }],
          });
        }
        return '';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
          return ['TASK-A', 'TASK-B'];
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot,
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'TASK-A',
      message: 'Task A visible.',
    }));
    expect(emitStreamEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'TASK-B',
      message: 'Task B visible.',
    }));

    const taskARoleSessionsPath = [...closeByPath.keys()].find((path) =>
      path.endsWith('.platform-state/runtime/tasks/TASK-A/role-sessions'),
    );
    emitStreamEvent.mockClear();
    setCurrentActiveContextPackTaskScope({
      contextPackId: 'pack-b',
      contextPackDir: '/packs/pack-b',
      contextPackName: 'pack-b',
    });

    activeCallbacks[0]?.();
    await vi.advanceTimersByTimeAsync(200);

    expect(taskARoleSessionsPath ? closeByPath.get(taskARoleSessionsPath) : undefined).toHaveBeenCalled();
    expect(readSnapshot).toHaveBeenLastCalledWith(fsAdapter, ['TASK-B']);
    expect(emitStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'TASK-B',
      message: 'Task B visible.',
    }));
    expect(emitStreamEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'TASK-A',
      message: 'Task A visible.',
    }));

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
    const transcriptFiles = new Map<string, string>();

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
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('terminal-events.json')) {
          const content = transcriptFiles.get(path);
          if (content === undefined) {
            throw Object.assign(new Error(`Missing transcript: ${path}`), { code: 'ENOENT' });
          }
          return content;
        }
        return '';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
          return activeEntries;
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async (oldPath: string, newPath: string) => {
        const content = transcriptFiles.get(oldPath);
        if (content !== undefined) {
          transcriptFiles.set(newPath, content);
          transcriptFiles.delete(oldPath);
        }
      }),
      rm: vi.fn(async (path: string) => {
        transcriptFiles.delete(path);
      }),
      writeFile: vi.fn(async (path: string, contents: string) => {
        transcriptFiles.set(path, contents);
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
        role: 'agent',
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
    const transcriptFiles = new Map<string, string>();

    const fsAdapter = {
      access: vi.fn(async (path: string) => {
        const allowed =
          path.endsWith('.platform-state') ||
          path.endsWith('.platform-state/runtime') ||
          path.endsWith('.platform-state/runtime/tasks') ||
          path.endsWith('AgentWorkSpace/pendingitems') ||
          path.endsWith('AgentWorkSpace/pendingitems/.active-items') ||
          path.includes('.platform-state/runtime/tasks/TASK-A') ||
          path.includes('.platform-state/runtime/tasks/TASK-B') ||
          path.includes('.platform-state/runtime/tasks/TASK-C') ||
          path.includes('.platform-state/runtime/tasks/TASK-D') ||
          path.includes('.platform-state/runtime/tasks/TASK-E') ||
          path.includes('.platform-state/runtime/tasks/TASK-F');
        if (!allowed) {
          throw Object.assign(new Error(`Unexpected watch target: ${path}`), { code: 'ENOENT' });
        }
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('terminal-events.json')) {
          const content = transcriptFiles.get(path);
          if (content !== undefined) {
            return content;
          }
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-A/pipeline-phase.json')) {
          return JSON.stringify({ phase: 'test-capture-started' });
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-B/pipeline-phase.json')) {
          return JSON.stringify({ phase: 'test-capture-completed' });
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-C/pipeline-phase.json')) {
          return JSON.stringify({ phase: 'test-capture-skipped' });
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-D/terminal-events.json')) {
          return JSON.stringify({
            events: [
              {
                eventId: 'archive.started',
                source: 'runtime.pipeline',
                role: 'pipeline',
                severity: 'info',
                message: 'Archiving task.',
              },
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
              {
                eventId: 'queue.branch.created:api:task/TASK-D:/tmp/worktrees/api',
                source: 'runtime.branch',
                role: 'pipeline',
                severity: 'info',
                message: 'Created worktree for api on branch task/TASK-D.',
              },
              {
                eventId: 'runtime.guardrail:legacy',
                source: 'runtime.guardrail',
                role: 'pipeline',
                severity: 'info',
                message: 'Guardrail receipt recorded an allowed launch.',
              },
            ],
          });
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-E/terminal-events.json')) {
          return JSON.stringify({
            events: [
              {
                eventId: 'auto_merge.applied',
                source: 'runtime.closeout',
                role: 'pipeline',
                severity: 'success',
                visible: false,
                message: 'Auto-merge applied api:task/TASK-G->main.',
              },
              {
                eventId: 'closeout.target_branch_update:api:task/TASK-G:applied:main',
                source: 'runtime.closeout',
                role: 'pipeline',
                severity: 'success',
                message: 'Code changes from task branch task/TASK-G were successfully staged on target branch main in target repo api at /repos/api.',
              },
              {
                eventId: 'queue.error_items.moved',
                source: 'runtime.queue',
                role: 'queue',
                severity: 'error',
                message: 'Moved to error-items: task-failed.',
              },
              {
                eventId: 'closeout.stranded.resumed',
                source: 'runtime.closeout',
                role: 'pipeline',
                severity: 'warning',
                message: 'Resumed stranded closeout.',
              },
              {
                eventId: 'closeout_remediation.launching',
                source: 'runtime.pipeline',
                role: 'pipeline',
                severity: 'warning',
                message: 'Closeout remediation launching.',
              },
              {
                eventId: 'closeout.finalized',
                source: 'runtime.closeout',
                role: 'pipeline',
                severity: 'success',
                message: 'Closeout finalized.',
              },
            ],
          });
        }
        if (path.endsWith('terminal-events.json')) {
          throw Object.assign(new Error(`Missing transcript: ${path}`), { code: 'ENOENT' });
        }
        throw Object.assign(new Error(`Unexpected readFile: ${path}`), { code: 'ENOENT' });
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
          return ['TASK-A', 'TASK-B', 'TASK-C', 'TASK-D', 'TASK-E'];
        }
        throw Object.assign(new Error(`Unexpected readdir: ${path}`), { code: 'ENOENT' });
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async (oldPath: string, newPath: string) => {
        const content = transcriptFiles.get(oldPath);
        if (content !== undefined) {
          transcriptFiles.set(newPath, content);
          transcriptFiles.delete(oldPath);
        }
      }),
      rm: vi.fn(async (path: string) => {
        transcriptFiles.delete(path);
      }),
      writeFile: vi.fn(async (path: string, contents: string) => {
        transcriptFiles.set(path, contents);
      }),
    };

    const stop = startRuntimeStreamWatcher({
      fsAdapter,
      readSnapshot: vi.fn().mockResolvedValue({ agentTerminalSessions: [], guardrails: [] }),
      watchFactory: watchFactory as unknown as typeof import('node:fs').watch,
    });

    await vi.runAllTimersAsync();

    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Archiving task.',
        source: 'runtime.pipeline',
        role: 'pipeline',
        taskId: 'TASK-D',
      }),
    );
    expect(countEmitted('Archiving task.', 'TASK-D')).toBe(1);

    for (const [path, callbacks] of callbacksByPath) {
      if (
        path.endsWith('.platform-state/runtime/tasks/TASK-A') ||
        path.endsWith('.platform-state/runtime/tasks/TASK-B') ||
        path.endsWith('.platform-state/runtime/tasks/TASK-C') ||
        path.endsWith('.platform-state/runtime/tasks/TASK-D') ||
        path.endsWith('.platform-state/runtime/tasks/TASK-E')
      ) {
        for (const callback of callbacks) {
          callback(
            'change',
            path.endsWith('.platform-state/runtime/tasks/TASK-D') ||
              path.endsWith('.platform-state/runtime/tasks/TASK-E')
                ? 'terminal-events.json'
                : 'pipeline-phase.json',
          );
        }
      }
    }
    await vi.runAllTimersAsync();

    expect(emitStreamEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Code capture started.',
        taskId: 'TASK-A',
      }),
    );
    expect(emitStreamEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Code capture completed.',
        taskId: 'TASK-B',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Archiving task.',
        source: 'runtime.pipeline',
        role: 'pipeline',
        taskId: 'TASK-D',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Task archived.',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'success',
        taskId: 'TASK-D',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Task archival failed.',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'error',
        taskId: 'TASK-D',
      }),
    );
    expect(emitStreamEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Code capture skipped — could not resolve target repo.',
        taskId: 'TASK-C',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Created worktree for api on branch task/TASK-D.',
        source: 'runtime.branch',
        role: 'pipeline',
        taskId: 'TASK-D',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Guardrail receipt recorded an allowed launch.',
        source: 'runtime.guardrail',
        role: 'system',
        taskId: 'TASK-D',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Code changes from task branch task/TASK-G were successfully staged on target branch main in target repo api at /repos/api.',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'success',
        taskId: 'TASK-E',
      }),
    );
    expect(emitStreamEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Auto-merge applied api:task/TASK-G->main.',
        taskId: 'TASK-E',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Moved to error-items: task-failed.',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
        taskId: 'TASK-E',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Resumed stranded closeout.',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'warning',
        taskId: 'TASK-E',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Closeout remediation launching.',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'warning',
        taskId: 'TASK-E',
      }),
    );
    expect(emitStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Closeout finalized.',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'success',
        taskId: 'TASK-E',
      }),
    );
    expect(countEmitted('Archiving task.', 'TASK-D')).toBe(1);

    stop();
  });
});

function countEmitted(message: string, taskId: string): number {
  return emitStreamEvent.mock.calls.filter(([event]) => (
    event.message === message && event.taskId === taskId
  )).length;
}

function readTranscriptEvents(
  files: Map<string, string>,
  taskId: string,
): Array<Record<string, unknown>> {
  const content = [...files.entries()].find(([filePath]) => (
    filePath.endsWith(`/${taskId}/terminal-events.json`)
  ))?.[1];
  return JSON.parse(content ?? '{"events":[]}').events;
}
