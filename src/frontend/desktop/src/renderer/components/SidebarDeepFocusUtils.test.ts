import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatRecentsTimestamp } from './SidebarDeepFocusUtils';

describe('formatRecentsTimestamp — Apple Mail vocabulary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T14:30:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Just now" for less than a minute', () => {
    expect(formatRecentsTimestamp('2026-04-15T14:29:30')).toBe('Just now');
    expect(formatRecentsTimestamp('2026-04-15T14:30:00')).toBe('Just now');
  });

  it('returns Nm (no "ago" suffix) for the first hour', () => {
    expect(formatRecentsTimestamp('2026-04-15T14:18:00')).toBe('12m');
    expect(formatRecentsTimestamp('2026-04-15T13:31:00')).toBe('59m');
  });

  it('returns Nh for the first 24 hours', () => {
    expect(formatRecentsTimestamp('2026-04-15T12:30:00')).toBe('2h');
    expect(formatRecentsTimestamp('2026-04-14T15:00:00')).toBe('23h');
  });

  it('returns "Yesterday" once the calendar day rolls over (even if < 24h)', () => {
    expect(formatRecentsTimestamp('2026-04-14T08:00:00')).toBe('Yesterday');
  });

  it('returns the weekday abbrev for 2-6 calendar days back', () => {
    expect(formatRecentsTimestamp('2026-04-13T10:00:00')).toMatch(/^[A-Z][a-z]{2}$/);
    expect(formatRecentsTimestamp('2026-04-09T10:00:00')).toMatch(/^[A-Z][a-z]{2}$/);
  });

  it('returns the absolute month-day for 7+ calendar days back', () => {
    const formatted = formatRecentsTimestamp('2026-04-05T10:00:00');
    expect(formatted).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(formatted).not.toMatch(/^[A-Z][a-z]{2}$/);
  });

  it('returns the absolute date for events well in the past', () => {
    expect(formatRecentsTimestamp('2025-11-23T10:00:00')).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('treats malformed input as a passthrough', () => {
    expect(formatRecentsTimestamp('not-a-date')).toBe('not-a-date');
  });
});
