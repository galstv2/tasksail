/**
 * Shared stream event emitter — broadcasts structured events to all
 * renderer windows via the DESKTOP_SHELL_STREAM_CHANNEL IPC channel.
 */
import { BrowserWindow } from 'electron';

import { DESKTOP_SHELL_STREAM_CHANNEL } from '../src/shared/desktopContract';
import type { StreamEvent, StreamRole, StreamSeverity } from '../src/renderer/activityStream';
import type { DesktopInvokeResult } from '../src/shared/desktopContract';

export type StreamEventOptions = {
  message: string;
  source: string;
  role: StreamRole;
  severity?: StreamSeverity;
  taskId?: string;
  actorName?: string;
  sessionContext?: StreamEvent['sessionContext'];
};

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
    message: options.message,
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
