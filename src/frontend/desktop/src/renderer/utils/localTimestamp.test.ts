import { describe, expect, it } from 'vitest';

import { formatLocalTimeShort, formatRelativeDay } from './localTimestamp';

describe('formatLocalTimeShort', () => {
  it('renders local HH:MM with no seconds', () => {
    const iso = new Date(2026, 4, 23, 14, 37, 5).toISOString();
    expect(formatLocalTimeShort(iso)).toBe('14:37');
  });

  it('returns null for malformed input', () => {
    expect(formatLocalTimeShort('not-a-date')).toBeNull();
  });
});

describe('formatRelativeDay', () => {
  const now = new Date(2026, 4, 23, 12, 0, 0); // local: 2026-05-23 12:00

  it('returns "Today" for the same calendar day', () => {
    const iso = new Date(2026, 4, 23, 3, 58, 37).toISOString();
    expect(formatRelativeDay(iso, now)).toBe('Today');
  });

  it('returns "Yesterday" for the prior calendar day', () => {
    const iso = new Date(2026, 4, 22, 23, 59, 0).toISOString();
    expect(formatRelativeDay(iso, now)).toBe('Yesterday');
  });

  it('returns short month-day for older dates within the same year', () => {
    const iso = new Date(2026, 4, 17, 1, 50, 6).toISOString();
    expect(formatRelativeDay(iso, now)).toBe('May 17');
  });

  it('returns month-day-year for prior years', () => {
    const iso = new Date(2025, 10, 4, 9, 30, 0).toISOString();
    expect(formatRelativeDay(iso, now)).toBe('Nov 4, 2025');
  });

  it('returns null for malformed input', () => {
    expect(formatRelativeDay('not-a-date', now)).toBeNull();
  });
});
