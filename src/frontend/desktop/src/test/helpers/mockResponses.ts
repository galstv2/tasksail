import type {
  ContextPackActivationResponse,
  ContextPackCatalogEntry,
  ContextPackCreateExecutionResult,
  ContextPackCreateResponse,
  ContextPackDiscoverPrefillResponse,
  ContextPackListResponse,
  ContextPackPickDirectoryResponse,
  ContextPackReseedExecutionResult,
  ContextPackReseedResponse,
  ContextPackSwitchExecutionResult,
  FollowUpResponse,
  PlannerPickMarkdownFileResponse,
  PlannerSubmitResponse,
} from '../../shared/desktopContract';

export function createPlannerSubmitResponse(
  overrides: Partial<PlannerSubmitResponse> = {},
): PlannerSubmitResponse {
  return {
    action: 'planner.submitDraft',
    mode: 'dry-run',
    accepted: true,
    message: 'Draft accepted.',
    draftTitle: 'Test Task',
    suggestedPath: 'sequential',
    ...overrides,
  };
}

export function createFollowUpResponse(
  overrides: Partial<FollowUpResponse> = {},
): FollowUpResponse {
  return {
    action: 'followup.begin',
    mode: 'dry-run',
    accepted: true,
    message: 'Follow-up initiated.',
    suggestedTaskKind: 'child-task',
    sourceTaskId: 'task-001',
    parentTaskId: 'task-001',
    rootTaskId: 'task-001',
    reopenedTask: false,
    ...overrides,
  };
}

export function createPickDirectoryResponse(
  overrides: Partial<ContextPackPickDirectoryResponse> = {},
): ContextPackPickDirectoryResponse {
  return {
    action: 'contextPack.pickDirectory',
    mode: 'selected',
    message: 'Directory selected.',
    purpose: 'context-pack-destination',
    selectedPath: '/tmp/context-packs/test-pack',
    ...overrides,
  };
}

export function createDiscoverPrefillResponse(
  overrides: Partial<ContextPackDiscoverPrefillResponse> = {},
): ContextPackDiscoverPrefillResponse {
  return {
    action: 'contextPack.discoverPrefill',
    mode: 'discovered',
    message: 'Discovery complete.',
    rootPath: '/repo',
    discoveryMode: 'auto',
    estateType: 'monolith',
    suggestedContextPackId: 'test-pack',
    suggestedDisplayName: 'Test Pack',
    warnings: [],
    candidateRepos: [],
    candidateFocusAreas: [],
    highSignalPaths: [],
    ...overrides,
  };
}

function createSwitchExecutionResult(
  overrides: Partial<ContextPackSwitchExecutionResult> = {},
): ContextPackSwitchExecutionResult {
  return {
    ok: true,
    wrapperAction: 'preview',
    stage: 'complete',
    status: 'success',
    activation: { performed: false, exitCode: null, output: '' },
    envStateCleared: false,
    error: null,
    contextPackId: 'test-pack',
    contextPackDir: '/tmp/context-packs/test-pack',
    workspaceFile: null,
    stateFile: null,
    scopeMode: 'focused',
    selectedRepoIds: [],
    selectedFocusIds: [],
    warnings: [],
    foldersToAdd: [],
    foldersToRemove: [],
    managedFolders: [],
    targetFolders: [],
    lastSyncedAt: null,
    deepFocusEnabled: false,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedTestTarget: null,
    selectedSupportTargets: [],
    ...overrides,
  };
}

type SwitchAction =
  | 'contextPack.previewSwitch'
  | 'contextPack.applySwitch'
  | 'contextPack.clearActive';

type SwitchMode = 'preview' | 'applied' | 'cleared';

export function createSwitchResponse(
  action: SwitchAction = 'contextPack.previewSwitch',
  mode: SwitchMode = 'preview',
  resultOverrides: Partial<ContextPackSwitchExecutionResult> = {},
): {
  action: SwitchAction;
  mode: SwitchMode;
  message: string;
  commandPath: string;
  result: ContextPackSwitchExecutionResult;
} {
  return {
    action,
    mode,
    message: 'Switch complete.',
    commandPath: 'src/backend/platform/context-pack/switch.ts',
    result: createSwitchExecutionResult(resultOverrides),
  };
}

export function createCreateContextPackResponse(
  overrides: Partial<ContextPackCreateResponse> = {},
): ContextPackCreateResponse {
  const defaultResult: ContextPackCreateExecutionResult = {
    contextPackId: 'test-pack',
    displayName: 'Test Pack',
    contextPackDir: '/tmp/context-packs/test-pack',
    discoveryRoot: '/repo',
    discoveryMode: 'auto',
    estateType: 'monolith',
    defaultScopeMode: 'focused',
    bootstrapAnswersPath: '/tmp/bootstrap.json',
    discoveryDraftPath: '/tmp/discovery.json',
    manifestPath: '/tmp/manifest.json',
    planPath: '/tmp/plan.json',
    repositoryCount: 1,
    focusTargetCount: 0,
    primaryWorkingRepoIds: ['repo-1'],
    primaryFocusAreaIds: [],
    seedStatus: 'complete',
    warnings: [],
  };
  return {
    action: 'contextPack.create',
    mode: 'created',
    message: 'Context pack created.',
    commandPath: 'src/backend/platform/context-pack/switch.ts',
    result: defaultResult,
    ...overrides,
  };
}

export function createListContextPacksResponse(
  packs: ContextPackCatalogEntry[] = [],
  overrides: Partial<ContextPackListResponse> = {},
): ContextPackListResponse {
  return {
    action: 'contextPack.list',
    mode: 'read-only',
    message: 'Listed context packs.',
    activeContextPackDir: null,
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: packs,
    ...overrides,
  };
}

export function createReseedResponse(
  overrides: Partial<ContextPackReseedResponse> = {},
): ContextPackReseedResponse {
  const defaultResult: ContextPackReseedExecutionResult = {
    contextPackDir: '/tmp/context-packs/test-pack',
    overallStatus: 'complete',
    reportPath: null,
    seededRepoCount: 1,
    blockedRepoCount: 0,
    conventionsSummaryStatus: null,
    conventionsPolicy: 'only-if-missing',
    workspaceFolderCount: null,
    workspaceFileCount: null,
  };
  return {
    action: 'contextPack.reseed',
    mode: 'reseeded',
    message: 'Reseed complete.',
    commandPath: 'src/backend/platform/context-pack/switch.ts',
    result: defaultResult,
    ...overrides,
  };
}

export function createActivateContextPackResponse(
  overrides: Partial<ContextPackActivationResponse> = {},
): ContextPackActivationResponse {
  return {
    action: 'contextPack.activate',
    mode: 'dry-run',
    accepted: true,
    message: 'Activation preview ready.',
    commandPreview:
      'tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /tmp/test-pack',
    ...overrides,
  };
}

export function createPickMarkdownFileCancelledResponse(
  overrides: Partial<PlannerPickMarkdownFileResponse> = {},
): PlannerPickMarkdownFileResponse {
  return {
    action: 'planner.pickMarkdownFile',
    mode: 'cancelled',
    message: 'Markdown file selection was cancelled.',
    filename: null,
    path: null,
    content: null,
    ...overrides,
  };
}
