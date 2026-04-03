import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStreamEvents } from './useStreamEvents';
import type { StreamEvent } from '../activityStream';

function makeEvent(id: string): StreamEvent {
  return {
    id,
    timestamp: '10:00:00',
    role: 'workflow',
    source: 'test',
    taskId: 'TASK-1',
    severity: 'info',
    message: `event ${id}`,
  };
}

describe('useStreamEvents', () => {
  let subscribedCallback: ((event: StreamEvent) => void) | null;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    subscribedCallback = null;
    unsubscribe = vi.fn();
    window.desktopShell = {
      ...window.desktopShell,
      onStreamEvent: vi.fn((cb) => {
        subscribedCallback = cb;
        return unsubscribe;
      }),
    } as typeof window.desktopShell;
  });

  afterEach(() => {
    subscribedCallback = null;
  });

  it('subscribes to onStreamEvent on mount', () => {
    renderHook(() => useStreamEvents());
    expect(window.desktopShell.onStreamEvent).toHaveBeenCalledOnce();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useStreamEvents());
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('accumulates events in state', () => {
    const { result } = renderHook(() => useStreamEvents());

    act(() => {
      subscribedCallback!(makeEvent('e1'));
    });
    act(() => {
      subscribedCallback!(makeEvent('e2'));
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].id).toBe('e1');
    expect(result.current.events[1].id).toBe('e2');
  });

  it('caps at maxEvents (ring buffer behavior)', () => {
    const { result } = renderHook(() => useStreamEvents(3));

    act(() => {
      subscribedCallback!(makeEvent('e1'));
      subscribedCallback!(makeEvent('e2'));
      subscribedCallback!(makeEvent('e3'));
      subscribedCallback!(makeEvent('e4'));
    });

    expect(result.current.events).toHaveLength(3);
    expect(result.current.events[0].id).toBe('e2');
    expect(result.current.events[2].id).toBe('e4');
  });

  it('clearEvents resets to empty array', () => {
    const { result } = renderHook(() => useStreamEvents());

    act(() => {
      subscribedCallback!(makeEvent('e1'));
    });
    expect(result.current.events).toHaveLength(1);

    act(() => {
      result.current.clearEvents();
    });
    expect(result.current.events).toHaveLength(0);
  });
});
