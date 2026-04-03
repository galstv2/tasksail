import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IpcMainInvokeEvent } from 'electron';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIST = join(__dirname, '../dist');

export function validateDevServerUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:') {
      return 'VITE_DEV_SERVER_URL must use http:// for local development.';
    }

    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) {
      return 'VITE_DEV_SERVER_URL must point to localhost, 127.0.0.1, or ::1.';
    }

    return null;
  } catch {
    return 'VITE_DEV_SERVER_URL must be a valid URL.';
  }
}

function isAuthorizedDesktopSenderUrl(senderUrl: string): boolean {
  if (!senderUrl) {
    return false;
  }

  const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (viteDevServerUrl) {
    if (validateDevServerUrl(viteDevServerUrl) !== null) {
      return false;
    }
    try {
      const expected = new URL(viteDevServerUrl);
      const actual = new URL(senderUrl);
      return actual.origin === expected.origin;
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(senderUrl);
    if (parsed.protocol !== 'file:') {
      return false;
    }
    const senderPath = fileURLToPath(parsed);
    return senderPath.startsWith(RENDERER_DIST);
  } catch {
    return false;
  }
}

export function validateDesktopInvokeSender(
  event: Pick<IpcMainInvokeEvent, 'senderFrame'> | { senderFrame?: { url?: string | undefined } | null },
): string | null {
  const senderUrl = event.senderFrame?.url ?? '';
  if (!isAuthorizedDesktopSenderUrl(senderUrl)) {
    return 'Desktop IPC request rejected: unauthorized renderer sender.';
  }
  return null;
}
