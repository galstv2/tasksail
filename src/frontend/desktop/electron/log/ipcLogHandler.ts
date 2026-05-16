import { ipcMain } from 'electron';

import {
  LOG_EMIT_CHANNEL,
  logEmitValidationError,
  validateLogEmitPayload,
  type ValidLogEmitPayload,
} from '../../src/shared/desktopContractLogging';
import { acceptForeignLine, createLogger } from './logger';

const logger = createLogger('electron/log/ipcLogHandler');

export function registerIpcLogHandler(): void {
  ipcMain.handle(LOG_EMIT_CHANNEL, async (_event, payload: unknown) => {
    const validationReason = logEmitValidationError(payload);
    if (!validateLogEmitPayload(payload)) {
      return drop(validationReason ?? 'invalid log payload');
    }

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
