import type {
  ContextPackDeepFocusTarget,
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

export type ArchivedTaskEntry = {
  taskId: string;
  title: string;
  summary: string;
  rootTaskId: string;
  qmdRecordId: string;
  followupReason: string;
  year: string;
  archivePath: string;
  contextPackName: string;
  branchHandoffs?: ArchivedTaskBranchHandoff[];
  plannerFocusSnapshot?: PlannerFocusSnapshot;
  parentTaskContent?: ArchivedParentTaskContent;
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
