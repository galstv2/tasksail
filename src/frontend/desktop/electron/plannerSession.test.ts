// @vitest-environment node

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlannerStreamEvent } from '../src/shared/desktopContract';
import { PlannerSessionBroker } from './plannerSessionBroker';

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
    const spawnCopilotProcess = vi.fn();
    const broker = new PlannerSessionBroker({
      emitEvent: vi.fn(),
      spawnCopilotProcess,
      now: () => 100,
    });

    expect(broker.getState()).toBeNull();
    expect(broker.startSession()).toEqual({ sessionId: 'planner-100', created: true });
    expect(broker.getState()).toEqual({
      brokerStatus: 'idle',
      copilotSessionId: null,
      turnId: null,
      content: '',
      exitCode: null,
      usage: null,
      error: null,
    });
    expect(spawnCopilotProcess).not.toHaveBeenCalled();
  });

  it('runs a single JSONL turn and emits planner content', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const spawnCopilotProcess = vi.fn(() => child);
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCopilotProcess,
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
      sessionId: 'copilot-session-1',
      exitCode: 0,
      usage: { premiumRequests: 1 },
    }) + '\n'));
    child.emit('exit', 0);

    await expect(sendPromise).resolves.toBe('sent');
    expect(spawnCopilotProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hello planner',
        promptMode: 'interactive',
        resumeSessionId: null,
      }),
    );
    expect(plannerEvents).toEqual([
      {
        eventType: 'planner.turn.started',
        brokerStatus: 'running',
        turnId: 'turn-11',
        done: false,
        error: null,
      },
      {
        eventType: 'planner.turn.message',
        brokerStatus: 'running',
        turnId: 'turn-11',
        done: false,
        content: 'Structured hello.',
        messageKind: 'final',
        error: null,
      },
      {
        eventType: 'planner.session.updated',
        brokerStatus: 'running',
        turnId: 'turn-11',
        done: false,
        error: null,
        copilotSessionId: 'copilot-session-1',
      },
      {
        eventType: 'planner.turn.completed',
        brokerStatus: 'completed',
        turnId: 'turn-11',
        done: true,
        error: null,
        copilotSessionId: 'copilot-session-1',
      },
    ]);
    expect(broker.getState()).toEqual({
      brokerStatus: 'completed',
      copilotSessionId: 'copilot-session-1',
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
      copilotSessionId: 'copilot-session-1',
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
      spawnCopilotProcess: vi.fn(() => child),
      now: vi.fn()
        .mockReturnValueOnce(15)
        .mockReturnValueOnce(16),
    });

    broker.startSession();
    const sendPromise = broker.sendMessage('Hello planner');

    await expect(sendPromise).resolves.toBe('sent');
    expect(broker.getState()).toEqual({
      brokerStatus: 'running',
      copilotSessionId: null,
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
      sessionId: 'copilot-session-15',
      exitCode: 0,
    }) + '\n'));
    child.emit('exit', 0);
  });

  it('surfaces explicit failure when the Copilot turn exits non-zero', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCopilotProcess: vi.fn(() => child),
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
        brokerStatus: 'running',
        turnId: 'turn-21',
        done: false,
        error: null,
      },
      {
        eventType: 'planner.turn.failed',
        brokerStatus: 'failed',
        turnId: 'turn-21',
        done: true,
        content: undefined,
        error: 'Planner Copilot process exited with code 1. copilot missing',
      },
    ]);
    expect(broker.getState()).toEqual({
      brokerStatus: 'failed',
      copilotSessionId: null,
      turnId: 'turn-21',
      content: '',
      exitCode: 1,
      usage: null,
      error: 'Planner Copilot process exited with code 1. copilot missing',
    });
  });

  it('reuses the prior Copilot sessionId on the second turn', async () => {
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnCopilotProcess = vi.fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild);
    const broker = new PlannerSessionBroker({
      emitEvent: vi.fn(),
      spawnCopilotProcess,
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
      sessionId: 'copilot-session-40',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);
    await expect(firstSend).resolves.toBe('sent');

    const secondSend = broker.sendMessage('Turn two');
    expect(spawnCopilotProcess).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        prompt: 'Turn one',
        promptMode: 'interactive',
        resumeSessionId: null,
      }),
    );
    expect(spawnCopilotProcess).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        prompt: 'Turn two',
        promptMode: 'one-shot',
        resumeSessionId: 'copilot-session-40',
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
      sessionId: 'copilot-session-40',
      exitCode: 0,
    }) + '\n'));
    secondChild.emit('exit', 0);

    await expect(secondSend).resolves.toBe('sent');
    expect(broker.getState()).toEqual({
      brokerStatus: 'completed',
      copilotSessionId: 'copilot-session-40',
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
      copilotSessionId: 'copilot-session-40',
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
    const spawnCopilotProcess = vi.fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild);
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        if (plannerEvent.eventType === 'planner.turn.message' && plannerEvent.content) {
          plannerMessages.push(plannerEvent.content);
        }
      },
      spawnCopilotProcess,
      now: vi.fn()
        .mockReturnValueOnce(50)
        .mockReturnValueOnce(51)
        .mockReturnValueOnce(52),
    });

    broker.startSession();
    const firstSend = broker.sendMessage('First turn');
    const secondSend = broker.sendMessage('Second turn');

    expect(spawnCopilotProcess).toHaveBeenCalledTimes(1);
    expect(spawnCopilotProcess).toHaveBeenNthCalledWith(1,
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
      sessionId: 'copilot-session-50',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);

    await expect(firstSend).resolves.toBe('sent');
    expect(spawnCopilotProcess).toHaveBeenCalledTimes(2);
    expect(spawnCopilotProcess).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        prompt: 'Second turn',
        promptMode: 'one-shot',
        resumeSessionId: 'copilot-session-50',
      }),
    );

    secondChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'Second reply' },
    }) + '\n'));
    secondChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'copilot-session-50',
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
    const spawnCopilotProcess = vi.fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild)
      .mockImplementationOnce(() => thirdChild);
    const broker = new PlannerSessionBroker({
      emitEvent: vi.fn(),
      spawnCopilotProcess,
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
      sessionId: 'copilot-session-60',
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
      copilotSessionId: null,
      turnId: 'turn-62',
      content: '',
      exitCode: 1,
      usage: null,
      error: 'Planner Copilot process exited with code 1. resume broken',
    });
    expect(broker.getObservability()).toEqual({
      sessionId: 'planner-60',
      brokerStatus: 'failed',
      activeTurnId: null,
      queuedTurnCount: 0,
      copilotSessionId: null,
      lastTurnSource: 'resumed-session',
      lastTurnOutcome: 'failed',
      lastTurnAt: expect.any(String),
      lastTurnHadContent: false,
      lastExitCode: 1,
      turnCount: 2,
      error: 'Planner Copilot process exited with code 1. resume broken',
    });

    const recoverySend = broker.sendMessage('Turn three');
    expect(spawnCopilotProcess).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        prompt: 'Turn two',
        promptMode: 'one-shot',
        resumeSessionId: 'copilot-session-60',
      }),
    );
    expect(spawnCopilotProcess).toHaveBeenNthCalledWith(3,
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
      sessionId: 'copilot-session-63',
      exitCode: 0,
    }) + '\n'));
    thirdChild.emit('exit', 0);

    await expect(recoverySend).resolves.toBe('sent');
    expect(broker.getState()).toEqual({
      brokerStatus: 'completed',
      copilotSessionId: 'copilot-session-63',
      turnId: 'turn-63',
      content: 'Recovery reply',
      exitCode: 0,
      usage: null,
      error: null,
    });
  });

  it('surfaces explicit failure when the Copilot process cannot start', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCopilotProcess: vi.fn(() => child),
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
        brokerStatus: 'running',
        turnId: 'turn-31',
        done: false,
        error: null,
      },
      {
        eventType: 'planner.turn.failed',
        brokerStatus: 'failed',
        turnId: 'turn-31',
        done: true,
        content: undefined,
        error: 'Failed to start planner Copilot process: spawn copilot ENOENT',
      },
    ]);
    expect(broker.getState()).toEqual({
      brokerStatus: 'failed',
      copilotSessionId: null,
      turnId: 'turn-31',
      content: '',
      exitCode: null,
      usage: null,
      error: 'Failed to start planner Copilot process: spawn copilot ENOENT',
    });
  });

  it('uses stable synthetic turnId even when Copilot assigns a different one', async () => {
    const plannerEvents: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: (plannerEvent) => {
        plannerEvents.push(plannerEvent);
      },
      spawnCopilotProcess: vi.fn(() => child),
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
      sessionId: 'copilot-session-70',
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
