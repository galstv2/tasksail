import { useEffect, useState } from 'react';

/**
 * Debounce a value: returns the input after `delayMs` of stability.
 *
 * Used for ARIA live-region announcements (spec §4.10) so rapid state
 * changes don't overwhelm screen readers. The visible UI can keep using
 * the un-debounced source value; the live region binds to the result.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
