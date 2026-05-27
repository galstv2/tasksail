type DesktopShellSource = Window['desktopShell'] & {
  loadAgentConfig: () => Promise<unknown>;
  loadModelCatalog: () => Promise<unknown>;
  loadCapabilities?: () => Promise<import('../../shared/desktopContract').DesktopInvokeResult>;
  saveAgentModels: (
    assignments: Array<{ agent_id: string; model_id: string; reasoning_effort?: string }>,
  ) => Promise<unknown>;
  addModel: (displayName: string, modelId: string) => Promise<unknown>;
  removeModel: (modelId: string) => Promise<unknown>;
  describeActiveProvider: () => Promise<import('../../shared/desktopContract').ProviderFrontendDescriptor>;
  listInstructionFiles: (directory: import('../../shared/desktopContract').InstructionDirectory) => Promise<unknown>;
  readInstructionFile: (relativePath: string) => Promise<unknown>;
  writeInstructionFile: (relativePath: string, content: string) => Promise<unknown>;
  subscribeContextPackCatalogChanged: (
    listener: (event: import('../../shared/desktopContract').ContextPackCatalogChangedEvent) => void,
  ) => () => void;
};

type DirectPlannerDraft = import('../../shared/desktopContract').PlannerDirectSubmissionDraft;
type PlannerStartSessionPayload = import('../../shared/desktopContract').PlannerStartSessionPayload;
type PlannerReadParentContextBundlePayload = import('../../shared/desktopContract').PlannerReadParentContextBundleRequest['payload'];
type PlannerReadParentChainArchiveBundlePayload = import('../../shared/desktopContract').PlannerReadParentChainArchiveBundleRequest['payload'];
type PlannerReadParentArchiveMarkdownPayload = import('../../shared/desktopContract').PlannerReadParentArchiveMarkdownRequest['payload'];
type DirectFollowUpDraft = import('../../shared/desktopContract').FollowUpDirectSubmissionDraft;
type ComposerStage = import('../../shared/desktopContract').ComposerStage;
type TaskNotificationsMarkSeenPayload = import('../../shared/desktopContract').TaskNotificationsMarkSeenRequest['payload'];

type DesktopShellBaseClient = Pick<
  DesktopShellSource,
  | 'getBootstrapInfo'
  | 'describeActiveProvider'
  | 'getQueueStatus'
  | 'deletePendingItem'
  | 'getEnvironmentStatus'
  | 'getObservabilitySnapshot'
  | 'submitPlannerDraft'
  | 'initiateFollowUp'
  | 'pickContextPackDirectory'
  | 'discoverContextPackPrefill'
  | 'createContextPack'
  | 'listContextPacks'
  | 'listRepoTree'
  | 'reseedContextPack'
  | 'setRepositoryType'
  | 'setRepoCategory'
  | 'previewContextPackSwitch'
  | 'applyContextPackSwitch'
  | 'clearActiveContextPack'
  | 'activateContextPack'
  | 'startPlannerSession'
  | 'updatePlannerSessionPersonality'
  | 'validateChildTaskFocus'
  | 'sendPlannerMessage'
  | 'endPlannerSession'
  | 'savePlannerDraft'
  | 'readStagedDraft'
  | 'finalizeSpec'
  | 'pickMarkdownFile'
  | 'uploadSpec'
  | 'getBypassTemplate'
  | 'listArchivedTasks'
  | 'readParentContextBundle'
  | 'readParentChainArchiveBundle'
  | 'readParentArchiveMarkdown'
  | 'listPlannerConversationHistory'
  | 'hydratePlannerConversation'
  | 'listExternalMcpServers'
  | 'addExternalMcpServer'
  | 'updateExternalMcpServer'
  | 'removeExternalMcpServer'
  | 'toggleExternalMcpServer'
  | 'validateExternalMcpConnection'
  | 'loadAgentConfig'
  | 'loadModelCatalog'
  | 'saveAgentModels'
  | 'addModel'
  | 'removeModel'
  | 'listInstructionFiles'
  | 'readInstructionFile'
  | 'writeInstructionFile'
  | 'submitReinforcementFeedback'
  | 'updateRealignmentDoc'
  | 'readReinforcementOverview'
  | 'listReinforcementTasks'
  | 'readAgentRewards'
  | 'listRealignmentSessions'
  | 'readRealignmentDoc'
  | 'checkActiveWorkGuard'
  | 'startRealignment'
  | 'runRealignmentAnalysis'
  | 'dismissRealignment'
  | 'readTaskBoard'
  | 'readTaskContent'
  | 'reorderPending'
  | 'requeueErrorItem'
  | 'deleteTask'
  | 'moveToPending'
  | 'moveToOpen'
  | 'killTask'
  | 'retryKillCleanup'
  | 'getBackendServiceStatus'
  | 'startBackendServices'
  | 'stopBackendServices'
  | 'checkBackendHealth'
  | 'saveDeepFocusSelections'
  | 'loadDeepFocusSelections'
  | 'clearDeepFocusSelections'
  | 'listFocusFilters'
  | 'createFocusFilter'
  | 'deleteFocusFilter'
  | 'loadContextPackSidebarState'
  | 'saveContextPackSidebarState'
  | 'deleteContextPack'
  | 'subscribeContextPackCatalogChanged'
>;

type DesktopShellTaskNotificationsClient = {
  readTaskNotifications: () => Promise<import('../../shared/desktopContract').DesktopInvokeResult>;
  markTaskNotificationsSeen: (
    payload: TaskNotificationsMarkSeenPayload,
  ) => Promise<import('../../shared/desktopContract').DesktopInvokeResult>;
  dismissTaskNotification: (
    notificationId: string,
  ) => Promise<import('../../shared/desktopContract').DesktopInvokeResult>;
  dismissAllTaskNotifications: () => Promise<import('../../shared/desktopContract').DesktopInvokeResult>;
  onTaskNotificationsUpdate: (
    listener: (event: import('../../shared/desktopContract').TaskNotificationEvent) => void,
  ) => () => void;
};

type DesktopShellCapabilitiesClient = {
  loadCapabilities: () => Promise<import('../../shared/desktopContract').DesktopInvokeResult>;
};

type DesktopShellClient = DesktopShellBaseClient & Partial<DesktopShellCapabilitiesClient> & Partial<DesktopShellTaskNotificationsClient>;
type DesktopShellRuntimeClient = DesktopShellBaseClient & DesktopShellCapabilitiesClient & DesktopShellTaskNotificationsClient;

type DesktopShellGetter = () => DesktopShellSource | Window['desktopShell'];

export function createDesktopShellClient(
  getDesktopShell: DesktopShellGetter = () => window.desktopShell as unknown as DesktopShellSource,
): DesktopShellRuntimeClient {
  const readShell = (): DesktopShellRuntimeClient =>
    getDesktopShell() as DesktopShellRuntimeClient;

  return {
    getBootstrapInfo: () => readShell().getBootstrapInfo(),
    describeActiveProvider: () => readShell().describeActiveProvider(),
    getQueueStatus: () => readShell().getQueueStatus(),
    deletePendingItem: (queueName) => readShell().deletePendingItem(queueName),
    getEnvironmentStatus: () => readShell().getEnvironmentStatus(),
    getObservabilitySnapshot: () => readShell().getObservabilitySnapshot(),
    submitPlannerDraft: (draft: DirectPlannerDraft, stage: ComposerStage) =>
      readShell().submitPlannerDraft(draft, stage),
    initiateFollowUp: (draft: DirectFollowUpDraft, stage: ComposerStage) =>
      readShell().initiateFollowUp(draft, stage),
    pickContextPackDirectory: (purpose, defaultPath) =>
      readShell().pickContextPackDirectory(purpose, defaultPath),
    discoverContextPackPrefill: (rootPath, mode) =>
      readShell().discoverContextPackPrefill(rootPath, mode),
    createContextPack: (payload) => readShell().createContextPack(payload),
    listContextPacks: () => readShell().listContextPacks(),
    listRepoTree: (repoLocalPath: string, relativePath?: string) =>
      readShell().listRepoTree(repoLocalPath, relativePath),
    reseedContextPack: (contextPackDir) =>
      readShell().reseedContextPack(contextPackDir),
    setRepositoryType: (contextPackDir, repoId, repositoryType) =>
      readShell().setRepositoryType(contextPackDir, repoId, repositoryType),
    setRepoCategory: (contextPackDir, repoId, repoCategory) =>
      readShell().setRepoCategory(contextPackDir, repoId, repoCategory),
    previewContextPackSwitch: (
      contextPackDir,
      scopeMode,
      selectedRepoIds,
      selectedFocusIds,
      deepFocusSelection,
    ) =>
      readShell().previewContextPackSwitch(
        contextPackDir,
        scopeMode,
        selectedRepoIds,
        selectedFocusIds,
        deepFocusSelection,
      ),
    applyContextPackSwitch: (
      contextPackDir,
      scopeMode,
      selectedRepoIds,
      selectedFocusIds,
      deepFocusSelection,
    ) =>
      readShell().applyContextPackSwitch(
        contextPackDir,
        scopeMode,
        selectedRepoIds,
        selectedFocusIds,
        deepFocusSelection,
      ),
    clearActiveContextPack: () => readShell().clearActiveContextPack(),
    activateContextPack: (packId) => readShell().activateContextPack(packId),
    startPlannerSession: (payload?: PlannerStartSessionPayload) =>
      readShell().startPlannerSession(payload),
    updatePlannerSessionPersonality: (payload) =>
      readShell().updatePlannerSessionPersonality(payload),
    validateChildTaskFocus: (payload) =>
      readShell().validateChildTaskFocus(payload),
    sendPlannerMessage: (text, displayText) =>
      readShell().sendPlannerMessage(text, displayText),
    endPlannerSession: () => readShell().endPlannerSession(),
    savePlannerDraft: () => readShell().savePlannerDraft(),
    readStagedDraft: () => readShell().readStagedDraft(),
    finalizeSpec: (expectedTaskKind) => readShell().finalizeSpec(expectedTaskKind),
    pickMarkdownFile: () => readShell().pickMarkdownFile(),
    uploadSpec: (content, options) => readShell().uploadSpec(content, options),
    getBypassTemplate: () => readShell().getBypassTemplate(),
    listArchivedTasks: () => readShell().listArchivedTasks(),
    readParentContextBundle: (payload: PlannerReadParentContextBundlePayload) =>
      readShell().readParentContextBundle(payload),
    readParentChainArchiveBundle: (payload: PlannerReadParentChainArchiveBundlePayload) =>
      readShell().readParentChainArchiveBundle(payload),
    readParentArchiveMarkdown: (payload: PlannerReadParentArchiveMarkdownPayload) =>
      readShell().readParentArchiveMarkdown(payload),
    listPlannerConversationHistory: () =>
      readShell().listPlannerConversationHistory(),
    hydratePlannerConversation: (recordId) =>
      readShell().hydratePlannerConversation(recordId),
    listExternalMcpServers: () => readShell().listExternalMcpServers(),
    addExternalMcpServer: (server) => readShell().addExternalMcpServer(server),
    updateExternalMcpServer: (server) => readShell().updateExternalMcpServer(server),
    removeExternalMcpServer: (serverId) => readShell().removeExternalMcpServer(serverId),
    toggleExternalMcpServer: (serverId) => readShell().toggleExternalMcpServer(serverId),
    validateExternalMcpConnection: (payload) => readShell().validateExternalMcpConnection(payload),
    loadAgentConfig: () => readShell().loadAgentConfig(),
    loadModelCatalog: () => readShell().loadModelCatalog(),
    loadCapabilities: () => {
      const shell = readShell();
      if (!shell.loadCapabilities) {
        return Promise.reject(new Error('agentConfig.loadCapabilities is not available.'));
      }
      return shell.loadCapabilities();
    },
    saveAgentModels: (assignments) => readShell().saveAgentModels(assignments),
    addModel: (displayName, modelId) => readShell().addModel(displayName, modelId),
    removeModel: (modelId) => readShell().removeModel(modelId),
    listInstructionFiles: (directory) => readShell().listInstructionFiles(directory),
    readInstructionFile: (relativePath) => readShell().readInstructionFile(relativePath),
    writeInstructionFile: (relativePath, content) => readShell().writeInstructionFile(relativePath, content),
    submitReinforcementFeedback: (payload) => readShell().submitReinforcementFeedback(payload),
    updateRealignmentDoc: (payload) => readShell().updateRealignmentDoc(payload),
    readReinforcementOverview: () => readShell().readReinforcementOverview(),
    listReinforcementTasks: (year) => readShell().listReinforcementTasks(year),
    readAgentRewards: () => readShell().readAgentRewards(),
    listRealignmentSessions: () => readShell().listRealignmentSessions(),
    readRealignmentDoc: () => readShell().readRealignmentDoc(),
    checkActiveWorkGuard: () => readShell().checkActiveWorkGuard(),
    startRealignment: (payload) => readShell().startRealignment(payload),
    runRealignmentAnalysis: (payload) => readShell().runRealignmentAnalysis(payload),
    dismissRealignment: (payload) => readShell().dismissRealignment(payload),
    readTaskBoard: () => readShell().readTaskBoard(),
    readTaskContent: (fileName, column) => readShell().readTaskContent(fileName, column),
    reorderPending: (order) => readShell().reorderPending(order),
    requeueErrorItem: (fileName, insertAtIndex) =>
      readShell().requeueErrorItem(fileName, insertAtIndex),
    deleteTask: (fileName, column) => readShell().deleteTask(fileName, column),
    moveToPending: (fileName, insertAtIndex) =>
      readShell().moveToPending(fileName, insertAtIndex),
    moveToOpen: (fileName, sourceColumn) => readShell().moveToOpen(fileName, sourceColumn),
    killTask: (fileName, taskId) => readShell().killTask(fileName, taskId),
    retryKillCleanup: (fileName, taskId) => readShell().retryKillCleanup(fileName, taskId),
    readTaskNotifications: () => readShell().readTaskNotifications(),
    markTaskNotificationsSeen: (payload: TaskNotificationsMarkSeenPayload) =>
      readShell().markTaskNotificationsSeen(payload),
    dismissTaskNotification: (notificationId) =>
      readShell().dismissTaskNotification(notificationId),
    dismissAllTaskNotifications: () => readShell().dismissAllTaskNotifications(),
    getBackendServiceStatus: () => readShell().getBackendServiceStatus(),
    startBackendServices: () => readShell().startBackendServices(),
    stopBackendServices: () => readShell().stopBackendServices(),
    checkBackendHealth: () => readShell().checkBackendHealth(),
    saveDeepFocusSelections: (contextPackDir, selections) =>
      readShell().saveDeepFocusSelections(contextPackDir, selections),
    loadDeepFocusSelections: (contextPackDir) =>
      readShell().loadDeepFocusSelections(contextPackDir),
    clearDeepFocusSelections: (contextPackDir) =>
      readShell().clearDeepFocusSelections(contextPackDir),
    listFocusFilters: (contextPackDir) =>
      readShell().listFocusFilters(contextPackDir),
    createFocusFilter: (contextPackDir, name, selection) =>
      readShell().createFocusFilter(contextPackDir, name, selection),
    deleteFocusFilter: (contextPackDir, filterId) =>
      readShell().deleteFocusFilter(contextPackDir, filterId),
    loadContextPackSidebarState: () =>
      readShell().loadContextPackSidebarState(),
    saveContextPackSidebarState: (selectedContextPackDir, selection) =>
      readShell().saveContextPackSidebarState(selectedContextPackDir, selection),
    deleteContextPack: (contextPackDir) =>
      readShell().deleteContextPack(contextPackDir),
    onTaskNotificationsUpdate: (listener) =>
      readShell().onTaskNotificationsUpdate(listener),
    subscribeContextPackCatalogChanged: (listener) =>
      readShell().subscribeContextPackCatalogChanged(listener),
  };
}

export const desktopShellClient = createDesktopShellClient();

export type { DesktopShellClient };
