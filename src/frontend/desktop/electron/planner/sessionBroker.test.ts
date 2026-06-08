// @vitest-environment node

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { PlannerStreamEvent } from '../../src/shared/desktopContract';
import { PlannerSessionBroker } from './sessionBroker';

type FakeChildProcess = ChildProcess & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function createFakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn<(signal?: number | NodeJS.Signals) => boolean>();
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
      plannerPersonalityId: 'clinical',
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
      plannerPersonalityId: 'balanced',
    }));
    child.emit('exit', 0);
    await sendPromise;
  });

  it('passes captured reasoning effort into every planner turn', async () => {
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnCliProcess = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const broker = new PlannerSessionBroker({
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(901)
        .mockReturnValueOnce(902)
        .mockReturnValueOnce(903),
    });

    broker.startSession({ reasoningEffort: 'high' });
    await broker.sendMessage('First');
    await Promise.resolve();
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'cli-session-1',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);
    await Promise.resolve();

    await broker.sendMessage('Second');
    await Promise.resolve();

    expect(spawnCliProcess).toHaveBeenNthCalledWith(1, expect.objectContaining({
      reasoningEffort: 'high',
      resumeSessionId: null,
    }));
    expect(spawnCliProcess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      reasoningEffort: 'high',
      resumeSessionId: 'cli-session-1',
    }));
    secondChild.emit('exit', 0);
  });

  it('captures launch extensions once and reuses them on every planner turn', async () => {
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnCliProcess = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const sourceLaunchExtensions = {
      pluginDirs: ['/plugins/original'],
      skillDirs: ['/skills/original'],
    };
    const broker = new PlannerSessionBroker({
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(901)
        .mockReturnValueOnce(902)
        .mockReturnValueOnce(903),
    });

    broker.startSession({ launchExtensions: sourceLaunchExtensions });
    sourceLaunchExtensions.pluginDirs[0] = '/plugins/mutated';
    sourceLaunchExtensions.pluginDirs.push('/plugins/late');
    sourceLaunchExtensions.skillDirs[0] = '/skills/mutated';
    await broker.sendMessage('First');
    await Promise.resolve();
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'cli-session-1',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);
    await Promise.resolve();

    await broker.sendMessage('Second');
    await Promise.resolve();

    expect(spawnCliProcess).toHaveBeenNthCalledWith(1, expect.objectContaining({
      launchExtensions: {
        pluginDirs: ['/plugins/original'],
        skillDirs: ['/skills/original'],
      },
    }));
    expect(spawnCliProcess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      launchExtensions: {
        pluginDirs: ['/plugins/original'],
        skillDirs: ['/skills/original'],
      },
    }));
    const captured = spawnCliProcess.mock.calls[0]![0].launchExtensions;
    expect(captured).toBeDefined();
    expect(Object.isFrozen(captured!.pluginDirs)).toBe(true);
    expect(Object.isFrozen(captured!.skillDirs)).toBe(true);
    secondChild.emit('exit', 0);
  });

  it('does not let frozen resolver-returned arrays leak through the capture boundary', async () => {
    const child = createFakeChildProcess();
    const spawnCliProcess = vi.fn(() => child);
    const resolverLaunchExtensions = { pluginDirs: Object.freeze(['/plugins/frozen']), skillDirs: Object.freeze(['/skills/frozen']) };
    const broker = new PlannerSessionBroker({ spawnCliProcess, now: vi.fn(() => 1001) });

    expect(() => (resolverLaunchExtensions.pluginDirs as string[]).push('/plugins/before')).toThrow();
    broker.startSession({ launchExtensions: resolverLaunchExtensions });
    expect(() => (resolverLaunchExtensions.skillDirs as string[]).push('/skills/after')).toThrow();
    await broker.sendMessage('Hello');
    await Promise.resolve();

    expect(spawnCliProcess).toHaveBeenCalledWith(expect.objectContaining({
      launchExtensions: {
        pluginDirs: ['/plugins/frozen'],
        skillDirs: ['/skills/frozen'],
      },
    }));
    const capturedOptions = (spawnCliProcess.mock.calls as unknown as Array<[{ launchExtensions?: unknown }]>)[0]![0];
    expect(capturedOptions.launchExtensions).not.toBe(resolverLaunchExtensions);
    child.emit('exit', 0);
  });

  it('stores null launch-extension absence and passes undefined to planner turns', async () => {
    const child = createFakeChildProcess();
    const spawnCliProcess = vi.fn(() => child);
    const broker = new PlannerSessionBroker({ spawnCliProcess, now: vi.fn(() => 801) });

    broker.startSession();
    await broker.sendMessage('Hello');
    await Promise.resolve();

    expect(spawnCliProcess).toHaveBeenCalledWith(expect.objectContaining({
      launchExtensions: undefined,
    }));
    child.emit('exit', 0);
  });

      // Launch extensions are captured/frozen on session and surfaced for
  // relaunch (used in every subsequent turn of the same session), null when absent.

  it('phase2: captured launchExtensions are surfaced on every turn of the session including resumed turns', async () => {
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnCliProcess = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const broker = new PlannerSessionBroker({
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(601)
        .mockReturnValueOnce(602)
        .mockReturnValueOnce(603),
    });

    broker.startSession({
      launchExtensions: { pluginDirs: ['/stage/plugin-a'], skillDirs: ['/stage/skill-a'] },
    });

    // First turn: broker uses captured extensions.
    await broker.sendMessage('First');
    await Promise.resolve();
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'cli-601',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);
    await Promise.resolve();

    // Resumed turn: broker still supplies the same captured extensions.
    await broker.sendMessage('Second');
    await Promise.resolve();

    expect(spawnCliProcess).toHaveBeenNthCalledWith(1, expect.objectContaining({
      launchExtensions: { pluginDirs: ['/stage/plugin-a'], skillDirs: ['/stage/skill-a'] },
    }));
    expect(spawnCliProcess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      launchExtensions: { pluginDirs: ['/stage/plugin-a'], skillDirs: ['/stage/skill-a'] },
      resumeSessionId: 'cli-601',
    }));
    secondChild.emit('exit', 0);
  });

  it('phase2: null (absent) launchExtensions surface as undefined on every turn', async () => {
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnCliProcess = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const broker = new PlannerSessionBroker({
      spawnCliProcess,
      now: vi.fn()
        .mockReturnValueOnce(701)
        .mockReturnValueOnce(702)
        .mockReturnValueOnce(703),
    });

    // No launchExtensions passed to startSession.
    broker.startSession();

    await broker.sendMessage('First');
    await Promise.resolve();
    firstChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      sessionId: 'cli-701',
      exitCode: 0,
    }) + '\n'));
    firstChild.emit('exit', 0);
    await Promise.resolve();

    await broker.sendMessage('Second');
    await Promise.resolve();

    // Both turns must receive undefined (not null, not a stale value from a prior session).
    expect(spawnCliProcess).toHaveBeenNthCalledWith(1, expect.objectContaining({
      launchExtensions: undefined,
    }));
    expect(spawnCliProcess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      launchExtensions: undefined,
    }));
    secondChild.emit('exit', 0);
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
