import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readReseedMarker } from '../reseedMarker.js';

describe('readReseedMarker', () => {
  let contextPackDir: string;
  const markerPath = () => path.join(contextPackDir, '.reseed-in-progress.json');

  beforeEach(() => {
    contextPackDir = mkdtempSync(path.join(tmpdir(), 'reseed-marker-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(contextPackDir, { recursive: true, force: true });
  });

  it('returns null when no marker exists', async () => {
    await expect(readReseedMarker(contextPackDir)).resolves.toBeNull();
  });

  it('returns reseed details for a recent marker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T18:30:00Z'));
    writeFileSync(markerPath(), JSON.stringify({
      started_at: '2026-05-06T18:29:00Z',
      pid: 123,
      host: 'host-a',
    }), 'utf-8');

    await expect(readReseedMarker(contextPackDir)).resolves.toEqual({
      startedAt: '2026-05-06T18:29:00Z',
      ageMs: 60_000,
      pid: 123,
      host: 'host-a',
    });
  });

  it('returns null and warns for a stale marker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T20:30:00Z'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeFileSync(markerPath(), JSON.stringify({
      started_at: '2026-05-06T18:00:00Z',
      pid: 123,
      host: 'host-a',
    }), 'utf-8');
    const oldTime = new Date('2026-05-06T18:00:00Z');
    utimesSync(markerPath(), oldTime, oldTime);

    await expect(readReseedMarker(contextPackDir)).resolves.toBeNull();
    expect(String(stderr.mock.calls.flat().join('\n'))).toContain('reseed_marker.stale.ignored');
  });

  it('returns null and warns for corrupt marker JSON', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeFileSync(markerPath(), '{not-json', 'utf-8');

    await expect(readReseedMarker(contextPackDir)).resolves.toBeNull();
    expect(String(stderr.mock.calls.flat().join('\n'))).toContain('reseed_marker.corrupt.ignored');
  });

  it('throws when the marker path is not readable as a file', async () => {
    mkdirSync(markerPath());

    await expect(readReseedMarker(contextPackDir)).rejects.toThrow('Unable to read reseed marker');
  });
});
