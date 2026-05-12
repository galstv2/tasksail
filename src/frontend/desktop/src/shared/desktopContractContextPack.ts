import type {
  ContextPackDeepFocusDerivedRoot,
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
  ContextPackSwitchDeepFocusSelection,
} from './desktopContractDeepFocus';

export const RESEED_IN_PROGRESS_ERROR_CODE = 'reseed_in_progress' as const;

export type ContextPackActivationRequest = {
  action: 'contextPack.activate';
  payload: {
    packId: string;
    command: 'context-pack:activate';
    mode: 'status-only';
  };
};

export type ContextPackActivationResponse = {
  action: 'contextPack.activate';
  mode: 'activated' | 'dry-run';
  accepted: true;
  message: string;
  commandPreview?: string;
  contextPackDir?: string;
  contextPackId?: string;
};

export type ContextPackDirectoryPurpose =
  | 'discovery-root'
  | 'context-pack-destination';

export type ContextPackPickDirectoryRequest = {
  action: 'contextPack.pickDirectory';
  payload: {
    purpose: ContextPackDirectoryPurpose;
    defaultPath?: string;
  };
};

export type ContextPackPickDirectoryResponse = {
  action: 'contextPack.pickDirectory';
  mode: 'selected' | 'cancelled';
  message: string;
  purpose: ContextPackDirectoryPurpose;
  selectedPath: string | null;
};

export type ContextPackEstateType =
  | 'distributed'
  | 'distributed-platform'
  | 'monolith'
  | 'monolith-platform';

// Discovery still allows 'auto' (the operator may not have decided yet).
export type ContextPackDiscoveryMode = 'auto' | ContextPackEstateType;

// Create requires a deterministic estate type — 'auto' is rejected.
export type ContextPackCreateMode = ContextPackEstateType;
export type ContextPackRepositoryType = 'primary' | 'support';
export type WorkspaceScopeMode = 'focused';

/** v2 repo category values (the 9 categories introduced in qmd-repo-sources/v2). */
export type ContextPackRepoCategory =
  | 'service'
  | 'application'
  | 'frontend'
  | 'library'
  | 'infrastructure'
  | 'data'
  | 'documentation'
  | 'tool'
  | 'unknown';

/** Deprecated alias — kept for one transition cycle. Use ContextPackRepositoryType instead. */
export type ContextPackRepoFocus = ContextPackRepositoryType;

export type ContextPackClassificationConfidence = 'high' | 'medium' | 'low';

export type ContextPackDiscoveredRepo = {
  repoId: string;
  repoName: string;
  path: string;
  relativePath: string;
  highSignalPaths: string[];
  repositoryType?: ContextPackRepositoryType;
  classificationConfidence?: ContextPackClassificationConfidence;
};

export type ContextPackDiscoveredFocusArea = {
  focusId: string;
  focusName: string;
  focusType: string;
  path: string;
  relativePath: string;
  group?: string;
  repositoryType?: ContextPackRepositoryType;
};

export type ContextPackDiscoveredHighSignalPath = {
  path: string;
  relativePath: string;
  signalType: string;
};

export type ContextPackDiscoverPrefillRequest = {
  action: 'contextPack.discoverPrefill';
  payload: {
    rootPath: string;
    mode: ContextPackDiscoveryMode;
  };
};

export type ContextPackDiscoverPrefillResponse = {
  action: 'contextPack.discoverPrefill';
  mode: 'discovered';
  message: string;
  rootPath: string;
  discoveryMode: ContextPackDiscoveryMode;
  estateType: ContextPackEstateType;
  suggestedContextPackId: string;
  suggestedDisplayName: string;
  warnings: string[];
  candidateRepos: ContextPackDiscoveredRepo[];
  candidateFocusAreas: ContextPackDiscoveredFocusArea[];
  highSignalPaths: ContextPackDiscoveredHighSignalPath[];
};

export type ContextPackBootstrapRepositoryInput = {
  repoRoot: string;
  repoName: string;
  repoId?: string;
  owner?: string;
  systemLayer:
    | 'backend'
    | 'frontend'
    | 'test'
    | 'infrastructure'
    | 'database'
    | 'documents'
    | 'shared';
  languages?: string[];
  artifactRoots?: string[];
  documentPaths?: string[];
  boundedContext?: string;
  serviceName?: string;
  /** @deprecated Superseded by repositoryType/repoFocus; removal deferred (Phase 6 Gate G7). */
  repoRole?: string;
  /** @deprecated Use repoFocus instead. Kept for backward compat. */
  repositoryType?: ContextPackRepositoryType;
  /** v2: replaces repositoryType as the primary focus field (primary | support). */
  repoFocus?: ContextPackRepositoryType;
  repoFocusAuthored?: boolean;
  /** v2: category classification for this repository. */
  repoCategory?: ContextPackRepoCategory;
  repoCategoryAuthored?: boolean;
  workspaceActivationGroup?: string;
  defaultFocusable?: boolean;
  activationPriority?: number;
  adjacentRepoIds?: string[];
  dependsOnRepoIds?: string[];
  usedByRepoIds?: string[];
};

export type ContextPackBootstrapFocusAreaInput = {
  focusId?: string;
  focusName?: string;
  relativePath?: string;
  path?: string;
  focusType?: string;
  group?: string;
  defaultFocusable?: boolean;
  activationPriority?: number;
  adjacentFocusAreaIds?: string[];
  repositoryType?: ContextPackRepositoryType;
};

export type ContextPackCreateRequest = {
  action: 'contextPack.create';
  payload: {
    contextPackDir: string;
    discoveryRoot: string;
    mode: ContextPackCreateMode;
    writePlan?: boolean;
    seedOnCreate?: boolean;
    initGitRepos?: boolean;
    confirmOverwrite?: boolean;
    allowScaryPath?: boolean;
    bootstrapAnswers: {
      contextPackId: string;
      estateName: string;
      defaultScopeMode?: WorkspaceScopeMode;
      primaryWorkingRepoIds?: string[];
      primaryFocusAreaIds?: string[];
      repositories: ContextPackBootstrapRepositoryInput[];
      focusableAreas?: ContextPackBootstrapFocusAreaInput[];
    };
  };
};

/**
 * Structured preflight error surfaced by run-pack-preflight.py before any disk write.
 * `field` uses renderer-facing camelCase form-paths (e.g. "bootstrapAnswers.repositories[0].repoRoot")
 * so the modal can scope the error message to the offending input.
 */
export type ContextPackPreflightError = {
  code: string;
  field: string | null;
  message: string;
  details: Record<string, unknown>;
};

export type ContextPackCreateExecutionResult = {
  contextPackId: string;
  displayName: string;
  contextPackDir: string;
  discoveryRoot: string;
  discoveryMode: ContextPackEstateType;
  estateType: ContextPackEstateType;
  defaultScopeMode: WorkspaceScopeMode;
  bootstrapAnswersPath: string;
  discoveryDraftPath: string;
  manifestPath: string;
  planPath: string;
  repositoryCount: number;
  focusTargetCount: number;
  primaryWorkingRepoIds: string[];
  primaryFocusAreaIds: string[];
  seedStatus: string;
  warnings: string[];
};

export type ContextPackCreateResponse = {
  action: 'contextPack.create';
  mode: 'created';
  message: string;
  commandPath: string;
  result: ContextPackCreateExecutionResult;
};

export type ContextPackCatalogSource =
  | 'configured-path'
  | 'search-root'
  | 'active-env'
  | 'recent-state';

export type ContextPackRuntimeStatus =
  | 'inactive'
  | 'active'
  | 'activation-failed'
  | 'workspace-sync-failed';

export type ContextPackFocusTarget = {
  focusId: string;
  displayName: string;
  kind: 'repository' | 'focus-area';
  repoId: string | null;
  repoLocalPath?: string | null;
  serviceName: string | null;
  systemLayer: string | null;
  /** @deprecated Superseded by repositoryType; removal deferred (Phase 6 Gate G7). */
  repoRole: string | null;
  repositoryType: ContextPackRepositoryType | null;
  relativePath: string | null;
  focusType: string | null;
  group: string | null;
  defaultFocusable: boolean;
  activationPriority: number;
  adjacentRepoIds: string[];
  adjacentFocusIds: string[];
};

/** Whether a pack has been seeded or is an empty new-flow stub awaiting population. */
export type PackSeedState = 'seeded' | 'bootstrap-empty';

/**
 * Camel-cased translation of the on-disk ``seed-state.json`` record (defined
 * in ``packSchemas.PackSeedStateRecord`` with snake_case keys).  The catalog
 * reader (``main.contextPackCatalog.ts``) is responsible for the snake→camel
 * translation; renderer code consumes only this shape.
 *
 * ``details`` is preserved as an opaque dict so future inner keys (today
 * ``plan_overall_status``, ``plan_repo_statuses``, ``plan_parsed`` from G1)
 * flow through without a contract change.
 */
export type PackSeedStateInfo = {
  state: PackSeedState;
  createdAt?: string | null;
  reason?: string | null;
  lastSeedAt?: string | null;
  lastSeedRunId?: string | null;
  lastFailureAt?: string | null;
  lastFailureReason?: string | null;
  lastFailureRunId?: string | null;
  inProgress?: boolean;
  details?: Record<string, unknown> | null;
};

export type ContextPackCatalogEntry = {
  contextPackId: string;
  displayName: string;
  contextPackDir: string;
  manifestPath: string | null;
  bootstrapReady: boolean;
  source: ContextPackCatalogSource;
  isActive: boolean;
  estateType: string | null;
  defaultScopeMode: WorkspaceScopeMode | null;
  repoCount: number;
  primaryWorkingRepoIds: string[];
  focusTargets: ContextPackFocusTarget[];
  /** Absent means the pack was created before Phase 5 and is treated as seeded. */
  packSeedState?: PackSeedState;
  /**
   * Full pack seed-state record (camel-cased from on-disk ``seed-state.json``).
   * Carries the diagnostic fields written by Phase 5 G1 (``createdAt``,
   * ``reason``, ``details``) and G2 (``lastSeedAt``, ``lastSeedRunId``) so the
   * UI can render a richer "needs population" message without re-reading
   * the marker file.  Absent for pre-Phase-5 packs.
   */
  packSeedStateInfo?: PackSeedStateInfo;
  status?: ContextPackRuntimeStatus;
  statusMessage?: string | null;
  restoreAvailable?: boolean;
  lastSyncedAt?: string | null;
  workspaceFolderCount?: number | null;
  workspaceFileCount?: number | null;
  lastAppliedScopeMode?: WorkspaceScopeMode | null;
  lastAppliedSelectedRepoIds?: string[];
  lastAppliedSelectedFocusIds?: string[];
  lastAppliedDeepFocusEnabled?: boolean;
  lastAppliedDeepFocusPrimaryRepoId?: string | null;
  lastAppliedDeepFocusPrimaryFocusId?: string | null;
  lastAppliedSelectedFocusPath?: string | null;
  lastAppliedSelectedFocusTargetKind?: ContextPackFocusTargetKind | null;
  lastAppliedSelectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  lastAppliedSelectedTestTarget?: ContextPackDeepFocusTarget | null;
  lastAppliedSelectedSupportTargets?: ContextPackDeepFocusTarget[];
  lastAppliedDerivedWritableRoots?: ContextPackDeepFocusDerivedRoot[];
  lastAppliedDerivedReadonlyContextRoots?: ContextPackDeepFocusDerivedRoot[];
};

export type ContextPackListRequest = {
  action: 'contextPack.list';
  payload?: undefined;
};

export type ContextPackListResponse = {
  action: 'contextPack.list';
  mode: 'read-only';
  message: string;
  activeContextPackDir: string | null;
  configuredPaths: string[];
  searchRoots: string[];
  recentContextPackDirs: string[];
  contextPacks: ContextPackCatalogEntry[];
};

export type ContextPackReseedPayload = {
  contextPackDir: string;
};

export type ContextPackReseedRequest = {
  action: 'contextPack.reseed';
  payload: ContextPackReseedPayload;
};

export type ContextPackReseedExecutionResult = {
  contextPackDir: string;
  overallStatus: string;
  reportPath: string | null;
  seededRepoCount: number;
  blockedRepoCount: number;
  conventionsSummaryStatus: string | null;
  conventionsPolicy: 'only-if-missing';
  workspaceFolderCount: number | null;
  workspaceFileCount: number | null;
};

export type ContextPackReseedResponse = {
  action: 'contextPack.reseed';
  mode: 'reseeded';
  message: string;
  commandPath: string;
  result: ContextPackReseedExecutionResult;
};

export type ContextPackSetRepositoryTypeRequest = {
  action: 'contextPack.setRepositoryType';
  payload: {
    contextPackDir: string;
    repoId: string;
    repositoryType: ContextPackRepositoryType;
  };
};

export type ContextPackSetRepositoryTypeResponse = {
  action: 'contextPack.setRepositoryType';
  mode: 'updated';
  message: string;
};

export type ContextPackSetRepoCategoryRequest = {
  action: 'contextPack.setRepoCategory';
  payload: {
    contextPackDir: string;
    repoId: string;
    repoCategory: string;
  };
};

export type ContextPackSetRepoCategoryResponse = {
  action: 'contextPack.setRepoCategory';
  mode: 'updated';
  message: string;
};

export type ContextPackSwitchPayload = {
  contextPackDir: string;
  scopeMode: WorkspaceScopeMode;
  selectedRepoIds?: string[];
  selectedFocusIds?: string[];
} & ContextPackSwitchDeepFocusSelection;

export type ContextPackPreviewRequest = {
  action: 'contextPack.previewSwitch';
  payload: ContextPackSwitchPayload;
};

export type ContextPackApplyRequest = {
  action: 'contextPack.applySwitch';
  payload: ContextPackSwitchPayload;
};

export type ContextPackClearRequest = {
  action: 'contextPack.clearActive';
  payload?: undefined;
};

export type ContextPackSwitchExecutionResult = {
  ok: boolean;
  wrapperAction: 'preview' | 'apply' | 'clear';
  stage: string;
  status: string;
  activation: {
    performed: boolean;
    exitCode: number | null;
    output: string;
  };
  envStateCleared: boolean;
  error: string | null;
  contextPackId: string | null;
  contextPackDir: string | null;
  workspaceFile: string | null;
  stateFile: string | null;
  scopeMode: WorkspaceScopeMode | null;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  warnings: string[];
  foldersToAdd: string[];
  foldersToRemove: string[];
  managedFolders: string[];
  targetFolders: string[];
  lastSyncedAt: string | null;
} & ContextPackDeepFocusState;

export type ContextPackPreviewResponse = {
  action: 'contextPack.previewSwitch';
  mode: 'preview';
  message: string;
  commandPath: string;
  result: ContextPackSwitchExecutionResult;
};

export type ContextPackApplyResponse = {
  action: 'contextPack.applySwitch';
  mode: 'applied';
  message: string;
  commandPath: string;
  result: ContextPackSwitchExecutionResult;
};

export type ContextPackClearResponse = {
  action: 'contextPack.clearActive';
  mode: 'cleared';
  message: string;
  commandPath: string;
  result: ContextPackSwitchExecutionResult;
};

export type {
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackSwitchDeepFocusSelection,
};
