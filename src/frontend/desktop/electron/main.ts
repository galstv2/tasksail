import { app } from 'electron';

const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock?.() ?? true;
if (!HAS_SINGLE_INSTANCE_LOCK) {
  app.exit?.(0);
}

import { schedulePipelineAutoStart } from './main.startupRecovery';
import { createDefaultDesktopActionHandlers } from './main.desktopActionHandlers';
import {
  handleDesktopAction as handleDesktopActionImpl,
  type DesktopActionContext,
} from './main.desktopActionRouter';
import { registerAppLifecycle as registerAppLifecycleImpl } from './main.appController';

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
      }),
      ...handlers,
    },
    context,
  );
}

export { createWindow, loadDevServerUrlWithRetry } from './main.windowManager';
export { registerDesktopContract } from './main.ipcContract';
export {
  readQueueStatusSnapshot,
  readEnvironmentStatus,
  readObservabilitySnapshot,
} from './main.environmentStatus';

export { listArchivedTasksAction } from './main.archivedTasks';

export {
  validatePlannerDraftForSubmission,
  validateFollowUpDraftForSubmission,
  submitDraftViaDropboxHelper,
  submitFollowUpViaHelper,
  submitUploadedSpecHelper,
  runDropboxTaskScript,
  runFollowUpTaskScript,
} from './main.taskQueue';

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
} from './main.contextPack';

export {
  getPackageOutputDir,
  getPackageArtifactName,
  getPackageCommand,
} from './main.packaging';

export {
  validateDesktopInvokeSender,
  validateDevServerUrl,
} from './main.senderAuth';

if (!process.env['VITEST']) {
  registerAppLifecycle();
}
