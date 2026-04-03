import { useCallback, useEffect, useState } from 'react';

import type { StreamEvent } from '../activityStream';

export function useStreamEvents(maxEvents = 500): {
  events: StreamEvent[];
  clearEvents: () => void;
} {
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    if (!window.desktopShell?.onStreamEvent) return;
    const unsubscribe = window.desktopShell.onStreamEvent((event) => {
      setEvents((prev) => {
        if (prev.length < maxEvents) {
          return [...prev, event];
        }
        return prev.slice(1 - maxEvents).concat(event);
      });
    });
    return unsubscribe;
  }, [maxEvents]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, clearEvents };
}
