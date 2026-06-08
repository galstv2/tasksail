/**
 * Shared stream event emitter — broadcasts structured events to all
 * renderer windows via the DESKTOP_SHELL_STREAM_CHANNEL IPC channel.
 */
import { BrowserWindow } from 'electron';

import { DESKTOP_SHELL_STREAM_CHANNEL } from '../../src/shared/desktopContract';
import type {
  StreamEvent,
  StreamRole,
  StreamSeverity,
  TerminalTaskScopeOption,
} from '../../src/renderer/activityStream';
import type { DesktopInvokeResult, TerminalSetTaskScopeResponse } from '../../src/shared/desktopContract';
import {
  isRegistryEntryVisibleForScope,
  type ActiveContextPackTaskScope,
} from '../contextPack/taskVisibility';
import { REPO_ROOT } from '../paths';
import {
  loadTaskRegistry,
  type TaskRegistry,
  type TaskRegistryEntry,
} from '../../../../backend/platform/queue/taskRegistry.js';

export type StreamEventOptions = {
  message: string;
  source: string;
  role: StreamRole;
  severity?: StreamSeverity;
  taskId?: string;
  actorName?: string;
  /** Optional: realignment job ID, populated only for runtime.realignment events. */
  realignmentId?: string;
  sessionContext?: StreamEvent['sessionContext'];
};

/** Whether emitStreamEvent accepted/appended a task-scoped event or skipped it due to missing metadata. */
export type StreamEmitResult = { emitAccepted: boolean };

type TaskStreamMetadata = {
  taskId: string;
  taskGuid: string;
  taskShortGuid: string;
  taskTitle: string | null;
};

const STREAM_HISTORY_LIMIT = 500;
const TASK_STREAM_METADATA_BY_TASK_ID = new Map<string, TaskStreamMetadata>();
const STREAM_HISTORY: StreamEvent[] = [];
/** Per-task GUID stream history for task-fair replay. Capped at STREAM_HISTORY_LIMIT per task GUID. */
const STREAM_HISTORY_BY_TASK_GUID = new Map<string, StreamEvent[]>();
const TERMINAL_TASK_SCOPE_BY_WEB_CONTENTS_ID = new Map<number, string | null>();
const TASK_MESSAGE_PREFIX_PATTERN = /^(Task \[[0-9a-fA-F]{8}\])(?:\s-\s|\s)/u;

function registryEntries(registry: TaskRegistry): TaskRegistryEntry[] {
  return Object.values(registry.tasks).flatMap((taskSet) => [
    ...taskSet.open,
    ...taskSet.pending,
    ...taskSet.active,
    ...taskSet.failed,
    ...taskSet.completed,
  ]);
}

export async function refreshStreamTaskMetadataForScope(
  scope: ActiveContextPackTaskScope | null,
): Promise<void> {
  TASK_STREAM_METADATA_BY_TASK_ID.clear();
  if (!scope) {
    pruneTaskStreamHistory(new Set());
    return;
  }

  const registry = await loadTaskRegistry(REPO_ROOT);
  const activeTaskGuids = new Set<string>();
  for (const entry of registryEntries(registry)) {
    if (!isRegistryEntryVisibleForScope(entry, scope)) {
      continue;
    }
    const taskGuid = entry.taskGuid?.trim();
    if (!taskGuid) {
      continue;
    }
    activeTaskGuids.add(taskGuid);
    TASK_STREAM_METADATA_BY_TASK_ID.set(entry.taskId, {
      taskId: entry.taskId,
      taskGuid,
      taskShortGuid: taskGuid.slice(0, 8),
      taskTitle: entry.title?.trim() || null,
    });
  }
  pruneTaskStreamHistory(activeTaskGuids);
}

function getTaskStreamMetadata(taskId: string | undefined): TaskStreamMetadata | null {
  const normalizedTaskId = taskId?.trim();
  if (!normalizedTaskId || normalizedTaskId === 'N/A') {
    return null;
  }

  const existing = TASK_STREAM_METADATA_BY_TASK_ID.get(normalizedTaskId);
  if (existing) {
    return existing;
  }

  return null;
}

function formatTaskScopedMessage(
  message: string,
  taskId: string | undefined,
  actorName: string | undefined,
): string {
  const existingPrefix = TASK_MESSAGE_PREFIX_PATTERN.exec(message);
  if (existingPrefix?.[1]) {
    return message.startsWith(`${existingPrefix[1]} - `)
      ? message
      : message.replace(TASK_MESSAGE_PREFIX_PATTERN, `${existingPrefix[1]} - `);
  }

  const taskMetadata = getTaskStreamMetadata(taskId);
  if (!taskMetadata) {
    return message;
  }

  const normalizedActorName = actorName?.trim();
  return normalizedActorName
    ? `Task [${taskMetadata.taskShortGuid}] - ${normalizedActorName}: ${message}`
    : `Task [${taskMetadata.taskShortGuid}] - ${message}`;
}

export function emitStreamEvent(options: StreamEventOptions): StreamEmitResult {
  const windows = BrowserWindow.getAllWindows();
  const taskMetadata = getTaskStreamMetadata(options.taskId);
  if (options.taskId?.trim() && options.taskId !== 'N/A' && !taskMetadata) {
    // Task-scoped event skipped because visible-task metadata is temporarily missing.
    return { emitAccepted: false };
  }
  const event: StreamEvent = {
    id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    role: options.role,
    source: options.source,
    taskId: options.taskId ?? 'N/A',
    taskGuid: taskMetadata?.taskGuid ?? null,
    taskShortGuid: taskMetadata?.taskShortGuid ?? null,
    taskTitle: taskMetadata?.taskTitle ?? null,
    severity: options.severity ?? 'info',
    message: formatTaskScopedMessage(options.message, options.taskId, options.actorName),
    actorName: options.actorName,
    ...(options.realignmentId ? { realignmentId: options.realignmentId } : {}),
    sessionContext: options.sessionContext,
  };
  appendStreamHistory(event);
  for (const win of windows) {
    if (!win.isDestroyed() && eventMatchesWindowScope(win.webContents.id, event)) {
      win.webContents.send(DESKTOP_SHELL_STREAM_CHANNEL, event);
    }
  }
  return { emitAccepted: true };
}

export function resetStreamState(): void {
  TASK_STREAM_METADATA_BY_TASK_ID.clear();
  STREAM_HISTORY.splice(0, STREAM_HISTORY.length);
  STREAM_HISTORY_BY_TASK_GUID.clear();
  TERMINAL_TASK_SCOPE_BY_WEB_CONTENTS_ID.clear();
}

export function setTerminalTaskScopeForWebContents(
  webContentsId: number,
  taskGuid: string | null,
): TerminalSetTaskScopeResponse {
  const globalHistory = [...STREAM_HISTORY];
  // Use per-task histories for scope discovery so a noisy task cannot evict quiet tasks.
  const taskScopes = buildTaskScopesFromPerTaskHistory(STREAM_HISTORY_BY_TASK_GUID, globalHistory);
  const requestedGuid = typeof taskGuid === 'string' ? taskGuid.trim() : null;
  const knownGuid = requestedGuid
    ? taskScopes.some((scope) => scope.taskGuid === requestedGuid)
    : true;
  const selectedTaskGuid = requestedGuid && knownGuid ? requestedGuid : null;
  TERMINAL_TASK_SCOPE_BY_WEB_CONTENTS_ID.set(webContentsId, selectedTaskGuid);
  // For scoped replay, prefer per-task history so quiet tasks are fully replayable.
  const replayEvents = selectedTaskGuid
    ? (STREAM_HISTORY_BY_TASK_GUID.get(selectedTaskGuid) ?? filterHistoryByTaskGuid(globalHistory, selectedTaskGuid))
    : globalHistory;
  return {
    action: 'terminal.setTaskScope',
    mode: 'scoped',
    selectedTaskGuid,
    events: [...replayEvents],
    taskScopes,
    message: requestedGuid && !knownGuid
      ? 'Unknown terminal task scope; reset to all tasks.'
      : selectedTaskGuid
        ? 'Terminal task scope updated.'
        : 'Terminal task scope reset to all tasks.',
  };
}

export function clearTerminalTaskScopeForWebContents(webContentsId: number): void {
  TERMINAL_TASK_SCOPE_BY_WEB_CONTENTS_ID.delete(webContentsId);
}

function appendStreamHistory(event: StreamEvent): void {
  STREAM_HISTORY.push(event);
  if (STREAM_HISTORY.length > STREAM_HISTORY_LIMIT) {
    STREAM_HISTORY.splice(0, STREAM_HISTORY.length - STREAM_HISTORY_LIMIT);
  }
  appendTaskStreamHistory(event);
}

function appendTaskStreamHistory(event: StreamEvent): void {
  if (!event.taskGuid) {
    return;
  }
  const taskHistory = STREAM_HISTORY_BY_TASK_GUID.get(event.taskGuid) ?? [];
  taskHistory.push(event);
  if (taskHistory.length > STREAM_HISTORY_LIMIT) {
    taskHistory.splice(0, taskHistory.length - STREAM_HISTORY_LIMIT);
  }
  STREAM_HISTORY_BY_TASK_GUID.set(event.taskGuid, taskHistory);
}

function pruneTaskStreamHistory(activeTaskGuids: ReadonlySet<string>): void {
  for (const guid of STREAM_HISTORY_BY_TASK_GUID.keys()) {
    if (!activeTaskGuids.has(guid)) {
      STREAM_HISTORY_BY_TASK_GUID.delete(guid);
    }
  }
}

function eventMatchesWindowScope(webContentsId: number, event: StreamEvent): boolean {
  const selectedTaskGuid = TERMINAL_TASK_SCOPE_BY_WEB_CONTENTS_ID.get(webContentsId) ?? null;
  return selectedTaskGuid === null || event.taskGuid === selectedTaskGuid;
}

function filterHistoryByTaskGuid(events: StreamEvent[], taskGuid: string | null): StreamEvent[] {
  return taskGuid === null ? events : events.filter((event) => event.taskGuid === taskGuid);
}

/**
 * Build task scope options from per-task histories (primary) plus the global history (fallback).
 * Per-task histories survive noisy-task eviction from the global cap, so quiet tasks remain
 * selectable even if the 500-event global cap has rolled past them.
 */
function buildTaskScopesFromPerTaskHistory(
  perTaskHistory: ReadonlyMap<string, StreamEvent[]>,
  globalHistory: StreamEvent[],
): TerminalTaskScopeOption[] {
  const byGuid = new Map<string, TerminalTaskScopeOption>();

  const processEvent = (event: StreamEvent): void => {
    if (!event.taskGuid || !event.taskShortGuid) {
      return;
    }
    const existing = byGuid.get(event.taskGuid);
    if (!existing) {
      byGuid.set(event.taskGuid, {
        taskGuid: event.taskGuid,
        taskShortGuid: event.taskShortGuid,
        taskId: event.taskId,
        title: event.taskTitle,
      });
    } else if (!existing.title && event.taskTitle) {
      existing.title = event.taskTitle;
    }
  };

  // Per-task history is the primary source — quiet tasks survive noisy-task eviction.
  for (const taskEvents of perTaskHistory.values()) {
    for (const event of taskEvents) {
      processEvent(event);
    }
  }
  // Global history fills in any non-task-scoped scopes.
  for (const event of globalHistory) {
    processEvent(event);
  }

  return [...byGuid.values()].sort((a, b) => (
    taskScopeLabel(a).localeCompare(taskScopeLabel(b)) ||
    a.taskShortGuid.localeCompare(b.taskShortGuid)
  ));
}

function taskScopeLabel(option: TerminalTaskScopeOption): string {
  return option.title ?? (option.taskId ? `Task ${option.taskId}` : `Task ${option.taskShortGuid}`);
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
