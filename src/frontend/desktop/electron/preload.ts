import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL,
  DESKTOP_SHELL_INVOKE_CHANNEL,
  DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
  DESKTOP_SHELL_STREAM_CHANNEL,
  DESKTOP_SHELL_TASK_BOARD_CHANNEL,
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
  type AgentConfigAddModelResponse,
  type AgentConfigLoadAgentsResponse,
  type AgentConfigLoadModelCatalogResponse,
  type AgentConfigRemoveModelResponse,
  type AgentConfigSaveAgentModelsRequest,
  type AgentConfigSaveAgentModelsResponse,
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
  type PlannerStreamEvent,
  type QueueStatusResponse,
  type TaskBoardReadBoardResponse,
  type TaskBoardReadTaskContentResponse,
  type TaskBoardReorderPendingResponse,
  type TaskBoardDeleteColumn,
  type TaskBoardDeleteTaskResponse,
  type TaskBoardMoveToPendingResponse,
  type TaskBoardMoveToOpenResponse,
  type TaskBoardRequeueErrorItemResponse,
  type ServicesReadStatusResponse,
  type WorkspaceScopeMode,
  type PlannerDirectSubmissionDraft,
  type FollowUpDirectSubmissionDraft,
  type ContextPackDeepFocusState,
} from '../src/shared/desktopContract';
import { isRecord } from '../src/shared/desktopContractValidators';

const isDev = process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL);

export const bootstrapInfo = {
  appName: 'TaskSail',
  platform: process.platform,
  versions: {
    chrome: isDev ? process.versions.chrome : undefined,
    electron: isDev ? process.versions.electron : undefined,
    node: process.versions.node,
  },
};

export const desktopShellApi = {
  getBootstrapInfo: async () => bootstrapInfo,
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
  startPlannerSession: async (contextPackDir?: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.startSession',
      ...(contextPackDir ? { payload: { contextPackDir } } : {}),
    }),
  sendPlannerMessage: async (text: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.sendMessage',
      payload: { text },
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
  uploadSpec: async (content: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.uploadSpec',
      payload: { content },
    }),
  getBypassTemplate: async (): Promise<string> =>
    ipcRenderer.invoke(DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL),
  listArchivedTasks: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.listArchivedTasks',
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
  loadAgentConfig: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.loadAgents',
    }),
  loadModelCatalog: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.loadModelCatalog',
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
  readTaskBoard: async (): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readBoard',
    }),
  readTaskContent: async (
    fileName: string,
    column: import('../src/shared/desktopContract').TaskBoardContentColumn,
  ): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readTaskContent',
      payload: { fileName, column },
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
  moveToOpen: async (fileName: string): Promise<DesktopInvokeResult> =>
    ipcRenderer.invoke(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.moveToOpen',
      payload: { fileName },
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
        console.warn('Dropped malformed stream event:', data);
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
        typeof plannerEvent.brokerStatus === 'string'
      ) {
        callback(plannerEvent as PlannerStreamEvent);
      } else {
        console.warn('Dropped malformed planner event:', plannerEvent);
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
      }
    };
    ipcRenderer.on(DESKTOP_SHELL_TASK_BOARD_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DESKTOP_SHELL_TASK_BOARD_CHANNEL, handler);
  },
};

export type DesktopShellApi = {
  getBootstrapInfo: () => Promise<typeof bootstrapInfo>;
  submitPlannerDraft: (
    draft: PlannerDirectSubmissionDraft,
    stage: 'compose' | 'preview' | 'confirm',
  ) => Promise<DesktopInvokeResult>;
  getQueueStatus: () => Promise<DesktopInvokeResult>;
  deletePendingItem: (queueName: string) => Promise<DesktopInvokeResult>;
  getEnvironmentStatus: () => Promise<DesktopInvokeResult>;
  getObservabilitySnapshot: () => Promise<DesktopInvokeResult>;
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
  startPlannerSession: (contextPackDir?: string) => Promise<DesktopInvokeResult>;
  sendPlannerMessage: (text: string) => Promise<DesktopInvokeResult>;
  endPlannerSession: () => Promise<DesktopInvokeResult>;
  savePlannerDraft: () => Promise<DesktopInvokeResult>;
  readStagedDraft: () => Promise<DesktopInvokeResult>;
  finalizeSpec: (expectedTaskKind?: 'standard' | 'child-task') => Promise<DesktopInvokeResult>;
  pickMarkdownFile: () => Promise<DesktopInvokeResult>;
  uploadSpec: (content: string) => Promise<DesktopInvokeResult>;
  getBypassTemplate: () => Promise<string>;
  listArchivedTasks: () => Promise<DesktopInvokeResult>;
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
  loadAgentConfig: () => Promise<DesktopInvokeResult>;
  loadModelCatalog: () => Promise<DesktopInvokeResult>;
  saveAgentModels: (
    assignments: AgentConfigSaveAgentModelsRequest['payload']['assignments'],
  ) => Promise<DesktopInvokeResult>;
  addModel: (display_name: string, model_id: string) => Promise<DesktopInvokeResult>;
  removeModel: (model_id: string) => Promise<DesktopInvokeResult>;
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
  readTaskBoard: () => Promise<DesktopInvokeResult>;
  readTaskContent: (
    fileName: string,
    column: import('../src/shared/desktopContract').TaskBoardContentColumn,
  ) => Promise<DesktopInvokeResult>;
  reorderPending: (order: string[]) => Promise<DesktopInvokeResult>;
  requeueErrorItem: (fileName: string, insertAtIndex: number) => Promise<DesktopInvokeResult>;
  deleteTask: (fileName: string, column: TaskBoardDeleteColumn) => Promise<DesktopInvokeResult>;
  moveToPending: (fileName: string, insertAtIndex: number) => Promise<DesktopInvokeResult>;
  moveToOpen: (fileName: string) => Promise<DesktopInvokeResult>;
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
  onStreamEvent: (
    callback: (event: import('../src/renderer/activityStream').StreamEvent) => void,
  ) => () => void;
  onPlannerEvent: (
    callback: (event: PlannerStreamEvent) => void,
  ) => () => void;
  onTaskBoardUpdate: (
    callback: (board: import('../src/shared/desktopContract').TaskBoardReadBoardResponse) => void,
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
  | AgentConfigLoadAgentsResponse
  | AgentConfigLoadModelCatalogResponse
  | AgentConfigSaveAgentModelsResponse
  | AgentConfigAddModelResponse
  | AgentConfigRemoveModelResponse
  | AgentInstructionsListFilesResponse
  | AgentInstructionsReadFileResponse
  | AgentInstructionsWriteFileResponse
  | TaskBoardReadBoardResponse
  | TaskBoardReadTaskContentResponse
  | TaskBoardReorderPendingResponse
  | TaskBoardRequeueErrorItemResponse
  | TaskBoardDeleteTaskResponse
  | TaskBoardMoveToPendingResponse
  | TaskBoardMoveToOpenResponse
  | ServicesReadStatusResponse;

export function exposeDesktopShell(): void {
  contextBridge.exposeInMainWorld('desktopShell', desktopShellApi);
}

exposeDesktopShell();
