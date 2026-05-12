// @vitest-environment node

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlannerStreamEvent } from '../src/shared/desktopContract';
import type { PlannerFocusSnapshot } from '../src/shared/desktopContract';
import { PlannerSessionBroker } from './plannerSessionBroker';

const sessionMocks = vi.hoisted(() => ({
  getPlannerHistoryRecord: vi.fn(),
  resolveSelectedPrimaryRepoRoot: vi.fn(),
  resolveFocusedRepoRoot: vi.fn(),
  clearStagingArtifacts: vi.fn(),
  initializeStagedPlanningDraft: vi.fn(),
  beginPendingRecord: vi.fn(),
  appendPendingMessage: vi.fn(),
  discardPendingRecord: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('../../../backend/platform/planner-history/store.js', () => ({
  getPlannerHistoryRecord: sessionMocks.getPlannerHistoryRecord,
}));

vi.mock('../../../backend/platform/context-pack/focusedRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/context-pack/focusedRepo.js')>();
  return {
    ...actual,
    resolveSelectedPrimaryRepoRoot: sessionMocks.resolveSelectedPrimaryRepoRoot,
    resolveFocusedRepoRoot: sessionMocks.resolveFocusedRepoRoot,
  };
});

vi.mock('../../../backend/platform/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/core/index.js')>();
  return {
    ...actual,
    readTextFile: vi.fn(),
    safeJsonParse: vi.fn(),
  };
});

vi.mock('./main.contextPackCatalog', () => ({
  readWorkspaceSyncStateSnapshot: vi.fn(async () => ({ activeContextPackId: 'orders' })),
}));

vi.mock('./main.staging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./main.staging')>();
  return {
    ...actual,
    clearStagingArtifacts: sessionMocks.clearStagingArtifacts,
    initializeStagedPlanningDraft: sessionMocks.initializeStagedPlanningDraft,
  };
});

vi.mock('./plannerCliProcess', () => ({
  getPlanningAgentAllowedRoots: vi.fn(() => ['/platform']),
  spawnPlannerCliProcess: vi.fn(),
}));

vi.mock('./plannerHistory', () => ({
  appendPendingMessage: sessionMocks.appendPendingMessage,
  beginPendingRecord: sessionMocks.beginPendingRecord,
  discardPendingRecord: sessionMocks.discardPendingRecord,
}));

type FakeChildProcess = ChildProcess & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function createFakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe('PlannerSessionBroker', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('starts idle without spawning Copilot', () => {
    const spawnCliProcess = vi.fn();
    const broker = new PlannerSessionBroker({
      emitEvent: vi.fn(),
      spawnCliProcess,
      now: () => 100,
    });

    expect(broker.getState()).toBeNull();
    expect(broker.startSession()).toEqual({ sessionId: 'planner-100', created: true });
    expect(broker.getState()).toEqual({
      brokerStatus: 'idle',
      cliSessionId: null,
      turnId: null,
      content: '',
      exitCode: null,
      usage: null,
      error: null,
    });
    expect(spawnCliProcess).not.toHaveBeenCalled();
  });

  it('runs a single JSONL turn and emits planner content', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const spawnCliProcess = vi.fn(() => child);
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(11),
    });

    broker.startSession();
    const sendPromise = broker.sendMessage('Hello planner');

    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Structured hello.' },
    }) + '\n'));
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-1',
      exitCode: 0,
      usage: { premiumRequests: 1 },
    }) + '\n'));
    child.emit('exit', 0);

    await expect(sendPromise).resolves.toBe('sent');
    expect(spawnCliProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hello planner',
        promptMode: 'interactive',
        resumeSessionId: null,
        plannerSessionId: 'planner-10',
      }),
    );
    expect(plannerEvents).toEqual([
      {
        eventType: 'planner.turn.started',
        sessionId: 'planner-10',
        brokerStatus: 'running',
        turnId: 'turn-11',
        done: false,
        error: null,
      },
      {
        eventType: 'planner.turn.message',
        sessionId: 'planner-10',
        brokerStatus: 'running',
        turnId: 'turn-11',
        done: false,
        content: 'Structured hello.',
        messageKind: 'final',
        error: null,
      },
      {
        eventType: 'planner.session.updated',
        sessionId: 'planner-10',
        brokerStatus: 'running',
        turnId: 'turn-11',
        done: false,
        error: null,
        cliSessionId: 'provider-session-1',
      },
      {
        eventType: 'planner.turn.completed',
        sessionId: 'planner-10',
        brokerStatus: 'completed',
        turnId: 'turn-11',
        done: true,
        error: null,
        cliSessionId: 'provider-session-1',
      },
    ]);
    expect(broker.getState()).toEqual({
      brokerStatus: 'completed',
      cliSessionId: 'provider-session-1',
      turnId: 'turn-11',
      content: 'Structured hello.',
      exitCode: 0,
      usage: { premiumRequests: 1, totalApiDurationMs: undefined, sessionDurationMs: undefined, codeChanges: undefined },
      error: null,
    });
    expect(broker.getObservability()).toEqual({
      sessionId: 'planner-10',
      brokerStatus: 'completed',
      activeTurnId: null,
      queuedTurnCount: 0,
      cliSessionId: 'provider-session-1',
      lastTurnSource: 'interactive-bootstrap',
      lastTurnOutcome: 'completed',
      lastTurnAt: expect.any(String),
      lastTurnHadContent: true,
      lastExitCode: 0,
      turnCount: 1,
      error: null,
    });
  });

  it('acknowledges a queued send before the Copilot turn finishes', async () => {
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: vi.fn(),
      spawnCliProcess: vi.fn(() => child),
      now: vi.fn()
        .mockReturnValueOnce(15)
        .mockReturnValueOnce(16),
    });

    broker.startSession();
    const sendPromise = broker.sendMessage('Hello planner');

    await expect(sendPromise).resolves.toBe('sent');
    expect(broker.getState()).toEqual({
      brokerStatus: 'running',
      cliSessionId: null,
      turnId: 'turn-16',
      content: '',
      exitCode: null,
      usage: null,
      error: null,
    });

    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Delayed reply' },
    }) + '\n'));
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-15',
      exitCode: 0,
    }) + '\n'));
    child.emit('exit', 0);
  });

  it('does not emit queued planner events after endSession returns', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCliProcess: vi.fn(() => child),
      now: vi.fn()
        .mockReturnValueOnce(40)
        .mockReturnValueOnce(41),
    });

    broker.startSession();
    await expect(broker.sendMessage('Hello planner')).resolves.toBe('sent');
    expect(plannerEvents).toEqual([
      expect.objectContaining({
        eventType: 'planner.turn.started',
        sessionId: 'planner-40',
      }),
    ]);

    broker.endSession();
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Late reply' },
    }) + '\n'));
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'copilot-late',
      exitCode: 0,
    }) + '\n'));
    child.emit('exit', 0);

    expect(plannerEvents).toEqual([
      expect.objectContaining({
        eventType: 'planner.turn.started',
        sessionId: 'planner-40',
      }),
    ]);
  });

  it('surfaces explicit failure when the Copilot turn exits non-zero', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCliProcess: vi.fn(() => child),
      now: vi.fn()
        .mockReturnValueOnce(20)
        .mockReturnValueOnce(21),
    });

    broker.startSession();
    const sendPromise = broker.sendMessage('Hello planner');

    child.stderr.emit('data', Buffer.from('copilot missing\n'));
    child.emit('exit', 1);

    await expect(sendPromise).resolves.toBe('sent');
    expect(plannerEvents).toEqual([
      {
        eventType: 'planner.turn.started',
        sessionId: 'planner-20',
        brokerStatus: 'running',
        turnId: 'turn-21',
        done: false,
        error: null,
      },
      {
        eventType: 'planner.turn.failed',
        sessionId: 'planner-20',
        brokerStatus: 'failed',
        turnId: 'turn-21',
        done: true,
        content: undefined,
        error: 'Planner agent CLI process exited with code 1. copilot missing',
      },
    ]);
    expect(broker.getState()).toEqual({
      brokerStatus: 'failed',
      cliSessionId: null,
      turnId: 'turn-21',
      content: '',
      exitCode: 1,
      usage: null,
      error: 'Planner agent CLI process exited with code 1. copilot missing',
    });
  });

  it('reuses the prior Copilot sessionId on the second turn', async () => {
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnCliProcess = vi.fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild);
    const broker = new PlannerSessionBroker({
      emitEvent: vi.fn(),
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(40)
        .mockReturnValueOnce(41)
        .mockReturnValueOnce(42),
    });

    broker.startSession();

    const firstSend = broker.sendMessage('Turn one');
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.turn_start',
      data: { turnId: 'turn-one' },
    }) + '\n'));
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Turn one reply' },
    }) + '\n'));
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-40',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);
    await expect(firstSend).resolves.toBe('sent');

    const secondSend = broker.sendMessage('Turn two');
    expect(spawnCliProcess).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        prompt: 'Turn one',
        promptMode: 'interactive',
        resumeSessionId: null,
      }),
    );
    expect(spawnCliProcess).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        prompt: 'Turn two',
        promptMode: 'one-shot',
        resumeSessionId: 'provider-session-40',
      }),
    );

    secondChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.turn_start',
      data: { turnId: 'turn-two' },
    }) + '\n'));
    secondChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Turn two reply' },
    }) + '\n'));
    secondChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-40',
      exitCode: 0,
    }) + '\n'));
    secondChild.emit('exit', 0);

    await expect(secondSend).resolves.toBe('sent');
    expect(broker.getState()).toEqual({
      brokerStatus: 'completed',
      cliSessionId: 'provider-session-40',
      turnId: 'turn-42',
      content: 'Turn two reply',
      exitCode: 0,
      usage: null,
      error: null,
    });
    expect(broker.getObservability()).toEqual({
      sessionId: 'planner-40',
      brokerStatus: 'completed',
      activeTurnId: null,
      queuedTurnCount: 0,
      cliSessionId: 'provider-session-40',
      lastTurnSource: 'resumed-session',
      lastTurnOutcome: 'completed',
      lastTurnAt: expect.any(String),
      lastTurnHadContent: true,
      lastExitCode: 0,
      turnCount: 2,
      error: null,
    });
  });

  it('queues rapid sends and executes them in FIFO order', async () => {
    const plannerMessages: string[] = [];
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnCliProcess = vi.fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild);
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        if (plannerEvent.eventType === 'planner.turn.message' && plannerEvent.content) {
          plannerMessages.push(plannerEvent.content);
        }
      },
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(50)
        .mockReturnValueOnce(51)
        .mockReturnValueOnce(52),
    });

    broker.startSession();
    const firstSend = broker.sendMessage('First turn');
    const secondSend = broker.sendMessage('Second turn');

    expect(spawnCliProcess).toHaveBeenCalledTimes(1);
    expect(spawnCliProcess).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        prompt: 'First turn',
        promptMode: 'interactive',
        resumeSessionId: null,
      }),
    );

    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.turn_start',
      data: { turnId: 'turn-first' },
    }) + '\n'));
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'First reply' },
    }) + '\n'));
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-50',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);

    await expect(firstSend).resolves.toBe('sent');
    expect(spawnCliProcess).toHaveBeenCalledTimes(2);
    expect(spawnCliProcess).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        prompt: 'Second turn',
        promptMode: 'one-shot',
        resumeSessionId: 'provider-session-50',
      }),
    );

    secondChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Second reply' },
    }) + '\n'));
    secondChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-50',
      exitCode: 0,
    }) + '\n'));
    secondChild.emit('exit', 0);

    await expect(secondSend).resolves.toBe('sent');
    expect(plannerMessages).toEqual(['First reply', 'Second reply']);
  });

  it('clears broken resume state after a resumed turn fails', async () => {
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const thirdChild = createFakeChildProcess();
    const spawnCliProcess = vi.fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild)
      .mockImplementationOnce(() => thirdChild);
    const broker = new PlannerSessionBroker({
      emitEvent: vi.fn(),
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(60)
        .mockReturnValueOnce(61)
        .mockReturnValueOnce(62)
        .mockReturnValueOnce(63),
    });

    broker.startSession();

    const firstSend = broker.sendMessage('Turn one');
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.turn_start',
      data: { turnId: 'turn-one' },
    }) + '\n'));
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'First reply' },
    }) + '\n'));
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-60',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);
    await expect(firstSend).resolves.toBe('sent');

    const failingSend = broker.sendMessage('Turn two');
    secondChild.stderr.emit('data', Buffer.from('resume broken\n'));
    secondChild.emit('exit', 1);
    await expect(failingSend).resolves.toBe('sent');

    expect(broker.getState()).toEqual({
      brokerStatus: 'failed',
      cliSessionId: null,
      turnId: 'turn-62',
      content: '',
      exitCode: 1,
      usage: null,
      error: 'Planner agent CLI process exited with code 1. resume broken',
    });
    expect(broker.getObservability()).toEqual({
      sessionId: 'planner-60',
      brokerStatus: 'failed',
      activeTurnId: null,
      queuedTurnCount: 0,
      cliSessionId: null,
      lastTurnSource: 'resumed-session',
      lastTurnOutcome: 'failed',
      lastTurnAt: expect.any(String),
      lastTurnHadContent: false,
      lastExitCode: 1,
      turnCount: 2,
      error: 'Planner agent CLI process exited with code 1. resume broken',
    });

    const recoverySend = broker.sendMessage('Turn three');
    expect(spawnCliProcess).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        prompt: 'Turn two',
        promptMode: 'one-shot',
        resumeSessionId: 'provider-session-60',
      }),
    );
    expect(spawnCliProcess).toHaveBeenNthCalledWith(3,
      expect.objectContaining({
        prompt: 'Turn three',
        promptMode: 'one-shot',
        resumeSessionId: null,
      }),
    );

    thirdChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.turn_start',
      data: { turnId: 'turn-three' },
    }) + '\n'));
    thirdChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Recovery reply' },
    }) + '\n'));
    thirdChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-63',
      exitCode: 0,
    }) + '\n'));
    thirdChild.emit('exit', 0);

    await expect(recoverySend).resolves.toBe('sent');
    expect(broker.getState()).toEqual({
      brokerStatus: 'completed',
      cliSessionId: 'provider-session-63',
      turnId: 'turn-63',
      content: 'Recovery reply',
      exitCode: 0,
      usage: null,
      error: null,
    });
  });

  it('surfaces explicit failure when the agent CLI process cannot start', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCliProcess: vi.fn(() => child),
      now: vi.fn()
        .mockReturnValueOnce(30)
        .mockReturnValueOnce(31),
    });

    broker.startSession();
    const sendPromise = broker.sendMessage('Hello planner');

    child.emit('error', new Error('spawn copilot ENOENT'));

    await expect(sendPromise).resolves.toBe('sent');
    expect(plannerEvents).toEqual([
      {
        eventType: 'planner.turn.started',
        sessionId: 'planner-30',
        brokerStatus: 'running',
        turnId: 'turn-31',
        done: false,
        error: null,
      },
      {
        eventType: 'planner.turn.failed',
        sessionId: 'planner-30',
        brokerStatus: 'failed',
        turnId: 'turn-31',
        done: true,
        content: undefined,
        error: 'Failed to start planner agent CLI process: spawn copilot ENOENT',
      },
    ]);
    expect(broker.getState()).toEqual({
      brokerStatus: 'failed',
      cliSessionId: null,
      turnId: 'turn-31',
      content: '',
      exitCode: null,
      usage: null,
      error: 'Failed to start planner agent CLI process: spawn copilot ENOENT',
    });
  });

  it('uses stable synthetic turnId even when Copilot assigns a different one', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCliProcess: vi.fn(() => child),
      now: vi.fn()
        .mockReturnValueOnce(70)
        .mockReturnValueOnce(71),
    });

    broker.startSession();
    const sendPromise = broker.sendMessage('Plan something');

    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.turn_start',
      data: { turnId: 'copilot-assigned-id' },
    }) + '\n'));
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Here is the plan.' },
    }) + '\n'));
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'provider-session-70',
      exitCode: 0,
    }) + '\n'));
    child.emit('exit', 0);

    await expect(sendPromise).resolves.toBe('sent');

    const allTurnIds = plannerEvents
      .filter((e): e is PlannerStreamEvent & { turnId: string } =>
        'turnId' in e && typeof e.turnId === 'string',
      )
      .map((e) => e.turnId);
    expect(allTurnIds.length).toBeGreaterThan(0);
    for (const id of allTurnIds) {
      expect(id).toBe('turn-71');
    }

    expect(broker.getState()?.turnId).toBe('turn-71');
  });
});

function buildFocusSnapshot(overrides: Partial<PlannerFocusSnapshot> = {}): PlannerFocusSnapshot {
  return {
    version: 1,
    contextPackDir: '/contextpacks/orders',
    contextPackId: 'orders',
    title: 'Parent task',
    primaryRepoId: 'orders-api',
    primaryRepoRoot: '/repos/orders-api',
    primaryFocusRelativePath: 'src/api',
    primaryFocusTargetKind: 'directory',
    primaryFocusTargets: [
      { path: 'src/api', kind: 'directory', role: 'anchor' },
    ],
    selectedTestTarget: { path: 'tests/api', kind: 'directory' },
    supportTargets: [{ path: 'docs/api.md', kind: 'file', effectiveScope: 'full-directory' }],
    deepFocusEnabled: true,
    contextPackBinding: {
      contextPackDir: '/contextpacks/orders',
      contextPackId: 'orders',
      scopeMode: 'selected',
      selectedRepoIds: ['orders-api'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/api',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { path: 'src/api', kind: 'directory', role: 'anchor' },
      ],
      selectedTestTarget: { path: 'tests/api', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/api.md', kind: 'file', effectiveScope: 'full-directory' }],
    },
    ...overrides,
  };
}

describe('plannerSession.startSession child-task focus snapshots', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionMocks.clearStagingArtifacts.mockResolvedValue(undefined);
    sessionMocks.initializeStagedPlanningDraft.mockResolvedValue({
      version: 1,
      ownership: 'planner-session',
      sessionId: 'planner-test',
      draftFilename: 'draft.md',
      draftPath: '/staging/draft.md',
      createdAt: '2026-03-21T00:00:00Z',
      title: 'Parent task',
      primaryRepoId: 'orders-api',
      primaryRepoRoot: '/repos/orders-api',
      primaryFocusRelativePath: 'src/api',
      deepFocusEnabled: true,
      primaryFocusTargetKind: 'directory',
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      lineage: {
        taskKind: 'child-task',
        parentTaskId: 'PARENT-1',
        rootTaskId: 'ROOT-1',
        parentQmdRecordId: 'qmd-1',
        parentQmdScope: 'qmd/context-packs/orders',
        followUpReason: 'Correction.',
      },
      contextPackBinding: buildFocusSnapshot().contextPackBinding,
    });
  });

  it('restores focus fields and context-pack binding from childTaskFocusSnapshot', async () => {
    const { startSession } = await import('./plannerSession');
    const snapshot = buildFocusSnapshot();

    await startSession('/ignored/current-pack', undefined, undefined, snapshot, {
      parentTaskId: 'PARENT-1',
      parentQmdRecordId: 'qmd-1',
      parentQmdScope: 'qmd/context-packs/orders',
      rootTaskId: 'ROOT-1',
      followUpReason: 'Correction.',
    });

    expect(sessionMocks.initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      contextPackDir: '/contextpacks/orders',
      title: 'Parent task',
      contextPackBinding: snapshot.contextPackBinding,
      focusedRepo: expect.objectContaining({
        primaryRepoId: 'orders-api',
        primaryRepoRoot: '/repos/orders-api',
        primaryFocusRelativePath: 'src/api',
        primaryFocusTargetKind: 'directory',
        primaryFocusTargets: snapshot.primaryFocusTargets,
        selectedTestTarget: snapshot.selectedTestTarget,
        supportTargets: snapshot.supportTargets,
        deepFocusEnabled: true,
        selectedRepoIds: ['orders-api'],
        selectedFocusIds: ['api'],
      }),
    }));
  });

  it('sets staged lineage from childTaskLineage and forces child-task kind', async () => {
    const { startSession } = await import('./plannerSession');

    await startSession('/contextpacks/orders', undefined, undefined, buildFocusSnapshot(), {
      parentTaskId: 'PARENT-1',
      parentQmdRecordId: 'qmd-1',
      parentQmdScope: 'qmd/context-packs/orders',
      rootTaskId: 'ROOT-1',
      followUpReason: 'Correction.',
    });

    expect(sessionMocks.initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      lineage: {
        taskKind: 'child-task',
        parentTaskId: 'PARENT-1',
        parentQmdRecordId: 'qmd-1',
        parentQmdScope: 'qmd/context-packs/orders',
        rootTaskId: 'ROOT-1',
        followUpReason: 'Correction.',
      },
    }));
  });

  it('rejects childTaskLineage without childTaskFocusSnapshot', async () => {
    const { startSession } = await import('./plannerSession');

    await expect(startSession('/contextpacks/orders', undefined, undefined, undefined, {
      parentTaskId: 'PARENT-1',
      parentQmdRecordId: 'qmd-1',
      parentQmdScope: 'qmd/context-packs/orders',
      rootTaskId: 'ROOT-1',
      followUpReason: 'Correction.',
    })).rejects.toThrow('Child-task planner sessions require a focus snapshot.');
  });

  it('does not read planner history for child-task snapshot starts', async () => {
    const { startSession } = await import('./plannerSession');

    await startSession('/contextpacks/orders', undefined, undefined, buildFocusSnapshot(), {
      parentTaskId: 'PARENT-1',
      parentQmdRecordId: 'qmd-1',
      parentQmdScope: 'qmd/context-packs/orders',
      rootTaskId: 'ROOT-1',
      followUpReason: 'Correction.',
    });

    expect(sessionMocks.getPlannerHistoryRecord).not.toHaveBeenCalled();
  });

  it('does not hydrate transcript messages for child-task snapshot starts', async () => {
    const { startSession } = await import('./plannerSession');

    await startSession('/contextpacks/orders', undefined, undefined, buildFocusSnapshot(), {
      parentTaskId: 'PARENT-1',
      parentQmdRecordId: 'qmd-1',
      parentQmdScope: 'qmd/context-packs/orders',
      rootTaskId: 'ROOT-1',
      followUpReason: 'Correction.',
    });

    expect(sessionMocks.appendPendingMessage).toHaveBeenCalledTimes(0);
    expect(sessionMocks.initializeStagedPlanningDraft).not.toHaveBeenCalledWith(
      expect.objectContaining({ transcript: expect.anything() }),
    );
  });

  it('preserves replay history lookup behavior for replayConversationId', async () => {
    const snapshot = buildFocusSnapshot();
    sessionMocks.getPlannerHistoryRecord.mockResolvedValue({
      id: 'conversation-1',
      contextPackDir: snapshot.contextPackDir,
      contextPackId: snapshot.contextPackId,
      createdAt: '2026-03-21T00:00:00Z',
      title: 'Replay task',
      finalizedDestinationPath: '/repo/final.md',
      sidecarSnapshot: {
        version: 1,
        ownership: 'planner-session',
        sessionId: 'old',
        draftFilename: 'draft.md',
        draftPath: '/staging/draft.md',
        createdAt: '2026-03-21T00:00:00Z',
        title: 'Replay task',
        primaryRepoId: snapshot.primaryRepoId,
        primaryRepoRoot: snapshot.primaryRepoRoot,
        primaryFocusRelativePath: snapshot.primaryFocusRelativePath,
        deepFocusEnabled: snapshot.deepFocusEnabled,
        primaryFocusTargetKind: snapshot.primaryFocusTargetKind,
        primaryFocusTargets: snapshot.primaryFocusTargets,
        selectedTestTarget: snapshot.selectedTestTarget,
        supportTargets: snapshot.supportTargets,
        lineage: {
          taskKind: 'standard',
          parentTaskId: '',
          rootTaskId: '',
          parentQmdRecordId: '',
          parentQmdScope: '',
          followUpReason: '',
        },
        contextPackBinding: snapshot.contextPackBinding,
      },
      transcript: [{ id: 'm1', role: 'operator', text: 'historical', timestamp: '2026-03-21T00:00:00Z' }],
    });
    const { startSession } = await import('./plannerSession');

    await startSession('/contextpacks/orders', undefined, 'conversation-1');

    expect(sessionMocks.getPlannerHistoryRecord).toHaveBeenCalledWith(expect.objectContaining({
      contextPackDir: '/contextpacks/orders',
      recordId: 'conversation-1',
    }));
    expect(sessionMocks.initializeStagedPlanningDraft).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Replay task',
      contextPackBinding: snapshot.contextPackBinding,
    }));
  });
});
