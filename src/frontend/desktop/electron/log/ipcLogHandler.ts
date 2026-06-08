import { ipcMain } from 'electron';

import {
  LOG_EMIT_CHANNEL,
  logEmitValidationError,
  validateLogEmitPayload,
  type ValidLogEmitPayload,
} from '../../src/shared/desktopContractLogging';
import { validateDesktopInvokeSender } from '../app/senderAuth';
import { acceptForeignLine, createLogger } from './logger';

const logger = createLogger('electron/log/ipcLogHandler');

// Fixed-window rate limit — mirrored from ipc/contract.ts.
// Threshold is kept at 60/s (same as DESKTOP_SHELL_INVOKE_CHANNEL) because
// renderer telemetry bursts arrive infrequently; renderer-side batching keeps
// the per-second volume well below this cap under normal usage.
const IPC_RATE_LIMIT_WINDOW_MS = 1000;
const IPC_RATE_LIMIT_MAX = 60;
let rateWindowStart = 0;
let rateCount = 0;
// Drop-warning deduplication: emit at most one warn per window.
let rateWarnedThisWindow = false;

export function registerIpcLogHandler(): void {
  ipcMain.handle(LOG_EMIT_CHANNEL, async (event, payload: unknown) => {
    // 1. Rate gate — applied to ALL invocations before any other work.
    const now = Date.now();
    if (now - rateWindowStart > IPC_RATE_LIMIT_WINDOW_MS) {
      rateWindowStart = now;
      rateCount = 0;
      rateWarnedThisWindow = false;
    }
    rateCount++;
    if (rateCount > IPC_RATE_LIMIT_MAX) {
      if (!rateWarnedThisWindow) {
        rateWarnedThisWindow = true;
        logger.warn('ipc.log.emit.rate_limit', { count: rateCount });
      }
      return { ok: false, reason: 'rate limit exceeded' };
    }

    // 2. Sender authentication — fail-soft, never throw into preload.
    const senderError = validateDesktopInvokeSender(event);
    if (senderError) {
      return { ok: false, reason: senderError };
    }

    // 3. Payload validation.
    const validationReason = logEmitValidationError(payload);
    if (!validateLogEmitPayload(payload)) {
      return drop(validationReason ?? 'invalid log payload');
    }

    // 4. Write.
    try {
      acceptForeignLine(payload as ValidLogEmitPayload);
      return { ok: true };
    } catch (err) {
      return drop(shortReason(err));
    }
  });
}

function drop(reason: string): { ok: false; reason: string } {
  logger.warn('ipc.log.emit.drop', { reason });
  return { ok: false, reason };
}

function shortReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
