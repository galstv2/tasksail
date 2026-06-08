/**
 * Context-pack catalog watcher.
 *
 * Teardown is synchronous: `stopContextPackCatalogWatcher()` closes active
 * fs.watch handles directly from Electron's before-quit path.
 */
import { watch, type FSWatcher } from 'node:fs';
import { basename } from 'node:path';

import type { ContextPackCatalogChangedEvent } from '../../src/shared/desktopContract';
import { getNodeErrorCode } from '../main.textUtils';
import { createLogger } from '../log/logger';

const log = createLogger('electron/main.contextPackWatcher');

type WatcherEntry = {
  watcher: FSWatcher | null;
  timer: NodeJS.Timeout | null;
};

type StartOptions = {
  catalogRoots: string[];
  onChange: (event: ContextPackCatalogChangedEvent) => void;
};

const watchers = new Map<string, WatcherEntry>();

function reasonFromEvent(eventType: string): ContextPackCatalogChangedEvent['reason'] {
  return eventType === 'rename' ? 'rename' : 'unknown';
}

function eventBasename(filename: string | Buffer | null): string | null {
  if (filename === null) {
    return null;
  }
  const normalized = String(filename).replace(/\\/g, '/');
  const name = basename(normalized);
  return name.length > 0 ? name : null;
}

function shouldIgnoreWatchEvent(filename: string | Buffer | null): boolean {
  const name = eventBasename(filename);
  if (name === null) {
    return false;
  }
  return name === '.pack-writer.lock'
    || (name.startsWith('.') && name.endsWith('.tmp'));
}

function scheduleChange(
  root: string,
  reason: ContextPackCatalogChangedEvent['reason'],
  onChange: (event: ContextPackCatalogChangedEvent) => void,
): void {
  const entry = watchers.get(root);
  if (!entry) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = setTimeout(() => {
    entry.timer = null;
    onChange({ changedRoot: root, reason });
  }, 500);
}

export function startContextPackCatalogWatcher({
  catalogRoots,
  onChange,
}: StartOptions): void {
  if (watchers.size > 0) return;
  for (const root of catalogRoots) {
    try {
      const watcher = watch(root, { recursive: true }, (eventType, filename) => {
        if (shouldIgnoreWatchEvent(filename)) {
          return;
        }
        scheduleChange(root, reasonFromEvent(eventType), onChange);
      });
      watcher.on('error', () => {
        log.warn('context-pack.watcher.stopped', { root });
        watchers.get(root)?.watcher?.close();
        watchers.delete(root);
      });
      watchers.set(root, { watcher, timer: null });
    } catch (err: unknown) {
      if (getNodeErrorCode(err) === 'ENOENT') {
        log.info('context-pack.watcher.skipped', { root, reason: 'missing-root' });
        continue;
      }
      log.error(
        'context-pack.watcher.start.failed',
        err instanceof Error ? err : { reason: String(err) },
        { root },
      );
      throw err;
    }
  }
}

export function stopContextPackCatalogWatcher(): void {
  for (const entry of watchers.values()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.watcher?.close();
  }
  watchers.clear();
}
