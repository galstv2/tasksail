type DesktopShellClient = Pick<
  Window['desktopShell'],
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
  | 'listArchivedTasks'
  | 'listExternalMcpServers'
  | 'addExternalMcpServer'
  | 'updateExternalMcpServer'
  | 'removeExternalMcpServer'
  | 'toggleExternalMcpServer'
  | 'validateExternalMcpConnection'
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
>;

type DesktopShellGetter = () => DesktopShellClient;

export function createDesktopShellClient(
  getDesktopShell: DesktopShellGetter = () => window.desktopShell,
): DesktopShellClient {
  return {
    getBootstrapInfo: () => getDesktopShell().getBootstrapInfo(),
    getQueueStatus: () => getDesktopShell().getQueueStatus(),
    deletePendingItem: (queueName) => getDesktopShell().deletePendingItem(queueName),
    getEnvironmentStatus: () => getDesktopShell().getEnvironmentStatus(),
    getObservabilitySnapshot: () => getDesktopShell().getObservabilitySnapshot(),
    submitPlannerDraft: (draft, stage) => getDesktopShell().submitPlannerDraft(draft, stage),
    initiateFollowUp: (draft, stage) => getDesktopShell().initiateFollowUp(draft, stage),
    pickContextPackDirectory: (purpose, defaultPath) =>
      getDesktopShell().pickContextPackDirectory(purpose, defaultPath),
    discoverContextPackPrefill: (rootPath, mode) =>
      getDesktopShell().discoverContextPackPrefill(rootPath, mode),
    createContextPack: (payload) => getDesktopShell().createContextPack(payload),
    listContextPacks: () => getDesktopShell().listContextPacks(),
    reseedContextPack: (contextPackDir) =>
      getDesktopShell().reseedContextPack(contextPackDir),
    setRepositoryType: (contextPackDir, repoId, repositoryType) =>
      getDesktopShell().setRepositoryType(contextPackDir, repoId, repositoryType),
    previewContextPackSwitch: (
      contextPackDir,
      scopeMode,
      selectedRepoIds,
      selectedFocusIds,
    ) =>
      getDesktopShell().previewContextPackSwitch(
        contextPackDir,
        scopeMode,
        selectedRepoIds,
        selectedFocusIds,
      ),
    applyContextPackSwitch: (
      contextPackDir,
      scopeMode,
      selectedRepoIds,
      selectedFocusIds,
    ) =>
      getDesktopShell().applyContextPackSwitch(
        contextPackDir,
        scopeMode,
        selectedRepoIds,
        selectedFocusIds,
      ),
    clearActiveContextPack: () => getDesktopShell().clearActiveContextPack(),
    activateContextPack: (packId) => getDesktopShell().activateContextPack(packId),
    startPlannerSession: (contextPackDir) => getDesktopShell().startPlannerSession(contextPackDir),
    sendPlannerMessage: (text) => getDesktopShell().sendPlannerMessage(text),
    endPlannerSession: () => getDesktopShell().endPlannerSession(),
    savePlannerDraft: () => getDesktopShell().savePlannerDraft(),
    readStagedDraft: () => getDesktopShell().readStagedDraft(),
    finalizeSpec: (expectedTaskKind) => getDesktopShell().finalizeSpec(expectedTaskKind),
    pickMarkdownFile: () => getDesktopShell().pickMarkdownFile(),
    listArchivedTasks: () => getDesktopShell().listArchivedTasks(),
    listExternalMcpServers: () => getDesktopShell().listExternalMcpServers(),
    addExternalMcpServer: (server) => getDesktopShell().addExternalMcpServer(server),
    updateExternalMcpServer: (server) => getDesktopShell().updateExternalMcpServer(server),
    removeExternalMcpServer: (serverId) => getDesktopShell().removeExternalMcpServer(serverId),
    toggleExternalMcpServer: (serverId) => getDesktopShell().toggleExternalMcpServer(serverId),
    validateExternalMcpConnection: (payload) => getDesktopShell().validateExternalMcpConnection(payload),
    submitReinforcementFeedback: (payload) => getDesktopShell().submitReinforcementFeedback(payload),
    updateRealignmentDoc: (payload) => getDesktopShell().updateRealignmentDoc(payload),
    readReinforcementOverview: () => getDesktopShell().readReinforcementOverview(),
    listReinforcementTasks: (year) => getDesktopShell().listReinforcementTasks(year),
    readAgentRewards: () => getDesktopShell().readAgentRewards(),
    listRealignmentSessions: () => getDesktopShell().listRealignmentSessions(),
    readRealignmentDoc: () => getDesktopShell().readRealignmentDoc(),
    checkActiveWorkGuard: () => getDesktopShell().checkActiveWorkGuard(),
    startRealignment: (payload) => getDesktopShell().startRealignment(payload),
    readTaskBoard: () => getDesktopShell().readTaskBoard(),
    readTaskContent: (fileName, column) => getDesktopShell().readTaskContent(fileName, column),
    reorderPending: (order) => getDesktopShell().reorderPending(order),
    requeueErrorItem: (fileName, insertAtIndex) =>
      getDesktopShell().requeueErrorItem(fileName, insertAtIndex),
    deleteTask: (fileName, column) => getDesktopShell().deleteTask(fileName, column),
    moveToPending: (fileName, insertAtIndex) =>
      getDesktopShell().moveToPending(fileName, insertAtIndex),
    moveToOpen: (fileName) => getDesktopShell().moveToOpen(fileName),
    getBackendServiceStatus: () => getDesktopShell().getBackendServiceStatus(),
    startBackendServices: () => getDesktopShell().startBackendServices(),
    stopBackendServices: () => getDesktopShell().stopBackendServices(),
    checkBackendHealth: () => getDesktopShell().checkBackendHealth(),
  };
}

export const desktopShellClient = createDesktopShellClient();

export type { DesktopShellClient };
