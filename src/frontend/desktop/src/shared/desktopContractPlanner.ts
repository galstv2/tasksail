import type {
  ContextPackDeepFocusTarget,
  ContextPackFocusFilterRepositoryType,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
} from './desktopContractDeepFocus';
import type {
  PlannerConversationRecord,
  PlannerConversationTranscriptMessage,
  PlannerStagingSidecar,
} from '../../../../backend/platform/planner-history/types.js';

export type {
  PlannerConversationRecord,
  PlannerConversationTranscriptMessage,
  PlannerStagingSidecar,
};

export const DESKTOP_SHELL_PLANNER_EVENT_CHANNEL = 'desktop-shell:planner-event';
export const DESKTOP_SHELL_BYPASS_TEMPLATE_CHANNEL = 'desktop-shell:bypass-template';

export type ComposerStage = 'compose' | 'preview' | 'confirm';

export type PlannerTaskKind = 'standard' | 'child-task';
export type SuggestedPath = 'sequential' | 'parallel';

export type PlannerEditableDraftModel = {
  summary: string;
  desiredOutcome: string;
  constraints: string;
  criticalRequirements: string;
  compatibilityRequirements: string;
  requiredValidation: string;
  acceptanceSignals: string;
  carryForwardSummary: string;
  suggestedPath: SuggestedPath;
  planningNotes: string;
};

export type PlannerDirectSubmissionDraft = PlannerEditableDraftModel & {
  taskKind: PlannerTaskKind;
  parentTaskId: string;
  parentQmdRecordId: string;
  parentQmdScope: string;
  rootTaskId: string;
  followupReason: string;
};

export type FollowUpDirectSubmissionDraft = PlannerDirectSubmissionDraft & {
  taskKind: PlannerTaskKind;
};

export type PlannerBrokerStatus = 'idle' | 'running' | 'completed' | 'failed';

export type PlannerBrokerTurnSource =
  | 'none'
  | 'interactive-bootstrap'
  | 'new-session'
  | 'resumed-session';

export type PlannerBrokerTurnOutcome = 'idle' | 'running' | 'completed' | 'failed';

export type PlannerBrokerObservation = {
  sessionId: string | null;
  brokerStatus: PlannerBrokerStatus;
  activeTurnId: string | null;
  queuedTurnCount: number;
  cliSessionId: string | null;
  lastTurnSource: PlannerBrokerTurnSource;
  lastTurnOutcome: PlannerBrokerTurnOutcome;
  lastTurnAt: string | null;
  lastTurnHadContent: boolean;
  lastExitCode: number | null;
  turnCount: number;
  error: string | null;
};

export type PlannerStreamEventType =
  | 'planner.turn.started'
  | 'planner.turn.message'
  | 'planner.turn.completed'
  | 'planner.turn.failed'
  | 'planner.session.updated';

export type PlannerStreamEvent = {
  eventType: PlannerStreamEventType;
  sessionId: string;
  brokerStatus: PlannerBrokerStatus;
  turnId: string | null;
  done: boolean;
  content?: string;
  messageKind?: 'delta' | 'final';
  error?: string | null;
  cliSessionId?: string | null;
};

export type PlannerSubmitRequest = {
  action: 'planner.submitDraft';
  payload: {
    draft: PlannerDirectSubmissionDraft;
    stage: ComposerStage;
  };
};

export type PlannerSubmitResponse = {
  action: 'planner.submitDraft';
  mode: 'dry-run' | 'submitted';
  accepted: true;
  message: string;
  draftTitle?: string;
  suggestedPath: SuggestedPath;
  submittedPath?: string;
  observationMode?: boolean;
};

export interface PlannerStartSessionPayload {
  contextPackDir: string;
  deepFocusSelection?: PlannerStartSessionDeepFocusSelection;
  replayConversationId?: string;
  childTaskFocusSnapshot?: PlannerFocusSnapshot;
  childTaskLineage?: PlannerChildTaskLineage;
  childTaskExecutionScope?: PlannerChildTaskExecutionScope;
  lilyPlanningReloadScope?: PlannerLilyPlanningReloadScope;
  parentTaskBranchView?: PlannerParentBranchViewRequest;
}

export interface PlannerStartSessionDeepFocusSelection {
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  selectedRepoIds: string[];
  selectedFocusIds: string[];
}

export type PlannerChildTaskExecutionScope = {
  contextPackDir: string;
  contextPackId: string;
  scopeMode: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  // Historical field name: distributed packs key this by repo ID, monolith packs key it by focus ID.
  // Treat it as selected-scope target roles, not as a repo-only map.
  repositoryTypes?: Record<string, ContextPackFocusFilterRepositoryType>;
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
};

export type PlannerLilyPlanningReloadScope = PlannerChildTaskExecutionScope & {
  schemaVersion: 1;
  purpose: 'lily-planning-read-context';
};

export type PlannerFocusSnapshot = {
  version: 1;
  contextPackDir: string;
  contextPackId: string;
  title: string;
  primaryRepoId: PlannerStagingSidecar['primaryRepoId'];
  primaryRepoRoot: PlannerStagingSidecar['primaryRepoRoot'];
  primaryFocusRelativePath: PlannerStagingSidecar['primaryFocusRelativePath'];
  primaryFocusTargetKind: PlannerStagingSidecar['primaryFocusTargetKind'];
  primaryFocusTargets: PlannerStagingSidecar['primaryFocusTargets'];
  selectedTestTarget: PlannerStagingSidecar['selectedTestTarget'];
  supportTargets: PlannerStagingSidecar['supportTargets'];
  deepFocusEnabled: PlannerStagingSidecar['deepFocusEnabled'];
  contextPackBinding: PlannerStagingSidecar['contextPackBinding'];
};

export type PlannerFocusValidationIssueCode =
  | 'context-pack-missing'
  | 'context-pack-mismatch'
  | 'context-pack-binding-mismatch'
  | 'primary-repo-missing'
  | 'primary-focus-path-missing'
  | 'primary-focus-target-missing'
  | 'selected-test-target-missing'
  | 'support-target-missing'
  | 'scoped-test-target-missing'
  | 'scoped-support-target-missing'
  | 'selected-repo-id-missing'
  | 'selected-focus-id-missing';

export type PlannerFocusValidationIssue = {
  code: PlannerFocusValidationIssueCode;
  label: string;
  path?: string;
  id?: string;
};

export type PlannerValidateChildTaskFocusRequest = {
  action: 'planner.validateChildTaskFocus';
  payload: {
    contextPackDir: string;
    snapshot: PlannerFocusSnapshot;
  };
};

export type PlannerValidateChildTaskFocusResponse = {
  action: 'planner.validateChildTaskFocus';
  mode: 'valid' | 'fallback';
  message: string;
  issues: PlannerFocusValidationIssue[];
};

export const PLANNER_FOCUS_VALID_MESSAGE = 'Parent task focus is still valid.';
export const PLANNER_FOCUS_FALLBACK_MESSAGE = "The parent task's saved focus no longer matches the current context pack or filesystem. Starting regular mode with the current live context instead.";

export type PlannerChildTaskLineage = {
  parentTaskId: string;
  parentQmdRecordId: string;
  parentQmdScope: string;
  rootTaskId: string;
  followUpReason: string;
};

export type PlannerParentBranchViewRequest = {
  schemaVersion: 1;
  parentTaskId: string;
  contextPackDir: string;
  contextPackId: string;
  branchChainAvailability: ArchivedTaskBranchChainAvailability;
  branchHandoffs?: ArchivedTaskBranchHandoff[];
};

export type PlannerParentBranchViewStatus = {
  mode: 'created' | 'skipped-missing-handoffs' | 'not-requested';
  message: string;
  worktreeCount: number;
  warning?: string;
};

export const PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE = 'Parent branch view unavailable: archived parent has no branch handoffs. Lily will use archived parent archive context only.';

export type PlannerStartSessionRequest = {
  action: 'planner.startSession';
  payload?: PlannerStartSessionPayload;
};

export type PlannerStartSessionResponse = {
  action: 'planner.startSession';
  mode: 'started';
  accepted: true;
  message: string;
  sessionId: string;
  brokerStatus: PlannerBrokerStatus;
  parentBranchViewStatus?: PlannerParentBranchViewStatus;
};

export type PlannerSendMessageRequest = {
  action: 'planner.sendMessage';
  payload: { text: string; displayText?: string };
};

export type PlannerSendMessageResponse = {
  action: 'planner.sendMessage';
  mode: 'sent';
  accepted: true;
  message: string;
};

export type PlannerEndSessionRequest = {
  action: 'planner.endSession';
  payload?: undefined;
};

export type PlannerEndSessionResponse = {
  action: 'planner.endSession';
  mode: 'ended';
  accepted: true;
  message: string;
};

export type PlannerSaveDraftRequest = {
  action: 'planner.saveDraft';
  payload?: undefined;
};

export type PlannerSaveDraftResponse = {
  action: 'planner.saveDraft';
  mode: 'instructed';
  accepted: true;
  message: string;
  brokerStatus: PlannerBrokerStatus;
};

export type StagedDraftContent = {
  filename: string;
  content: string;
  modifiedAt: string;
};

export type PlannerReadStagedDraftRequest = {
  action: 'planner.readStagedDraft';
  payload?: undefined;
};

export type PlannerReadStagedDraftResponse = {
  action: 'planner.readStagedDraft';
  mode: 'found' | 'empty';
  message: string;
  draft: StagedDraftContent | null;
  brokerStatus: PlannerBrokerStatus;
};

export type PlannerFinalizeSpecRequest = {
  action: 'planner.finalizeSpec';
  payload?: {
    expectedTaskKind?: 'standard' | 'child-task';
  };
};

export type PlannerFinalizeSpecResponse = {
  action: 'planner.finalizeSpec';
  mode: 'finalized';
  accepted: true;
  message: string;
  destinationPath: string;
  brokerStatus: PlannerBrokerStatus;
};

export type MarkdownFileSelection = {
  filename: string;
  path: string;
  content: string;
};

export type PlannerPickMarkdownFileRequest = {
  action: 'planner.pickMarkdownFile';
  payload?: undefined;
};

export type PlannerPickMarkdownFileResponse = {
  action: 'planner.pickMarkdownFile';
  mode: 'selected' | 'cancelled';
  message: string;
  filename: string | null;
  path: string | null;
  content: string | null;
};

export type PlannerUploadSpecRequest = {
  action: 'planner.uploadSpec';
  payload: {
    content: string;
    requirePlannerSidecar?: boolean;
    expectedTaskKind?: PlannerTaskKind;
  };
};

export type PlannerUploadSpecResponse = {
  action: 'planner.uploadSpec';
  mode: 'submitted';
  accepted: true;
  message: string;
  draftTitle: string;
  submittedPath: string;
  observationMode: boolean;
};

export type ArchivedTaskBranchHandoff = {
  repoRoot: string;
  repoLabel: string;
  branch: string;
  baseCommitSha: string;
  headCommitSha: string;
  commitsAhead: number;
  status: string;
  autoMerge?: {
    enabled: boolean;
    status: string;
    targetBranch: string | null;
    detail: string;
  };
};

export type ArchivedTaskParentContextFile = {
  kind: 'handoff' | 'implementation-step';
  fileName: string;
  path: string;
  relativePath: string;
  sizeBytes: number;
};

export type ArchivedTaskParentContextArtifacts = {
  status: 'available' | 'missing-artifacts' | 'legacy-flat-archive';
  archiveArtifactDir: string | null;
  handoffsDir: string | null;
  implementationStepsDir: string | null;
  handoffs: ArchivedTaskParentContextFile[];
  implementationSteps: ArchivedTaskParentContextFile[];
  missing: string[];
};

export type ArchivedTaskBranchChainAvailability = {
  status: 'ready' | 'missing-branch-handoffs' | 'invalid-branch-handoffs';
  message: string;
};

export type ArchivedTaskChildChainMetadata = {
  rootTaskId: string;
  parentTaskId: string | null;
  previousTaskId: string | null;
  depth: number;
  state: 'planned' | 'pending' | 'active' | 'completed' | 'failed';
  currentTipTaskId: string;
  isCurrentTip: boolean;
  archivePath: string | null;
  archiveArtifactDir: string | null;
  parentArchivePath: string | null;
  parentArchiveArtifactDir: string | null;
};

export type ArchivedTaskChildChainStateStatus = {
  status: 'invalid';
  message: string;
};

export type ArchivedTaskChildParentEligibility = {
  eligible: boolean;
  reason:
    | 'standalone-root'
    | 'current-chain-tip'
    | 'not-current-chain-tip'
    | 'reserved-by-unarchived-tip'
    | 'legacy-child-without-chain-state'
    | 'chain-tip-state-not-completed'
    | 'child-chain-state-invalid';
  message: string;
  rootTaskId: string;
  currentTipTaskId: string | null;
  currentTipState: 'planned' | 'pending' | 'active' | 'completed' | 'failed' | null;
};

export type ArchivedTaskEntry = {
  taskId: string;
  title: string;
  summary: string;
  rootTaskId: string;
  qmdRecordId: string;
  followupReason: string;
  year: string;
  archivePath: string;
  archivedAt: string | null;
  contextPackName: string;
  branchHandoffs?: ArchivedTaskBranchHandoff[];
  archiveLayout?: 'nested' | 'flat';
  archiveArtifactDir?: string | null;
  handoffsDir?: string | null;
  implementationStepsDir?: string | null;
  handoffArtifactsManifestPath?: string | null;
  parentContextArtifacts?: ArchivedTaskParentContextArtifacts;
  branchChainAvailability?: ArchivedTaskBranchChainAvailability;
  childChain?: ArchivedTaskChildChainMetadata;
  childParentEligibility?: ArchivedTaskChildParentEligibility;
  parentTaskId?: string;
  childDepth?: number;
  parentResolution?: string;
  plannerFocusSnapshot?: PlannerFocusSnapshot;
  parentTaskContent?: ArchivedParentTaskContent;
};

export type ArchivedTaskChildParentBlockedTip = {
  rootTaskId: string;
  blockedParentTaskId: string | null;
  currentTipTaskId: string;
  chainState: 'planned' | 'pending' | 'active' | 'failed';
  boardState: 'open' | 'pending' | 'active' | 'failed' | null;
  title: string | null;
  fileName: string | null;
  message: string;
};

export type ArchivedParentTaskContent = {
  taskTitle?: string;
  taskSummary?: string;
  completedWorkSummary?: string;
  keyDecisions?: string[];
  knownLimitations?: string[];
  constraints?: string[];
  implementationSummary?: string;
};

export type PlannerListArchivedTasksRequest = {
  action: 'planner.listArchivedTasks';
  payload?: undefined;
};

export type PlannerListArchivedTasksResponse = {
  action: 'planner.listArchivedTasks';
  mode: 'found' | 'empty' | 'no-context-pack';
  message: string;
  tasks: ArchivedTaskEntry[];
  childParentBlockedTips?: ArchivedTaskChildParentBlockedTip[];
  childChainStateStatus?: ArchivedTaskChildChainStateStatus;
};

export type ArchivedParentContextBundleFile = {
  kind: 'handoff' | 'implementation-step';
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  content: string;
  truncated: boolean;
};

export type ArchivedParentContextBundle = {
  schemaVersion: 1;
  parentTaskId: string;
  rootTaskId: string;
  parentTaskTitle: string;
  archivePath: string;
  archiveArtifactDir: string | null;
  status: 'available' | 'missing-artifacts' | 'legacy-flat-archive';
  missing: string[];
  files: ArchivedParentContextBundleFile[];
  totalBytes: number;
  truncated: boolean;
  fallbackSummary: ArchivedParentTaskContent | null;
};

export type PlannerReadParentContextBundleRequest = {
  action: 'planner.readParentContextBundle';
  payload: {
    parentTaskId: string;
    contextPackDir: string;
    contextPackId: string;
  };
};

export type PlannerReadParentContextBundleResponse = {
  action: 'planner.readParentContextBundle';
  mode: 'loaded';
  accepted: true;
  message: string;
  bundle: ArchivedParentContextBundle;
};

export type ArchivedParentChainArchiveBundleTask = {
  taskId: string;
  title: string;
  depth: number;
  role: 'root' | 'child' | 'selected-parent' | 'root-selected-parent';
  state: 'completed';
  archivedAt: string | null;
  archivePath: string;
  sizeBytes: number;
  content: string;
  truncated: boolean;
};

export type ArchivedParentChainArchiveBundle = {
  schemaVersion: 1;
  parentTaskId: string;
  rootTaskId: string;
  currentTipTaskId: string | null;
  status: 'available' | 'no-chain-state' | 'missing-archives';
  tasks: ArchivedParentChainArchiveBundleTask[];
  missingTaskIds: string[];
  totalBytes: number;
  truncated: boolean;
};

export type PlannerReadParentChainArchiveBundleRequest = {
  action: 'planner.readParentChainArchiveBundle';
  payload: {
    parentTaskId: string;
    rootTaskId: string;
    contextPackDir: string;
    contextPackId: string;
  };
};

export type PlannerReadParentChainArchiveBundleResponse = {
  action: 'planner.readParentChainArchiveBundle';
  mode: 'loaded';
  accepted: true;
  message: string;
  bundle: ArchivedParentChainArchiveBundle;
};

export type PlannerReadParentArchiveMarkdownRequest = {
  action: 'planner.readParentArchiveMarkdown';
  payload: {
    parentTaskId: string;
    contextPackDir: string;
    contextPackId: string;
  };
};

export type PlannerReadParentArchiveMarkdownResponse = {
  action: 'planner.readParentArchiveMarkdown';
  mode: 'loaded';
  accepted: true;
  message: string;
  taskId: string;
  title: string;
  archivePath: string;
  archivedAt: string | null;
  content: string;
  sizeBytes: number;
};

export type PlannerListConversationHistoryRequest = {
  action: 'planner.listConversationHistory';
  payload?: undefined;
};

export type PlannerListConversationHistorySummary = {
  id: string;
  title: string;
  createdAt: string;
  finalizedDestinationPath: string;
  messageCount: number;
  taskKind: PlannerTaskKind;
  scopeMode: string;
  primaryRepoId: string;
  primaryFocusRelativePath: string | null;
};

export type PlannerListConversationHistoryResponse = {
  action: 'planner.listConversationHistory';
  mode: 'found' | 'empty' | 'no-context-pack';
  message: string;
  conversations: PlannerListConversationHistorySummary[];
};

export type PlannerHydrateConversationRequest = {
  action: 'planner.hydrateConversation';
  payload: { recordId: string };
};

export type PlannerHydrateConversationResponse = {
  action: 'planner.hydrateConversation';
  mode: 'found' | 'not-found';
  message: string;
  record: PlannerConversationRecord | null;
};

export type QueueStatusRequest = {
  action: 'queue.readStatus';
  payload?: undefined;
};

export type QueueDeletePendingItemRequest = {
  action: 'queue.deletePendingItem';
  payload: {
    queueName: string;
  };
};

export type QueueDeletePendingItemResponse = {
  action: 'queue.deletePendingItem';
  mode: 'deleted';
  message: string;
  queueName: string;
};

export type FollowUpRequest = {
  action: 'followup.begin';
  payload: {
    draft: FollowUpDirectSubmissionDraft;
    stage: ComposerStage;
  };
};

export type FollowUpResponse = {
  action: 'followup.begin';
  mode: 'dry-run' | 'submitted';
  accepted: true;
  message: string;
  suggestedTaskKind: 'child-task';
  sourceTaskId: string;
  parentTaskId: string;
  rootTaskId: string;
  submittedPath?: string;
  reopenedTask: false;
};
