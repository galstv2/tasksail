import { useCallback, useEffect, useRef, useState } from 'react';

import type { StreamEvent, TerminalTaskScopeOption } from '../activityStream';

export function useStreamEvents(maxEvents = 500): {
  events: StreamEvent[];
  replayedEventIds: ReadonlySet<string>;
  taskScopes: TerminalTaskScopeOption[];
  selectedTaskGuid: string | null;
  setSelectedTaskGuid: (taskGuid: string | null) => Promise<void>;
  clearEvents: () => void;
} {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [replayedEventIds, setReplayedEventIds] = useState<ReadonlySet<string>>(() => new Set());
  const [taskScopes, setTaskScopes] = useState<TerminalTaskScopeOption[]>([]);
  const [selectedTaskGuid, setSelectedTaskGuidState] = useState<string | null>(null);
  const scopeRequestSeq = useRef(0);

  useEffect(() => {
    if (!window.desktopShell?.onStreamEvent) return;
    const unsubscribe = window.desktopShell.onStreamEvent((event) => {
      if (event.taskGuid !== null) {
        setTaskScopes((prev) => mergeTaskScope(prev, event));
      }
      setEvents((prev) => {
        const next = prev.length < maxEvents
          ? [...prev, event]
          : prev.slice(1 - maxEvents).concat(event);
        const renderedIds = new Set(next.map((renderedEvent) => renderedEvent.id));
        setReplayedEventIds((prevIds) => {
          if (prevIds.size === 0) {
            return prevIds;
          }
          const nextIds = new Set<string>();
          for (const id of prevIds) {
            if (id !== event.id && renderedIds.has(id)) {
              nextIds.add(id);
            }
          }
          return nextIds;
        });
        return next;
      });
    });
    return unsubscribe;
  }, [maxEvents]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setReplayedEventIds(new Set());
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
      setEvents(response.response.events);
      setReplayedEventIds(new Set(response.response.events.map((event) => event.id)));
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
