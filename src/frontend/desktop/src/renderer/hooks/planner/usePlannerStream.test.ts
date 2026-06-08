import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlannerStreamEvent } from '../../../shared/desktopContract';
import { usePlannerStream } from './usePlannerStream';

function plannerEvent(event: Omit<PlannerStreamEvent, 'sessionId'>): PlannerStreamEvent {
  return { sessionId: 'planner-test', ...event };
}

describe('usePlannerStream', () => {
  let subscribedCallback: ((plannerEvent: PlannerStreamEvent) => void) | null;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    subscribedCallback = null;
    unsubscribe = vi.fn();
    window.desktopShell = {
      ...window.desktopShell,
      sendPlannerMessage: vi.fn(),
      onPlannerEvent: vi.fn((cb) => {
        subscribedCallback = cb;
        return unsubscribe;
      }),
    } as typeof window.desktopShell;
  });

  afterEach(() => {
    subscribedCallback = null;
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => usePlannerStream());
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('accumulates tokens into a single streaming message', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: 'Hello', messageKind: 'delta' }));
    });
    act(() => {
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: ' world', messageKind: 'delta' }));
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].text).toBe('Hello world');
    expect(result.current.messages[0].role).toBe('planner');
    expect(result.current.messages[0].isStreaming).toBe(true);
  });

  it('marks isStreaming as true during token flow', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.started', brokerStatus: 'running', turnId: 'turn-1', done: false }));
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.brokerStatus).toBe('running');
  });

  it('marks isStreaming as false after explicit completion', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: 'Hello', messageKind: 'delta' }));
    });
    act(() => {
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.completed', brokerStatus: 'completed', turnId: 'turn-1', done: true }));
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.brokerStatus).toBe('completed');
    expect(result.current.messages[0].text).toBe('Hello');
    expect(result.current.messages[0].isStreaming).toBe(false);
  });

  it('does not render non-message planner events as chat content', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.started', brokerStatus: 'running', turnId: 'turn-1', done: false }));
      subscribedCallback!(plannerEvent({ eventType: 'planner.session.updated', brokerStatus: 'completed', turnId: 'turn-1', done: false, cliSessionId: 'session-1' }));
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.completed', brokerStatus: 'completed', turnId: 'turn-1', done: true }));
    });

    expect(result.current.messages).toEqual([]);
  });

  it('sendMessage appends an operator message', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      result.current.sendMessage('Build a feature');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('operator');
    expect(result.current.messages[0].text).toBe('Build a feature');
    expect(result.current.messages[0].isStreaming).toBe(false);
  });

  it('caps messages at MAX_MESSAGES (200)', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
        for (let i = 0; i < 210; i++) {
          subscribedCallback!(plannerEvent({ eventType: 'planner.turn.message', brokerStatus: 'completed', turnId: `turn-${i}`, done: true, content: `msg-${i}`, messageKind: 'final' }));
        }
      });

    expect(result.current.messages).toHaveLength(200);
    expect(result.current.messages[0].text).toBe('msg-10');
    expect(result.current.messages[199].text).toBe('msg-209');
  });

  it('caps operator messages at MAX_MESSAGES (200)', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.sendMessage(`op-${i}`);
      }
    });

    expect(result.current.messages).toHaveLength(200);
    expect(result.current.messages[0].text).toBe('op-10');
    expect(result.current.messages[199].text).toBe('op-209');
  });

  it('clearConversation resets messages and streaming state', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: 'token', messageKind: 'delta' }));
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.clearConversation();
    });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.brokerStatus).toBe('idle');
    expect(result.current.lastError).toBe('');
  });

  it('hydrateMessages replaces messages without streaming state or broker IPC', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      result.current.sendMessage('Live message');
      result.current.hydrateMessages([
        {
          id: 'history-1',
          role: 'operator',
          text: 'Historical operator message',
          isStreaming: true,
          timestamp: '2026-03-20T00:00:00.000Z',
        },
        {
          id: 'history-2',
          role: 'planner',
          text: 'Historical planner message',
          isStreaming: false,
          timestamp: '2026-03-20T00:01:00.000Z',
        },
      ]);
    });

    expect(result.current.messages).toEqual([
      {
        id: 'history-1',
        role: 'operator',
        text: 'Historical operator message',
        isStreaming: false,
        timestamp: '2026-03-20T00:00:00.000Z',
      },
      {
        id: 'history-2',
        role: 'planner',
        text: 'Historical planner message',
        isStreaming: false,
        timestamp: '2026-03-20T00:01:00.000Z',
      },
    ]);
    expect(result.current.isStreaming).toBe(false);
    expect(window.desktopShell.sendPlannerMessage).not.toHaveBeenCalled();
  });

  it('drops planner events whose session id does not match the expected session id', () => {
    const expectedSessionIdRef: { current: string | null } = { current: 'expected-session' };
    const { result } = renderHook(() => usePlannerStream({ expectedSessionIdRef }));

    act(() => {
      subscribedCallback!(plannerEvent({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: 'stale', messageKind: 'delta' }));
      subscribedCallback!({ sessionId: 'expected-session', eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-2', done: false, content: 'fresh', messageKind: 'delta' });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].text).toBe('fresh');

    act(() => {
      expectedSessionIdRef.current = null;
      subscribedCallback!({ sessionId: 'expected-session', eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-3', done: false, content: 'while-resetting', messageKind: 'delta' });
    });

    expect(result.current.messages).toHaveLength(1);
  });
});
