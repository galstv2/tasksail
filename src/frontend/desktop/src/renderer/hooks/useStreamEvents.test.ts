import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStreamEvents } from './useStreamEvents';
import type { StreamEvent } from '../activityStream';

function makeEvent(id: string, overrides: Partial<StreamEvent> = {}): StreamEvent {
  return {
    id,
    timestamp: '10:00:00',
    role: 'workflow',
    source: 'test',
    taskId: 'TASK-1',
    taskGuid: null,
    taskShortGuid: null,
    taskTitle: null,
    severity: 'info',
    message: `event ${id}`,
    ...overrides,
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
      setTerminalTaskScope: vi.fn(),
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

  it('merges task scope options by full GUID and keeps the first title', () => {
    const { result } = renderHook(() => useStreamEvents());

    act(() => {
      subscribedCallback!(makeEvent('e1', {
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        taskShortGuid: 'feedbeef',
        taskTitle: 'First title',
      }));
      subscribedCallback!(makeEvent('e2', {
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        taskShortGuid: 'feedbeef',
        taskTitle: 'Second title',
      }));
    });

    expect(result.current.taskScopes).toEqual([
      {
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        taskShortGuid: 'feedbeef',
        taskId: 'TASK-1',
        title: 'First title',
      },
    ]);
  });

  it('setSelectedTaskGuid replaces events and options from the backend response', async () => {
    vi.mocked(window.desktopShell.setTerminalTaskScope).mockResolvedValueOnce({
      ok: true,
      response: {
        action: 'terminal.setTaskScope',
        mode: 'scoped',
        selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        events: [makeEvent('scoped')],
        taskScopes: [{
          taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
          taskShortGuid: 'feedbeef',
          taskId: 'TASK-1',
          title: 'Scoped task',
        }],
        message: 'Terminal task scope updated.',
      },
    });
    const { result } = renderHook(() => useStreamEvents());

    await act(async () => {
      await result.current.setSelectedTaskGuid('feedbeef-1234-4234-9234-123456789abc');
    });

    expect(result.current.events.map((event) => event.id)).toEqual(['scoped']);
    expect(Array.from(result.current.replayedEventIds)).toEqual(['scoped']);
    expect(result.current.selectedTaskGuid).toBe('feedbeef-1234-4234-9234-123456789abc');
    expect(result.current.taskScopes[0].title).toBe('Scoped task');
  });

  it('failed scope responses leave state unchanged', async () => {
    vi.mocked(window.desktopShell.setTerminalTaskScope).mockResolvedValueOnce({
      ok: false,
      action: 'terminal.setTaskScope',
      error: 'Nope.',
    });
    const { result } = renderHook(() => useStreamEvents());
    act(() => subscribedCallback!(makeEvent('e1')));

    await act(async () => {
      await result.current.setSelectedTaskGuid('feedbeef-1234-4234-9234-123456789abc');
    });

    expect(result.current.events.map((event) => event.id)).toEqual(['e1']);
    expect(result.current.replayedEventIds.size).toBe(0);
    expect(result.current.selectedTaskGuid).toBeNull();
  });

  it('rejected scope requests leave state unchanged', async () => {
    vi.mocked(window.desktopShell.setTerminalTaskScope).mockRejectedValueOnce(new Error('ipc down'));
    const { result } = renderHook(() => useStreamEvents());
    act(() => subscribedCallback!(makeEvent('e1')));

    await act(async () => {
      await result.current.setSelectedTaskGuid('feedbeef-1234-4234-9234-123456789abc');
    });

    expect(result.current.events.map((event) => event.id)).toEqual(['e1']);
    expect(result.current.replayedEventIds.size).toBe(0);
    expect(result.current.selectedTaskGuid).toBeNull();
  });

  it('failed and rejected scope requests preserve replay suppression state', async () => {
    vi.mocked(window.desktopShell.setTerminalTaskScope)
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'terminal.setTaskScope',
          mode: 'scoped',
          selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
          events: [makeEvent('scoped')],
          taskScopes: [],
          message: 'Terminal task scope updated.',
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        action: 'terminal.setTaskScope',
        error: 'Nope.',
      })
      .mockRejectedValueOnce(new Error('ipc down'));
    const { result } = renderHook(() => useStreamEvents());

    await act(async () => {
      await result.current.setSelectedTaskGuid('feedbeef-1234-4234-9234-123456789abc');
    });
    await act(async () => {
      await result.current.setSelectedTaskGuid('facefeed-1234-4234-9234-123456789abc');
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['scoped']);
    expect(Array.from(result.current.replayedEventIds)).toEqual(['scoped']);

    await act(async () => {
      await result.current.setSelectedTaskGuid('badc0ffe-1234-4234-9234-123456789abc');
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['scoped']);
    expect(Array.from(result.current.replayedEventIds)).toEqual(['scoped']);
  });

  it('applies only the latest rapid scope response', async () => {
    let resolveFirst: (value: Awaited<ReturnType<typeof window.desktopShell.setTerminalTaskScope>>) => void = () => {};
    vi.mocked(window.desktopShell.setTerminalTaskScope)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'terminal.setTaskScope',
          mode: 'scoped',
          selectedTaskGuid: 'second',
          events: [makeEvent('second')],
          taskScopes: [],
          message: 'Terminal task scope updated.',
        },
      });
    const { result } = renderHook(() => useStreamEvents());

    void act(() => {
      void result.current.setSelectedTaskGuid('first');
    });
    await act(async () => {
      await result.current.setSelectedTaskGuid('second');
    });
    await act(async () => {
      resolveFirst({
        ok: true,
        response: {
          action: 'terminal.setTaskScope',
          mode: 'scoped',
          selectedTaskGuid: 'first',
          events: [makeEvent('first')],
          taskScopes: [],
          message: 'Terminal task scope updated.',
        },
      });
      await Promise.resolve();
    });

    expect(result.current.events.map((event) => event.id)).toEqual(['second']);
    expect(Array.from(result.current.replayedEventIds)).toEqual(['second']);
    expect(result.current.selectedTaskGuid).toBe('second');
  });

  it('live appends after replay are not suppressed', async () => {
    vi.mocked(window.desktopShell.setTerminalTaskScope).mockResolvedValueOnce({
      ok: true,
      response: {
        action: 'terminal.setTaskScope',
        mode: 'scoped',
        selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        events: [makeEvent('scoped')],
        taskScopes: [],
        message: 'Terminal task scope updated.',
      },
    });
    const { result } = renderHook(() => useStreamEvents());

    await act(async () => {
      await result.current.setSelectedTaskGuid('feedbeef-1234-4234-9234-123456789abc');
    });
    act(() => subscribedCallback!(makeEvent('live')));

    expect(result.current.events.map((event) => event.id)).toEqual(['scoped', 'live']);
    expect(Array.from(result.current.replayedEventIds)).toEqual(['scoped']);
  });

  it('live appends remove duplicate ids from replay suppression', async () => {
    vi.mocked(window.desktopShell.setTerminalTaskScope).mockResolvedValueOnce({
      ok: true,
      response: {
        action: 'terminal.setTaskScope',
        mode: 'scoped',
        selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        events: [makeEvent('dup')],
        taskScopes: [],
        message: 'Terminal task scope updated.',
      },
    });
    const { result } = renderHook(() => useStreamEvents());

    await act(async () => {
      await result.current.setSelectedTaskGuid('feedbeef-1234-4234-9234-123456789abc');
    });
    act(() => subscribedCallback!(makeEvent('dup', { message: 'live duplicate' })));

    expect(result.current.events.map((event) => event.id)).toEqual(['dup', 'dup']);
    expect(result.current.replayedEventIds.size).toBe(0);
  });

  it('clearEvents resets events but preserves task scopes and selected task', async () => {
    vi.mocked(window.desktopShell.setTerminalTaskScope).mockResolvedValueOnce({
      ok: true,
      response: {
        action: 'terminal.setTaskScope',
        mode: 'scoped',
        selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        events: [makeEvent('scoped')],
        taskScopes: [{
          taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
          taskShortGuid: 'feedbeef',
          taskId: 'TASK-1',
          title: 'Scoped task',
        }],
        message: 'Terminal task scope updated.',
      },
    });
    const { result } = renderHook(() => useStreamEvents());

    await act(async () => {
      await result.current.setSelectedTaskGuid('feedbeef-1234-4234-9234-123456789abc');
    });
    expect(result.current.events).toHaveLength(1);
    expect(Array.from(result.current.replayedEventIds)).toEqual(['scoped']);

    act(() => {
      result.current.clearEvents();
    });
    expect(result.current.events).toHaveLength(0);
    expect(result.current.replayedEventIds.size).toBe(0);
    expect(result.current.taskScopes).toHaveLength(1);
    expect(result.current.selectedTaskGuid).toBe('feedbeef-1234-4234-9234-123456789abc');
  });
});
