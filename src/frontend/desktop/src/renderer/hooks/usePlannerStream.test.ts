import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlannerStreamEvent } from '../../shared/desktopContract';
import { usePlannerStream } from './usePlannerStream';

describe('usePlannerStream', () => {
  let subscribedCallback: ((plannerEvent: PlannerStreamEvent) => void) | null;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    subscribedCallback = null;
    unsubscribe = vi.fn();
    window.desktopShell = {
      ...window.desktopShell,
      onPlannerEvent: vi.fn((cb) => {
        subscribedCallback = cb;
        return unsubscribe;
      }),
    } as typeof window.desktopShell;
  });

  afterEach(() => {
    subscribedCallback = null;
  });

  it('subscribes to onPlannerEvent on mount', () => {
    renderHook(() => usePlannerStream());
    expect(window.desktopShell.onPlannerEvent).toHaveBeenCalledOnce();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => usePlannerStream());
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('accumulates tokens into a single streaming message', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: 'Hello', messageKind: 'delta' });
    });
    act(() => {
      subscribedCallback!({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: ' world', messageKind: 'delta' });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].text).toBe('Hello world');
    expect(result.current.messages[0].role).toBe('planner');
    expect(result.current.messages[0].isStreaming).toBe(true);
  });

  it('marks isStreaming as true during token flow', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!({ eventType: 'planner.turn.started', brokerStatus: 'running', turnId: 'turn-1', done: false });
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.brokerStatus).toBe('running');
  });

  it('marks isStreaming as false after explicit completion', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: 'Hello', messageKind: 'delta' });
    });
    act(() => {
      subscribedCallback!({ eventType: 'planner.turn.completed', brokerStatus: 'completed', turnId: 'turn-1', done: true });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.brokerStatus).toBe('completed');
    expect(result.current.messages[0].text).toBe('Hello');
    expect(result.current.messages[0].isStreaming).toBe(false);
  });

  it('does not render non-message planner events as chat content', () => {
    const { result } = renderHook(() => usePlannerStream());

    act(() => {
      subscribedCallback!({ eventType: 'planner.turn.started', brokerStatus: 'running', turnId: 'turn-1', done: false });
      subscribedCallback!({ eventType: 'planner.session.updated', brokerStatus: 'completed', turnId: 'turn-1', done: false, copilotSessionId: 'session-1' });
      subscribedCallback!({ eventType: 'planner.turn.completed', brokerStatus: 'completed', turnId: 'turn-1', done: true });
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
          subscribedCallback!({ eventType: 'planner.turn.message', brokerStatus: 'completed', turnId: `turn-${i}`, done: true, content: `msg-${i}`, messageKind: 'final' });
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
      subscribedCallback!({ eventType: 'planner.turn.message', brokerStatus: 'running', turnId: 'turn-1', done: false, content: 'token', messageKind: 'delta' });
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
});
