import { describe, expect, it } from 'vitest';
import { assertValidTaskId } from '../paths.js';
import {
  buildReadableTaskFileName,
  buildReadableTaskId,
  isGeneratedTaskFileName,
  stripGeneratedTaskPrefix,
} from '../taskNames.js';

const NOW = new Date('2026-05-17T09:02:46.000Z');

describe('taskNames', () => {
  it('generates readable task ids from titles', () => {
    expect(buildReadableTaskId({ rawTitle: 'Auth Middleware Wire', now: NOW }))
      .toBe('2026-05-17_auth-middleware-wire-090246');
  });

  it('generates ids that pass the queue task id pattern', () => {
    const id = buildReadableTaskId({ rawTitle: 'Auth Middleware Wire', now: NOW });
    expect(() => assertValidTaskId(id)).not.toThrow();
  });

  it('trims long titles to 64 characters without a trailing separator', () => {
    const id = buildReadableTaskId({
      rawTitle: 'This title is deliberately extremely long and should be trimmed cleanly',
      now: NOW,
    });
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).not.toMatch(/[-_]$/);
    expect(id).toMatch(/^2026-05-17_/);
    expect(id).toMatch(/-090246$/);
  });

  it('appends collision suffixes while preserving the length cap', () => {
    const first = buildReadableTaskId({ rawTitle: 'Auth Middleware Wire', now: NOW });
    const second = buildReadableTaskId({
      rawTitle: 'Auth Middleware Wire',
      now: NOW,
      existingIds: new Set([first]),
    });
    const third = buildReadableTaskId({
      rawTitle: 'Auth Middleware Wire',
      now: NOW,
      existingIds: new Set([first, second]),
    });
    expect(second).toBe('2026-05-17_auth-middleware-wire-090246-2');
    expect(third).toBe('2026-05-17_auth-middleware-wire-090246-3');
    expect(second.length).toBeLessThanOrEqual(64);
  });

  it('strips legacy compact prefixes before applying readable names', () => {
    expect(stripGeneratedTaskPrefix('20260517t090246z_task-a')).toBe('task-a');
    expect(buildReadableTaskFileName({
      rawTitle: '20260517t090246z_task-a',
      now: NOW,
    })).toBe('2026-05-17_task-a-090246.md');
  });

  it('strips readable prefixes before applying readable names', () => {
    expect(stripGeneratedTaskPrefix('2026-05-17_task-a-090246')).toBe('task-a');
    expect(buildReadableTaskFileName({
      rawTitle: '2026-05-17_task-a-090246',
      now: NOW,
    })).toBe('2026-05-17_task-a-090246.md');
  });

  it('does not strip natural six-digit suffixes from non-generated titles', () => {
    expect(stripGeneratedTaskPrefix('incident-123456')).toBe('incident-123456');
    expect(buildReadableTaskFileName({
      rawTitle: 'incident-123456',
      now: NOW,
    })).toBe('2026-05-17_incident-123456-090246.md');
  });

  it('recognizes only valid generated task filenames for preservation', () => {
    expect(isGeneratedTaskFileName('20260517t090246z_task-a.md')).toBe(true);
    expect(isGeneratedTaskFileName('2026-05-17_task-a-090246.md')).toBe(true);
    expect(isGeneratedTaskFileName('20260307T183000Z-my-task.md')).toBe(false);
    expect(isGeneratedTaskFileName('incident-123456.md')).toBe(false);
  });
});
