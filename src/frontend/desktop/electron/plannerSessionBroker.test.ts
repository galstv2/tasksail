// @vitest-environment node

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

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

describe('PlannerSessionBroker stream identity', () => {
  it('uses planner-now session IDs by default and caller-supplied IDs when provided', () => {
    const broker = new PlannerSessionBroker({ now: vi.fn(() => 901) });

    expect(broker.startSession()).toEqual({ sessionId: 'planner-901', created: true });
    broker.endSession();
    expect(broker.startSession({ sessionId: 'planner-fixed' })).toEqual({ sessionId: 'planner-fixed', created: true });
  });

  it('defaults personality to balanced and allows pre-bootstrap updates only', async () => {
    const child = createFakeChildProcess();
    const spawnCliProcess = vi.fn(() => child);
    const broker = new PlannerSessionBroker({
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(701)
        .mockReturnValueOnce(702),
    });

    broker.startSession();
    expect(broker.updateSessionPersonality('clinical')).toBe('updated');

    const sendPromise = broker.sendMessage('Hello');
    await Promise.resolve();
    expect(spawnCliProcess).toHaveBeenCalledWith(expect.objectContaining({
      lilyPersonalityId: 'clinical',
    }));
    expect(broker.updateSessionPersonality('balanced')).toBe('locked');
    child.emit('exit', 0);
    await sendPromise;
  });

  it('passes balanced personality when omitted', async () => {
    const child = createFakeChildProcess();
    const spawnCliProcess = vi.fn(() => child);
    const broker = new PlannerSessionBroker({ spawnCliProcess, now: vi.fn(() => 801) });

    broker.startSession();
    const sendPromise = broker.sendMessage('Hello');
    await Promise.resolve();
    expect(spawnCliProcess).toHaveBeenCalledWith(expect.objectContaining({
      lilyPersonalityId: 'balanced',
    }));
    child.emit('exit', 0);
    await sendPromise;
  });

  it('adds sessionId to events and drops late events after endSession', async () => {
    const events: PlannerStreamEvent[] = [];
    const child = createFakeChildProcess();
    const broker = new PlannerSessionBroker({
      emitEvent: (event) => events.push(event),
      spawnCliProcess: vi.fn(() => child),
      now: vi.fn()
        .mockReturnValueOnce(501)
        .mockReturnValueOnce(502),
    });

    broker.startSession();
    await expect(broker.sendMessage('Hello')).resolves.toBe('sent');
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'planner.turn.started',
        sessionId: 'planner-501',
      }),
    ]);

    broker.endSession();
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant.message',
      data: { content: 'stale' },
    }) + '\n'));
    child.emit('exit', 0);

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'planner.turn.started',
        sessionId: 'planner-501',
      }),
    ]);
  });
});
