import { ipcMain } from 'electron';

import {
  DESKTOP_SHELL_INVOKE_CHANNEL,
  PROVIDER_DESCRIBE_ACTIVE_CHANNEL,
  type DesktopActionRequest,
  type DesktopInvokeResult,
} from '../src/shared/desktopContract';
import { DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL } from '../src/shared/desktopContractPlanner';
import { getProviderFrontendDescriptor } from '../../../backend/platform/cli-provider/index.js';
import { REPO_ROOT } from './paths';
import { validateDesktopInvokeSender } from './main.senderAuth';
import { readBypassTemplate } from './main.taskQueue';
import { DesktopActionRouter } from './main.desktopActionRouter';

const IPC_RATE_LIMIT_WINDOW_MS = 1000;
const IPC_RATE_LIMIT_MAX = 60;
let ipcRateWindowStart = 0;
let ipcRateCount = 0;

export class DesktopIpcContract {
  constructor(private readonly router = new DesktopActionRouter()) {}

  register(): void {
    ipcMain.handle(DESKTOP_SHELL_INVOKE_CHANNEL, async (event, request: DesktopActionRequest) => {
      const senderError = validateDesktopInvokeSender(event);
      if (senderError) {
        return {
          ok: false,
          action: request?.action,
          error: senderError,
        } satisfies DesktopInvokeResult;
      }

      const now = Date.now();
      if (now - ipcRateWindowStart > IPC_RATE_LIMIT_WINDOW_MS) {
        ipcRateWindowStart = now;
        ipcRateCount = 0;
      }
      ipcRateCount++;
      if (ipcRateCount > IPC_RATE_LIMIT_MAX) {
        return {
          ok: false,
          action: request?.action,
          error: 'Rate limit exceeded. Please wait before retrying.',
        } satisfies DesktopInvokeResult;
      }

      return this.router.handle(request, { webContentsId: event.sender?.id });
    });

    ipcMain.handle(DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL, async () => readBypassTemplate());
    ipcMain.handle(PROVIDER_DESCRIBE_ACTIVE_CHANNEL, async () => getProviderFrontendDescriptor(REPO_ROOT));
  }
}

export function registerDesktopContract(): void {
  new DesktopIpcContract().register();
}
