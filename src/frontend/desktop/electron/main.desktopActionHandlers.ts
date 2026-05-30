import { basename } from 'node:path';

import {
  ERROR_CODE_ACTIVE_WORK_BLOCKED,
  ERROR_CODE_VERSION_CONFLICT,
  type DesktopInvokeResult,
  type FollowUpDirectSubmissionDraft,
  type PlannerDirectSubmissionDraft,
} from '../src/shared/desktopContract';
import * as plannerSession from './plannerSession';
import { validateChildTaskFocusSnapshot } from './plannerFocusValidation';
import {
  hydrateConversationAction,
  listConversationHistoryAction,
} from './plannerHistory';
import { REPO_ROOT } from './paths';
import { parseStderrErrorCode } from './main.textUtils';
import {
  listExternalMcpServers,
  addExternalMcpServer,
  updateExternalMcpServer,
  removeExternalMcpServer,
  toggleExternalMcpServer,
  validateExternalMcpConnection,
  validateExternalMcpLocalCommand,
} from './externalMcpHandlers';
import {
  addAgentModel,
  loadAgentConfigCapabilities,
  loadAgentConfigAgents,
  loadAgentModelCatalog,
  removeAgentModel,
  saveAgentModels,
} from './agentConfigHandlers';
import {
  listAgentExtensionsCatalog,
  addAgentExtensionCatalog,
  reseedAgentExtensionCatalog,
  deleteAgentExtensionCatalog,
  loadAgentExtensionAssignments,
  saveAgentExtensionAssignments,
} from './agentExtensionCatalog';
import {
  listInstructionFiles,
  readInstructionFile,
  writeInstructionFile,
} from './agentInstructionsHandlers';
import { listArchivedTasksAction } from './main.archivedTasks';
import { readParentContextBundleAction } from './main.parentContextBundle';
import { readParentChainArchiveBundleAction } from './main.parentChainArchiveBundle';
import { readParentArchiveMarkdownAction } from './main.parentArchiveMarkdown';
import { readChildTaskChainBranchInventoryAction } from './main.childTaskChainBranchInventory';
import {
  readTaskBoard,
  readTaskContent as readTaskContentImpl,
  reorderPending as reorderPendingImpl,
  requeueErrorItem as requeueErrorItemAction,
  deleteTask as deleteTaskAction,
  moveToPending as moveToPendingAction,
  moveToOpen as moveToOpenAction,
  killTask as killTaskAction,
  retryKillCleanup as retryKillCleanupAction,
} from './main.taskBoard';
import {
  dismissAllTaskNotifications,
  dismissTaskNotification,
  markTaskNotificationsSeen,
  readTaskNotifications,
} from './main.taskNotifications';
import {
  submitDraftViaDropboxHelper,
  submitFollowUpViaHelper,
  submitUploadedSpecHelper,
} from './main.taskQueue';
import {
  readEnvironmentStatus,
  readObservabilitySnapshot,
  readQueueStatusSnapshot,
} from './main.environmentStatus';
import {
  listAvailableContextPacks,
  executeContextPackListRepoTreeAction,
  pickContextPackDirectoryAction,
  pickMarkdownFileAction,
  executeContextPackDiscoveryAction,
  executeContextPackCreateAction,
  executeContextPackReseedAction,
  executeContextPackWorkspaceAction,
  executeSetRepoFocusAction,
  executeSetRepoCategoryAction,
} from './main.contextPack';
import {
  saveDeepFocusSelections,
  loadDeepFocusSelections,
  clearDeepFocusSelections,
  listFocusFilters,
  createFocusFilter,
  deleteFocusFilter,
  loadContextPackSidebarState,
  saveContextPackSidebarState,
  executeContextPackDeleteAction,
} from './main.contextPackActions';
import {
  emitStreamEvent,
  setTerminalTaskScopeForWebContents,
} from './main.stream';
import {
  submitReinforcementFeedback,
  updateGlobalRealignmentDoc,
  checkActiveWorkGuard,
  startRealignmentSession,
  dismissRealignmentSession,
  type ReinforcementFeedbackResult,
} from '../../../backend/platform/agent-runner/reinforcementWrite';
import { prewarmExternalMcpRegistry } from '../../../backend/platform/agent-runner/pipeline/externalMcpRegistryCache';
import { startRealignmentAnalysisJob } from '../../../backend/platform/agent-runner/realignmentPhase/supervisor';
import { activateContextPack as activateContextPackImpl } from '../../../backend/platform/context-pack/activate';
import {
  deletePendingItem as deletePendingItemImpl,
} from '../../../backend/platform/queue';
import { stopPipeline } from '../../../backend/platform/agent-runner/pipelineSupervisor.js';

export type DesktopActionHandlerDeps = {
  getRecoveryController?: () =>
    | { noteActivatedPendingItem: (id: string) => void }
    | null
    | undefined;
  schedulePipelineAutoStart?: () => void;
};

export type DesktopActionHandlers = {
  submitDraft: (draft: PlannerDirectSubmissionDraft) => Promise<DesktopInvokeResult>;
  submitFollowUp: (draft: FollowUpDirectSubmissionDraft) => Promise<DesktopInvokeResult>;
  startPlannerSession: (
    payload?: import('../src/shared/desktopContract').PlannerStartSessionPayload,
  ) => Promise<{
    sessionId: string;
    created: boolean;
    parentBranchViewStatus?: import('../src/shared/desktopContract').PlannerParentBranchViewStatus;
  }>;
  updatePlannerSessionPersonality: (
    payload: import('../src/shared/desktopContract').PlannerUpdateSessionPersonalityRequest['payload'],
  ) => Promise<import('../src/shared/desktopContract').PlannerUpdateSessionPersonalityResponse>;
  validateChildTaskFocus: (
    payload: import('../src/shared/desktopContract').PlannerValidateChildTaskFocusRequest['payload'],
  ) => Promise<import('../src/shared/desktopContract').PlannerFocusValidationIssue[]>;
  sendPlannerMessage: (text: string, displayText?: string) => Promise<'sent' | 'no-session' | 'busy'>;
  endPlannerSession: () => Promise<{ ended: boolean }>;
  savePlannerDraft: () => Promise<'sent' | 'no-session' | 'busy'>;
  getPlannerSessionState: () => ReturnType<typeof plannerSession.getSessionState>;
  readQueueStatus: () => Promise<import('../src/shared/desktopContract').QueueStatusResponse>;
  deletePendingItem: (
    payload: import('../src/shared/desktopContract').QueueDeletePendingItemRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readEnvironmentStatus: () => Promise<import('../src/shared/desktopContract').EnvironmentStatusResponse>;
  readObservability: () => Promise<import('../src/shared/desktopContract').ObservabilitySnapshotResponse>;
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
  deleteContextPack: (
    payload: import('../src/shared/desktopContract').ContextPackDeleteRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  pickMarkdownFile: () => Promise<DesktopInvokeResult>;
  listArchivedTasks: () => Promise<DesktopInvokeResult>;
  readParentContextBundle: (
    payload: import('../src/shared/desktopContract').PlannerReadParentContextBundleRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readParentChainArchiveBundle: (
    payload: import('../src/shared/desktopContract').PlannerReadParentChainArchiveBundleRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readParentArchiveMarkdown: (
    payload: import('../src/shared/desktopContract').PlannerReadParentArchiveMarkdownRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  listConversationHistory: () => Promise<DesktopInvokeResult>;
  hydrateConversation: (recordId: string) => Promise<DesktopInvokeResult>;
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
  runRealignmentAnalysis: (
    payload: import('../src/shared/desktopContract').ReinforcementRunRealignmentAnalysisRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  dismissRealignment: (
    payload: import('../src/shared/desktopContract').ReinforcementDismissRealignmentRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  activateContextPack: (
    payload: import('../src/shared/desktopContract').ContextPackActivationRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  setRepositoryType: (
    payload: import('../src/shared/desktopContract').ContextPackSetRepositoryTypeRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  setRepoCategory: (
    payload: import('../src/shared/desktopContract').ContextPackSetRepoCategoryRequest['payload'],
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
  validateExternalMcpLocalCommand: (
    payload: import('../src/shared/desktopContract').ExternalMcpValidateLocalCommandRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  loadAgentConfigAgents: () => Promise<DesktopInvokeResult>;
  loadAgentModelCatalog: () => Promise<DesktopInvokeResult>;
  loadAgentConfigCapabilities: () => Promise<DesktopInvokeResult>;
  saveAgentModels: (
    payload: import('../src/shared/desktopContract').AgentConfigSaveAgentModelsRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  addAgentModel: (
    payload: import('../src/shared/desktopContract').AgentConfigAddModelRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  removeAgentModel: (
    payload: import('../src/shared/desktopContract').AgentConfigRemoveModelRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  listAgentExtensions: () => Promise<DesktopInvokeResult>;
  addAgentExtension: (
    payload: import('../src/shared/desktopContract').AgentConfigAddExtensionRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  reseedAgentExtension: (
    payload: import('../src/shared/desktopContract').AgentConfigReseedExtensionRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  deleteAgentExtension: (
    payload: import('../src/shared/desktopContract').AgentConfigDeleteExtensionRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  loadAgentExtensionAssignments: () => Promise<DesktopInvokeResult>;
  saveAgentExtensionAssignments: (
    payload: import('../src/shared/desktopContract').AgentConfigSaveExtensionAssignmentsRequest['payload'],
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
  readTaskNotifications: () => Promise<DesktopInvokeResult>;
  markTaskNotificationsSeen: (
    payload: { notificationIds?: string[]; allVisible?: boolean },
  ) => Promise<DesktopInvokeResult>;
  dismissTaskNotification: (
    payload: { notificationId: string },
  ) => Promise<DesktopInvokeResult>;
  dismissAllTaskNotifications: () => Promise<DesktopInvokeResult>;
  readTaskContent: (
    payload: import('../src/shared/desktopContract').TaskBoardReadTaskContentRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readChildChainBranchInventory: (
    payload: import('../src/shared/desktopContract').TaskBoardReadChildChainBranchInventoryRequest['payload'],
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
  killTask: (
    payload: import('../src/shared/desktopContract').TaskBoardKillTaskRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  retryKillCleanup: (
    payload: import('../src/shared/desktopContract').TaskBoardRetryKillCleanupRequest['payload'],
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
  listFocusFilters: (
    payload: import('../src/shared/desktopContract').FocusFiltersListRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  createFocusFilter: (
    payload: import('../src/shared/desktopContract').FocusFiltersCreateRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  deleteFocusFilter: (
    payload: import('../src/shared/desktopContract').FocusFiltersDeleteRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  loadContextPackSidebarState: () => Promise<DesktopInvokeResult>;
  saveContextPackSidebarState: (
    payload: import('../src/shared/desktopContract').ContextPackSidebarStateSaveRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  uploadSpec: (
    content: string,
    options?: Parameters<typeof submitUploadedSpecHelper>[1],
  ) => Promise<DesktopInvokeResult>;
  cancelTask: (taskId: string) => Promise<DesktopInvokeResult>;
  setTerminalTaskScope: (
    webContentsId: number,
    taskGuid: string | null,
  ) => import('../src/shared/desktopContract').TerminalSetTaskScopeResponse;
};

export {
  readQueueStatusSnapshot,
  readEnvironmentStatus,
  readObservabilitySnapshot,
} from './main.environmentStatus';


export function createDefaultDesktopActionHandlers(
  deps: DesktopActionHandlerDeps = {},
): DesktopActionHandlers {
  return {
  submitDraft: submitDraftViaDropboxHelper,
  submitFollowUp: submitFollowUpViaHelper,
  startPlannerSession: (payload) => {
    const contextPackDir = payload?.contextPackDir;
    if (!contextPackDir) {
      return Promise.reject(new Error('Planner session requires an active context pack.'));
    }
    return plannerSession.startSession(
      contextPackDir,
      payload?.deepFocusSelection,
      payload?.replayConversationId,
      payload?.childTaskFocusSnapshot,
      payload?.childTaskLineage,
      payload?.childTaskExecutionScope,
      payload?.lilyPlanningReloadScope,
      payload?.parentTaskBranchView,
      payload?.lilyPersonalityId,
    );
  },
  updatePlannerSessionPersonality: (payload) => plannerSession.updateSessionPersonality(payload.lilyPersonalityId),
  validateChildTaskFocus: (payload) => validateChildTaskFocusSnapshot({
    repoRoot: REPO_ROOT,
    contextPackDir: payload.contextPackDir,
    snapshot: payload.snapshot,
  }),
  sendPlannerMessage: (text, displayText) => plannerSession.sendMessage(text, displayText),
  endPlannerSession: () => plannerSession.endSession(),
  savePlannerDraft: () => plannerSession.saveDraft(),
  getPlannerSessionState: () => plannerSession.getSessionState(),
  readQueueStatus: () => readQueueStatusSnapshot(),
  deletePendingItem: async (payload) => {
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
  },
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
  deleteContextPack: (payload) => executeContextPackDeleteAction(payload),
  pickMarkdownFile: () => pickMarkdownFileAction(),
  listArchivedTasks: () => listArchivedTasksAction(listAvailableContextPacks),
  readParentContextBundle: (payload) => readParentContextBundleAction(listAvailableContextPacks, payload),
  readParentChainArchiveBundle: (payload) => readParentChainArchiveBundleAction(listAvailableContextPacks, payload),
  readParentArchiveMarkdown: (payload) => readParentArchiveMarkdownAction(listAvailableContextPacks, payload),
  listConversationHistory: () => listConversationHistoryAction(),
  hydrateConversation: (recordId) => hydrateConversationAction(recordId),
  submitReinforcementFeedback: async (payload) => {
    let result: ReinforcementFeedbackResult;
    try {
      result = await submitReinforcementFeedback(payload);
    } catch (error: unknown) {
      return {
        ok: false,
        action: 'reinforcement.submitFeedback',
        error: error instanceof Error ? error.message : 'Feedback submission failed.',
      };
    }
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
  runRealignmentAnalysis: async (payload) => {
    const externalMcpRegistry = await prewarmExternalMcpRegistry(REPO_ROOT);
    const job = await startRealignmentAnalysisJob({
      repoRoot: REPO_ROOT,
      contextPackDir: payload.contextPackDir,
      realignmentId: payload.realignmentId,
      externalMcpRegistry,
    });
    return {
      ok: true,
      response: {
        action: 'reinforcement.runRealignmentAnalysis' as const,
        mode: job.status === 'failed' ? 'analysis-start-failed' as const : 'analysis-started' as const,
        message: job.status === 'failed'
          ? (job.reason ?? 'Realignment analysis job failed to start.')
          : 'Realignment analysis job registered.',
        job,
      },
    };
  },
  dismissRealignment: async (payload) => {
    const result = await dismissRealignmentSession(payload);
    if (!result.passed) {
      const parsed = parseStderrErrorCode(result.stderr, 'realignment_dismiss_failed');
      return {
        ok: false,
        action: 'reinforcement.dismissRealignment',
        error: parsed?.errorMessage ?? result.stderr ?? 'Failed to dismiss realignment.',
        errorCode: parsed?.errorCode,
      } as const;
    }
    return {
      ok: true,
      response: {
        action: 'reinforcement.dismissRealignment' as const,
        mode: 'dismissed' as const,
        message: 'Realignment dismissed.',
        realignmentId: payload.realignmentId,
      },
    };
  },
  listExternalMcpServers: () => listExternalMcpServers(),
  addExternalMcpServer: (payload) => addExternalMcpServer(payload),
  updateExternalMcpServer: (payload) => updateExternalMcpServer(payload),
  removeExternalMcpServer: (payload) => removeExternalMcpServer(payload),
  toggleExternalMcpServer: (payload) => toggleExternalMcpServer(payload),
  validateExternalMcpConnection: (payload) => validateExternalMcpConnection(payload),
  validateExternalMcpLocalCommand: (payload) => validateExternalMcpLocalCommand(payload),
  loadAgentConfigAgents: () => loadAgentConfigAgents(),
  loadAgentModelCatalog: () => loadAgentModelCatalog(),
  loadAgentConfigCapabilities: () => loadAgentConfigCapabilities(),
  saveAgentModels: (payload) => saveAgentModels(payload),
  addAgentModel: (payload) => addAgentModel(payload),
  removeAgentModel: (payload) => removeAgentModel(payload),
  listAgentExtensions: () => listAgentExtensionsCatalog(),
  addAgentExtension: (payload) => addAgentExtensionCatalog(payload),
  reseedAgentExtension: (payload) => reseedAgentExtensionCatalog(payload),
  deleteAgentExtension: (payload) => deleteAgentExtensionCatalog(payload),
  loadAgentExtensionAssignments: () => loadAgentExtensionAssignments(),
  saveAgentExtensionAssignments: (payload) => saveAgentExtensionAssignments(payload),
  listInstructionFiles: (request) => listInstructionFiles(request),
  readInstructionFile: (request) => readInstructionFile(request),
  writeInstructionFile: (request) => writeInstructionFile(request),
  readTaskBoard: () => readTaskBoard(listAvailableContextPacks),
  readTaskNotifications: () => readTaskNotifications(),
  markTaskNotificationsSeen: (payload) => markTaskNotificationsSeen(payload),
  dismissTaskNotification: (payload) => dismissTaskNotification(payload),
  dismissAllTaskNotifications: () => dismissAllTaskNotifications(),
  readTaskContent: (payload) => readTaskContentImpl(payload, listAvailableContextPacks),
  readChildChainBranchInventory: (payload) => readChildTaskChainBranchInventoryAction(payload),
  reorderPending: (payload) => reorderPendingImpl(payload, listAvailableContextPacks),
  requeueErrorItem: async (payload) => {
    const result = await requeueErrorItemAction(payload, listAvailableContextPacks);
    if (
      result.ok &&
      result.response.action === 'taskBoard.requeueErrorItem' &&
      result.response.activatedItem
    ) {
      deps.getRecoveryController?.()?.noteActivatedPendingItem(result.response.activatedItem);
      deps.schedulePipelineAutoStart?.();
    }
    return result;
  },
  deleteTask: (payload) => deleteTaskAction(payload, listAvailableContextPacks),
  moveToPending: async (payload) => {
    const result = await moveToPendingAction(payload, listAvailableContextPacks);
    if (
      result.ok &&
      result.response.action === 'taskBoard.moveToPending' &&
      result.response.activatedItem
    ) {
      deps.getRecoveryController?.()?.noteActivatedPendingItem(result.response.activatedItem);
      deps.schedulePipelineAutoStart?.();
    }
    return result;
  },
  moveToOpen: (payload) => moveToOpenAction(payload, listAvailableContextPacks),
  killTask: (payload) => killTaskAction(payload, listAvailableContextPacks),
  retryKillCleanup: (payload) => retryKillCleanupAction(payload, listAvailableContextPacks),
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
  setRepositoryType: (payload) => executeSetRepoFocusAction(payload),
  setRepoCategory: (payload) => executeSetRepoCategoryAction(payload),
  saveDeepFocusSelections: (payload) => saveDeepFocusSelections(payload),
  loadDeepFocusSelections: (payload) => loadDeepFocusSelections(payload),
  clearDeepFocusSelections: (payload) => clearDeepFocusSelections(payload),
  listFocusFilters: (payload) => listFocusFilters(payload),
  createFocusFilter: (payload) => createFocusFilter(payload),
  deleteFocusFilter: (payload) => deleteFocusFilter(payload),
  loadContextPackSidebarState: () => loadContextPackSidebarState(),
  saveContextPackSidebarState: (payload) => saveContextPackSidebarState(payload),
  uploadSpec: submitUploadedSpecHelper,
  cancelTask: async (taskId: string) => {
    await stopPipeline(taskId);
    emitStreamEvent({
      message: `Pipeline cancelled for task ${taskId}.`,
      source: 'pipeline.cancelTask',
      role: 'system',
      severity: 'warning',
    });
    return {
      ok: true,
      response: {
        action: 'cancel-task' as const,
        mode: 'cancelled' as const,
        message: `Pipeline stopped for task ${taskId}.`,
        taskId,
      },
    };
  },
  setTerminalTaskScope: setTerminalTaskScopeForWebContents,
};

}
