import type {
  ContextPackDeepFocusDerivedRoot,
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackSwitchDeepFocusSelection,
} from './desktopContractDeepFocus';

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

export type ContextPackDiscoveryMode = 'auto' | 'distributed' | 'monolith';
export type ContextPackRepositoryType = 'primary' | 'support';
export type WorkspaceScopeMode = 'focused';

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
  estateType: 'distributed' | 'monolith';
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
  repoRole?: string;
  repositoryType?: ContextPackRepositoryType;
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
      repositories: ContextPackBootstrapRepositoryInput[];
      focusableAreas?: ContextPackBootstrapFocusAreaInput[];
    };
  };
};

export type ContextPackCreateExecutionResult = {
  contextPackId: string;
  displayName: string;
  contextPackDir: string;
  discoveryRoot: string;
  discoveryMode: ContextPackDiscoveryMode;
  estateType: 'distributed-platform' | 'monolith';
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
  | 'active-dirty-workspace'
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
  status?: ContextPackRuntimeStatus;
  statusMessage?: string | null;
  driftDetected?: boolean;
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
