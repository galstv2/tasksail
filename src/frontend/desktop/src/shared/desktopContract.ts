export const DESKTOP_SHELL_INVOKE_CHANNEL = 'desktop-shell:invoke';
export const DESKTOP_SHELL_STREAM_CHANNEL = 'desktop-shell:stream';
export const DESKTOP_SHELL_TASK_BOARD_CHANNEL = 'desktop-shell:task-board';

export * from './desktopContractPlanner';
export * from './desktopContractDeepFocus';
export * from './desktopContractContextPack';

import type {
  ContextPackListRepoTreeRequest,
  ContextPackListRepoTreeResponse,
  DeepFocusSaveSelectionsRequest,
  DeepFocusSaveSelectionsResponse,
  DeepFocusLoadSelectionsRequest,
  DeepFocusLoadSelectionsResponse,
  DeepFocusClearSelectionsRequest,
  DeepFocusClearSelectionsResponse,
} from './desktopContractDeepFocus';
import type {
  ContextPackActivationRequest,
  ContextPackActivationResponse,
  ContextPackApplyRequest,
  ContextPackApplyResponse,
  ContextPackClearRequest,
  ContextPackClearResponse,
  ContextPackCreateRequest,
  ContextPackCreateResponse,
  ContextPackDiscoverPrefillRequest,
  ContextPackDiscoverPrefillResponse,
  ContextPackListRequest,
  ContextPackListResponse,
  ContextPackPickDirectoryRequest,
  ContextPackPickDirectoryResponse,
  ContextPackPreviewRequest,
  ContextPackPreviewResponse,
  ContextPackReseedRequest,
  ContextPackReseedResponse,
  ContextPackSetRepositoryTypeRequest,
  ContextPackSetRepositoryTypeResponse,
  ContextPackSwitchExecutionResult,
} from './desktopContractContextPack';

import type {
  ArchivedTaskEntry,
  FollowUpRequest,
  FollowUpResponse,
  PlannerBrokerObservation,
  PlannerEndSessionRequest,
  PlannerEndSessionResponse,
  PlannerFinalizeSpecRequest,
  PlannerFinalizeSpecResponse,
  PlannerListArchivedTasksRequest,
  PlannerListArchivedTasksResponse,
  PlannerPickMarkdownFileRequest,
  PlannerPickMarkdownFileResponse,
  PlannerReadStagedDraftRequest,
  PlannerReadStagedDraftResponse,
  PlannerSaveDraftRequest,
  PlannerSaveDraftResponse,
  PlannerSendMessageRequest,
  PlannerSendMessageResponse,
  PlannerStartSessionRequest,
  PlannerStartSessionResponse,
  PlannerSubmitRequest,
  PlannerSubmitResponse,
  QueueDeletePendingItemRequest,
  QueueDeletePendingItemResponse,
  QueueStatusRequest,
} from './desktopContractPlanner';

export type DesktopActionName =
  | 'planner.submitDraft'
  | 'planner.startSession'
  | 'planner.sendMessage'
  | 'planner.endSession'
  | 'planner.saveDraft'
  | 'planner.readStagedDraft'
  | 'planner.finalizeSpec'
  | 'queue.readStatus'
  | 'queue.deletePendingItem'
  | 'environment.readStatus'
  | 'observability.readSnapshot'
  | 'followup.begin'
  | 'contextPack.pickDirectory'
  | 'contextPack.discoverPrefill'
  | 'contextPack.create'
  | 'contextPack.list'
  | 'contextPack.listRepoTree'
  | 'contextPack.reseed'
  | 'contextPack.previewSwitch'
  | 'contextPack.applySwitch'
  | 'contextPack.clearActive'
  | 'contextPack.activate'
  | 'contextPack.setRepositoryType'
  | 'planner.pickMarkdownFile'
  | 'planner.listArchivedTasks'
  | 'reinforcement.submitFeedback'
  | 'reinforcement.updateRealignmentDoc'
  | 'reinforcement.checkActiveWorkGuard'
  | 'reinforcement.startRealignment'
  | 'externalMcp.list'
  | 'externalMcp.add'
  | 'externalMcp.update'
  | 'externalMcp.remove'
  | 'externalMcp.toggleEnabled'
  | 'externalMcp.validateConnection'
  | 'agentConfig.loadAgents'
  | 'agentConfig.loadModelCatalog'
  | 'agentConfig.saveAgentModels'
  | 'agentConfig.addModel'
  | 'agentConfig.removeModel'
  | 'agentInstructions.listFiles'
  | 'agentInstructions.readFile'
  | 'agentInstructions.writeFile'
  | 'taskBoard.readBoard'
  | 'taskBoard.readTaskContent'
  | 'taskBoard.reorderPending'
  | 'taskBoard.requeueErrorItem'
  | 'taskBoard.deleteTask'
  | 'taskBoard.moveToPending'
  | 'taskBoard.moveToOpen'
  | 'services.readStatus'
  | 'services.startBackend'
  | 'services.stopBackend'
  | 'services.healthCheck'
  | 'deepFocus.saveSelections'
  | 'deepFocus.loadSelections'
  | 'deepFocus.clearSelections';

export type QueueStatusResponse = {
  action: 'queue.readStatus';
  mode: 'dry-run' | 'observed';
  queueDepth: number;
  pendingReviewCount: number;
  activeTaskId: string | null;
  operatorStatus?: OperatorStatus;
  errorItemsCount?: number;
  message: string;
};

export type OperatorStatus = 'OPEN' | 'RUNNING' | 'PENDING';

export type PendingQueueItem = {
  queueName: string;
  taskId: string | null;
  title: string | null;
  state: 'active' | 'pending';
  canDelete: boolean;
};

export type ArtifactReference = {
  label: string;
  path: string;
  kind: 'file' | 'directory';
  status: 'present' | 'empty' | 'missing';
  detail: string;
};

export type LifecycleState = 'queued' | 'active' | 'blocked' | 'complete' | 'idle';

export type WorkflowLifecycleEntry = {
  state: LifecycleState;
  observed: boolean;
  detail: string;
};

export type TaskLifecycleFeed = {
  taskId: string | null;
  taskTitle: string | null;
  taskKind: string | null;
  workflowStage: LifecycleState;
  activePath: string | null;
  parallelizationEnabled: boolean;
  startedAt: string | null;
  lastUpdatedAt: string | null;
  sourceArtifact: string | null;
  taskHealth?: TaskHealthRollup;
  guardrailSummary?: GuardrailSummary;
  recoveryState?: TaskRecoveryState | null;
};

export type TaskRecoveryKind =
  | 'activation-timeout'
  | 'runtime-failure'
  | 'queue-repair'
  | 'queue-divergence';

export type TaskRecoveryStatus =
  | 'pending-start'
  | 'recovery-needed'
  | 'repaired'
  | 'auto-failed';

export type TaskRecoveryState = {
  kind: TaskRecoveryKind;
  status: TaskRecoveryStatus;
  summary: string;
  queueName: string | null;
  taskId: string | null;
  activationStartedAt: string | null;
  deadlineAt: string | null;
  detectedAt: string;
  updatedAt: string;
  errorItemPath: string | null;
};

export type TaskHealthRollup = {
  status: 'idle' | 'healthy' | 'attention' | 'critical';
  summary: string;
  observedSessionCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  suspectedStuckCount: number;
  orphanedCount: number;
  aliveCount: number;
  missingPidCount: number;
  unknownPidCount: number;
};

export type GuardrailViolation = {
  receiptPath: string | null;
  ruleId: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  remediation: string | null;
};

export type GuardrailStatus =
  | 'allowed'
  | 'denied'
  | 'internal-bypass'
  | 'malformed';

export type GuardrailObservation = {
  receiptPath: string;
  sessionId: string | null;
  agentId: string;
  agentLabel: string;
  instanceId: string | null;
  status: GuardrailStatus;
  severity: 'info' | 'warning' | 'error';
  summary: string;
  validatorMode: string | null;
  launchSeam: string | null;
  expectedAgentId: string | null;
  requiredModel: string | null;
  activeModel: string | null;
  violationCount: number;
  violations: GuardrailViolation[];
};

export type GuardrailSummary = {
  status: 'idle' | 'healthy' | 'attention' | 'critical';
  summary: string;
  observedReceiptCount: number;
  allowedCount: number;
  deniedCount: number;
  internalBypassCount: number;
  malformedCount: number;
  violationCount: number;
};

export type AgentTerminalSession = {
  taskId: string | null;
  agentId: string;
  agentLabel: string;
  sessionId: string;
  instanceId: string | null;
  launchPid: number | null;
  liveness: 'alive' | 'not-found' | 'unknown';
  stuckState: 'none' | 'suspected-stuck' | 'orphaned';
  stuckReason: string | null;
  sliceId: string | null;
  slicePath: string | null;
  launchState: 'queued' | 'started' | 'completed' | 'failed' | 'dry-run' | 'skipped' | 'unknown';
  terminalState: 'pending' | 'running' | 'completed' | 'failed' | 'unknown';
  lastUpdatedAt: string | null;
  latestOutputLines: string[];
  stdoutLogPath: string | null;
  stderrLogPath: string | null;
  severity: 'info' | 'success' | 'warning' | 'error';
  guardrailStatus?: GuardrailStatus;
  guardrailSeverity?: 'info' | 'warning' | 'error';
  guardrailReason?: string | null;
  guardrailReceiptPath?: string | null;
  guardrailViolationCount?: number;
};

export type EnvironmentHelperStatus = {
  label: string;
  path: string;
  available: boolean;
  detail: string;
};

export type EnvironmentStatusRequest = {
  action: 'environment.readStatus';
  payload?: undefined;
};

export type EnvironmentStatusResponse = {
  action: 'environment.readStatus';
  mode: 'read-only';
  message: string;
  platform: NodeJS.Platform;
  repoRoot: string;
  packageOutputDir: string;
  packageArtifactName: string;
  packageCommand: string;
  hostMode: 'repo-root-native';
  validationSummary: string;
  launchPolicy: string;
  helperStatuses: EnvironmentHelperStatus[];
  contextPackCommand: string;
  contextPackWritePlanHint: string;
  bootstrapFlowHint: string;
};

export type ObservabilitySnapshotRequest = {
  action: 'observability.readSnapshot';
  payload?: undefined;
};

export type ObservabilitySnapshotResponse = {
  action: 'observability.readSnapshot';
  mode: 'read-only';
  message: string;
  queueDepth: number;
  pendingReviewCount: number;
  activeTaskId: string | null;
  activeTaskTitle: string | null;
  currentState: LifecycleState;
  operatorStatus?: OperatorStatus;
  pendingQueueItems?: PendingQueueItem[];
  errorItemsCount?: number;
  activeTask?: TaskLifecycleFeed | null;
  agentTerminalSessions?: AgentTerminalSession[];
  guardrailSummary?: GuardrailSummary;
  guardrails?: GuardrailObservation[];
  recoveryState?: TaskRecoveryState | null;
  plannerBroker?: PlannerBrokerObservation | null;
  lifecycle: WorkflowLifecycleEntry[];
  artifactReferences: ArtifactReference[];
  policyBoundary: string;
};

export type ReinforcementSubmitFeedbackRequest = {
  action: 'reinforcement.submitFeedback';
  payload: {
    contextPackDir: string;
    taskId: string;
    feedbackType: 'none' | 'positive' | 'negative';
    starRating?: number;
    comment?: string;
  };
};

export type ReinforcementSubmitFeedbackResponse = {
  action: 'reinforcement.submitFeedback';
  mode: 'submitted';
  passed: boolean;
  message: string;
  data?: Record<string, unknown>;
};

export type ReinforcementUpdateRealignmentDocRequest = {
  action: 'reinforcement.updateRealignmentDoc';
  payload:
    | { contextPackDir: string; field: string; value: string }
    | { contextPackDir: string; updates: Record<string, unknown> };
};

export type ReinforcementUpdateRealignmentDocResponse = {
  action: 'reinforcement.updateRealignmentDoc';
  mode: 'updated';
  passed: boolean;
  message: string;
  data?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Reinforcement read-side actions
// ---------------------------------------------------------------------------

export type ReinforcementTaskEntry = {
  taskId: string;
  title: string;
  difficulty: string;
  effectiveReward: number;
  settlementStatus: 'unrewarded' | 'rewarded';
  qualityOutcome: string;
  year: string;
};

export type ReinforcementAgentRewardEntry = {
  agentId: string;
  role: string;
  multiplier: number;
  lifetimeReward: number;
  unrewardedTaskCount: number;
  unrewardedRewardTotal: number;
};

export type ReinforcementOverviewData = {
  totalTasks: number;
  totalReward: number;
  unrewardedCount: number;
  streakProgress: number;
  streakThreshold: number;
  lastSettlementId: string | null;
  agents: ReinforcementAgentRewardEntry[];
};

export type ReinforcementSettlementEntry = {
  settlementId: string;
  trigger: string;
  tasksIncluded: string[];
  perAgentRewards: Record<string, number>;
  settledAt: string;
};

export type ReinforcementRealignmentSessionEntry = {
  realignmentId: string;
  triggerTaskId: string;
  triggerFeedbackId: string;
  participatingAgents: string[];
  failureAnalysis: string;
  rootCause: string;
  correctiveActions: string[];
  status: string;
  meetingNotes: string;
  createdAt: string;
};

export type ReinforcementGlobalDocData = {
  standingExpectations: string[];
  behavioralGuidance?: string[];
  lessonsLearned?: string[];
  fairnessFraming?: string[];
  version: number;
  updatedAt: string;
};

export type ReinforcementReadOverviewRequest = {
  action: 'reinforcement.readOverview';
  payload?: undefined;
};

export type ReinforcementReadOverviewResponse = {
  action: 'reinforcement.readOverview';
  mode: 'read-only';
  message: string;
  overview: ReinforcementOverviewData;
};

export type ReinforcementListTasksRequest = {
  action: 'reinforcement.listTasks';
  payload?: { year?: string };
};

export type ReinforcementListTasksResponse = {
  action: 'reinforcement.listTasks';
  mode: 'read-only';
  message: string;
  tasks: ReinforcementTaskEntry[];
  availableYears: string[];
};

export type ReinforcementReadAgentRewardsRequest = {
  action: 'reinforcement.readAgentRewards';
  payload?: undefined;
};

export type ReinforcementReadAgentRewardsResponse = {
  action: 'reinforcement.readAgentRewards';
  mode: 'read-only';
  message: string;
  agents: ReinforcementAgentRewardEntry[];
};

export type ReinforcementListRealignmentSessionsRequest = {
  action: 'reinforcement.listRealignmentSessions';
  payload?: undefined;
};

export type ReinforcementListRealignmentSessionsResponse = {
  action: 'reinforcement.listRealignmentSessions';
  mode: 'read-only';
  message: string;
  sessions: ReinforcementRealignmentSessionEntry[];
};

export type ReinforcementReadRealignmentDocRequest = {
  action: 'reinforcement.readRealignmentDoc';
  payload?: undefined;
};

export type ReinforcementReadRealignmentDocResponse = {
  action: 'reinforcement.readRealignmentDoc';
  mode: 'read-only';
  message: string;
  document: ReinforcementGlobalDocData;
};

export type ReinforcementCheckActiveWorkGuardRequest = {
  action: 'reinforcement.checkActiveWorkGuard';
  payload?: undefined;
};

export type ReinforcementCheckActiveWorkGuardResponse = {
  action: 'reinforcement.checkActiveWorkGuard';
  mode: 'guard-check';
  allowed: boolean;
  message: string;
  activeTaskId: string | null;
  hasUnprocessedFeedback: boolean;
};

export type ReinforcementStartRealignmentRequest = {
  action: 'reinforcement.startRealignment';
  payload: {
    contextPackDir: string;
    triggerTaskId: string;
  };
};

export type ReinforcementStartRealignmentResponse = {
  action: 'reinforcement.startRealignment';
  mode: 'started';
  message: string;
  session: ReinforcementRealignmentSessionEntry;
};

// ---------------------------------------------------------------------------
// External MCP server management
// ---------------------------------------------------------------------------

export type ExternalMcpServerEntry = {
  id: string;
  display_name: string;
  purpose: string;
  preferred_for?: string[];
  fallback_description?: string;
  enabled: boolean;
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  agent_scope: {
    mode: 'allowlist';
    agent_ids: string[];
  };
};

export type ExternalMcpListRequest = {
  action: 'externalMcp.list';
  payload?: undefined;
};

export type ExternalMcpListResponse = {
  action: 'externalMcp.list';
  mode: 'read-only';
  message: string;
  servers: ExternalMcpServerEntry[];
};

export type ExternalMcpAddRequest = {
  action: 'externalMcp.add';
  payload: { server: ExternalMcpServerEntry };
};

export type ExternalMcpAddResponse = {
  action: 'externalMcp.add';
  mode: 'mutated';
  message: string;
  servers: ExternalMcpServerEntry[];
};

export type ExternalMcpUpdateRequest = {
  action: 'externalMcp.update';
  payload: { server: ExternalMcpServerEntry };
};

export type ExternalMcpUpdateResponse = {
  action: 'externalMcp.update';
  mode: 'mutated';
  message: string;
  servers: ExternalMcpServerEntry[];
};

export type ExternalMcpRemoveRequest = {
  action: 'externalMcp.remove';
  payload: { serverId: string };
};

export type ExternalMcpRemoveResponse = {
  action: 'externalMcp.remove';
  mode: 'mutated';
  message: string;
  servers: ExternalMcpServerEntry[];
};

export type ExternalMcpToggleEnabledRequest = {
  action: 'externalMcp.toggleEnabled';
  payload: { serverId: string };
};

export type ExternalMcpToggleEnabledResponse = {
  action: 'externalMcp.toggleEnabled';
  mode: 'mutated';
  message: string;
  servers: ExternalMcpServerEntry[];
};

export type ExternalMcpValidateConnectionRequest = {
  action: 'externalMcp.validateConnection';
  payload: {
    transport: 'http' | 'sse';
    url: string;
    headers?: Record<string, string>;
  };
};

export type ExternalMcpValidateConnectionResponse = {
  action: 'externalMcp.validateConnection';
  mode: 'validated';
  success: boolean;
  message: string;
  toolCount?: number;
};

// ---------------------------------------------------------------------------
// Agent configuration (types in desktopContractAgentConfig.ts)
// ---------------------------------------------------------------------------

import type {
  AgentConfigLoadAgentsRequest,
  AgentConfigLoadAgentsResponse,
  AgentConfigLoadModelCatalogRequest,
  AgentConfigLoadModelCatalogResponse,
  AgentConfigSaveAgentModelsRequest,
  AgentConfigSaveAgentModelsResponse,
  AgentConfigAddModelRequest,
  AgentConfigAddModelResponse,
  AgentConfigRemoveModelRequest,
  AgentConfigRemoveModelResponse,
} from './desktopContractAgentConfig';

export type {
  AgentConfigAgentEntry,
  AgentConfigModelCatalogEntry,
  AgentConfigLoadAgentsRequest,
  AgentConfigLoadAgentsResponse,
  AgentConfigLoadModelCatalogRequest,
  AgentConfigLoadModelCatalogResponse,
  AgentConfigSaveAgentModelsRequest,
  AgentConfigSaveAgentModelsResponse,
  AgentConfigAddModelRequest,
  AgentConfigAddModelResponse,
  AgentConfigRemoveModelRequest,
  AgentConfigRemoveModelResponse,
} from './desktopContractAgentConfig';

export type { InstructionFileEntry, InstructionDirectory } from './desktopContractAgentInstructions';
import type { AgentInstructionsListFilesRequest, AgentInstructionsListFilesResponse, AgentInstructionsReadFileRequest, AgentInstructionsReadFileResponse, AgentInstructionsWriteFileRequest, AgentInstructionsWriteFileResponse } from './desktopContractAgentInstructions';
export type { AgentInstructionsListFilesRequest, AgentInstructionsListFilesResponse, AgentInstructionsReadFileRequest, AgentInstructionsReadFileResponse, AgentInstructionsWriteFileRequest, AgentInstructionsWriteFileResponse };

// ---------------------------------------------------------------------------
// Task Board actions
// ---------------------------------------------------------------------------

export type TaskBoardItem = {
  fileName: string;
  taskId: string | null;
  title: string | null;
};

export type TaskBoardReadBoardRequest = {
  action: 'taskBoard.readBoard';
  payload?: undefined;
};

export type TaskBoardReadBoardResponse = {
  action: 'taskBoard.readBoard';
  mode: 'read-only';
  message: string;
  dropboxItems: TaskBoardItem[];
  pendingItems: (TaskBoardItem & { state: 'active' | 'pending' })[];
  errorItems: TaskBoardItem[];
  completedItems: ArchivedTaskEntry[];
};

export type TaskBoardContentColumn = 'open' | 'pending' | 'error' | 'completed';

export type TaskBoardReadTaskContentRequest = {
  action: 'taskBoard.readTaskContent';
  payload: {
    fileName: string;
    column: TaskBoardContentColumn;
  };
};

export type TaskBoardReadTaskContentResponse = {
  action: 'taskBoard.readTaskContent';
  mode: 'found' | 'not-found';
  message: string;
  content: string;
  fileName: string;
};

export type TaskBoardReorderPendingRequest = {
  action: 'taskBoard.reorderPending';
  payload: {
    order: string[];
  };
};

export type TaskBoardReorderPendingResponse = {
  action: 'taskBoard.reorderPending';
  mode: 'reordered';
  message: string;
};

export type TaskBoardRequeueErrorItemRequest = {
  action: 'taskBoard.requeueErrorItem';
  payload: {
    fileName: string;
    insertAtIndex: number;
  };
};

export type TaskBoardRequeueErrorItemResponse = {
  action: 'taskBoard.requeueErrorItem';
  mode: 'requeued';
  message: string;
  requeuedItem: string;
  activatedItem: string | null;
};

export type TaskBoardDeleteColumn = 'open' | 'pending' | 'error';

export type TaskBoardDeleteTaskRequest = {
  action: 'taskBoard.deleteTask';
  payload: {
    fileName: string;
    column: TaskBoardDeleteColumn;
  };
};

export type TaskBoardDeleteTaskResponse = {
  action: 'taskBoard.deleteTask';
  mode: 'deleted';
  message: string;
  fileName: string;
  column: TaskBoardDeleteColumn;
};

export type TaskBoardMoveToPendingRequest = {
  action: 'taskBoard.moveToPending';
  payload: {
    fileName: string;
    insertAtIndex: number;
  };
};

export type TaskBoardMoveToPendingResponse = {
  action: 'taskBoard.moveToPending';
  mode: 'moved';
  message: string;
  movedItem: string;
  activatedItem?: string | null;
};

export type TaskBoardMoveToOpenRequest = {
  action: 'taskBoard.moveToOpen';
  payload: { fileName: string };
};

export type TaskBoardMoveToOpenResponse = {
  action: 'taskBoard.moveToOpen';
  mode: 'moved';
  message: string;
  movedItem: string;
};

export type DesktopActionRequest =
  | PlannerSubmitRequest
  | PlannerStartSessionRequest
  | PlannerSendMessageRequest
  | PlannerEndSessionRequest
  | PlannerSaveDraftRequest
  | PlannerReadStagedDraftRequest
  | PlannerFinalizeSpecRequest
  | QueueStatusRequest
  | QueueDeletePendingItemRequest
  | EnvironmentStatusRequest
  | ObservabilitySnapshotRequest
  | FollowUpRequest
  | ContextPackPickDirectoryRequest
  | ContextPackDiscoverPrefillRequest
  | ContextPackCreateRequest
  | ContextPackListRequest
  | ContextPackListRepoTreeRequest
  | ContextPackReseedRequest
  | ContextPackPreviewRequest
  | ContextPackApplyRequest
  | ContextPackClearRequest
  | ContextPackActivationRequest
  | ContextPackSetRepositoryTypeRequest
  | PlannerPickMarkdownFileRequest
  | PlannerListArchivedTasksRequest
  | ReinforcementSubmitFeedbackRequest
  | ReinforcementUpdateRealignmentDocRequest
  | ReinforcementReadOverviewRequest
  | ReinforcementListTasksRequest
  | ReinforcementReadAgentRewardsRequest
  | ReinforcementListRealignmentSessionsRequest
  | ReinforcementReadRealignmentDocRequest
  | ReinforcementCheckActiveWorkGuardRequest
  | ReinforcementStartRealignmentRequest
  | ExternalMcpListRequest
  | AgentConfigLoadAgentsRequest
  | AgentConfigLoadModelCatalogRequest
  | AgentConfigSaveAgentModelsRequest
  | AgentConfigAddModelRequest
  | AgentConfigRemoveModelRequest
  | AgentInstructionsListFilesRequest
  | AgentInstructionsReadFileRequest
  | AgentInstructionsWriteFileRequest
  | ExternalMcpAddRequest
  | ExternalMcpUpdateRequest
  | ExternalMcpRemoveRequest
  | ExternalMcpToggleEnabledRequest
  | ExternalMcpValidateConnectionRequest
  | TaskBoardReadBoardRequest
  | TaskBoardReadTaskContentRequest
  | TaskBoardReorderPendingRequest
  | TaskBoardRequeueErrorItemRequest
  | TaskBoardDeleteTaskRequest
  | TaskBoardMoveToPendingRequest
  | TaskBoardMoveToOpenRequest
  | ServicesReadStatusRequest
  | ServicesStartBackendRequest
  | ServicesStopBackendRequest
  | ServicesHealthCheckRequest
  | DeepFocusSaveSelectionsRequest
  | DeepFocusLoadSelectionsRequest
  | DeepFocusClearSelectionsRequest;

export type DesktopActionResponse =
  | PlannerSubmitResponse
  | PlannerStartSessionResponse
  | PlannerSendMessageResponse
  | PlannerEndSessionResponse
  | PlannerSaveDraftResponse
  | PlannerReadStagedDraftResponse
  | PlannerFinalizeSpecResponse
  | QueueStatusResponse
  | QueueDeletePendingItemResponse
  | EnvironmentStatusResponse
  | ObservabilitySnapshotResponse
  | FollowUpResponse
  | ContextPackPickDirectoryResponse
  | ContextPackDiscoverPrefillResponse
  | ContextPackCreateResponse
  | ContextPackListResponse
  | ContextPackListRepoTreeResponse
  | ContextPackReseedResponse
  | ContextPackPreviewResponse
  | ContextPackApplyResponse
  | ContextPackClearResponse
  | ContextPackActivationResponse
  | ContextPackSetRepositoryTypeResponse
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
  | ExternalMcpListResponse
  | AgentConfigLoadAgentsResponse
  | AgentConfigLoadModelCatalogResponse
  | AgentConfigSaveAgentModelsResponse
  | AgentConfigAddModelResponse
  | AgentConfigRemoveModelResponse
  | AgentInstructionsListFilesResponse
  | AgentInstructionsReadFileResponse
  | AgentInstructionsWriteFileResponse
  | ExternalMcpAddResponse
  | ExternalMcpUpdateResponse
  | ExternalMcpRemoveResponse
  | ExternalMcpToggleEnabledResponse
  | ExternalMcpValidateConnectionResponse
  | TaskBoardReadBoardResponse
  | TaskBoardReadTaskContentResponse
  | TaskBoardReorderPendingResponse
  | TaskBoardRequeueErrorItemResponse
  | TaskBoardDeleteTaskResponse
  | TaskBoardMoveToPendingResponse
  | TaskBoardMoveToOpenResponse
  | ServicesReadStatusResponse
  | DeepFocusSaveSelectionsResponse
  | DeepFocusLoadSelectionsResponse
  | DeepFocusClearSelectionsResponse;

// ---------------------------------------------------------------------------
// Services (backend MCP container service management)
// ---------------------------------------------------------------------------
export type BackendServiceStatus =
  | 'idle'
  | 'starting'
  | 'healthy'
  | 'unhealthy'
  | 'unavailable'
  | 'stopping';

export type ServicesReadStatusRequest = {
  action: 'services.readStatus';
  payload?: undefined;
};

export type ServicesStartBackendRequest = {
  action: 'services.startBackend';
  payload?: undefined;
};

export type ServicesStopBackendRequest = {
  action: 'services.stopBackend';
  payload?: undefined;
};

export type ServicesHealthCheckRequest = {
  action: 'services.healthCheck';
  payload?: undefined;
};

export type ServicesReadStatusResponse = {
  action: 'services.readStatus';
  mode: 'observed';
  status: BackendServiceStatus;
  lastCheckedAt: string | null;
  error: string | null;
  message: string;
};

export const ERROR_CODE_VERSION_CONFLICT = 'version_conflict' as const;
export const ERROR_CODE_ACTIVE_WORK_BLOCKED = 'active_work_blocked' as const;

export type DesktopActionError = {
  ok: false;
  error: string;
  action?: string;
  errorCode?: string;
  details?: string[];
  contextPackResult?: ContextPackSwitchExecutionResult;
};

export type DesktopInvokeResult =
  | {
      ok: true;
      response: DesktopActionResponse;
    }
  | DesktopActionError;
