import { app } from 'electron';

const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock?.() ?? true;
if (!HAS_SINGLE_INSTANCE_LOCK) {
  app.exit?.(0);
}

import { schedulePipelineAutoStart } from './app/startupRecovery';
import { createDefaultDesktopActionHandlers } from './ipc/desktopActionHandlers';
import { restartTaskSailApp } from './app/restart';
import {
  handleDesktopAction as handleDesktopActionImpl,
  type DesktopActionContext,
} from './ipc/desktopActionRouter';
import { registerAppLifecycle as registerAppLifecycleImpl } from './app/appController';

export function registerAppLifecycle(): void {
  registerAppLifecycleImpl({ hasSingleInstanceLock: HAS_SINGLE_INSTANCE_LOCK });
}

export function handleDesktopAction(
  request: Parameters<typeof handleDesktopActionImpl>[0],
  handlers?: Parameters<typeof handleDesktopActionImpl>[1],
  context?: DesktopActionContext,
): ReturnType<typeof handleDesktopActionImpl> {
  return handleDesktopActionImpl(
    request,
    {
      ...createDefaultDesktopActionHandlers({
        schedulePipelineAutoStart,
        // Full app restart so saved platform settings take effect (env-aware:
        // a clean managed dev restart, or a production relaunch).
        restartApp: restartTaskSailApp,
      }),
      ...handlers,
    },
    context,
  );
}

export { createWindow, loadDevServerUrlWithRetry } from './app/windowManager';
export { registerDesktopContract } from './ipc/contract';
export {
  readQueueStatusSnapshot,
  readEnvironmentStatus,
  readObservabilitySnapshot,
} from './app/environmentStatus';

export { listArchivedTasksAction } from './archive/archivedTasks';

export {
  validatePlannerDraftForSubmission,
  validateFollowUpDraftForSubmission,
  submitDraftViaDropboxHelper,
  submitFollowUpViaHelper,
  submitUploadedSpecHelper,
  runDropboxTaskScript,
  runFollowUpTaskScript,
} from './tasks/queue';

export {
  getDefaultContextPackSearchRoots,
  resolveContextPackSearchRoots,
  deriveContextPackRuntimeState,
  listAvailableContextPacks,
  CONTEXT_PACK_TREE_STATIC_DENY_LIST,
  executeContextPackListRepoTreeAction,
  buildContextPackWorkspaceArgs,
  runContextPackWorkspaceScript,
  buildContextPackReseedArgs,
  runContextPackReseedCommand,
  runPythonScriptCommand,
  buildContextPackDiscoveryArgs,
  pickContextPackDirectoryAction,
  executeContextPackDiscoveryAction,
  buildContextPackBootstrapArgs,
  buildQmdSeedPlanArgs,
  buildContextPackSeedArgs,
  executeContextPackCreateAction,
  executeContextPackReseedAction,
  executeContextPackWorkspaceAction,
  pickMarkdownFileAction,
} from './contextPack';

export {
  getPackageOutputDir,
  getPackageArtifactName,
  getPackageCommand,
} from './app/packaging';

export {
  validateDesktopInvokeSender,
  validateDevServerUrl,
} from './app/senderAuth';

if (!process.env['VITEST']) {
  registerAppLifecycle();
}
