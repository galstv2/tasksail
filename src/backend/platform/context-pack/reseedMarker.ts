import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { isMissingPathError } from '../core/index.js';

const RESEED_MARKER_FILENAME = '.reseed-in-progress.json';
const STALE_MARKER_AGE_MS = 60 * 60 * 1000;

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
    process.stderr.write(`[reseedMarker] ignoring corrupt marker at ${markerPath}\n`);
    return null;
  }
  if (
    typeof parsed.started_at !== 'string'
    || typeof parsed.pid !== 'number'
    || !Number.isFinite(parsed.pid)
    || typeof parsed.host !== 'string'
    || parsed.host.trim().length === 0
  ) {
    process.stderr.write(`[reseedMarker] ignoring corrupt marker at ${markerPath}\n`);
    return null;
  }

  const startedAtMs = Date.parse(parsed.started_at);
  if (Number.isNaN(startedAtMs)) {
    process.stderr.write(`[reseedMarker] ignoring marker with unparseable started_at at ${markerPath}\n`);
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
    process.stderr.write(
      `[reseedMarker] ignoring stale marker (age ${Math.round(ageMs / 1000)}s) at ${markerPath}\n`,
    );
    return null;
  }

  return {
    startedAt: parsed.started_at,
    ageMs,
    pid: parsed.pid,
    host: parsed.host,
  };
}
