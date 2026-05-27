export const DESKTOP_SHELL_INVOKE_CHANNEL = 'desktop-shell:invoke';
export const DESKTOP_SHELL_STREAM_CHANNEL = 'desktop-shell:stream';
export const DESKTOP_SHELL_TASK_BOARD_CHANNEL = 'desktop-shell:task-board';
export const DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL = 'desktop-shell:task-notifications';
export const CONTEXT_PACK_CATALOG_CHANGED_CHANNEL = 'contextPack.catalogChanged';

export type ContextPackCatalogChangedEvent = {
  changedRoot: string;
  reason: 'mkdir' | 'rmdir' | 'rename' | 'unknown';
};

export * from './desktopContractPlanner';
export * from './desktopContractDeepFocus';
export * from './desktopContractContextPack';
export * from './desktopContractProvider';
export * from './desktopContractTaskNotifications';

import type {
  ContextPackListRepoTreeRequest,
  ContextPackListRepoTreeResponse,
  DeepFocusSaveSelectionsRequest,
  DeepFocusSaveSelectionsResponse,
  DeepFocusLoadSelectionsRequest,
  DeepFocusLoadSelectionsResponse,
  DeepFocusClearSelectionsRequest,
  DeepFocusClearSelectionsResponse,
  FocusFiltersListRequest,
  FocusFiltersListResponse,
  FocusFiltersCreateRequest,
  FocusFiltersCreateResponse,
  FocusFiltersDeleteRequest,
  FocusFiltersDeleteResponse,
  ContextPackSidebarStateLoadRequest,
  ContextPackSidebarStateLoadResponse,
  ContextPackSidebarStateSaveRequest,
  ContextPackSidebarStateSaveResponse,
} from './desktopContractDeepFocus';
import type {
  ContextPackActivationRequest,
  ContextPackActivationResponse,
  ContextPackApplyRequest,
  ContextPackApplyResponse,
  ContextPackClearRequest,
  ContextPackClearResponse,
  ContextPackDeleteRequest,
  ContextPackDeleteResponse,
  ContextPackCreateRequest,
  ContextPackCreateResponse,
  ContextPackPreflightError,
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
  ContextPackSetRepoCategoryRequest,
  ContextPackSetRepoCategoryResponse,
  ContextPackSwitchExecutionResult,
} from './desktopContractContextPack';
import type {
  TaskNotificationMutationResponse,
  TaskNotificationSnapshot,
  TaskNotificationsDismissAllRequest,
  TaskNotificationsDismissRequest,
  TaskNotificationsMarkSeenRequest,
  TaskNotificationsReadRequest,
} from './desktopContractTaskNotifications';

import type {
  ArchivedTaskEntry,
  FollowUpRequest,
  FollowUpResponse,
  PlannerBrokerObservation,
  PlannerEndSessionRequest,
  PlannerEndSessionResponse,
  PlannerFinalizeSpecRequest,
  PlannerFinalizeSpecResponse,
  PlannerHydrateConversationRequest,
  PlannerHydrateConversationResponse,
  PlannerListArchivedTasksRequest,
  PlannerListArchivedTasksResponse,
  PlannerListConversationHistoryRequest,
  PlannerListConversationHistoryResponse,
  PlannerReadParentContextBundleRequest,
  PlannerReadParentContextBundleResponse,
  PlannerReadParentChainArchiveBundleRequest,
  PlannerReadParentChainArchiveBundleResponse,
  PlannerReadParentArchiveMarkdownRequest,
  PlannerReadParentArchiveMarkdownResponse,
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
  PlannerUpdateSessionPersonalityRequest,
  PlannerUpdateSessionPersonalityResponse,
  PlannerValidateChildTaskFocusRequest,
  PlannerValidateChildTaskFocusResponse,
  PlannerUploadSpecRequest,
  PlannerUploadSpecResponse,
  QueueDeletePendingItemRequest,
  QueueDeletePendingItemResponse,
  QueueStatusRequest,
} from './desktopContractPlanner';

export const DESKTOP_ACTION_NAMES = [
  'planner.submitDraft',
  'planner.startSession',
  'planner.updateSessionPersonality',
  'planner.validateChildTaskFocus',
  'planner.sendMessage',
  'planner.endSession',
  'planner.saveDraft',
  'planner.readStagedDraft',
  'planner.finalizeSpec',
  'queue.readStatus',
  'queue.deletePendingItem',
  'environment.readStatus',
  'observability.readSnapshot',
  'followup.begin',
  'contextPack.pickDirectory',
  'contextPack.discoverPrefill',
  'contextPack.create',
  'contextPack.list',
  'contextPack.listRepoTree',
  'contextPack.reseed',
  'contextPack.previewSwitch',
  'contextPack.applySwitch',
  'contextPack.clearActive',
  'contextPack.delete',
  'contextPack.activate',
  'contextPack.setRepositoryType',
  'contextPack.setRepoCategory',
  'planner.pickMarkdownFile',
  'planner.listArchivedTasks',
  'planner.readParentContextBundle',
  'planner.readParentChainArchiveBundle',
  'planner.readParentArchiveMarkdown',
  'planner.listConversationHistory',
  'planner.hydrateConversation',
  'planner.uploadSpec',
  'reinforcement.submitFeedback',
  'reinforcement.updateRealignmentDoc',
  'reinforcement.readOverview',
  'reinforcement.listTasks',
  'reinforcement.readAgentRewards',
  'reinforcement.listRealignmentSessions',
  'reinforcement.readRealignmentDoc',
  'reinforcement.checkActiveWorkGuard',
  'reinforcement.startRealignment',
  'reinforcement.runRealignmentAnalysis',
  'reinforcement.dismissRealignment',
  'externalMcp.list',
  'externalMcp.add',
  'externalMcp.update',
  'externalMcp.remove',
  'externalMcp.toggleEnabled',
  'externalMcp.validateConnection',
  'agentConfig.loadAgents',
  'agentConfig.loadModelCatalog',
  'agentConfig.loadCapabilities',
  'agentConfig.saveAgentModels',
  'agentConfig.addModel',
  'agentConfig.removeModel',
  'agentInstructions.listFiles',
  'agentInstructions.readFile',
  'agentInstructions.writeFile',
  'taskBoard.readBoard',
  'taskBoard.readTaskContent',
  'taskBoard.reorderPending',
  'taskBoard.requeueErrorItem',
  'taskBoard.deleteTask',
  'taskBoard.moveToPending',
  'taskBoard.moveToOpen',
  'taskBoard.killTask',
  'taskBoard.retryKillCleanup',
  'taskNotifications.read',
  'taskNotifications.markSeen',
  'taskNotifications.dismiss',
  'taskNotifications.dismissAll',
  'services.readStatus',
  'services.startBackend',
  'services.stopBackend',
  'services.healthCheck',
  'deepFocus.saveSelections',
  'deepFocus.loadSelections',
  'deepFocus.clearSelections',
  'focusFilters.list',
  'focusFilters.create',
  'focusFilters.delete',
  'contextPackSidebarState.load',
  'contextPackSidebarState.save',
  'terminal.setTaskScope',
  'cancel-task',
] as const;

export type DesktopActionName = (typeof DESKTOP_ACTION_NAMES)[number];

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

/**
 * §5.5 OperatorStatus shape change (F28 — §0.3 amendment).
 * Exception to "No frontend/IPC contract changes": this type changes from a string enum
 * to { activeTasks: Array<{ taskId, phase, startedAt }> } carrying a back-compat
 * activeTaskId scalar. All renderer consumers are updated in the same PR (§5.5).
 * activeTaskId and activeTaskTitle scalar back-compat fields are preserved in
 * ObservabilitySnapshotResponse.
 */
export type OperatorStatus = {
  /** Array of currently active tasks. Empty when no tasks are active. */
  activeTasks: Array<{ taskId: string; phase: string; startedAt: string }>;
  /**
   * F39 back-compat scalar: derived as activeTasks[0]?.taskId ?? null.
   * Preserved so useAppShell.ts:176 and taskObservationModel.ts can read it
   * without switching to activeTasks[0].
   */
  activeTaskId: string | null;
};

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
  /** @deprecated back-compat scalar — use activeTasks[0]?.taskId ?? null */
  activeTaskId: string | null;
  /** @deprecated back-compat scalar — use activeTasks[0]?.taskTitle ?? null */
  activeTaskTitle: string | null;
  currentState: LifecycleState;
  operatorStatus?: OperatorStatus;
  pendingQueueItems?: PendingQueueItem[];
  errorItemsCount?: number;
  /** Array of currently active task lifecycle feeds. Empty when no tasks are active. */
  activeTasks?: TaskLifecycleFeed[];
  /** @deprecated back-compat alias — use activeTasks[0] ?? null */
  activeTask?: TaskLifecycleFeed | null;
  agentTerminalSessions?: AgentTerminalSession[];
  guardrailSummary?: GuardrailSummary;
  guardrails?: GuardrailObservation[];
  recoveryState?: TaskRecoveryState | null;
  plannerBroker?: PlannerBrokerObservation | null;
  lifecycle: WorkflowLifecycleEntry[];
  artifactReferences: Array<ArtifactReference & { taskId?: string | null }>;
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
  reviewStatus?: 'unreviewed' | 'reviewed';
  feedbackCount?: number;
  archivePath?: string;
  archiveMarkdown?: string;
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

export type RealignmentJobStartResult = {
  jobId: string;
  realignmentId: string;
  status: 'started' | 'already-running' | 'failed';
  reason?: string;
};

export type ReinforcementRunRealignmentAnalysisRequest = {
  action: 'reinforcement.runRealignmentAnalysis';
  payload: {
    contextPackDir: string;
    realignmentId: string;
  };
};

export type ReinforcementRunRealignmentAnalysisResponse = {
  action: 'reinforcement.runRealignmentAnalysis';
  mode: 'analysis-started' | 'analysis-start-failed';
  message: string;
  job: RealignmentJobStartResult;
};

export type ReinforcementDismissRealignmentRequest = {
  action: 'reinforcement.dismissRealignment';
  payload: {
    contextPackDir: string;
    realignmentId: string;
  };
};

export type ReinforcementDismissRealignmentResponse = {
  action: 'reinforcement.dismissRealignment';
  mode: 'dismissed';
  message: string;
  realignmentId: string;
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
  AgentConfigLoadCapabilitiesRequest,
  AgentConfigLoadCapabilitiesResponse,
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
  AgentConfigLoadCapabilitiesRequest,
  AgentConfigLoadCapabilitiesResponse,
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

// Mirrors ActivationProgressPhase in src/backend/platform/queue/activationProgress.ts.
// Keep the two unions in sync.
export type TaskBoardActivationPhase =
  | 'claimed'
  | 'validating'
  | 'preparing-worktree'
  | 'materializing-worktree'
  | 'initializing-task'
  | 'starting-pipeline';

export type TaskBoardStopCleanupStatus = 'failed';

export type TaskBoardStopCleanupFailureCode =
  | 'unproven-stopped'
  | 'failed-item-cleanup-failed'
  | 'activation-cleanup-failed'
  | 'unexpected-cleanup-error';

export type TaskBoardPendingItem = TaskBoardItem & {
  state: 'active' | 'activating' | 'pending' | 'stopping';
  activationPhase?: TaskBoardActivationPhase;
  activationStartedAt?: string;
  activationUpdatedAt?: string;
  stopRequestedAt?: string;
  stopCleanupStatus?: TaskBoardStopCleanupStatus;
  stopCleanupFailedAt?: string;
  stopCleanupErrorCode?: TaskBoardStopCleanupFailureCode;
  stopCleanupMessage?: string;
  stopCleanupRetryable?: boolean;
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
  pendingItems: TaskBoardPendingItem[];
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
  payload: {
    fileName: string;
    sourceColumn?: 'error' | 'pending';
  };
};

export type TaskBoardMoveToOpenResponse = {
  action: 'taskBoard.moveToOpen';
  mode: 'moved';
  message: string;
  movedItem: string;
};

export type TaskBoardKillTaskRequest = {
  action: 'taskBoard.killTask';
  payload: {
    taskId: string;
    fileName: string;
  };
};

export type TaskBoardKillTaskResponse = {
  action: 'taskBoard.killTask';
  mode: 'failed' | 'kill-requested';
  message: string;
  taskId: string;
  movedItem?: string;
  nextActiveItem?: string | null;
};

export type TaskBoardRetryKillCleanupRequest = {
  action: 'taskBoard.retryKillCleanup';
  payload: {
    taskId: string;
    fileName: string;
  };
};

export type TaskBoardRetryKillCleanupResponse = {
  action: 'taskBoard.retryKillCleanup';
  mode: 'cleanup-retry-scheduled';
  message: string;
  taskId: string;
};

export type TerminalSetTaskScopeRequest = {
  action: 'terminal.setTaskScope';
  payload: { taskGuid: string | null };
};

export type TerminalSetTaskScopeResponse = {
  action: 'terminal.setTaskScope';
  mode: 'scoped';
  selectedTaskGuid: string | null;
  events: import('../renderer/activityStream').StreamEvent[];
  taskScopes: import('../renderer/activityStream').TerminalTaskScopeOption[];
  message: string;
};

export type DesktopActionRequest =
  | PlannerSubmitRequest
  | PlannerStartSessionRequest
  | PlannerUpdateSessionPersonalityRequest
  | PlannerValidateChildTaskFocusRequest
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
  | ContextPackDeleteRequest
  | ContextPackActivationRequest
  | ContextPackSetRepositoryTypeRequest
  | ContextPackSetRepoCategoryRequest
  | PlannerPickMarkdownFileRequest
  | PlannerListArchivedTasksRequest
  | PlannerReadParentContextBundleRequest
  | PlannerReadParentChainArchiveBundleRequest
  | PlannerReadParentArchiveMarkdownRequest
  | PlannerListConversationHistoryRequest
  | PlannerHydrateConversationRequest
  | PlannerUploadSpecRequest
  | ReinforcementSubmitFeedbackRequest
  | ReinforcementUpdateRealignmentDocRequest
  | ReinforcementReadOverviewRequest
  | ReinforcementListTasksRequest
  | ReinforcementReadAgentRewardsRequest
  | ReinforcementListRealignmentSessionsRequest
  | ReinforcementReadRealignmentDocRequest
  | ReinforcementCheckActiveWorkGuardRequest
  | ReinforcementStartRealignmentRequest
  | ReinforcementRunRealignmentAnalysisRequest
  | ReinforcementDismissRealignmentRequest
  | ExternalMcpListRequest
  | AgentConfigLoadAgentsRequest
  | AgentConfigLoadModelCatalogRequest
  | AgentConfigLoadCapabilitiesRequest
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
  | TaskBoardKillTaskRequest
  | TaskBoardRetryKillCleanupRequest
  | TaskNotificationsReadRequest
  | TaskNotificationsMarkSeenRequest
  | TaskNotificationsDismissRequest
  | TaskNotificationsDismissAllRequest
  | ServicesReadStatusRequest
  | ServicesStartBackendRequest
  | ServicesStopBackendRequest
  | ServicesHealthCheckRequest
  | DeepFocusSaveSelectionsRequest
  | DeepFocusLoadSelectionsRequest
  | DeepFocusClearSelectionsRequest
  | FocusFiltersListRequest
  | FocusFiltersCreateRequest
  | FocusFiltersDeleteRequest
  | ContextPackSidebarStateLoadRequest
  | ContextPackSidebarStateSaveRequest
  | TerminalSetTaskScopeRequest
  | CancelTaskRequest;

export type DesktopActionResponse =
  | PlannerSubmitResponse
  | PlannerStartSessionResponse
  | PlannerUpdateSessionPersonalityResponse
  | PlannerValidateChildTaskFocusResponse
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
  | ContextPackDeleteResponse
  | ContextPackActivationResponse
  | ContextPackSetRepositoryTypeResponse
  | ContextPackSetRepoCategoryResponse
  | PlannerPickMarkdownFileResponse
  | PlannerListArchivedTasksResponse
  | PlannerReadParentContextBundleResponse
  | PlannerReadParentChainArchiveBundleResponse
  | PlannerReadParentArchiveMarkdownResponse
  | PlannerListConversationHistoryResponse
  | PlannerHydrateConversationResponse
  | PlannerUploadSpecResponse
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
  | ExternalMcpListResponse
  | AgentConfigLoadAgentsResponse
  | AgentConfigLoadModelCatalogResponse
  | AgentConfigLoadCapabilitiesResponse
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
  | TaskBoardKillTaskResponse
  | TaskBoardRetryKillCleanupResponse
  | TaskNotificationSnapshot
  | TaskNotificationMutationResponse
  | ServicesReadStatusResponse
  | DeepFocusSaveSelectionsResponse
  | DeepFocusLoadSelectionsResponse
  | DeepFocusClearSelectionsResponse
  | FocusFiltersListResponse
  | FocusFiltersCreateResponse
  | FocusFiltersDeleteResponse
  | ContextPackSidebarStateLoadResponse
  | ContextPackSidebarStateSaveResponse
  | TerminalSetTaskScopeResponse
  | CancelTaskResponse;

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

// ---------------------------------------------------------------------------
// Cancel task (§5.3)
// ---------------------------------------------------------------------------

export type CancelTaskRequest = {
  action: 'cancel-task';
  payload: { taskId: string };
};

export type CancelTaskResponse = {
  action: 'cancel-task';
  mode: 'cancelled';
  message: string;
  taskId: string;
};

export const ERROR_CODE_VERSION_CONFLICT = 'version_conflict' as const;
export const ERROR_CODE_ACTIVE_WORK_BLOCKED = 'active_work_blocked' as const;

export type DesktopActionError = {
  ok: false;
  error: string;
  action?: string;
  errorCode?: string;
  details?: string[];
  /**
   * Structured preflight failures emitted by run-pack-preflight.py for
   * context-pack creation. Present only when `errorCode === 'preflight-failed'`.
   * Each entry carries a per-field code/message; renderers can render either
   * the flat `details[]` list or the structured array for field-scoped UI.
   */
  preflightErrors?: ContextPackPreflightError[];
  contextPackResult?: ContextPackSwitchExecutionResult;
};

export type DesktopInvokeResult =
  | {
      ok: true;
      response: DesktopActionResponse;
    }
  | DesktopActionError;
