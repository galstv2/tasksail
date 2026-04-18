import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import { readFile as fsReadFile, readdir as fsReaddir, rm as fsRm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';


import {
  DESKTOP_SHELL_INVOKE_CHANNEL,
  ERROR_CODE_ACTIVE_WORK_BLOCKED,
  ERROR_CODE_VERSION_CONFLICT,
  type DesktopActionRequest,
  type DesktopInvokeResult,
  type EnvironmentStatusResponse,
  type FollowUpDirectSubmissionDraft,
  type ObservabilitySnapshotResponse,
  type PlannerDirectSubmissionDraft,
  type QueueStatusResponse,
} from '../src/shared/desktopContract';
import { isValidDesktopActionRequest, validateDesktopActionRequest } from '../src/shared/desktopContractValidators';
import { DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL } from '../src/shared/desktopContractPlanner';
import {
  readObservabilitySnapshot as readObservabilitySnapshotImpl,
  readQueueStatusSnapshot as readQueueStatusSnapshotImpl,
} from './repoObservability';
import * as plannerSession from './plannerSession';
import { repairTaskRegistry } from '../../../backend/platform/queue/taskRegistry.js';
import { REPO_ROOT, DESKTOP_ROOT } from './paths';
import { toRepoRelativePath, parseStderrErrorCode } from './main.textUtils';
import {
  parseMarkdownSections,
  parsePlannerEditableDraft,
  validatePlannerProtectedMetadata,
  validatePlanningIntakeDraft,
} from './main.markdown';
import { getPackageOutputDir, getPackageArtifactName, getPackageCommand } from './main.packaging';
import { validateDesktopInvokeSender, validateDevServerUrl } from './main.senderAuth';
import { readOwnedStagedDraft, readStagedDraft } from './main.staging';
import {
  autoStartBackendServices,
  startBackendServices,
  stopBackendServices,
  checkBackendHealth,
  readBackendServiceStatus,
} from './main.services';
import {
  listExternalMcpServers,
  addExternalMcpServer,
  updateExternalMcpServer,
  removeExternalMcpServer,
  toggleExternalMcpServer,
  validateExternalMcpConnection,
} from './externalMcpHandlers';
import {
  addAgentModel,
  loadAgentConfigAgents,
  loadAgentModelCatalog,
  removeAgentModel,
  saveAgentModels,
} from './agentConfigHandlers';
import {
  listInstructionFiles,
  readInstructionFile,
  writeInstructionFile,
} from './agentInstructionsHandlers';
import { pathExists, repoFs, type ReadOnlyRepoFs } from './utils';

// Re-export archived task handler so existing test imports from './main' continue to work.
export { listArchivedTasksAction } from './main.archivedTasks';

import { listArchivedTasksAction } from './main.archivedTasks';

import {
  readTaskBoard,
  readTaskContent as readTaskContentImpl,
  reorderPending as reorderPendingImpl,
  requeueErrorItem as requeueErrorItemAction,
  deleteTask as deleteTaskAction,
  moveToPending as moveToPendingAction,
  moveToOpen as moveToOpenAction,
  startTaskBoardWatcher,
} from './main.taskBoard';
import { startTaskRecoveryController } from './main.recovery';
import { startRuntimeStreamWatcher } from './main.runtimeStream';
import { emitStreamEvent, withStreamEvent } from './main.stream';
import { cleanupWorkspaceOnQuit } from './main.cleanup';

// Re-export task queue handlers so existing test imports from './main' continue to work.
export {
  validatePlannerDraftForSubmission,
  validateFollowUpDraftForSubmission,
  submitDraftViaDropboxHelper,
  submitFollowUpViaHelper,
  submitUploadedSpecHelper,
  runDropboxTaskScript,
  runFollowUpTaskScript,
} from './main.taskQueue';

// Re-export context pack handlers so existing test imports from './main' continue to work.
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

// Import for internal use (default handlers)
import {
  submitDraftViaDropboxHelper,
  submitFollowUpViaHelper,
  submitUploadedSpecHelper,
  readBypassTemplate,
} from './main.taskQueue';

import {
  listAvailableContextPacks,
  executeContextPackListRepoTreeAction,
  pickContextPackDirectoryAction,
  pickMarkdownFileAction,
  executeContextPackDiscoveryAction,
  executeContextPackCreateAction,
  executeContextPackReseedAction,
  executeContextPackWorkspaceAction,
  executeSetRepositoryTypeAction,
} from './main.contextPack';

import {
  saveDeepFocusSelections,
  loadDeepFocusSelections,
  clearDeepFocusSelections,
} from './main.contextPackActions';
import {
  submitReinforcementFeedback,
  updateGlobalRealignmentDoc,
  checkActiveWorkGuard,
  startRealignmentSession,
} from '../../../backend/platform/agent-runner/reinforcementWrite';
import { activateContextPack as activateContextPackImpl } from '../../../backend/platform/context-pack/activate';
import {
  acquireDirLockOrThrow,
  deletePendingItem as deletePendingItemImpl,
  resolveQueuePaths,
  getQueueStatus,
} from '../../../backend/platform/queue';
import { createDropboxTask } from '../../../backend/platform/queue/createDropboxTask.js';
import { createFollowupTask } from '../../../backend/platform/queue/createFollowupTask.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIST = join(__dirname, '../dist');
const PRELOAD_PATH = join(__dirname, 'preload.js');
const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
const PENDING_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems');
const PIPELINE_LOCK_DIR = join(REPO_ROOT, '.platform-state', 'runtime', 'pipeline.lock');
const ROLE_SESSIONS_DIR = join(REPO_ROOT, '.platform-state', 'runtime', 'role-sessions');
const RELEASE_DIR = join(DESKTOP_ROOT, 'release');

const HELPER_STATUSES = [
  {
    label: 'Dropbox task helper',
    path: 'src/backend/platform/queue/createDropboxTask.ts',
    available: true,
    detail: 'Platform TypeScript module for standard planner submission through AgentWorkSpace/dropbox/.',
  },
  {
    label: 'Follow-up task helper',
    path: 'src/backend/platform/queue/createFollowupTask.ts',
    available: true,
    detail: 'Platform TypeScript module for completed-task child-task follow-up creation.',
  },
  {
    label: 'Context-pack activation helper',
    path: 'src/backend/platform/context-pack/switch.ts',
    available: true,
    detail: 'Platform TypeScript module for the default operator startup activation flow.',
  },
];

export { getPackageOutputDir, getPackageArtifactName, getPackageCommand } from './main.packaging';
export { validateDesktopInvokeSender, validateDevServerUrl } from './main.senderAuth';

/**
 * Clean up stale pipeline state from a crashed previous run.
 * - Removes pipeline lock if the owning process is dead.
 * - Kills orphaned copilot processes whose session receipts lack terminal status.
 */
async function cleanupStalePipelineState(): Promise<void> {
  // 1. Stale pipeline lock — check if owner PID is still alive.
  if (await pathExists(PIPELINE_LOCK_DIR)) {
    let ownerAlive = false;
    try {
      const ownerJson = await fsReadFile(join(PIPELINE_LOCK_DIR, 'owner.json'), 'utf-8');
      const owner = JSON.parse(ownerJson) as { pid?: number };
      if (owner.pid && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
          ownerAlive = true;
        } catch (err: unknown) {
          if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'ESRCH') {
            ownerAlive = false;
          } else {
            ownerAlive = true; // EPERM = alive but not ours
          }
        }
      }
    } catch {
      // Can't read owner.json — treat as stale.
    }

    if (!ownerAlive) {
      await fsRm(PIPELINE_LOCK_DIR, { recursive: true, force: true });
      emitStreamEvent({
        message: 'Cleaned up stale pipeline lock from crashed previous run.',
        source: 'startup.recovery',
        role: 'system',
        severity: 'warning',
      });
    }
  }

  // 2. Kill orphaned copilot processes from stale session receipts.
  let receiptFiles: string[];
  try {
    receiptFiles = await fsReaddir(ROLE_SESSIONS_DIR);
  } catch {
    return; // Directory doesn't exist — nothing to clean.
  }

  for (const file of receiptFiles) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = await fsReadFile(join(ROLE_SESSIONS_DIR, file), 'utf-8');
      const receipt = JSON.parse(content) as {
        agent_id?: string;
        launch?: { pid?: number };
        terminal?: unknown;
      };
      // Skip receipts that already have terminal status.
      if (receipt.terminal) continue;

      const pid = receipt.launch?.pid;
      if (!pid || pid <= 0) continue;

      try {
        process.kill(pid, 0); // alive check
        process.kill(pid, 'SIGTERM'); // graceful kill
        emitStreamEvent({
          message: `Killed orphaned agent process (pid: ${pid}, agent: ${receipt.agent_id ?? file}).`,
          source: 'startup.recovery',
          role: 'system',
          severity: 'warning',
        });
      } catch {
        // Already dead — nothing to kill.
      }
    } catch {
      // Corrupt receipt — skip.
    }
  }
}

function schedulePipelineAutoStart(): void {
  // Guard: skip launch if a pipeline is already running. This prevents the
  // race where auto-fail activates the next task and immediately tries to
  // launch, only to fail on the lock and strand the task.
  void pathExists(PIPELINE_LOCK_DIR).then(async (locked) => {
    if (locked) {
      return;
    }

    const status = await getQueueStatus(REPO_ROOT);
    if (!status.activeItem) {
      emitStreamEvent({
        message: 'pipeline.autoStart: no active pending item; skipping launch',
        source: 'pipeline.autoStart',
        role: 'workflow',
        severity: 'info',
      });
      return;
    }
    const taskId = status.activeItem.replace(/\.md$/, '');

    emitStreamEvent({
      message: 'Launching active-task pipeline for pending item from Alice.',
      source: 'pipeline.autoStart',
      role: 'workflow',
    });

    return import('../../../backend/platform/agent-runner/pipeline/sequencer.js')
      .then(({ runPipelineSequence }) => runPipelineSequence({ repoRoot: REPO_ROOT, startAt: 'alice', taskId }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const alreadyRunning = message.includes('Another pipeline run is already active');
        emitStreamEvent({
          message: alreadyRunning
            ? `Pipeline already running: ${message}`
            : `Failed to start agent pipeline: ${message}`,
          source: 'pipeline.autoStart',
          role: 'system',
          severity: alreadyRunning ? 'warning' : 'error',
        });
      });
  });
}

let recoveryController:
  | ReturnType<typeof startTaskRecoveryController>
  | null = null;

type DesktopActionHandlers = {
  submitDraft: (draft: PlannerDirectSubmissionDraft) => Promise<DesktopInvokeResult>;
  submitFollowUp: (draft: FollowUpDirectSubmissionDraft) => Promise<DesktopInvokeResult>;
  startPlannerSession: (payload?: { contextPackDir?: string }) => Promise<{ sessionId: string; created: boolean }>;
  sendPlannerMessage: (text: string) => Promise<'sent' | 'no-session' | 'busy'>;
  endPlannerSession: () => Promise<void>;
  savePlannerDraft: () => Promise<'sent' | 'no-session' | 'busy'>;
  getPlannerSessionState: () => ReturnType<typeof plannerSession.getSessionState>;
  readQueueStatus: () => Promise<QueueStatusResponse>;
  deletePendingItem: (
    payload: import('../src/shared/desktopContract').QueueDeletePendingItemRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readEnvironmentStatus: () => Promise<EnvironmentStatusResponse>;
  readObservability: () => Promise<ObservabilitySnapshotResponse>;
  pickContextPackDirectory: (
    payload: import('../src/shared/desktopContract').ContextPackPickDirectoryRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  discoverContextPackPrefill: (
    payload: import('../src/shared/desktopContract').ContextPackDiscoverPrefillRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  createContextPack: (
    payload: import('../src/shared/desktopContract').ContextPackCreateRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  listContextPacks: () => Promise<import('../src/shared/desktopContract').ContextPackListResponse>;
  listRepoTree: (
    payload: import('../src/shared/desktopContract').ContextPackListRepoTreeRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  reseedContextPack: (
    payload: import('../src/shared/desktopContract').ContextPackReseedPayload,
  ) => Promise<DesktopInvokeResult>;
  previewContextPackSwitch: (
    payload: import('../src/shared/desktopContract').ContextPackSwitchPayload,
  ) => Promise<DesktopInvokeResult>;
  applyContextPackSwitch: (
    payload: import('../src/shared/desktopContract').ContextPackSwitchPayload,
  ) => Promise<DesktopInvokeResult>;
  clearActiveContextPack: () => Promise<DesktopInvokeResult>;
  pickMarkdownFile: () => Promise<DesktopInvokeResult>;
  listArchivedTasks: () => Promise<DesktopInvokeResult>;
  submitReinforcementFeedback: (
    payload: import('../src/shared/desktopContract').ReinforcementSubmitFeedbackRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  updateRealignmentDoc: (
    payload: import('../src/shared/desktopContract').ReinforcementUpdateRealignmentDocRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readReinforcementOverview: () => Promise<DesktopInvokeResult>;
  listReinforcementTasks: (
    payload?: import('../src/shared/desktopContract').ReinforcementListTasksRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readAgentRewards: () => Promise<DesktopInvokeResult>;
  listRealignmentSessions: () => Promise<DesktopInvokeResult>;
  readRealignmentDoc: () => Promise<DesktopInvokeResult>;
  checkActiveWorkGuard: () => Promise<DesktopInvokeResult>;
  startRealignment: (
    payload: import('../src/shared/desktopContract').ReinforcementStartRealignmentRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  activateContextPack: (
    payload: import('../src/shared/desktopContract').ContextPackActivationRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  setRepositoryType: (
    payload: import('../src/shared/desktopContract').ContextPackSetRepositoryTypeRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  listExternalMcpServers: () => Promise<DesktopInvokeResult>;
  addExternalMcpServer: (
    payload: import('../src/shared/desktopContract').ExternalMcpAddRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  updateExternalMcpServer: (
    payload: import('../src/shared/desktopContract').ExternalMcpUpdateRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  removeExternalMcpServer: (
    payload: import('../src/shared/desktopContract').ExternalMcpRemoveRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  toggleExternalMcpServer: (
    payload: import('../src/shared/desktopContract').ExternalMcpToggleEnabledRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  validateExternalMcpConnection: (
    payload: import('../src/shared/desktopContract').ExternalMcpValidateConnectionRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  loadAgentConfigAgents: () => Promise<DesktopInvokeResult>;
  loadAgentModelCatalog: () => Promise<DesktopInvokeResult>;
  saveAgentModels: (
    payload: import('../src/shared/desktopContract').AgentConfigSaveAgentModelsRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  addAgentModel: (
    payload: import('../src/shared/desktopContract').AgentConfigAddModelRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  removeAgentModel: (
    payload: import('../src/shared/desktopContract').AgentConfigRemoveModelRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  listInstructionFiles: (
    request: import('../src/shared/desktopContract').AgentInstructionsListFilesRequest,
  ) => Promise<DesktopInvokeResult>;
  readInstructionFile: (
    request: import('../src/shared/desktopContract').AgentInstructionsReadFileRequest,
  ) => Promise<DesktopInvokeResult>;
  writeInstructionFile: (
    request: import('../src/shared/desktopContract').AgentInstructionsWriteFileRequest,
  ) => Promise<DesktopInvokeResult>;
  readTaskBoard: () => Promise<DesktopInvokeResult>;
  readTaskContent: (
    payload: import('../src/shared/desktopContract').TaskBoardReadTaskContentRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  reorderPending: (
    payload: import('../src/shared/desktopContract').TaskBoardReorderPendingRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  requeueErrorItem: (
    payload: import('../src/shared/desktopContract').TaskBoardRequeueErrorItemRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  deleteTask: (
    payload: import('../src/shared/desktopContract').TaskBoardDeleteTaskRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  moveToPending: (
    payload: import('../src/shared/desktopContract').TaskBoardMoveToPendingRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  moveToOpen: (
    payload: import('../src/shared/desktopContract').TaskBoardMoveToOpenRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  saveDeepFocusSelections: (
    payload: import('../src/shared/desktopContract').DeepFocusSaveSelectionsRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  loadDeepFocusSelections: (
    payload: import('../src/shared/desktopContract').DeepFocusLoadSelectionsRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  clearDeepFocusSelections: (
    payload: import('../src/shared/desktopContract').DeepFocusClearSelectionsRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  uploadSpec: (content: string) => Promise<DesktopInvokeResult>;
};

export async function readQueueStatusSnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<QueueStatusResponse> {
  return readQueueStatusSnapshotImpl(fsAdapter);
}

export async function readEnvironmentStatus(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<EnvironmentStatusResponse> {
  const repoArtifactsReady = await Promise.all([
    pathExists(REPO_ROOT, fsAdapter),
    pathExists(DROPBOX_DIR, fsAdapter),
    pathExists(PENDING_DIR, fsAdapter),
  ]);
  const platformLabel = `Native packaging guidance is available for the current host platform (${process.platform}).`;
  const validationSummary =
    repoArtifactsReady.every(Boolean)
      ? 'Repo root, workflow queue directories, and platform modules are available for host-native desktop operation.'
      : 'Desktop startup requires the repo root and queue directories to remain available on the host before native launch.';

  return {
    action: 'environment.readStatus',
    mode: 'read-only',
    message: 'Desktop packaging and startup guidance remain read-only and host-native against the repo root.',
    platform: process.platform,
    repoRoot: REPO_ROOT,
    packageOutputDir: toRepoRelativePath(getPackageOutputDir(RELEASE_DIR)),
    packageArtifactName: getPackageArtifactName(),
    packageCommand: getPackageCommand(),
    hostMode: 'repo-root-native',
    validationSummary: `${platformLabel} ${validationSummary}`,
    launchPolicy:
      'Launch the desktop shell host-native against the repo root. Repo workflow artifacts remain authoritative and are never relocated into the packaged app bundle.',
    helperStatuses: HELPER_STATUSES,
    contextPackCommand: 'tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack',
    contextPackWritePlanHint:
      'If activation needs a materialized plan, reuse the stable platform module with `--write-plan` instead of reimplementing overlay logic in the desktop shell.',
    bootstrapFlowHint:
      'Structured bootstrap continues through `--bootstrap-repo-root` and `--bootstrap-answers-file` on the platform activation module rather than desktop-specific setup commands.',
  };
}

export async function readObservabilitySnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<ObservabilitySnapshotResponse> {
  const snapshot = await readObservabilitySnapshotImpl(fsAdapter);
  return {
    ...snapshot,
    plannerBroker: plannerSession.getObservability(),
  };
}

async function withQueueMutationLock<T>(
  operationName: string,
  work: () => Promise<T>,
): Promise<T> {
  const { queueLockDir } = resolveQueuePaths(REPO_ROOT);
  const release = await acquireDirLockOrThrow(queueLockDir, operationName);
  try {
    return await work();
  } finally {
    await release();
  }
}

const defaultDesktopActionHandlers: DesktopActionHandlers = {
  submitDraft: submitDraftViaDropboxHelper,
  submitFollowUp: submitFollowUpViaHelper,
  startPlannerSession: (payload) => {
    const contextPackDir = payload?.contextPackDir;
    if (!contextPackDir) {
      return Promise.reject(new Error('Planner session requires an active context pack.'));
    }
    return plannerSession.startSession(contextPackDir);
  },
  sendPlannerMessage: (text) => plannerSession.sendMessage(text),
  endPlannerSession: () => plannerSession.endSession(),
  savePlannerDraft: () => plannerSession.saveDraft(),
  getPlannerSessionState: () => plannerSession.getSessionState(),
  readQueueStatus: () => readQueueStatusSnapshot(),
  deletePendingItem: async (payload) =>
    withQueueMutationLock('queue.deletePendingItem', async () => {
      await deletePendingItemImpl({ repoRoot: REPO_ROOT, queueName: payload.queueName });
      return {
        ok: true,
        response: {
          action: 'queue.deletePendingItem' as const,
          mode: 'deleted' as const,
          message: `Removed pending queue item ${payload.queueName}.`,
          queueName: payload.queueName,
        },
      };
    }),
  readEnvironmentStatus: () => readEnvironmentStatus(),
  readObservability: () => readObservabilitySnapshot(),
  pickContextPackDirectory: (payload) => pickContextPackDirectoryAction(payload),
  discoverContextPackPrefill: (payload) =>
    executeContextPackDiscoveryAction(payload),
  createContextPack: (payload) => executeContextPackCreateAction(payload),
  listContextPacks: () => listAvailableContextPacks(),
  listRepoTree: (payload) => executeContextPackListRepoTreeAction(payload),
  reseedContextPack: (payload) => executeContextPackReseedAction(payload),
  previewContextPackSwitch: (payload) =>
    executeContextPackWorkspaceAction(
      'contextPack.previewSwitch',
      'preview',
      payload,
    ),
  applyContextPackSwitch: (payload) =>
    executeContextPackWorkspaceAction(
      'contextPack.applySwitch',
      'apply',
      payload,
    ),
  clearActiveContextPack: () =>
    executeContextPackWorkspaceAction('contextPack.clearActive', 'clear'),
  pickMarkdownFile: () => pickMarkdownFileAction(),
  listArchivedTasks: () => listArchivedTasksAction(listAvailableContextPacks),
  submitReinforcementFeedback: async (payload) => {
    const result = await submitReinforcementFeedback(payload);
    if (!result.passed) {
      return { ok: false, action: 'reinforcement.submitFeedback', error: result.stderr || 'Feedback submission failed.' };
    }
    return {
      ok: true,
      response: {
        action: 'reinforcement.submitFeedback',
        mode: 'submitted',
        passed: true,
        message: 'Reinforcement feedback submitted.',
        data: result.data,
      },
    };
  },
  updateRealignmentDoc: async (payload) => {
    const result = await updateGlobalRealignmentDoc(payload);
    if (!result.passed) {
      const parsed = parseStderrErrorCode(result.stderr, ERROR_CODE_VERSION_CONFLICT);
      return {
        ok: false,
        action: 'reinforcement.updateRealignmentDoc',
        error: parsed?.errorMessage ?? result.stderr ?? 'Realignment doc update failed.',
        errorCode: parsed?.errorCode,
      } as const;
    }
    return {
      ok: true,
      response: {
        action: 'reinforcement.updateRealignmentDoc',
        mode: 'updated',
        passed: true,
        message: 'Global realignment document updated.',
        data: result.data,
      },
    };
  },
  readReinforcementOverview: async () => {
    const { readReinforcementOverview: readOverview } = await import('../../../backend/platform/agent-runner/reinforcementRead');
    const overview = await readOverview();
    return {
      ok: true,
      response: {
        action: 'reinforcement.readOverview' as const,
        mode: 'read-only' as const,
        message: `${overview.totalTasks} task(s), streak ${overview.streakProgress}/${overview.streakThreshold}.`,
        overview,
      },
    };
  },
  listReinforcementTasks: async (payload) => {
    const { listReinforcementTasks: listTasks } = await import('../../../backend/platform/agent-runner/reinforcementRead');
    const catalog = await listAvailableContextPacks();
    const activeEntry = catalog.contextPacks.find((entry) => entry.isActive);
    const contextPackName = activeEntry
      ? basename(activeEntry.contextPackDir)
      : undefined;
    const result = await listTasks(undefined, contextPackName, payload?.year);
    return {
      ok: true,
      response: {
        action: 'reinforcement.listTasks' as const,
        mode: 'read-only' as const,
        message: contextPackName
          ? `${result.tasks.length} task(s) in ${contextPackName}.`
          : 'No active context pack.',
        tasks: result.tasks,
        availableYears: result.availableYears,
      },
    };
  },
  readAgentRewards: async () => {
    const { readAgentRewards } = await import('../../../backend/platform/agent-runner/reinforcementRead');
    const agents = await readAgentRewards();
    return {
      ok: true,
      response: {
        action: 'reinforcement.readAgentRewards' as const,
        mode: 'read-only' as const,
        message: `${agents.length} agent(s).`,
        agents,
      },
    };
  },
  listRealignmentSessions: async () => {
    const { listRealignmentSessions } = await import('../../../backend/platform/agent-runner/reinforcementRead');
    const sessions = await listRealignmentSessions();
    return {
      ok: true,
      response: {
        action: 'reinforcement.listRealignmentSessions' as const,
        mode: 'read-only' as const,
        message: `${sessions.length} session(s).`,
        sessions,
      },
    };
  },
  readRealignmentDoc: async () => {
    const { readGlobalRealignmentDoc } = await import('../../../backend/platform/agent-runner/reinforcementRead');
    const document = await readGlobalRealignmentDoc();
    return {
      ok: true,
      response: {
        action: 'reinforcement.readRealignmentDoc' as const,
        mode: 'read-only' as const,
        message: document.version > 0 ? `Version ${document.version}.` : 'No document yet.',
        document,
      },
    };
  },
  checkActiveWorkGuard: async () => {
    const result = await checkActiveWorkGuard();
    if (!result.allowed) {
      return {
        ok: false,
        action: 'reinforcement.checkActiveWorkGuard',
        error: result.message,
        errorCode: ERROR_CODE_ACTIVE_WORK_BLOCKED,
      } as const;
    }
    return {
      ok: true,
      response: {
        action: 'reinforcement.checkActiveWorkGuard' as const,
        mode: 'guard-check' as const,
        allowed: true,
        message: result.message,
        activeTaskId: null,
        hasUnprocessedFeedback: result.hasUnprocessedFeedback,
      },
    };
  },
  startRealignment: async (payload) => {
    const result = await startRealignmentSession(payload);
    if (!result.passed) {
      const parsed = parseStderrErrorCode(result.stderr, ERROR_CODE_ACTIVE_WORK_BLOCKED);
      return {
        ok: false,
        action: 'reinforcement.startRealignment',
        error: parsed?.errorMessage ?? result.stderr ?? 'Failed to start realignment session.',
        errorCode: parsed?.errorCode,
      } as const;
    }
    return {
      ok: true,
      response: {
        action: 'reinforcement.startRealignment' as const,
        mode: 'started' as const,
        message: 'Corrective realignment session started.',
        session: result.data as unknown as import('../src/shared/desktopContract').ReinforcementRealignmentSessionEntry,
      },
    };
  },
  listExternalMcpServers: () => listExternalMcpServers(),
  addExternalMcpServer: (payload) => addExternalMcpServer(payload),
  updateExternalMcpServer: (payload) => updateExternalMcpServer(payload),
  removeExternalMcpServer: (payload) => removeExternalMcpServer(payload),
  toggleExternalMcpServer: (payload) => toggleExternalMcpServer(payload),
  validateExternalMcpConnection: (payload) => validateExternalMcpConnection(payload),
  loadAgentConfigAgents: () => loadAgentConfigAgents(),
  loadAgentModelCatalog: () => loadAgentModelCatalog(),
  saveAgentModels: (payload) => saveAgentModels(payload),
  addAgentModel: (payload) => addAgentModel(payload),
  removeAgentModel: (payload) => removeAgentModel(payload),
  listInstructionFiles: (request) => listInstructionFiles(request),
  readInstructionFile: (request) => readInstructionFile(request),
  writeInstructionFile: (request) => writeInstructionFile(request),
  readTaskBoard: () => readTaskBoard(listAvailableContextPacks),
  readTaskContent: (payload) => readTaskContentImpl(payload, listAvailableContextPacks),
  reorderPending: (payload) =>
    withQueueMutationLock('taskBoard.reorderPending', () => reorderPendingImpl(payload)),
  requeueErrorItem: async (payload) => {
    const result = await withQueueMutationLock(
      'taskBoard.requeueErrorItem',
      () => requeueErrorItemAction(payload),
    );
    if (
      result.ok &&
      result.response.action === 'taskBoard.requeueErrorItem' &&
      result.response.activatedItem
    ) {
      recoveryController?.noteActivatedPendingItem(result.response.activatedItem);
      schedulePipelineAutoStart();
    }
    return result;
  },
  deleteTask: (payload) =>
    withQueueMutationLock('taskBoard.deleteTask', () => deleteTaskAction(payload)),
  moveToPending: async (payload) => {
    const result = await withQueueMutationLock(
      'taskBoard.moveToPending',
      () => moveToPendingAction(payload),
    );
    if (
      result.ok &&
      result.response.action === 'taskBoard.moveToPending' &&
      result.response.activatedItem
    ) {
      recoveryController?.noteActivatedPendingItem(result.response.activatedItem);
      schedulePipelineAutoStart();
    }
    return result;
  },
  moveToOpen: (payload) =>
    withQueueMutationLock('taskBoard.moveToOpen', () => moveToOpenAction(payload)),
  activateContextPack: async (payload) => {
    const catalog = await listAvailableContextPacks();
    const entry = catalog.contextPacks.find((p) => p.contextPackId === payload.packId);
    if (!entry) {
      return {
        ok: false,
        action: 'contextPack.activate',
        error: `Unknown context pack: ${payload.packId}. Pack must appear in the catalog before activation.`,
      };
    }
    const result = await activateContextPackImpl({ contextPackDir: entry.contextPackDir });
    if (!result.validation.valid) {
      return {
        ok: false,
        action: 'contextPack.activate',
        error: `Context-pack validation failed: ${result.validation.errors.join('; ')}`,
        details: result.validation.errors,
      };
    }
    return {
      ok: true,
      response: {
        action: 'contextPack.activate',
        mode: 'activated',
        accepted: true,
        message: `Context pack '${payload.packId}' activated and ACTIVE_CONTEXT_PACK_DIR updated.`,
        contextPackDir: result.contextPackDir,
        contextPackId: payload.packId,
      },
    };
  },
  setRepositoryType: (payload) => executeSetRepositoryTypeAction(payload),
  saveDeepFocusSelections: (payload) => saveDeepFocusSelections(payload),
  loadDeepFocusSelections: (payload) => loadDeepFocusSelections(payload),
  clearDeepFocusSelections: (payload) => clearDeepFocusSelections(payload),
  uploadSpec: submitUploadedSpecHelper,
};

function resolveDesktopActionHandlers(
  handlers?: Partial<DesktopActionHandlers>,
): DesktopActionHandlers {
  return {
    ...defaultDesktopActionHandlers,
    ...handlers,
  };
}

export async function handleDesktopAction(
  request: DesktopActionRequest | unknown,
  handlers?: Partial<DesktopActionHandlers>,
): Promise<DesktopInvokeResult> {
  const resolvedHandlers = resolveDesktopActionHandlers(handlers);
  const requestErrors = validateDesktopActionRequest(request);
  if (requestErrors.length > 0 || !isValidDesktopActionRequest(request)) {
    return {
      ok: false,
      action:
        typeof request === 'object' && request !== null && 'action' in request
          ? String((request as { action?: unknown }).action ?? '')
          : undefined,
      error: 'Desktop action request failed runtime validation.',
      details: requestErrors,
    };
  }

  switch (request.action) {
    case 'planner.submitDraft':
      if (request.payload.stage === 'confirm') {
        return resolvedHandlers.submitDraft(request.payload.draft);
      }

      return {
        ok: true,
        response: {
          action: 'planner.submitDraft',
          mode: 'dry-run',
          accepted: true,
          message:
            'Planner draft accepted for local review only. No dropbox file or helper script was invoked.',
          suggestedPath: request.payload.draft.suggestedPath,
        },
      };
    case 'planner.startSession': {
      const { sessionId } = await resolvedHandlers.startPlannerSession(request.payload);
      emitStreamEvent({ message: 'Planner session started.', source: 'planner.startSession', role: 'planner' });
      return {
        ok: true,
        response: {
          action: 'planner.startSession',
          mode: 'started',
          accepted: true,
          message: 'Planner session started.',
          sessionId,
          brokerStatus: resolvedHandlers.getPlannerSessionState()?.brokerStatus ?? 'idle',
        },
      };
    }
    case 'planner.sendMessage': {
      const sendResult = await resolvedHandlers.sendPlannerMessage(request.payload.text);
      if (sendResult === 'no-session') {
        return {
          ok: false,
          action: 'planner.sendMessage',
          error: 'No active planner session to send message to.',
        };
      }
      if (sendResult === 'busy') {
        return {
          ok: false,
          action: 'planner.sendMessage',
          error: 'Planner session is already running a turn.',
        };
      }
      return {
        ok: true,
        response: {
          action: 'planner.sendMessage',
          mode: 'sent',
          accepted: true,
          message: 'Message sent to planner session.',
        },
      };
    }
    case 'planner.endSession':
      await resolvedHandlers.endPlannerSession();
      emitStreamEvent({ message: 'Planner session ended.', source: 'planner.endSession', role: 'planner' });
      return {
        ok: true,
        response: {
          action: 'planner.endSession',
          mode: 'ended',
          accepted: true,
          message: 'Planner session ended.',
        },
      };
    case 'planner.saveDraft': {
      const saveResult = await resolvedHandlers.savePlannerDraft();
      const brokerState = resolvedHandlers.getPlannerSessionState();
      if (saveResult === 'no-session') {
        return {
          ok: false,
          action: 'planner.saveDraft',
          error: 'No active planner session to instruct.',
        };
      }
      if (saveResult === 'busy') {
        return {
          ok: false,
          action: 'planner.saveDraft',
          error: 'Planner session is already running a turn.',
        };
      }
      if (brokerState?.brokerStatus === 'failed') {
        return {
          ok: false,
          action: 'planner.saveDraft',
          error: brokerState.error ?? 'Planner failed while saving the staged draft.',
        };
      }
      return {
        ok: true,
        response: {
          action: 'planner.saveDraft',
          mode: 'instructed',
          accepted: true,
          message: 'Save-draft instruction sent to planner session.',
          brokerStatus: brokerState?.brokerStatus ?? 'idle',
        },
      };
    }
    case 'planner.readStagedDraft': {
      const brokerState = resolvedHandlers.getPlannerSessionState();
      const brokerStatus = brokerState?.brokerStatus ?? 'idle';
      const activePlannerSessionId = plannerSession.getObservability().sessionId;
      const stagedDraft = await readStagedDraft(activePlannerSessionId ?? undefined);
      if (stagedDraft.error) {
        return {
          ok: false,
          action: 'planner.readStagedDraft',
          error: stagedDraft.error,
        };
      }
      if (brokerStatus === 'failed') {
        return {
          ok: false,
          action: 'planner.readStagedDraft',
          error: brokerState?.error ?? 'Planner failed before writing a staged draft.',
        };
      }
      if (!stagedDraft.draft) {
        if (brokerStatus === 'completed') {
          return {
            ok: false,
            action: 'planner.readStagedDraft',
            error: 'Planner completed without writing a staged draft to AgentWorkSpace/dropbox/.staging.',
          };
        }

        return {
          ok: true,
          response: {
            action: 'planner.readStagedDraft',
            mode: 'empty',
            message: 'No staged draft found in .staging/ directory.',
            draft: null,
            brokerStatus,
          },
        };
      }
      return {
        ok: true,
        response: {
          action: 'planner.readStagedDraft',
          mode: 'found',
          message: `Staged draft found: ${stagedDraft.draft.filename}`,
          draft: stagedDraft.draft,
          brokerStatus,
        },
      };
    }
    case 'planner.finalizeSpec': {
      const brokerState = resolvedHandlers.getPlannerSessionState();
      if (brokerState?.brokerStatus === 'running') {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: 'Planner session is still running a turn. Wait for draft generation to finish before finalizing.',
        };
      }
      const activePlannerSessionId = plannerSession.getObservability().sessionId;
      const stagedDraft = await readOwnedStagedDraft(activePlannerSessionId ?? undefined);
      if (stagedDraft.error) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: stagedDraft.error,
        };
      }
      if (!stagedDraft.draft) {
        if (brokerState?.brokerStatus === 'failed') {
          return {
            ok: false,
            action: 'planner.finalizeSpec',
            error: brokerState.error ?? 'Planner session failed before writing a staged draft. Reconnect or retry before finalizing.',
          };
        }
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: 'No staged draft to finalize. Use "View Draft" first.',
        };
      }
      if (!stagedDraft.metadata) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: 'No platform-owned staged planner metadata is available. Start a new planner session before finalizing.',
        };
      }
      const expectedTaskKind = (
        typeof request.payload === 'object' &&
        request.payload !== null &&
        'expectedTaskKind' in request.payload
      )
        ? (request.payload as { expectedTaskKind?: 'standard' | 'child-task' }).expectedTaskKind
        : undefined;
      const sections = parseMarkdownSections(stagedDraft.draft.content);
      const protectedMetadataError = validatePlannerProtectedMetadata(
        stagedDraft.draft.content,
        stagedDraft.metadata,
        expectedTaskKind,
        sections,
      );
      if (protectedMetadataError) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: protectedMetadataError,
        };
      }
      const validationError = validatePlanningIntakeDraft(
        stagedDraft.draft.content,
        stagedDraft.metadata.lineage.taskKind,
        sections,
      );
      if (validationError) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: validationError,
        };
      }
      try {
        const editableDraft = parsePlannerEditableDraft(stagedDraft.draft.content, sections);
        const metadata = stagedDraft.metadata;
        const destinationPath = await withQueueMutationLock('planner.finalizeSpec', async () => {
          if (metadata.lineage.taskKind === 'child-task') {
            return createFollowupTask({
              title: metadata.title,
              summary: editableDraft.summary,
              desiredOutcome: editableDraft.desiredOutcome,
              constraints: editableDraft.constraints,
              acceptanceSignals: editableDraft.acceptanceSignals,
              parentTaskId: metadata.lineage.parentTaskId,
              parentQmdRecordId: metadata.lineage.parentQmdRecordId,
              parentQmdScope: metadata.lineage.parentQmdScope,
              rootTaskId: metadata.lineage.rootTaskId,
              followupReason: metadata.lineage.followUpReason,
              carryForwardSummary: editableDraft.carryForwardSummary,
              suggestedPath: editableDraft.suggestedPath,
              planningNotes: editableDraft.planningNotes,
              contextPackDir: metadata.contextPackBinding.contextPackDir,
              contextPackId: metadata.contextPackBinding.contextPackId,
              scopeMode: metadata.contextPackBinding.scopeMode,
              selectedRepoIds: metadata.contextPackBinding.selectedRepoIds,
              selectedFocusIds: metadata.contextPackBinding.selectedFocusIds,
              deepFocusEnabled: metadata.deepFocusEnabled,
              selectedFocusPath: metadata.primaryFocusRelativePath,
              selectedFocusTargetKind: metadata.primaryFocusTargetKind,
              selectedTestTarget: metadata.selectedTestTarget,
              selectedSupportTargets: metadata.supportTargets,
              repoRoot: REPO_ROOT,
            });
          }

          return createDropboxTask({
            title: metadata.title,
            summary: editableDraft.summary,
            desiredOutcome: editableDraft.desiredOutcome,
            constraints: editableDraft.constraints,
            acceptanceSignals: editableDraft.acceptanceSignals,
            suggestedPath: editableDraft.suggestedPath,
            planningNotes: editableDraft.planningNotes,
            kind: metadata.lineage.taskKind,
            contextPackDir: metadata.contextPackBinding.contextPackDir,
            contextPackId: metadata.contextPackBinding.contextPackId,
            scopeMode: metadata.contextPackBinding.scopeMode,
            selectedRepoIds: metadata.contextPackBinding.selectedRepoIds,
            selectedFocusIds: metadata.contextPackBinding.selectedFocusIds,
            deepFocusEnabled: metadata.deepFocusEnabled,
            selectedFocusPath: metadata.primaryFocusRelativePath,
            selectedFocusTargetKind: metadata.primaryFocusTargetKind,
            selectedTestTarget: metadata.selectedTestTarget,
            selectedSupportTargets: metadata.supportTargets,
            repoRoot: REPO_ROOT,
          });
        });

        try {
          await resolvedHandlers.endPlannerSession();
        } catch (endSessionError: unknown) {
          console.warn(
            endSessionError instanceof Error
              ? `Planner session shutdown failed after finalization: ${endSessionError.message}`
              : 'Planner session shutdown failed after finalization.',
          );
        }
        emitStreamEvent({ message: `Spec finalized to dropbox: ${basename(destinationPath)}`, source: 'planner.finalizeSpec', role: 'planner', severity: 'success' });
        return {
          ok: true,
          response: {
            action: 'planner.finalizeSpec',
            mode: 'finalized',
            accepted: true,
            message: `Spec finalized to dropbox: ${basename(destinationPath)}`,
            destinationPath,
            brokerStatus: 'idle',
          },
        };
      } catch (err: unknown) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: err instanceof Error ? err.message : 'Failed to finalize the staged planner draft.',
        };
      }
    }
    case 'queue.readStatus':
      return { ok: true, response: await resolvedHandlers.readQueueStatus() };
    case 'queue.deletePendingItem':
      return withStreamEvent(resolvedHandlers.deletePendingItem(request.payload),
        { message: `Deleted pending item ${request.payload.queueName}.`, source: 'queue.deletePendingItem', role: 'queue' });
    case 'environment.readStatus':
      return { ok: true, response: await resolvedHandlers.readEnvironmentStatus() };
    case 'observability.readSnapshot':
      return { ok: true, response: await resolvedHandlers.readObservability() };
    case 'contextPack.pickDirectory':
      return resolvedHandlers.pickContextPackDirectory(request.payload);
    case 'contextPack.discoverPrefill':
      return resolvedHandlers.discoverContextPackPrefill(request.payload);
    case 'contextPack.create':
      return withStreamEvent(resolvedHandlers.createContextPack(request.payload),
        { message: 'Created context pack.', source: 'contextPack.create', role: 'workflow', severity: 'success' });
    case 'contextPack.list':
      return { ok: true, response: await resolvedHandlers.listContextPacks() };
    case 'contextPack.listRepoTree':
      return resolvedHandlers.listRepoTree(request.payload);
    case 'contextPack.reseed':
      return withStreamEvent(resolvedHandlers.reseedContextPack(request.payload),
        { message: 'Reseeded context pack.', source: 'contextPack.reseed', role: 'workflow' });
    case 'followup.begin':
      if (request.payload.stage === 'confirm') {
        return resolvedHandlers.submitFollowUp(request.payload.draft);
      }

      return {
        ok: true,
        response: {
          action: 'followup.begin',
          mode: 'dry-run',
          accepted: true,
          message:
            'Follow-up draft staged locally only. No child task has been created and the closed parent task remains unchanged.',
          suggestedTaskKind: 'child-task',
          sourceTaskId: request.payload.draft.parentTaskId,
          parentTaskId: request.payload.draft.parentTaskId,
          rootTaskId:
            request.payload.draft.rootTaskId ||
            request.payload.draft.parentTaskId,
          reopenedTask: false,
        },
      };
    case 'contextPack.previewSwitch':
      return resolvedHandlers.previewContextPackSwitch(request.payload);
    case 'contextPack.applySwitch':
      return withStreamEvent(resolvedHandlers.applyContextPackSwitch(request.payload),
        { message: 'Applied workspace switch.', source: 'contextPack.applySwitch', role: 'workflow' });
    case 'contextPack.clearActive':
      return withStreamEvent(resolvedHandlers.clearActiveContextPack(),
        { message: 'Cleared active context pack.', source: 'contextPack.clearActive', role: 'workflow' });
    case 'planner.pickMarkdownFile':
      return resolvedHandlers.pickMarkdownFile();
    case 'planner.listArchivedTasks':
      return resolvedHandlers.listArchivedTasks();
    case 'reinforcement.submitFeedback':
      return withStreamEvent(resolvedHandlers.submitReinforcementFeedback(request.payload),
        { message: 'Feedback submitted.', source: 'reinforcement.submitFeedback', role: 'system' });
    case 'reinforcement.updateRealignmentDoc':
      return resolvedHandlers.updateRealignmentDoc(request.payload);
    case 'reinforcement.readOverview':
      return resolvedHandlers.readReinforcementOverview();
    case 'reinforcement.listTasks':
      return resolvedHandlers.listReinforcementTasks(request.payload);
    case 'reinforcement.readAgentRewards':
      return resolvedHandlers.readAgentRewards();
    case 'reinforcement.listRealignmentSessions':
      return resolvedHandlers.listRealignmentSessions();
    case 'reinforcement.readRealignmentDoc':
      return resolvedHandlers.readRealignmentDoc();
    case 'reinforcement.checkActiveWorkGuard':
      return resolvedHandlers.checkActiveWorkGuard();
    case 'reinforcement.startRealignment':
      return withStreamEvent(resolvedHandlers.startRealignment(request.payload),
        { message: 'Corrective realignment started.', source: 'reinforcement.startRealignment', role: 'system', severity: 'warning' });
    case 'contextPack.activate':
      return withStreamEvent(resolvedHandlers.activateContextPack(request.payload),
        { message: 'Activated context pack.', source: 'contextPack.activate', role: 'workflow' });
    case 'contextPack.setRepositoryType':
      return resolvedHandlers.setRepositoryType(request.payload);
    case 'externalMcp.list':
      return resolvedHandlers.listExternalMcpServers();
    case 'externalMcp.add':
      return resolvedHandlers.addExternalMcpServer(request.payload);
    case 'externalMcp.update':
      return resolvedHandlers.updateExternalMcpServer(request.payload);
    case 'externalMcp.remove':
      return resolvedHandlers.removeExternalMcpServer(request.payload);
    case 'externalMcp.toggleEnabled':
      return resolvedHandlers.toggleExternalMcpServer(request.payload);
    case 'externalMcp.validateConnection':
      return resolvedHandlers.validateExternalMcpConnection(request.payload);
    case 'agentConfig.loadAgents':
      return resolvedHandlers.loadAgentConfigAgents();
    case 'agentConfig.loadModelCatalog':
      return resolvedHandlers.loadAgentModelCatalog();
    case 'agentConfig.saveAgentModels':
      return resolvedHandlers.saveAgentModels(request.payload);
    case 'agentConfig.addModel':
      return resolvedHandlers.addAgentModel(request.payload);
    case 'agentConfig.removeModel':
      return resolvedHandlers.removeAgentModel(request.payload);
    case 'agentInstructions.listFiles':
      return resolvedHandlers.listInstructionFiles(request);
    case 'agentInstructions.readFile':
      return resolvedHandlers.readInstructionFile(request);
    case 'agentInstructions.writeFile':
      return resolvedHandlers.writeInstructionFile(request);
    case 'taskBoard.readBoard':
      return resolvedHandlers.readTaskBoard();
    case 'taskBoard.readTaskContent':
      return resolvedHandlers.readTaskContent(request.payload);
    case 'taskBoard.reorderPending':
      return withStreamEvent(resolvedHandlers.reorderPending(request.payload),
        { message: 'Reordered pending queue.', source: 'taskBoard.reorderPending', role: 'queue' });
    case 'taskBoard.requeueErrorItem':
      return withStreamEvent(resolvedHandlers.requeueErrorItem(request.payload),
        { message: `Requeued ${request.payload.fileName} to pending.`, source: 'taskBoard.requeueErrorItem', role: 'queue' });
    case 'taskBoard.deleteTask':
      return withStreamEvent(resolvedHandlers.deleteTask(request.payload),
        { message: `Deleted ${request.payload.fileName} from ${request.payload.column}.`, source: 'taskBoard.deleteTask', role: 'queue' });
    case 'taskBoard.moveToPending':
      return withStreamEvent(resolvedHandlers.moveToPending(request.payload),
        { message: `Moved ${request.payload.fileName} to pending queue.`, source: 'taskBoard.moveToPending', role: 'queue' });
    case 'taskBoard.moveToOpen':
      return withStreamEvent(resolvedHandlers.moveToOpen(request.payload),
        { message: `Moved ${request.payload.fileName} to open.`, source: 'taskBoard.moveToOpen', role: 'queue' });
    case 'services.readStatus':
      return { ok: true, response: readBackendServiceStatus() };
    case 'services.startBackend': {
      const resp = await startBackendServices(REPO_ROOT);
      if (resp.status === 'healthy') {
        emitStreamEvent({ message: 'Backend services started.', source: 'services.startBackend', role: 'system', severity: 'success' });
      } else if (resp.status === 'unhealthy' || resp.status === 'unavailable') {
        emitStreamEvent({ message: `Backend services failed: ${resp.error ?? resp.status}.`, source: 'services.startBackend', role: 'system', severity: 'error' });
      }
      return { ok: true, response: resp };
    }
    case 'services.stopBackend': {
      const resp = await stopBackendServices(REPO_ROOT);
      if (resp.status === 'idle') {
        emitStreamEvent({ message: 'Backend services stopped.', source: 'services.stopBackend', role: 'system' });
      }
      return { ok: true, response: resp };
    }
    case 'services.healthCheck': {
      const resp = await checkBackendHealth(REPO_ROOT);
      if (resp.status !== 'healthy') {
        emitStreamEvent({ message: `Health check: ${resp.status}.`, source: 'services.healthCheck', role: 'system', severity: 'warning' });
      }
      return { ok: true, response: resp };
    }
    case 'deepFocus.saveSelections':
      return resolvedHandlers.saveDeepFocusSelections(request.payload);
    case 'deepFocus.loadSelections':
      return resolvedHandlers.loadDeepFocusSelections(request.payload);
    case 'deepFocus.clearSelections':
      return resolvedHandlers.clearDeepFocusSelections(request.payload);
    case 'planner.uploadSpec':
      return resolvedHandlers.uploadSpec(request.payload.content);
    default:
      return {
        ok: false,
        action: (request as { action?: string }).action,
        error: 'Unsupported desktop action requested.',
      };
  }
}

const IPC_RATE_LIMIT_WINDOW_MS = 1000;
const IPC_RATE_LIMIT_MAX = 60;
let ipcRateWindowStart = 0;
let ipcRateCount = 0;

export function registerDesktopContract(): void {
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

    return handleDesktopAction(request);
  });

  ipcMain.handle(DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL, async () => readBypassTemplate());
}

export async function createWindow(): Promise<BrowserWindow> {
  const iconPath = join(__dirname, '..', 'build', 'icon.png');
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#020617',
    title: 'TaskSail',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const isDevMode = Boolean(process.env.VITE_DEV_SERVER_URL);
  if (!isDevMode && window.webContents?.session) {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' data:; " +
            "connect-src 'self'; " +
            "frame-src 'none'"
          ],
        },
      });
    });
  }

  // Periodically trim renderer memory when idle.
  // Electron's backgroundThrottling reduces CPU but doesn't compact the V8 heap.
  // This timer runs a lightweight executeJavaScript call that nudges the GC.
  const IDLE_GC_INTERVAL_MS = 5 * 60 * 1000;
  if (typeof window.webContents?.executeJavaScript === 'function') {
    const idleGcTimer = setInterval(() => {
      if (window.isDestroyed()) return;
      window.webContents.executeJavaScript(
        'typeof gc === "function" ? gc() : void 0',
        true,
      ).catch(() => {});
    }, IDLE_GC_INTERVAL_MS);

    window.once('closed', () => {
      clearInterval(idleGcTimer);
    });
  }

  window.once('ready-to-show', () => {
    window.show();
  });

  const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (viteDevServerUrl) {
    const validationError = validateDevServerUrl(viteDevServerUrl);
    if (validationError) {
      throw new Error(validationError);
    }

    await window.loadURL(viteDevServerUrl);
    return window;
  }

  await window.loadFile(join(RENDERER_DIST, 'index.html'));
  return window;
}

export function registerAppLifecycle(): void {
  // Constrain V8 heap to 256 MB so GC runs more aggressively in long-lived sessions.
  // --expose-gc makes the global gc() function available for the idle GC nudge timer.
  if (typeof app.commandLine?.appendSwitch === 'function') {
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256 --expose-gc');
  }

  let stopBoardWatcher: (() => void) | undefined;
  let stopRuntimeWatcher: (() => void) | undefined;

  app.whenReady().then(async () => {
    // Set macOS dock icon
    if (process.platform === 'darwin' && app.dock) {
      const dockIconPath = join(__dirname, '..', 'build', 'icon.png');
      try {
        app.dock.setIcon(nativeImage.createFromPath(dockIconPath));
      } catch { /* best effort — icon file may not exist in dev */ }
    }

    registerDesktopContract();
    await createWindow();

    // Clean up stale pipeline state before starting watchers/recovery.
    await cleanupStalePipelineState();

    stopBoardWatcher = startTaskBoardWatcher(listAvailableContextPacks);
    stopRuntimeWatcher = startRuntimeStreamWatcher();
    recoveryController = startTaskRecoveryController({
      schedulePipelineAutoStart,
    });

    // Rebuild the task registry from filesystem state on startup (fire-and-forget).
    // This handles first run, corruption recovery, and manual file placement.
    void repairTaskRegistry(REPO_ROOT)
      .catch(() => { /* best-effort — board falls back to directory scanning */ });

    // Auto-start backend MCP services (non-blocking).
    void autoStartBackendServices(REPO_ROOT);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  });

  app.on('before-quit', () => {
    // Full workspace reset: kill agent PIDs, move pending/active tasks back to
    // open (dropbox), clear handoffs, reset pipeline state, and clean ephemeral
    // runtime directories. This prevents stale-state recovery messages on the
    // next launch and keeps the workspace ready for a fresh session.
    cleanupWorkspaceOnQuit();

    stopBoardWatcher?.();
    stopRuntimeWatcher?.();
    recoveryController?.stop();
    recoveryController = null;
    void plannerSession.endSession();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

registerAppLifecycle();
