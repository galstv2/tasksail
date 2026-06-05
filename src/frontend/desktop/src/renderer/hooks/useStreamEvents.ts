import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { StreamEvent, TerminalTaskScopeOption } from '../activityStream';

type StreamEventsState = { events: StreamEvent[]; replayedEventIds: ReadonlySet<string> };
type StreamEventsAction =
  | { type: 'append'; event: StreamEvent; maxEvents: number }
  | { type: 'replay'; events: StreamEvent[] }
  | { type: 'clear' };

// Consolidates events + replayedEventIds into one reducer so the replayed-id
// pruning (which needs the post-append window) happens in a single pure step.
// Previously this was a setReplayedEventIds call nested inside the setEvents
// updater — an impure-updater anti-pattern.
function streamEventsReducer(state: StreamEventsState, action: StreamEventsAction): StreamEventsState {
  switch (action.type) {
    case 'append': {
      const { event, maxEvents: cap } = action;
      const events = state.events.length < cap
        ? [...state.events, event]
        : state.events.slice(1 - cap).concat(event);
      let replayedEventIds = state.replayedEventIds;
      if (replayedEventIds.size > 0) {
        const renderedIds = new Set(events.map((rendered) => rendered.id));
        const nextIds = new Set<string>();
        for (const id of replayedEventIds) {
          if (id !== event.id && renderedIds.has(id)) {
            nextIds.add(id);
          }
        }
        replayedEventIds = nextIds;
      }
      return { events, replayedEventIds };
    }
    case 'replay':
      return {
        events: action.events,
        replayedEventIds: new Set(action.events.map((event) => event.id)),
      };
    case 'clear':
      return { events: [], replayedEventIds: new Set() };
    default:
      return state;
  }
}

export function useStreamEvents(maxEvents = 500): {
  events: StreamEvent[];
  replayedEventIds: ReadonlySet<string>;
  taskScopes: TerminalTaskScopeOption[];
  selectedTaskGuid: string | null;
  setSelectedTaskGuid: (taskGuid: string | null) => Promise<void>;
  clearEvents: () => void;
} {
  const [{ events, replayedEventIds }, dispatchStream] = useReducer(
    streamEventsReducer,
    { events: [], replayedEventIds: new Set<string>() },
  );
  const [taskScopes, setTaskScopes] = useState<TerminalTaskScopeOption[]>([]);
  const [selectedTaskGuid, setSelectedTaskGuidState] = useState<string | null>(null);
  const scopeRequestSeq = useRef(0);

  useEffect(() => {
    if (!window.desktopShell?.onStreamEvent) return;
    const unsubscribe = window.desktopShell.onStreamEvent((event) => {
      if (event.taskGuid !== null) {
        setTaskScopes((prev) => mergeTaskScope(prev, event));
      }
      dispatchStream({ type: 'append', event, maxEvents });
    });
    return unsubscribe;
  }, [maxEvents]);

  const clearEvents = useCallback(() => {
    dispatchStream({ type: 'clear' });
  }, []);
  const setSelectedTaskGuid = useCallback(async (taskGuid: string | null) => {
    const requestSeq = scopeRequestSeq.current + 1;
    scopeRequestSeq.current = requestSeq;
    let response: Awaited<ReturnType<typeof window.desktopShell.setTerminalTaskScope>>;
    try {
      response = await window.desktopShell.setTerminalTaskScope(taskGuid);
    } catch {
      return;
    }
    if (requestSeq !== scopeRequestSeq.current) {
      return;
    }
    if (response.ok && response.response.action === 'terminal.setTaskScope') {
      dispatchStream({ type: 'replay', events: response.response.events });
      setTaskScopes(response.response.taskScopes);
      setSelectedTaskGuidState(response.response.selectedTaskGuid);
    }
  }, []);

  return {
    events,
    replayedEventIds,
    taskScopes,
    selectedTaskGuid,
    setSelectedTaskGuid,
    clearEvents,
  };
}

function mergeTaskScope(
  taskScopes: TerminalTaskScopeOption[],
  event: StreamEvent,
): TerminalTaskScopeOption[] {
  if (!event.taskGuid || !event.taskShortGuid) {
    return taskScopes;
  }
  const next = [...taskScopes];
  const existing = next.find((scope) => scope.taskGuid === event.taskGuid);
  if (!existing) {
    next.push({
      taskGuid: event.taskGuid,
      taskShortGuid: event.taskShortGuid,
      taskId: event.taskId,
      title: event.taskTitle,
    });
  } else if (!existing.title && event.taskTitle) {
    existing.title = event.taskTitle;
  }
  return next.sort((a, b) => (
    taskScopeLabel(a).localeCompare(taskScopeLabel(b)) ||
    a.taskShortGuid.localeCompare(b.taskShortGuid)
  ));
}

function taskScopeLabel(option: TerminalTaskScopeOption): string {
  return option.title ?? (option.taskId ? `Task ${option.taskId}` : `Task ${option.taskShortGuid}`);
}
