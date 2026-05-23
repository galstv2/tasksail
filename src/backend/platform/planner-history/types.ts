import type {
  FocusTarget,
  FocusTargetKind,
  NormalizedSupportTarget,
  PrimaryFocusTarget,
} from '../context-pack/deepFocusNormalization.js';

export const PLANNER_HISTORY_VERSION = 1;
export const PLANNER_HISTORY_RECORD_CAP = 10;
export const TRANSCRIPT_MESSAGE_CAP = 400;

export type PlannerTaskKind = 'standard' | 'child-task';

export type PlannerStagingLineage = {
  taskKind: PlannerTaskKind;
  parentTaskId: string;
  rootTaskId: string;
  parentQmdRecordId: string;
  parentQmdScope: string;
  followUpReason: string;
};

export type PlannerStagingContextPackBinding = {
  contextPackDir: string;
  contextPackId: string;
  scopeMode: string;
  primaryRepoId?: string;
  primaryFocusId?: string;
  deepFocusPrimaryRepoId?: string;
  deepFocusPrimaryFocusId?: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  repositoryTypes?: Record<string, 'primary' | 'support'>;
  deepFocusEnabled: boolean;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: FocusTargetKind | null;
  selectedFocusTargets: PrimaryFocusTarget[];
  selectedTestTarget: FocusTarget | null;
  selectedSupportTargets: NormalizedSupportTarget[];
};

export type PlannerStagingSidecar = {
  version: 1;
  ownership: 'planner-session';
  sessionId: string;
  draftFilename: string;
  draftPath: string;
  createdAt: string;
  title: string;
  primaryRepoId: string;
  primaryRepoRoot: string;
  primaryFocusRelativePath: string | null;
  deepFocusEnabled: boolean;
  primaryFocusTargetKind: FocusTargetKind | null;
  primaryFocusTargets: PrimaryFocusTarget[];
  selectedTestTarget: FocusTarget | null;
  supportTargets: NormalizedSupportTarget[];
  lineage: PlannerStagingLineage;
  contextPackBinding: PlannerStagingContextPackBinding;
  childTaskExecutionScope?: PlannerStagingContextPackBinding;
};

export interface PlannerConversationHistoryFile {
  version: 1;
  conversationsByContextPackDir: Record<string, PlannerConversationRecord[]>;
}

export interface PlannerConversationRecord {
  id: string;
  contextPackDir: string;
  contextPackId: string;
  createdAt: string;
  title: string;
  finalizedDestinationPath: string;
  sidecarSnapshot: PlannerStagingSidecar;
  transcript: PlannerConversationTranscriptMessage[];
}

export interface PlannerConversationTranscriptMessage {
  id: string;
  role: 'planner' | 'operator';
  text: string;
  timestamp: string;
}

export class PlannerHistoryValidationError extends Error {
  override readonly name = 'PlannerHistoryValidationError';

  constructor(message: string) {
    super(message);
  }
}
