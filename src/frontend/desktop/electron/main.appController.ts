import { app, BrowserWindow, nativeImage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTEXT_PACK_CATALOG_CHANGED_CHANNEL } from '../src/shared/desktopContract';
import * as plannerSession from './plannerSession';
import { repairTaskRegistry } from '../../../backend/platform/queue/taskRegistry.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createLogger('electron/main');

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
        })),
      ).register();
      registerIpcLogHandler();
      await createWindow();

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

      void repairTaskRegistry(REPO_ROOT)
        .catch((error: unknown) => {
          log.warn('task-registry.repair.failed', {
            reason: error instanceof Error ? error.message : String(error),
          });
        });

      void autoStartBackendServices(REPO_ROOT);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow();
        }
      });
    });

    app.on('before-quit', () => {
      if (!this.devGracefulRestartRequested) {
        cleanupWorkspaceOnQuit();
      }

      stopBoardWatcher?.();
      stopContextPackCatalogWatcher();
      stopRuntimeWatcher?.();
      this.recoveryController?.stop();
      this.recoveryController = null;
      uninstallProcessHandlers();
      void plannerSession.endSession();

      if (!this.devGracefulRestartRequested) {
        stopBackendServicesDetached(REPO_ROOT);
      }
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
