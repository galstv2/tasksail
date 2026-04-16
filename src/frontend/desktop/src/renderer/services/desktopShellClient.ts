type DesktopShellSource = Window['desktopShell'] & {
  loadAgentConfig: () => Promise<unknown>;
  loadModelCatalog: () => Promise<unknown>;
  saveAgentModels: (
    assignments: Array<{ agent_id: string; model_id: string }>,
  ) => Promise<unknown>;
  addModel: (displayName: string, modelId: string) => Promise<unknown>;
  removeModel: (modelId: string) => Promise<unknown>;
  listInstructionFiles: (directory: import('../../shared/desktopContract').InstructionDirectory) => Promise<unknown>;
  readInstructionFile: (relativePath: string) => Promise<unknown>;
  writeInstructionFile: (relativePath: string, content: string) => Promise<unknown>;
};

type DirectPlannerDraft = import('../../shared/desktopContract').PlannerDirectSubmissionDraft;
type DirectFollowUpDraft = import('../../shared/desktopContract').FollowUpDirectSubmissionDraft;
type ComposerStage = import('../../shared/desktopContract').ComposerStage;

type DesktopShellClient = Pick<
  DesktopShellSource,
  | 'getBootstrapInfo'
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
  | 'previewContextPackSwitch'
  | 'applyContextPackSwitch'
  | 'clearActiveContextPack'
  | 'activateContextPack'
  | 'startPlannerSession'
  | 'sendPlannerMessage'
  | 'endPlannerSession'
  | 'savePlannerDraft'
  | 'readStagedDraft'
  | 'finalizeSpec'
  | 'pickMarkdownFile'
  | 'uploadSpec'
  | 'getBypassTemplate'
  | 'listArchivedTasks'
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
  | 'readTaskBoard'
  | 'readTaskContent'
  | 'reorderPending'
  | 'requeueErrorItem'
  | 'deleteTask'
  | 'moveToPending'
  | 'moveToOpen'
  | 'getBackendServiceStatus'
  | 'startBackendServices'
  | 'stopBackendServices'
  | 'checkBackendHealth'
  | 'saveDeepFocusSelections'
  | 'loadDeepFocusSelections'
  | 'clearDeepFocusSelections'
>;

type DesktopShellGetter = () => DesktopShellSource | Window['desktopShell'];

export function createDesktopShellClient(
  getDesktopShell: DesktopShellGetter = () => window.desktopShell as unknown as DesktopShellSource,
): DesktopShellClient {
  const readShell = (): DesktopShellClient => getDesktopShell() as DesktopShellClient;

  return {
    getBootstrapInfo: () => readShell().getBootstrapInfo(),
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
    startPlannerSession: (contextPackDir) => readShell().startPlannerSession(contextPackDir),
    sendPlannerMessage: (text) => readShell().sendPlannerMessage(text),
    endPlannerSession: () => readShell().endPlannerSession(),
    savePlannerDraft: () => readShell().savePlannerDraft(),
    readStagedDraft: () => readShell().readStagedDraft(),
    finalizeSpec: (expectedTaskKind) => readShell().finalizeSpec(expectedTaskKind),
    pickMarkdownFile: () => readShell().pickMarkdownFile(),
    uploadSpec: (content: string) => readShell().uploadSpec(content),
    getBypassTemplate: () => readShell().getBypassTemplate(),
    listArchivedTasks: () => readShell().listArchivedTasks(),
    listExternalMcpServers: () => readShell().listExternalMcpServers(),
    addExternalMcpServer: (server) => readShell().addExternalMcpServer(server),
    updateExternalMcpServer: (server) => readShell().updateExternalMcpServer(server),
    removeExternalMcpServer: (serverId) => readShell().removeExternalMcpServer(serverId),
    toggleExternalMcpServer: (serverId) => readShell().toggleExternalMcpServer(serverId),
    validateExternalMcpConnection: (payload) => readShell().validateExternalMcpConnection(payload),
    loadAgentConfig: () => readShell().loadAgentConfig(),
    loadModelCatalog: () => readShell().loadModelCatalog(),
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
    readTaskBoard: () => readShell().readTaskBoard(),
    readTaskContent: (fileName, column) => readShell().readTaskContent(fileName, column),
    reorderPending: (order) => readShell().reorderPending(order),
    requeueErrorItem: (fileName, insertAtIndex) =>
      readShell().requeueErrorItem(fileName, insertAtIndex),
    deleteTask: (fileName, column) => readShell().deleteTask(fileName, column),
    moveToPending: (fileName, insertAtIndex) =>
      readShell().moveToPending(fileName, insertAtIndex),
    moveToOpen: (fileName) => readShell().moveToOpen(fileName),
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
  };
}

export const desktopShellClient = createDesktopShellClient();

export type { DesktopShellClient };
