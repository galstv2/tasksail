import { dirname, join, posix, sep, win32 } from 'node:path';
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

/**
 * Pure path-level check: is `senderPath` equal to or a direct descendant of
 * `distPath`? Containment is computed with path.relative (not a startsWith
 * boundary). On Windows the comparison is case-insensitive for the WHOLE path
 * (the Windows filesystem is case-insensitive), so differing drive/segment
 * casing — e.g. C:\\App\\Dist vs c:\\app\\dist\\index.html — does not reject a
 * legitimate renderer; POSIX stays case-sensitive. A prefix-sibling (e.g.
 * dist-extra) and a cross-drive path are NOT authorized.
 *
 * Exported for unit testing; production callers use isAuthorizedDesktopSenderUrl.
 */
export function isFileUrlInsideDist(senderPath: string, distPath: string, pathSep: string): boolean {
  // path.relative-based containment (no raw startsWith boundary). path.win32 is
  // case-insensitive across the whole path — matching the Windows filesystem —
  // so differing drive/segment casing never rejects a legitimate renderer; POSIX
  // stays case-sensitive. Prefix-siblings and cross-drive paths resolve to an
  // absolute or "../" relative result, and ".." escapes resolve to a ".." first
  // segment; all are rejected.
  const impl = pathSep === '\\' ? win32 : posix;
  const relative = impl.relative(impl.resolve(distPath), impl.resolve(senderPath));
  if (relative === '') {
    return true;
  }
  if (impl.isAbsolute(relative)) {
    return false;
  }
  return relative.split(impl.sep)[0] !== '..';
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
    // isFileUrlInsideDist resolves/normalizes both paths internally.
    const senderPath = fileURLToPath(parsed);
    return isFileUrlInsideDist(senderPath, RENDERER_DIST, sep);
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
