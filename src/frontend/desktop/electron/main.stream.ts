/**
 * Shared stream event emitter — broadcasts structured events to all
 * renderer windows via the DESKTOP_SHELL_STREAM_CHANNEL IPC channel.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';

import { DESKTOP_SHELL_STREAM_CHANNEL } from '../src/shared/desktopContract';
import type { StreamEvent, StreamRole, StreamSeverity } from '../src/renderer/activityStream';
import type { DesktopInvokeResult } from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';

export type StreamEventOptions = {
  message: string;
  source: string;
  role: StreamRole;
  severity?: StreamSeverity;
  taskId?: string;
  actorName?: string;
  sessionContext?: StreamEvent['sessionContext'];
};

const TASK_EVENT_GUIDS = new Map<string, string>();
const TASK_MESSAGE_PREFIX_PATTERN = /^Task \[[0-9a-fA-F]{8}\]\s/u;
const TASK_REGISTRY_PATH = join(REPO_ROOT, '.platform-state', 'task-registry.json');

function findTaskGuidInRegistry(taskId: string): string | null {
  try {
    const raw = readFileSync(TASK_REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as {
      tasks?: Record<string, Record<string, unknown>>;
    };
    for (const taskSet of Object.values(parsed.tasks ?? {})) {
      for (const state of ['open', 'pending', 'active', 'failed', 'completed']) {
        const entries = taskSet[state];
        if (!Array.isArray(entries)) {
          continue;
        }
        for (const entry of entries) {
          if (
            entry &&
            typeof entry === 'object' &&
            'taskId' in entry &&
            entry.taskId === taskId &&
            'taskGuid' in entry &&
            typeof entry.taskGuid === 'string'
          ) {
            return entry.taskGuid;
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function getTaskEventGuid(taskId: string | undefined): string | null {
  const normalizedTaskId = taskId?.trim();
  if (!normalizedTaskId || normalizedTaskId === 'N/A') {
    return null;
  }

  const existing = TASK_EVENT_GUIDS.get(normalizedTaskId);
  if (existing) {
    return existing;
  }

  const guid = (findTaskGuidInRegistry(normalizedTaskId) ?? randomUUID()).slice(0, 8);
  TASK_EVENT_GUIDS.set(normalizedTaskId, guid);
  return guid;
}

function formatTaskScopedMessage(message: string, taskId: string | undefined): string {
  if (TASK_MESSAGE_PREFIX_PATTERN.test(message)) {
    return message;
  }

  const taskGuid = getTaskEventGuid(taskId);
  return taskGuid ? `Task [${taskGuid}] ${message}` : message;
}

export function emitStreamEvent(options: StreamEventOptions): void {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) return;
  const event = {
    id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toLocaleTimeString(),
    role: options.role,
    source: options.source,
    taskId: options.taskId ?? 'N/A',
    severity: options.severity ?? 'info',
    message: formatTaskScopedMessage(options.message, options.taskId),
    actorName: options.actorName,
    sessionContext: options.sessionContext,
  };
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(DESKTOP_SHELL_STREAM_CHANNEL, event);
    }
  }
}

/**
 * Await a handler result, emit a stream event on success, and return the result.
 * Use for the common pattern in handleDesktopAction switch cases.
 */
export async function withStreamEvent(
  resultOrPromise: DesktopInvokeResult | Promise<DesktopInvokeResult>,
  event: StreamEventOptions,
): Promise<DesktopInvokeResult> {
  const r = await resultOrPromise;
  if (r.ok) emitStreamEvent(event);
  return r;
}
