// Parent (vite dev launcher) → child (Electron): gracefully quit so the launcher
// can respawn a fresh Electron (HMR + managed settings restart).
export const TASKSAIL_DEV_GRACEFUL_RESTART_MESSAGE = 'tasksail:dev-graceful-restart';

// Child (Electron) → parent (vite dev launcher): request a clean managed restart.
// Used by the System Settings save flow in dev, where app.relaunch() is unreliable
// (single-instance-lock race + a launcher-detached process that cannot reach the
// dev server). The launcher responds by gracefully quitting and respawning Electron.
export const TASKSAIL_DEV_RESTART_REQUEST_MESSAGE = 'tasksail:dev-restart-request';
