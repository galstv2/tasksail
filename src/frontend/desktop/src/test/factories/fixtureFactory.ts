import type {
  EnvironmentStatusResponse,
  ObservabilitySnapshotResponse,
  ProviderFrontendDescriptor,
  QueueStatusResponse,
} from '../../shared/desktopContract';

type BootstrapInfo = {
  appName: string;
  platform: string;
  versions: { chrome: string; electron: string; node: string };
};

export function createBootstrapInfo(
  overrides: Partial<BootstrapInfo> = {},
): BootstrapInfo {
  return {
    appName: 'TaskSail',
    platform: 'linux',
    versions: { chrome: '131.0.0', electron: '35.0.0', node: '22.0.0' },
    ...overrides,
  };
}

export function createProviderFrontendDescriptor(
  overrides: Partial<ProviderFrontendDescriptor> = {},
): ProviderFrontendDescriptor {
  return {
    providerId: 'test-provider',
    homeDirName: 'test-home',
    registryPath: '/repo/.provider/registry.json',
    agentConfigPaths: {
      root: '.provider',
      instructions: '.provider/instructions',
      prompts: '.provider/prompts',
      profiles: '.provider/agents',
      registry: '.provider/registry.json',
    },
    promptPathEnvVars: { handoffsDir: 'TEST_HANDOFFS_DIR', implStepsDir: 'TEST_IMPL_STEPS_DIR' },
    contextPackEnvVars: { paths: 'TEST_CONTEXT_PACK_PATHS', searchRoots: 'TEST_CONTEXT_PACK_SEARCH_ROOTS' },
    roster: [
      { agentId: 'planning-agent', roleName: 'Planning Specialist', humanName: 'Lily', workflowOrder: 1 },
      { agentId: 'product-manager', roleName: 'Product Manager', humanName: 'Alice', workflowOrder: 2 },
      { agentId: 'software-engineer', roleName: 'Software Engineer', humanName: 'Dalton', workflowOrder: 3 },
      { agentId: 'qa', roleName: 'QA', humanName: 'Ron', workflowOrder: 4 },
    ],
    ...overrides,
  };
}

export function createQueueStatus(
  overrides: Partial<QueueStatusResponse> = {},
): QueueStatusResponse {
  return {
    action: 'queue.readStatus',
    mode: 'observed',
    queueDepth: 0,
    pendingReviewCount: 0,
    activeTaskId: null,
    message: 'Queue is empty.',
    ...overrides,
  };
}

export function createEnvironmentStatus(
  overrides: Partial<EnvironmentStatusResponse> = {},
): EnvironmentStatusResponse {
  return {
    action: 'environment.readStatus',
    mode: 'read-only',
    message: 'Environment healthy.',
    platform: 'linux',
    repoRoot: '/repo',
    packageOutputDir: '/repo/dist',
    packageArtifactName: 'desktop',
    packageCommand: 'npm run package:linux',
    hostMode: 'repo-root-native',
    validationSummary: 'All checks passed.',
    launchPolicy: 'standard',
    helperStatuses: [],
    contextPackCommand: 'tsx src/backend/platform/context-pack/cli.ts',
    contextPackWritePlanHint: '',
    bootstrapFlowHint: '',
    ...overrides,
  };
}

export function createObservabilitySnapshot(
  overrides: Partial<ObservabilitySnapshotResponse> = {},
): ObservabilitySnapshotResponse {
  return {
    action: 'observability.readSnapshot',
    mode: 'read-only',
    message: 'Snapshot captured.',
    queueDepth: 0,
    pendingReviewCount: 0,
    activeTaskId: null,
    activeTaskTitle: null,
    currentState: 'idle',
    activeTasks: [],
    plannerBroker: {
      sessionId: null,
      brokerStatus: 'idle',
      activeTurnId: null,
      queuedTurnCount: 0,
      cliSessionId: null,
      lastTurnSource: 'none',
      lastTurnOutcome: 'idle',
      lastTurnAt: null,
      lastTurnHadContent: false,
      lastExitCode: null,
      turnCount: 0,
      error: null,
    },
    lifecycle: [],
    artifactReferences: [],
    policyBoundary: 'standard',
    ...overrides,
  };
}
