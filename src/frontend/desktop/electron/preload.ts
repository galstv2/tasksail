import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL,
  CONTEXT_PACK_CATALOG_CHANGED_CHANNEL,
  DESKTOP_SHELL_INVOKE_CHANNEL,
  DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
  DESKTOP_SHELL_STREAM_CHANNEL,
  DESKTOP_SHELL_TASK_BOARD_CHANNEL,
  DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL,
  PROVIDER_DESCRIBE_ACTIVE_CHANNEL,
  type ContextPackApplyResponse,
  type ContextPackActivationResponse,
  type PlannerListArchivedTasksResponse,
  type PlannerPickMarkdownFileResponse,
  type ReinforcementSubmitFeedbackRequest,
  type ReinforcementSubmitFeedbackResponse,
  type ReinforcementUpdateRealignmentDocRequest,
  type ReinforcementUpdateRealignmentDocResponse,
  type ReinforcementReadOverviewResponse,
  type ReinforcementListTasksResponse,
  type ReinforcementReadAgentRewardsResponse,
  type ReinforcementListRealignmentSessionsResponse,
  type ReinforcementReadRealignmentDocResponse,
  type ReinforcementCheckActiveWorkGuardResponse,
  type ReinforcementStartRealignmentRequest,
  type ReinforcementStartRealignmentResponse,
  type ReinforcementRunRealignmentAnalysisRequest,
  type ReinforcementRunRealignmentAnalysisResponse,
  type ReinforcementDismissRealignmentRequest,
  type ReinforcementDismissRealignmentResponse,
  type AgentConfigAddModelResponse,
  type AgentConfigLoadCapabilitiesResponse,
  type AgentConfigLoadAgentsResponse,
  type AgentConfigLoadModelCatalogResponse,
  type AgentConfigRemoveModelResponse,
  type AgentConfigSaveAgentModelsRequest,
  type AgentConfigSaveAgentModelsResponse,
  type AgentConfigListExtensionsResponse,
  type AgentConfigAddExtensionResponse,
  type AgentConfigReseedExtensionResponse,
  type AgentConfigDeleteExtensionResponse,
  type AgentConfigLoadExtensionAssignmentsResponse,
  type AgentConfigSaveExtensionAssignmentsResponse,
  type AgentConfigAddExtensionRequest,
  type AgentConfigReseedExtensionRequest,
  type AgentConfigDeleteExtensionRequest,
  type AgentConfigSaveExtensionAssignmentsRequest,
  type AgentInstructionsListFilesResponse,
  type AgentInstructionsReadFileResponse,
  type AgentInstructionsWriteFileResponse,
  type InstructionDirectory,
  type ContextPackClearResponse,
  type ContextPackCreateResponse,
  type ContextPackDiscoveryMode,
  type ContextPackDiscoverPrefillResponse,
  type ContextPackListResponse,
  type ContextPackPickDirectoryResponse,
  type ContextPackPreviewResponse,
  type ContextPackReseedResponse,
  type DesktopInvokeResult,
  type EnvironmentStatusResponse,
  type FollowUpResponse,
  type ObservabilitySnapshotResponse,
  type PlannerSubmitResponse,
  type PlannerStartSessionResponse,
  type PlannerSendMessageResponse,
  type PlannerEndSessionResponse,
  type PlannerSaveDraftResponse,
  type PlannerReadStagedDraftResponse,
  type PlannerFinalizeSpecResponse,
  type PlannerHydrateConversationResponse,
  type PlannerListConversationHistoryResponse,
  type PlannerStreamEvent,
  type ProviderFrontendDescriptor,
  type QueueStatusResponse,
  type TaskBoardReadBoardResponse,
  type TaskBoardReadTaskContentResponse,
  type TaskBoardReadChildChainBranchInventoryResponse,
  type TaskBoardReorderPendingResponse,
  type TaskBoardDeleteColumn,
  type TaskBoardDeleteTaskResponse,
  type TaskBoardMoveToPendingResponse,
  type TaskBoardMoveToOpenResponse,
  type TaskBoardRequeueErrorItemResponse,
  type TaskNotificationEvent,
  type TaskNotificationMutationResponse,
  type TaskNotificationSnapshot,
  type ServicesReadStatusResponse,
  type WorkspaceScopeMode,
  type PlannerDirectSubmissionDraft,
  type FollowUpDirectSubmissionDraft,
  type ContextPackDeepFocusState,
  type ContextPackCatalogChangedEvent,
  type ContextPackFocusFilterSelection,
} from '../src/shared/desktopContract';
import { LOG_EMIT_CHANNEL, type LogEmitPayload } from '../src/shared/desktopContractLogging';
import { isTaskNotificationEvent } from '../src/shared/desktopContractTypeGuards';
import { isRecord } from '../src/shared/desktopContractValidators';

const isDev = process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL);

type FrontendLogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS = new Set<FrontendLogLevel>(['debug', 'info', 'warn', 'error']);

function normalizeFrontendLogLevel(
  value: string | undefined,
  fallback: FrontendLogLevel,
): FrontendLogLevel {
  const normalized = value?.toLowerCase();
  return normalized && LOG_LEVELS.has(normalized as FrontendLogLevel)
    ? (normalized as FrontendLogLevel)
    : fallback;
}

const logLevel = normalizeFrontendLogLevel(process.env.LOG_LEVEL, 'info');

function emitPreloadWarn(msg: 'preload.stream-event.malformed' | 'preload.planner-event.malformed' | 'preload.task-board-update.malformed' | 'preload.task-notifications-update.malformed' | 'preload.context-pack-catalog-event.malformed', extra: Record<string, unknown>): void {
  void ipcRenderer.invoke(LOG_EMIT_CHANNEL, {
    ts: new Date().toISOString(),
    level: 'warn',
    stack: 'renderer',
    module: 'electron/preload',
    pid: 0,
    task_id: null,
    agent_id: null,
    provider_id: null,
    span_id: null,
    msg,
    extra,
  } satisfies LogEmitPayload).catch(() => undefined);
}

function isContextPackCatalogChangedEvent(value: unknown): value is ContextPackCatalogChangedEvent {
  return (
    isRecord(value) &&
    typeof value.changedRoot === 'string' &&
    (
      value.reason === 'mkdir' ||
      value.reason === 'rmdir' ||
      value.reason === 'rename' ||
      value.reason === 'unknown'
    )
  );
}

export const bootstrapInfo = {
  appName: 'TaskSail',
  platform: process.platform,
  logLevel,
  rendererForwardLevel: normalizeFrontendLogLevel(
    process.env.LOG_RENDERER_FORWARD_LEVEL,
    logLevel,
  ),
  versions: {
    chrome: isDev ? process.versions.chrome : undefined,
    electron: isDev ? process.versions.electron : undefined,
    node: process.versions.node,
  },
};

export const desktopShellApi = {
  log: {
    emit: (payload: LogEmitPayload): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke(LOG_EMIT_CHANNEL, payload),
  },
  getBootstrapInfo: async () => bootstrapInfo,
  describeActiveProvider: async (): Promise<ProviderFrontendDescriptor> =>
    ipcRenderer.invoke(PROVIDER_DESCRIBE_ACTIVE_CHANNEL),
  submitPlannerDraft: async (
    draft: PlannerDirectSubmissionDraft,
    stage: 'compose' | 'preview' | 'confirm',
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.submitDraft',
      payload: { draft, stage },
    }),
  getQueueStatus: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'queue.readStatus',
    }),
  deletePendingItem: async (queueName: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'queue.deletePendingItem',
      payload: { queueName },
    }),
  getEnvironmentStatus: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'environment.readStatus',
    }),
  getObservabilitySnapshot: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'observability.readSnapshot',
    }),
  setTerminalTaskScope: (taskGuid: string | null): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'terminal.setTaskScope',
      payload: { taskGuid },
    }),
  initiateFollowUp: async (
    draft: FollowUpDirectSubmissionDraft,
    stage: 'compose' | 'preview' | 'confirm',
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'followup.begin',
      payload: { draft, stage },
    }),
  pickContextPackDirectory: async (
    purpose: 'discovery-root' | 'context-pack-destination',
    defaultPath?: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.pickDirectory',
      payload: {
        purpose,
        defaultPath,
      },
    }),
  discoverContextPackPrefill: async (
    rootPath: string,
    mode: ContextPackDiscoveryMode = 'auto',
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.discoverPrefill',
      payload: {
        rootPath,
        mode,
      },
    }),
  createContextPack: async (payload: {
    contextPackDir: string;
    discoveryRoot: string;
    mode: ContextPackDiscoveryMode;
    writePlan?: boolean;
    seedOnCreate?: boolean;
    initGitRepos?: boolean;
    bootstrapAnswers: {
      contextPackId: string;
      estateName: string;
      defaultScopeMode?: WorkspaceScopeMode;
      primaryWorkingRepoIds?: string[];
      primaryFocusAreaIds?: string[];
      repositories: Array<{
        repoRoot: string;
        repoName: string;
        repoId?: string;
        owner?: string;
        systemLayer:
          | 'backend'
          | 'frontend'
          | 'infrastructure'
          | 'database'
          | 'documents'
          | 'shared';
        languages?: string[];
        artifactRoots?: string[];
        documentPaths?: string[];
        boundedContext?: string;
        serviceName?: string;
        repoRole?: string;
        workspaceActivationGroup?: string;
        defaultFocusable?: boolean;
        activationPriority?: number;
        adjacentRepoIds?: string[];
        dependsOnRepoIds?: string[];
        usedByRepoIds?: string[];
      }>;
      focusableAreas?: Array<{
        focusId?: string;
        focusName?: string;
        relativePath?: string;
        path?: string;
        focusType?: string;
        group?: string;
        defaultFocusable?: boolean;
        activationPriority?: number;
        adjacentFocusAreaIds?: string[];
        repositoryType?: string;
      }>;
    };
  }): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.create',
      payload,
    }),
  activateContextPack: async (
    packId: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.activate',
      payload: {
        packId,
        command: 'context-pack:activate',
        mode: 'status-only',
      },
    }),
  listContextPacks: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.list',
    }),
  listRepoTree: async (
    repoLocalPath: string,
    relativePath?: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.listRepoTree',
      payload: {
        repoLocalPath,
        ...(relativePath !== undefined ? { relativePath } : {}),
      },
    }),
  reseedContextPack: async (
    contextPackDir: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.reseed',
      payload: {
        contextPackDir,
      },
    }),
  setRepositoryType: async (
    contextPackDir: string,
    repoId: string,
    repositoryType: 'primary' | 'support',
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.setRepositoryType',
      payload: { contextPackDir, repoId, repositoryType },
    }),
  setRepoCategory: async (
    contextPackDir: string,
    repoId: string,
    repoCategory: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.setRepoCategory',
      payload: { contextPackDir, repoId, repoCategory },
    }),
  previewContextPackSwitch: async (
    contextPackDir: string,
    scopeMode: WorkspaceScopeMode = 'focused',
    selectedRepoIds: string[] = [],
    selectedFocusIds: string[] = [],
    deepFocusSelection: import('../src/shared/desktopContract').ContextPackSwitchDeepFocusSelection = {},
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.previewSwitch',
      payload: {
        contextPackDir,
        scopeMode,
        selectedRepoIds,
        selectedFocusIds,
        ...deepFocusSelection,
      },
    }),
  applyContextPackSwitch: async (
    contextPackDir: string,
    scopeMode: WorkspaceScopeMode = 'focused',
    selectedRepoIds: string[] = [],
    selectedFocusIds: string[] = [],
    deepFocusSelection: import('../src/shared/desktopContract').ContextPackSwitchDeepFocusSelection = {},
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.applySwitch',
      payload: {
        contextPackDir,
        scopeMode,
        selectedRepoIds,
        selectedFocusIds,
        ...deepFocusSelection,
      },
    }),
  clearActiveContextPack: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.clearActive',
    }),
  deleteContextPack: async (contextPackDir: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.delete',
      payload: { contextPackDir },
    }),
  startPlannerSession: async (
    payload?: import('../src/shared/desktopContract').PlannerStartSessionPayload,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.startSession',
      ...(payload ? { payload } : {}),
    }),
  updatePlannerSessionPersonality: async (
    payload: import('../src/shared/desktopContract').PlannerUpdateSessionPersonalityRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.updateSessionPersonality',
      payload,
    }),
  validateChildTaskFocus: async (
    payload: import('../src/shared/desktopContract').PlannerValidateChildTaskFocusRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.validateChildTaskFocus',
      payload,
    }),
  sendPlannerMessage: async (
    text: string,
    displayText?: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.sendMessage',
      payload: {
        text,
        ...(displayText !== undefined ? { displayText } : {}),
      },
    }),
  endPlannerSession: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.endSession',
    }),
  savePlannerDraft: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.saveDraft',
    }),
  readStagedDraft: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.readStagedDraft',
    }),
  finalizeSpec: async (
    expectedTaskKind?: 'standard' | 'child-task',
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.finalizeSpec',
      ...(expectedTaskKind ? { payload: { expectedTaskKind } } : {}),
    }),
  pickMarkdownFile: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.pickMarkdownFile',
    }),
  uploadSpec: async (
    content: string,
    options?: {
      requirePlannerSidecar?: boolean;
      expectedTaskKind?: 'standard' | 'child-task';
    },
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.uploadSpec',
      payload: {
        content,
        ...(options?.requirePlannerSidecar !== undefined
          ? { requirePlannerSidecar: options.requirePlannerSidecar }
          : {}),
        ...(options?.expectedTaskKind ? { expectedTaskKind: options.expectedTaskKind } : {}),
      },
    }),
  getBypassTemplate: async (): Promise<string> =>
    ipcRenderer.invoke(DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL),
  listArchivedTasks: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.listArchivedTasks',
    }),
  readParentContextBundle: async (
    payload: import('../src/shared/desktopContract').PlannerReadParentContextBundleRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.readParentContextBundle',
      payload,
    }),
  readParentChainArchiveBundle: async (
    payload: import('../src/shared/desktopContract').PlannerReadParentChainArchiveBundleRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.readParentChainArchiveBundle',
      payload,
    }),
  readParentArchiveMarkdown: async (
    payload: import('../src/shared/desktopContract').PlannerReadParentArchiveMarkdownRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.readParentArchiveMarkdown',
      payload,
    }),
  listPlannerConversationHistory: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.listConversationHistory',
    }),
  hydratePlannerConversation: async (
    recordId: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.hydrateConversation',
      payload: { recordId },
    }),
  submitReinforcementFeedback: async (
    payload: ReinforcementSubmitFeedbackRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.submitFeedback',
      payload,
    }),
  updateRealignmentDoc: async (
    payload: ReinforcementUpdateRealignmentDocRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.updateRealignmentDoc',
      payload,
    }),
  readReinforcementOverview: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.readOverview',
    }),
  listReinforcementTasks: async (
    year?: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.listTasks',
      ...(year ? { payload: { year } } : {}),
    }),
  readAgentRewards: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.readAgentRewards',
    }),
  listRealignmentSessions: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.listRealignmentSessions',
    }),
  readRealignmentDoc: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.readRealignmentDoc',
    }),
  checkActiveWorkGuard: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.checkActiveWorkGuard',
    }),
  startRealignment: async (
    payload: ReinforcementStartRealignmentRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.startRealignment',
      payload,
    }),
  runRealignmentAnalysis: async (
    payload: ReinforcementRunRealignmentAnalysisRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.runRealignmentAnalysis',
      payload,
    }),
  dismissRealignment: async (
    payload: ReinforcementDismissRealignmentRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.dismissRealignment',
      payload,
    }),
  loadAgentConfig: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.loadAgents',
    }),
  loadModelCatalog: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.loadModelCatalog',
    }),
  loadCapabilities: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.loadCapabilities',
    }),
  saveAgentModels: async (
    assignments: AgentConfigSaveAgentModelsRequest['payload']['assignments'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.saveAgentModels',
      payload: { assignments },
    }),
  addModel: async (
    display_name: string,
    model_id: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.addModel',
      payload: { display_name, model_id },
    }),
  removeModel: async (model_id: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.removeModel',
      payload: { model_id },
    }),
  listAgentExtensions: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.listExtensions',
    }),
  addAgentExtension: async (
    payload: AgentConfigAddExtensionRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.addExtension',
      payload,
    }),
  reseedAgentExtension: async (
    payload: AgentConfigReseedExtensionRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.reseedExtension',
      payload,
    }),
  deleteAgentExtension: async (
    payload: AgentConfigDeleteExtensionRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.deleteExtension',
      payload,
    }),
  loadAgentExtensionAssignments: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.loadExtensionAssignments',
    }),
  saveAgentExtensionAssignments: async (
    payload: AgentConfigSaveExtensionAssignmentsRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.saveExtensionAssignments',
      payload,
    }),
  listInstructionFiles: async (
    directory: InstructionDirectory,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentInstructions.listFiles',
      payload: { directory },
    }),
  readInstructionFile: async (
    relativePath: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentInstructions.readFile',
      payload: { relativePath },
    }),
  writeInstructionFile: async (
    relativePath: string,
    content: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentInstructions.writeFile',
      payload: { relativePath, content },
    }),
  listExternalMcpServers: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'externalMcp.list',
    }),
  addExternalMcpServer: async (
    server: import('../src/shared/desktopContract').ExternalMcpServerEntry,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'externalMcp.add',
      payload: { server },
    }),
  updateExternalMcpServer: async (
    server: import('../src/shared/desktopContract').ExternalMcpServerEntry,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'externalMcp.update',
      payload: { server },
    }),
  removeExternalMcpServer: async (serverId: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'externalMcp.remove',
      payload: { serverId },
    }),
  toggleExternalMcpServer: async (serverId: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'externalMcp.toggleEnabled',
      payload: { serverId },
    }),
  validateExternalMcpConnection: async (
    payload: import('../src/shared/desktopContract').ExternalMcpValidateConnectionRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'externalMcp.validateConnection',
      payload,
    }),
  validateExternalMcpLocalCommand: async (
    payload: import('../src/shared/desktopContract').ExternalMcpValidateLocalCommandRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'externalMcp.validateLocalCommand',
      payload,
    }),
  readTaskBoard: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readBoard',
    }),
  readTaskContent: async (
    fileName: string,
    column: import('../src/shared/desktopContract').TaskBoardContentColumn,
    artifactRelativePath?: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readTaskContent',
      payload: { fileName, column, ...(artifactRelativePath !== undefined ? { artifactRelativePath } : {}) },
    }),
  readChildChainBranchInventory: async (
    taskId: string,
    expectedRootTaskId?: string | null,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readChildChainBranchInventory',
      payload: { taskId, ...(expectedRootTaskId !== undefined ? { expectedRootTaskId } : {}) },
    }),
  reorderPending: async (order: string[]): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.reorderPending',
      payload: { order },
    }),
  requeueErrorItem: async (
    fileName: string,
    insertAtIndex: number,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.requeueErrorItem',
      payload: { fileName, insertAtIndex },
    }),
  deleteTask: async (
    fileName: string,
    column: TaskBoardDeleteColumn,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.deleteTask',
      payload: { fileName, column },
    }),
  moveToPending: async (
    fileName: string,
    insertAtIndex: number,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.moveToPending',
      payload: { fileName, insertAtIndex },
    }),
  moveToOpen: async (fileName: string, sourceColumn?: 'error' | 'pending'): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.moveToOpen',
      payload: { fileName, sourceColumn },
    }),
  killTask: async (fileName: string, taskId: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.killTask',
      payload: { fileName, taskId },
    }),
  retryKillCleanup: async (fileName: string, taskId: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.retryKillCleanup',
      payload: { fileName, taskId },
    }),
  readTaskNotifications: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskNotifications.read',
    }),
  markTaskNotificationsSeen: async (
    payload: import('../src/shared/desktopContract').TaskNotificationsMarkSeenRequest['payload'],
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskNotifications.markSeen',
      payload,
    }),
  dismissTaskNotification: async (notificationId: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskNotifications.dismiss',
      payload: { notificationId },
    }),
  dismissAllTaskNotifications: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskNotifications.dismissAll',
    }),
  getBackendServiceStatus: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'services.readStatus',
    }),
  startBackendServices: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'services.startBackend',
    }),
  stopBackendServices: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'services.stopBackend',
    }),
  checkBackendHealth: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'services.healthCheck',
    }),
  saveDeepFocusSelections: async (
    contextPackDir: string,
    selections: ContextPackDeepFocusState,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'deepFocus.saveSelections',
      payload: { contextPackDir, selections },
    }),
  loadDeepFocusSelections: async (
    contextPackDir: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'deepFocus.loadSelections',
      payload: { contextPackDir },
    }),
  clearDeepFocusSelections: async (
    contextPackDir: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'deepFocus.clearSelections',
      payload: { contextPackDir },
    }),
  listFocusFilters: async (
    contextPackDir: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'focusFilters.list',
      payload: { contextPackDir },
    }),
  createFocusFilter: async (
    contextPackDir: string,
    name: string,
    selection: ContextPackFocusFilterSelection,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'focusFilters.create',
      payload: { contextPackDir, name, selection },
    }),
  deleteFocusFilter: async (
    contextPackDir: string,
    filterId: string,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'focusFilters.delete',
      payload: { contextPackDir, filterId },
    }),
  loadContextPackSidebarState: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPackSidebarState.load',
    }),
  saveContextPackSidebarState: async (
    selectedContextPackDir: string | null,
    selection: ContextPackFocusFilterSelection | null,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPackSidebarState.save',
      payload: { selectedContextPackDir, selection },
    }),
  cancelTask: async (taskId: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'cancel-task',
      payload: { taskId },
    }),
  onStreamEvent: (
    callback: (event: import('../src/renderer/activityStream').StreamEvent) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: unknown,
    ) => {
      if (
        isRecord(data) &&
        typeof data.id === 'string' &&
        typeof data.role === 'string' &&
        typeof data.message === 'string'
      ) {
        callback(data as import('../src/renderer/activityStream').StreamEvent);
      } else {
        emitPreloadWarn('preload.stream-event.malformed', { data });
      }
    };
    ipcRenderer.on(DESKTOP_SHELL_STREAM_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DESKTOP_SHELL_STREAM_CHANNEL, handler);
  },
  onPlannerEvent: (
    callback: (event: PlannerStreamEvent) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      plannerEvent: unknown,
    ) => {
      if (
        isRecord(plannerEvent) &&
        typeof plannerEvent.eventType === 'string' &&
        typeof plannerEvent.sessionId === 'string' &&
        typeof plannerEvent.brokerStatus === 'string'
      ) {
        callback(plannerEvent as PlannerStreamEvent);
      } else {
        emitPreloadWarn('preload.planner-event.malformed', { plannerEvent });
      }
    };
    ipcRenderer.on(DESKTOP_SHELL_PLANNER_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DESKTOP_SHELL_PLANNER_EVENT_CHANNEL, handler);
  },
  onTaskBoardUpdate: (
    callback: (board: import('../src/shared/desktopContract').TaskBoardReadBoardResponse) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: unknown,
    ) => {
      if (isRecord(data) && data.action === 'taskBoard.readBoard') {
        callback(data as import('../src/shared/desktopContract').TaskBoardReadBoardResponse);
      } else {
        emitPreloadWarn('preload.task-board-update.malformed', {
          action: isRecord(data) ? String(data.action) : null,
          type: typeof data,
        });
      }
    };
    ipcRenderer.on(DESKTOP_SHELL_TASK_BOARD_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DESKTOP_SHELL_TASK_BOARD_CHANNEL, handler);
  },
  onTaskNotificationsUpdate: (
    callback: (event: TaskNotificationEvent) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: unknown,
    ) => {
      if (isTaskNotificationEvent(data)) {
        callback(data);
      } else {
        emitPreloadWarn('preload.task-notifications-update.malformed', {
          type: typeof data,
          eventType: isRecord(data) ? String(data.type) : null,
        });
      }
    };
    ipcRenderer.on(DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL, handler);
  },
  subscribeContextPackCatalogChanged: (
    callback: (event: ContextPackCatalogChangedEvent) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => {
      if (isContextPackCatalogChangedEvent(data)) {
        callback(data);
      } else {
        emitPreloadWarn('preload.context-pack-catalog-event.malformed', {
          reason: isRecord(data) ? String(data.reason) : null,
          type: typeof data,
        });
      }
    };
    ipcRenderer.on(CONTEXT_PACK_CATALOG_CHANGED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(CONTEXT_PACK_CATALOG_CHANGED_CHANNEL, handler);
  },
};

export type DesktopShellApi = {
  log: {
    emit: (payload: LogEmitPayload) => Promise<{ ok: boolean; reason?: string }>;
  };
  getBootstrapInfo: () => Promise<typeof bootstrapInfo>;
  describeActiveProvider: () => Promise<ProviderFrontendDescriptor>;
  submitPlannerDraft: (
    draft: PlannerDirectSubmissionDraft,
    stage: 'compose' | 'preview' | 'confirm',
  ) => Promise<DesktopInvokeResult>;
  getQueueStatus: () => Promise<DesktopInvokeResult>;
  deletePendingItem: (queueName: string) => Promise<DesktopInvokeResult>;
  getEnvironmentStatus: () => Promise<DesktopInvokeResult>;
  getObservabilitySnapshot: () => Promise<DesktopInvokeResult>;
  setTerminalTaskScope: (taskGuid: string | null) => Promise<DesktopInvokeResult>;
  initiateFollowUp: (
    draft: FollowUpDirectSubmissionDraft,
    stage: 'compose' | 'preview' | 'confirm',
  ) => Promise<DesktopInvokeResult>;
  pickContextPackDirectory: (
    purpose: 'discovery-root' | 'context-pack-destination',
    defaultPath?: string,
  ) => Promise<DesktopInvokeResult>;
  discoverContextPackPrefill: (
    rootPath: string,
    mode?: ContextPackDiscoveryMode,
  ) => Promise<DesktopInvokeResult>;
  createContextPack: (payload: {
    contextPackDir: string;
    discoveryRoot: string;
    mode: ContextPackDiscoveryMode;
    writePlan?: boolean;
    seedOnCreate?: boolean;
    initGitRepos?: boolean;
    bootstrapAnswers: {
      contextPackId: string;
      estateName: string;
      defaultScopeMode?: WorkspaceScopeMode;
      primaryWorkingRepoIds?: string[];
      primaryFocusAreaIds?: string[];
      repositories: Array<{
        repoRoot: string;
        repoName: string;
        repoId?: string;
        owner?: string;
        systemLayer:
          | 'backend'
          | 'frontend'
          | 'infrastructure'
          | 'database'
          | 'documents'
          | 'shared';
        languages?: string[];
        artifactRoots?: string[];
        documentPaths?: string[];
        boundedContext?: string;
        serviceName?: string;
        repoRole?: string;
        workspaceActivationGroup?: string;
        defaultFocusable?: boolean;
        activationPriority?: number;
        adjacentRepoIds?: string[];
        dependsOnRepoIds?: string[];
        usedByRepoIds?: string[];
      }>;
      focusableAreas?: Array<{
        focusId?: string;
        focusName?: string;
        relativePath?: string;
        path?: string;
        focusType?: string;
        group?: string;
        defaultFocusable?: boolean;
        activationPriority?: number;
        adjacentFocusAreaIds?: string[];
        repositoryType?: string;
      }>;
    };
  }) => Promise<DesktopInvokeResult>;
  activateContextPack: (packId: string) => Promise<DesktopInvokeResult>;
  listContextPacks: () => Promise<DesktopInvokeResult>;
  listRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<DesktopInvokeResult>;
  reseedContextPack: (
    contextPackDir: string,
  ) => Promise<DesktopInvokeResult>;
  setRepositoryType: (
    contextPackDir: string,
    repoId: string,
    repositoryType: 'primary' | 'support',
  ) => Promise<DesktopInvokeResult>;
  setRepoCategory: (
    contextPackDir: string,
    repoId: string,
    repoCategory: string,
  ) => Promise<DesktopInvokeResult>;
  previewContextPackSwitch: (
    contextPackDir: string,
    scopeMode?: WorkspaceScopeMode,
    selectedRepoIds?: string[],
    selectedFocusIds?: string[],
    deepFocusSelection?: import('../src/shared/desktopContract').ContextPackSwitchDeepFocusSelection,
  ) => Promise<DesktopInvokeResult>;
  applyContextPackSwitch: (
    contextPackDir: string,
    scopeMode?: WorkspaceScopeMode,
    selectedRepoIds?: string[],
    selectedFocusIds?: string[],
    deepFocusSelection?: import('../src/shared/desktopContract').ContextPackSwitchDeepFocusSelection,
  ) => Promise<DesktopInvokeResult>;
  clearActiveContextPack: () => Promise<DesktopInvokeResult>;
  deleteContextPack: (contextPackDir: string) => Promise<DesktopInvokeResult>;
  startPlannerSession: (
    payload?: import('../src/shared/desktopContract').PlannerStartSessionPayload,
  ) => Promise<DesktopInvokeResult>;
  updatePlannerSessionPersonality: (
    payload: import('../src/shared/desktopContract').PlannerUpdateSessionPersonalityRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  validateChildTaskFocus: (
    payload: import('../src/shared/desktopContract').PlannerValidateChildTaskFocusRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  sendPlannerMessage: (
    text: string,
    displayText?: string,
  ) => Promise<DesktopInvokeResult>;
  endPlannerSession: () => Promise<DesktopInvokeResult>;
  savePlannerDraft: () => Promise<DesktopInvokeResult>;
  readStagedDraft: () => Promise<DesktopInvokeResult>;
  finalizeSpec: (expectedTaskKind?: 'standard' | 'child-task') => Promise<DesktopInvokeResult>;
  pickMarkdownFile: () => Promise<DesktopInvokeResult>;
  uploadSpec: (
    content: string,
    options?: {
      requirePlannerSidecar?: boolean;
      expectedTaskKind?: 'standard' | 'child-task';
    },
  ) => Promise<DesktopInvokeResult>;
  getBypassTemplate: () => Promise<string>;
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
  listPlannerConversationHistory: () => Promise<DesktopInvokeResult>;
  hydratePlannerConversation: (recordId: string) => Promise<DesktopInvokeResult>;
  submitReinforcementFeedback: (
    payload: ReinforcementSubmitFeedbackRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  updateRealignmentDoc: (
    payload: ReinforcementUpdateRealignmentDocRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readReinforcementOverview: () => Promise<DesktopInvokeResult>;
  listReinforcementTasks: (year?: string) => Promise<DesktopInvokeResult>;
  readAgentRewards: () => Promise<DesktopInvokeResult>;
  listRealignmentSessions: () => Promise<DesktopInvokeResult>;
  readRealignmentDoc: () => Promise<DesktopInvokeResult>;
  checkActiveWorkGuard: () => Promise<DesktopInvokeResult>;
  startRealignment: (
    payload: ReinforcementStartRealignmentRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  runRealignmentAnalysis: (
    payload: ReinforcementRunRealignmentAnalysisRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  dismissRealignment: (
    payload: ReinforcementDismissRealignmentRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  loadAgentConfig: () => Promise<DesktopInvokeResult>;
  loadModelCatalog: () => Promise<DesktopInvokeResult>;
  loadCapabilities?: () => Promise<DesktopInvokeResult>;
  saveAgentModels: (
    assignments: AgentConfigSaveAgentModelsRequest['payload']['assignments'],
  ) => Promise<DesktopInvokeResult>;
  addModel: (display_name: string, model_id: string) => Promise<DesktopInvokeResult>;
  removeModel: (model_id: string) => Promise<DesktopInvokeResult>;
  listAgentExtensions: () => Promise<DesktopInvokeResult>;
  addAgentExtension: (
    payload: AgentConfigAddExtensionRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  reseedAgentExtension: (
    payload: AgentConfigReseedExtensionRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  deleteAgentExtension: (
    payload: AgentConfigDeleteExtensionRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  loadAgentExtensionAssignments: () => Promise<DesktopInvokeResult>;
  saveAgentExtensionAssignments: (
    payload: AgentConfigSaveExtensionAssignmentsRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  listInstructionFiles: (directory: InstructionDirectory) => Promise<DesktopInvokeResult>;
  readInstructionFile: (relativePath: string) => Promise<DesktopInvokeResult>;
  writeInstructionFile: (relativePath: string, content: string) => Promise<DesktopInvokeResult>;
  listExternalMcpServers: () => Promise<DesktopInvokeResult>;
  addExternalMcpServer: (
    server: import('../src/shared/desktopContract').ExternalMcpServerEntry,
  ) => Promise<DesktopInvokeResult>;
  updateExternalMcpServer: (
    server: import('../src/shared/desktopContract').ExternalMcpServerEntry,
  ) => Promise<DesktopInvokeResult>;
  removeExternalMcpServer: (serverId: string) => Promise<DesktopInvokeResult>;
  toggleExternalMcpServer: (serverId: string) => Promise<DesktopInvokeResult>;
  validateExternalMcpConnection: (
    payload: import('../src/shared/desktopContract').ExternalMcpValidateConnectionRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  validateExternalMcpLocalCommand: (
    payload: import('../src/shared/desktopContract').ExternalMcpValidateLocalCommandRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  readTaskBoard: () => Promise<DesktopInvokeResult>;
  readTaskContent: (
    fileName: string,
    column: import('../src/shared/desktopContract').TaskBoardContentColumn,
    artifactRelativePath?: string,
  ) => Promise<DesktopInvokeResult>;
  readChildChainBranchInventory: (
    taskId: string,
    expectedRootTaskId?: string | null,
  ) => Promise<DesktopInvokeResult>;
  reorderPending: (order: string[]) => Promise<DesktopInvokeResult>;
  requeueErrorItem: (fileName: string, insertAtIndex: number) => Promise<DesktopInvokeResult>;
  deleteTask: (fileName: string, column: TaskBoardDeleteColumn) => Promise<DesktopInvokeResult>;
  moveToPending: (fileName: string, insertAtIndex: number) => Promise<DesktopInvokeResult>;
  moveToOpen: (fileName: string, sourceColumn?: 'error' | 'pending') => Promise<DesktopInvokeResult>;
  killTask: (fileName: string, taskId: string) => Promise<DesktopInvokeResult>;
  retryKillCleanup: (fileName: string, taskId: string) => Promise<DesktopInvokeResult>;
  readTaskNotifications?: () => Promise<DesktopInvokeResult>;
  markTaskNotificationsSeen?: (
    payload: import('../src/shared/desktopContract').TaskNotificationsMarkSeenRequest['payload'],
  ) => Promise<DesktopInvokeResult>;
  dismissTaskNotification?: (notificationId: string) => Promise<DesktopInvokeResult>;
  dismissAllTaskNotifications?: () => Promise<DesktopInvokeResult>;
  getBackendServiceStatus: () => Promise<DesktopInvokeResult>;
  startBackendServices: () => Promise<DesktopInvokeResult>;
  stopBackendServices: () => Promise<DesktopInvokeResult>;
  checkBackendHealth: () => Promise<DesktopInvokeResult>;
  saveDeepFocusSelections: (
    contextPackDir: string,
    selections: ContextPackDeepFocusState,
  ) => Promise<DesktopInvokeResult>;
  loadDeepFocusSelections: (contextPackDir: string) => Promise<DesktopInvokeResult>;
  clearDeepFocusSelections: (contextPackDir: string) => Promise<DesktopInvokeResult>;
  listFocusFilters: (contextPackDir: string) => Promise<DesktopInvokeResult>;
  createFocusFilter: (
    contextPackDir: string,
    name: string,
    selection: ContextPackFocusFilterSelection,
  ) => Promise<DesktopInvokeResult>;
  deleteFocusFilter: (contextPackDir: string, filterId: string) => Promise<DesktopInvokeResult>;
  loadContextPackSidebarState: () => Promise<DesktopInvokeResult>;
  saveContextPackSidebarState: (
    selectedContextPackDir: string | null,
    selection: ContextPackFocusFilterSelection | null,
  ) => Promise<DesktopInvokeResult>;
  cancelTask: (taskId: string) => Promise<DesktopInvokeResult>;
  onStreamEvent: (
    callback: (event: import('../src/renderer/activityStream').StreamEvent) => void,
  ) => () => void;
  onPlannerEvent: (
    callback: (event: PlannerStreamEvent) => void,
  ) => () => void;
  onTaskBoardUpdate: (
    callback: (board: import('../src/shared/desktopContract').TaskBoardReadBoardResponse) => void,
  ) => () => void;
  onTaskNotificationsUpdate?: (
    callback: (event: TaskNotificationEvent) => void,
  ) => () => void;
  subscribeContextPackCatalogChanged: (
    callback: (event: ContextPackCatalogChangedEvent) => void,
  ) => () => void;
};

export type DesktopAllowedResponses =
  | PlannerSubmitResponse
  | PlannerStartSessionResponse
  | PlannerSendMessageResponse
  | PlannerEndSessionResponse
  | PlannerSaveDraftResponse
  | PlannerReadStagedDraftResponse
  | PlannerFinalizeSpecResponse
  | PlannerListConversationHistoryResponse
  | PlannerHydrateConversationResponse
  | QueueStatusResponse
  | EnvironmentStatusResponse
  | ObservabilitySnapshotResponse
  | FollowUpResponse
  | ContextPackPickDirectoryResponse
  | ContextPackDiscoverPrefillResponse
  | ContextPackCreateResponse
  | ContextPackListResponse
  | ContextPackReseedResponse
  | ContextPackPreviewResponse
  | ContextPackApplyResponse
  | ContextPackClearResponse
  | ContextPackActivationResponse
  | PlannerPickMarkdownFileResponse
  | PlannerListArchivedTasksResponse
  | ReinforcementSubmitFeedbackResponse
  | ReinforcementUpdateRealignmentDocResponse
  | ReinforcementReadOverviewResponse
  | ReinforcementListTasksResponse
  | ReinforcementReadAgentRewardsResponse
  | ReinforcementListRealignmentSessionsResponse
  | ReinforcementReadRealignmentDocResponse
  | ReinforcementCheckActiveWorkGuardResponse
  | ReinforcementStartRealignmentResponse
  | ReinforcementRunRealignmentAnalysisResponse
  | ReinforcementDismissRealignmentResponse
  | AgentConfigLoadAgentsResponse
  | AgentConfigLoadModelCatalogResponse
  | AgentConfigLoadCapabilitiesResponse
  | AgentConfigSaveAgentModelsResponse
  | AgentConfigAddModelResponse
  | AgentConfigRemoveModelResponse
  | AgentConfigListExtensionsResponse
  | AgentConfigAddExtensionResponse
  | AgentConfigReseedExtensionResponse
  | AgentConfigDeleteExtensionResponse
  | AgentConfigLoadExtensionAssignmentsResponse
  | AgentConfigSaveExtensionAssignmentsResponse
  | AgentInstructionsListFilesResponse
  | AgentInstructionsReadFileResponse
  | AgentInstructionsWriteFileResponse
  | TaskBoardReadBoardResponse
  | TaskBoardReadTaskContentResponse
  | TaskBoardReadChildChainBranchInventoryResponse
  | TaskBoardReorderPendingResponse
  | TaskBoardRequeueErrorItemResponse
  | TaskBoardDeleteTaskResponse
  | TaskBoardMoveToPendingResponse
  | TaskBoardMoveToOpenResponse
  | TaskNotificationSnapshot
  | TaskNotificationMutationResponse
  | ServicesReadStatusResponse;

export function exposeDesktopShell(): void {
  contextBridge.exposeInMainWorld('desktopShell', desktopShellApi);
}

exposeDesktopShell();
