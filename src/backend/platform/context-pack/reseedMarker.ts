import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createLogger, isMissingPathError } from '../core/index.js';

const RESEED_MARKER_FILENAME = '.reseed-in-progress.json';
const STALE_MARKER_AGE_MS = 60 * 60 * 1000;
const log = createLogger('platform/context-pack/reseedMarker');

interface ReseedMarker {
  started_at: string;
  pid: number;
  host: string;
}

export interface ReseedInProgress {
  startedAt: string;
  ageMs: number;
  pid: number;
  host: string;
}

export async function readReseedMarker(
  contextPackDir: string,
): Promise<ReseedInProgress | null> {
  const markerPath = path.join(contextPackDir, RESEED_MARKER_FILENAME);
  let raw: string;
  try {
    raw = await readFile(markerPath, 'utf-8');
  } catch (err: unknown) {
    if (isMissingPathError(err)) return null;
    throw new Error(
      `Unable to read reseed marker at ${markerPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: ReseedMarker;
  try {
    parsed = JSON.parse(raw) as ReseedMarker;
  } catch {
    log.warn('reseed_marker.corrupt.ignored', { markerPath });
    return null;
  }
  if (
    typeof parsed.started_at !== 'string'
    || typeof parsed.pid !== 'number'
    || !Number.isFinite(parsed.pid)
    || typeof parsed.host !== 'string'
    || parsed.host.trim().length === 0
  ) {
    log.warn('reseed_marker.corrupt.ignored', { markerPath });
    return null;
  }

  const startedAtMs = Date.parse(parsed.started_at);
  if (Number.isNaN(startedAtMs)) {
    log.warn('reseed_marker.started_at.invalid', { markerPath, startedAt: parsed.started_at });
    return null;
  }

  const ageMs = Date.now() - startedAtMs;
  if (ageMs > STALE_MARKER_AGE_MS) {
    try {
      const info = await stat(markerPath);
      const mtimeAgeMs = Date.now() - info.mtimeMs;
      if (mtimeAgeMs <= STALE_MARKER_AGE_MS) {
        return {
          startedAt: parsed.started_at,
          ageMs: mtimeAgeMs,
          pid: parsed.pid,
          host: parsed.host,
        };
      }
    } catch {
      // Treat stat failure as stale; the marker already parsed as old.
    }
    log.warn('reseed_marker.stale.ignored', { markerPath, ageSeconds: Math.round(ageMs / 1000) });
    return null;
  }

  return {
    startedAt: parsed.started_at,
    ageMs,
    pid: parsed.pid,
    host: parsed.host,
  };
}
