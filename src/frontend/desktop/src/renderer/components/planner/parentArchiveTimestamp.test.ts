import { describe, expect, it } from 'vitest';

import { formatParentArchiveTimestamp } from './parentArchiveTimestamp';

function expectedLocalTimestamp(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    String(date.getFullYear()).padStart(4, '0'),
  ].join('/') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

describe('formatParentArchiveTimestamp', () => {
  it('formats timestamps in operator-local time as MM/DD/YYYY HH:MM:SS', () => {
    expect(formatParentArchiveTimestamp('2026-05-17T08:42:11Z')).toBe(
      expectedLocalTimestamp('2026-05-17T08:42:11Z'),
    );
  });

  it('zero pads values and rejects invalid input', () => {
    expect(formatParentArchiveTimestamp('2026-01-02T03:04:05Z')).toBe(
      expectedLocalTimestamp('2026-01-02T03:04:05Z'),
    );
    expect(formatParentArchiveTimestamp('not-a-date')).toBeNull();
  });
});
