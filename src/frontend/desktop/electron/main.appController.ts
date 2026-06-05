import { app, BrowserWindow, nativeImage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTEXT_PACK_CATALOG_CHANGED_CHANNEL } from '../src/shared/desktopContract';
import * as plannerSession from './plannerSession';
import { repairTaskRegistry } from '../../../backend/platform/queue/taskRegistry.js';
import { acquireDirLock, resolveQueuePaths } from '../../../backend/platform/queue/index.js';
import { REPO_ROOT } from './paths';
import {
  autoStartBackendServices,
  stopBackendServicesDetached,
} from './main.services';
import { registerIpcLogHandler } from './log/ipcLogHandler';
import { createLogger, installProcessHandlers } from './log/logger';
import { startTaskBoardWatcher } from './main.taskBoard';
import { startTaskRecoveryController } from './main.recovery';
import { startRuntimeStreamWatcher } from './main.runtimeStream';
import {
  getCurrentActiveContextPackTaskScope,
  refreshCurrentActiveContextPackTaskScope,
} from './main.contextPackTaskVisibility';
import { cleanupWorkspaceOnQuit } from './main.cleanup';
import { TASKSAIL_DEV_GRACEFUL_RESTART_MESSAGE } from './devRestartProtocol';
import { createWindow, focusMainWindow } from './main.windowManager';
import {
  cleanupStalePipelineState,
  schedulePipelineAutoStart,
} from './main.startupRecovery';
import { recoverPlannerParentBranchViewsOnStartup } from './plannerParentBranchView';
import { refreshTerminalScopeCaches } from './main.terminalScopeRefresh';
import { createDefaultDesktopActionHandlers } from './main.desktopActionHandlers';
import { restartTaskSailApp } from './appRestart';
import { DesktopActionRouter } from './main.desktopActionRouter';
import { DesktopIpcContract } from './main.ipcContract';
import {
  getContextPackCatalogRoots,
  listAvailableContextPacks,
} from './main.contextPack';
import {
  startContextPackCatalogWatcher,
  stopContextPackCatalogWatcher,
} from './main.contextPackWatcher';
import { startTaskNotificationRuntime } from './main.taskNotifications';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createLogger('electron/main');
const QUIT_CLEANUP_TIMEOUT_MS = 3000;

export interface ElectronAppControllerDeps {
  hasSingleInstanceLock: boolean;
}

export class ElectronAppController {
  private devGracefulRestartRequested = false;
  private devGracefulRestartHandlerRegistered = false;
  private recoveryController: ReturnType<typeof startTaskRecoveryController> | null = null;

  constructor(private readonly deps: ElectronAppControllerDeps = { hasSingleInstanceLock: true }) {}

  registerAppLifecycle(): void {
    if (!this.deps.hasSingleInstanceLock) {
      return;
    }
    const uninstallProcessHandlers = installProcessHandlers();
    if (typeof app.commandLine?.appendSwitch === 'function') {
      app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256 --expose-gc');
    }
    this.registerDevGracefulRestartHandler();
    app.on('second-instance', (_event, argv, workingDirectory) => {
      log.info('app.launch.duplicate', { argv, workingDirectory });
      focusMainWindow();
    });

    let stopBoardWatcher: (() => void) | undefined;
    let stopRuntimeWatcher: (() => void) | undefined;
    let stopTaskNotificationRuntime: (() => void) | undefined;

    app.whenReady().then(async () => {
      if (process.platform === 'darwin' && app.dock) {
        const dockIconPath = join(__dirname, '..', 'build', 'icon.png');
        try {
          app.dock.setIcon(nativeImage.createFromPath(dockIconPath));
        } catch { /* best effort — icon file may not exist in dev */ }
      }

      new DesktopIpcContract(
        new DesktopActionRouter(createDefaultDesktopActionHandlers({
          getRecoveryController: () => this.recoveryController,
          schedulePipelineAutoStart,
          // Full TaskSail restart after a confirmed System Settings save so the
          // saved platform settings take effect (env-aware: a clean managed dev
          // restart, or a production relaunch).
          restartApp: restartTaskSailApp,
        })),
      ).register();
      registerIpcLogHandler();
      await createWindow();
      stopTaskNotificationRuntime = startTaskNotificationRuntime();

      await cleanupStalePipelineState();
      await recoverPlannerParentBranchViewsOnStartup().catch((error: unknown) => {
        log.warn('planner.parent-branch-view.recovery.failed', {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
      await refreshCurrentActiveContextPackTaskScope(listAvailableContextPacks);
      await refreshTerminalScopeCaches();

      stopBoardWatcher = startTaskBoardWatcher(listAvailableContextPacks);
      startContextPackCatalogWatcher({
        catalogRoots: getContextPackCatalogRoots(),
        onChange: (event) => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send(CONTEXT_PACK_CATALOG_CHANGED_CHANNEL, event);
          }
          void refreshCurrentActiveContextPackTaskScope(listAvailableContextPacks)
            .then(({ changed }) => {
              if (!changed) {
                return;
              }
              return refreshTerminalScopeCaches();
            })
            .catch((error: unknown) => {
              log.warn('context-pack.scope-refresh.failed', {
                reason: error instanceof Error ? error.message : String(error),
              });
            });
        },
      });
      stopRuntimeWatcher = startRuntimeStreamWatcher({
        scopeProvider: getCurrentActiveContextPackTaskScope,
        listContextPacks: listAvailableContextPacks,
      });
      this.recoveryController = startTaskRecoveryController({
        schedulePipelineAutoStart,
      });

      // Non-blocking queue-lock guard: a single mkdir attempt (one try, no
      // backoff). Acquires if the lock is free; returns null immediately if it
      // is held by a live mutation, in which case we skip this cycle — live
      // recovery will reconcile. This ensures the registry scan never overlaps a
      // concurrent queue mutation. NOTE: maxRetries must be >= 1; maxRetries=0
      // would skip the mkdir entirely and never acquire.
      void (async () => {
        const queueLockDir = resolveQueuePaths(REPO_ROOT).queueLockDir;
        const release = await acquireDirLock(queueLockDir, /* maxRetries */ 1, /* backoffMs */ 0);
        if (!release) {
          log.info('task-registry.repair.deferred', {
            reason: 'queue-lock-unavailable',
          });
          return;
        }
        try {
          await repairTaskRegistry(REPO_ROOT);
        } catch (error: unknown) {
          log.warn('task-registry.repair.failed', {
            reason: error instanceof Error ? error.message : String(error),
          });
        } finally {
          await release();
        }
      })();

      void autoStartBackendServices(REPO_ROOT);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow();
        }
      });
    });

    let quitCleanupStarted = false;
    app.on('before-quit', (event) => {
      // Second pass (after our own deferred app.quit()): allow the quit to proceed.
      if (quitCleanupStarted) {
        return;
      }

      if (!this.devGracefulRestartRequested) {
        cleanupWorkspaceOnQuit();
      }

      stopBoardWatcher?.();
      stopTaskNotificationRuntime?.();
      stopContextPackCatalogWatcher();
      stopRuntimeWatcher?.();
      this.recoveryController?.stop();
      this.recoveryController = null;
      uninstallProcessHandlers();

      if (this.devGracefulRestartRequested) {
        // Dev graceful restart stays fast; staging cleanup is best-effort.
        void plannerSession.endSession();
        return;
      }

      stopBackendServicesDetached(REPO_ROOT);

      // Defer the quit until planner-session staging cleanup finishes, but never
      // let a stalled cleanup block shutdown beyond QUIT_CLEANUP_TIMEOUT_MS.
      quitCleanupStarted = true;
      event.preventDefault();
      let quitDispatched = false;
      const dispatchQuit = (): void => {
        if (quitDispatched) {
          return;
        }
        quitDispatched = true;
        app.quit();
      };
      void plannerSession.endSession()
        .catch((error) => log.warn('planner.end-session.quit-cleanup.failed', {
          error: error instanceof Error ? error.message : String(error),
        }))
        .finally(dispatchQuit);
      setTimeout(dispatchQuit, QUIT_CLEANUP_TIMEOUT_MS).unref();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }

  private registerDevGracefulRestartHandler(): void {
    if (!process.env.VITE_DEV_SERVER_URL || this.devGracefulRestartHandlerRegistered) {
      return;
    }
    this.devGracefulRestartHandlerRegistered = true;
    process.on('message', (message: unknown) => {
      if (message !== TASKSAIL_DEV_GRACEFUL_RESTART_MESSAGE) {
        return;
      }
      this.devGracefulRestartRequested = true;
      app.quit();
    });
  }
}

export function registerAppLifecycle(deps?: ElectronAppControllerDeps): void {
  new ElectronAppController(deps).registerAppLifecycle();
}
