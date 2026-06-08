import { app } from 'electron';

import { TASKSAIL_DEV_RESTART_REQUEST_MESSAGE } from '../devRestartProtocol';

/**
 * Restart TaskSail so saved platform settings take effect.
 *
 * In a `vite-plugin-electron` dev session, Electron is a launcher-managed child
 * process, so `app.relaunch()` is unreliable: the relaunched process is detached
 * from the launcher (can't reach the dev server → black screen) and races the
 * single-instance lock. Instead we ask the parent launcher to perform the same
 * clean managed restart it uses for HMR (graceful quit + respawn).
 *
 * In production (no dev launcher) we use the standard Electron relaunch, guarded
 * with optional chaining like `app.exit?.()` for non-app/test contexts.
 */
export function restartTaskSailApp(): void {
  if (process.env.VITE_DEV_SERVER_URL && typeof process.send === 'function') {
    process.send(TASKSAIL_DEV_RESTART_REQUEST_MESSAGE);
    return;
  }
  app.relaunch?.();
  app.quit?.();
}
