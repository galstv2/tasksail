import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const existsSync = vi.fn();
const testLogger = vi.hoisted(() => {
  const logger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    child: () => typeof logger;
  } = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return logger;
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync,
  };
});

vi.mock('../metadata.js', () => ({
  loadAgentRegistry: vi.fn(),
  resolveAgentProfile: vi.fn(),
  resolveActiveModel: vi.fn(),
}));

vi.mock('../autonomy.js', () => ({
  resolveAutonomyProfile: vi.fn(),
  buildAgentArgs: vi.fn(),
  formatAgentCommand: vi.fn(),
}));

vi.mock('../environment.js', () => ({
  buildAgentEnvironment: vi.fn(),
  buildAutonomyEnvironment: vi.fn(),
}));

vi.mock('../guardrails.js', async () => {
  const { createGuardrailsMockModule } = await import('./guardrailsMockFactory.js');
  return createGuardrailsMockModule();
});

vi.mock('../confinement.js', () => ({
  captureChangedPathsSnapshot: vi.fn(),
  validateDaltonBoundaryChanges: vi.fn(),
  DaltonConfinementError: class DaltonConfinementError extends Error {
    violationPaths: string[];

    constructor(message: string, violationPaths: string[]) {
      super(message);
      this.violationPaths = violationPaths;
    }
  },
}));

vi.mock('../processLifecycle.js', () => ({
  launchAgent: vi.fn(),
  waitForAgentDetailed: vi.fn(),
}));

vi.mock('../pythonHelpers.js', () => ({
  captureCodeDiff: vi.fn(),
  prepareExternalMcpLaunchContext: vi.fn(),
}));

vi.mock('../../context-pack/focusedRepo.js', async () => {
  const actual = await vi.importActual<typeof import('../../context-pack/focusedRepo.js')>(
    '../../context-pack/focusedRepo.js',
  );
  return {
    ...actual,
    resolveFocusedRepoRoot: vi.fn(),
    resolveSelectedPrimaryRepoRoot: vi.fn(),
    explainSelectedPrimaryBoundaryFailure: vi.fn(async () => 'no authoritative selection found.'),
  };
});

vi.mock('../../context-pack/taskPackSnapshot.js', () => ({
  loadTaskPackSnapshot: vi.fn(),
}));

vi.mock('../../queue/taskJson.js', () => ({
  readTaskJsonSafe: vi.fn(),
}));

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    resolvePaths: vi.fn(),
    stripWrappingQuotes: actual.stripWrappingQuotes,
    getErrorMessage: actual.getErrorMessage,
    canonicalRoot: actual.canonicalRoot,
    isPathWithinBoundary: actual.isPathWithinBoundary,
    createLogger: () => testLogger,
    emitTaskProgressEvent: vi.fn(async () => undefined),
    normalizeAgentLaunchPhase: actual.normalizeAgentLaunchPhase,
    normalizeTaskAgentLaunchOutcome: actual.normalizeTaskAgentLaunchOutcome,
    ensureDir: vi.fn(async () => undefined),
    newSpanId: vi.fn(() => 'test-span-id'),
    writeProtocolStdout: vi.fn(),
  };
});

vi.mock('../../core/io.js', () => ({
  readTextFile: vi.fn(),
}));

vi.mock('../artifactCompletion.js', async () => {
  const actual = await vi.importActual<typeof import('../artifactCompletion.js')>('../artifactCompletion.js');
  return {
    ...actual,
    checkAgentArtifactCompletion: vi.fn(),
    checkAgentArtifactCompletionDetails: vi.fn(),
    buildAgentArtifactRemediationPrompt: vi.fn(),
  };
});

vi.mock('../sessionReceipts.js', () => ({
  writeSessionStartReceipt: vi.fn(),
  writeSessionTerminalReceipt: vi.fn(),
}));

vi.mock('../../container/sharedMcp.js', () => ({
  getSharedMcpUrl: vi.fn(async () => 'http://localhost:8811/sse'),
  resolveContextPackContainerPath: vi.fn(() => '/workspace/context-pack'),
  runtimeRequiresContainerPaths: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn(async () => ({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'docker',
    container_engine_host: null,
    container_engine_wsl_distro: null,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  })),
}));

const { runRoleAgent } = await import('../roleAgent.js');
const { loadAgentRegistry, resolveAgentProfile, resolveActiveModel } = await import('../metadata.js');
const { resolveAutonomyProfile, buildAgentArgs, formatAgentCommand } = await import('../autonomy.js');
const { buildAgentEnvironment, buildAutonomyEnvironment } = await import('../environment.js');
const { resolvePaths } = await import('../../core/index.js');
const { readTextFile } = await import('../../core/io.js');
const { resolveFocusedRepoRoot } = await import('../../context-pack/focusedRepo.js');
const { resolveSelectedPrimaryRepoRoot } = await import('../../context-pack/focusedRepo.js');
const { loadTaskPackSnapshot } = await import('../../context-pack/taskPackSnapshot.js');
const { readTaskJsonSafe } = await import('../../queue/taskJson.js');
const { launchAgent, waitForAgentDetailed } = await import('../processLifecycle.js');
const { captureCodeDiff, prepareExternalMcpLaunchContext } = await import('../pythonHelpers.js');
const { runRuntimePolicyCheck, writeGuardrailReceipt, guardrailReceiptPath } = await import('../guardrails.js');
const { captureChangedPathsSnapshot, validateDaltonBoundaryChanges, DaltonConfinementError } = await import('../confinement.js');
const { checkAgentArtifactCompletionDetails } = await import('../artifactCompletion.js');
const { buildAgentArtifactRemediationPrompt } = await import('../artifactCompletion.js');
const { writeSessionStartReceipt, writeSessionTerminalReceipt } = await import('../sessionReceipts.js');
const { runtimeRequiresContainerPaths } = await import('../../container/sharedMcp.js');

const mockedLoadAgentRegistry = vi.mocked(loadAgentRegistry);
const mockedResolveAgentProfile = vi.mocked(resolveAgentProfile);
const mockedResolveActiveModel = vi.mocked(resolveActiveModel);
const mockedResolveAutonomyProfile = vi.mocked(resolveAutonomyProfile);
const mockedBuildAgentArgs = vi.mocked(buildAgentArgs);
const mockedFormatAgentCommand = vi.mocked(formatAgentCommand);
const mockedBuildAgentEnvironment = vi.mocked(buildAgentEnvironment);
const mockedBuildAutonomyEnvironment = vi.mocked(buildAutonomyEnvironment);
const mockedRuntimeRequiresContainerPaths = vi.mocked(runtimeRequiresContainerPaths);
const mockedResolvePaths = vi.mocked(resolvePaths);
const mockedReadTextFile = vi.mocked(readTextFile);
const mockedResolveFocusedRepoRoot = vi.mocked(resolveFocusedRepoRoot);
const mockedResolveSelectedPrimaryRepoRoot = vi.mocked(resolveSelectedPrimaryRepoRoot);
const mockedLoadTaskPackSnapshot = vi.mocked(loadTaskPackSnapshot);
const mockedReadTaskJsonSafe = vi.mocked(readTaskJsonSafe);
const mockedLaunchAgent = vi.mocked(launchAgent);
const mockedWaitForAgentDetailed = vi.mocked(waitForAgentDetailed);
const mockedCaptureCodeDiff = vi.mocked(captureCodeDiff);
const mockedPrepareExternalMcpLaunchContext = vi.mocked(prepareExternalMcpLaunchContext);
const mockedRunRuntimePolicyCheck = vi.mocked(runRuntimePolicyCheck);
const mockedWriteGuardrailReceipt = vi.mocked(writeGuardrailReceipt);
const mockedGuardrailReceiptPath = vi.mocked(guardrailReceiptPath);
const mockedCheckAgentArtifactCompletionDetails = vi.mocked(checkAgentArtifactCompletionDetails);
const mockedBuildAgentArtifactRemediationPrompt = vi.mocked(buildAgentArtifactRemediationPrompt);
const mockedWriteSessionStartReceipt = vi.mocked(writeSessionStartReceipt);
const mockedWriteSessionTerminalReceipt = vi.mocked(writeSessionTerminalReceipt);
const mockedCaptureChangedPathsSnapshot = vi.mocked(captureChangedPathsSnapshot);
const mockedValidateDaltonBoundaryChanges = vi.mocked(validateDaltonBoundaryChanges);
const mockedExistsSync = vi.mocked(existsSync);

function mockTaskSidecarWorktrees(repoBindings: Array<{ originalRoot: string; worktreeRoot: string }>, readonlyContextBindings: Array<{ originalRoot: string; worktreeRoot: string; repoId?: string }> = []): void {
  mockedReadTaskJsonSafe.mockReturnValue({
    contextPackBinding: {
      repoBindings: repoBindings.map((binding) => ({
        ...binding,
        worktreeBranch: 'task/t1',
        baseCommitSha: 'abc123',
      })),
      readonlyContextBindings: readonlyContextBindings.map((binding) => ({
        ...binding,
        baseCommitSha: 'def456',
        repoId: binding.repoId ?? 'support',
        role: 'support',
      })),
    },
  } as never);
}

function setupCommonMocks(): void {
  mockedRuntimeRequiresContainerPaths.mockResolvedValue(true);
  mockedResolvePaths.mockReturnValue({
    repoRoot: '/repo',
    agentWorkSpace: '/repo/AgentWorkSpace',
    dropbox: '/repo/AgentWorkSpace/dropbox',
    pendingItems: '/repo/AgentWorkSpace/pendingitems',
    handoffs: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs',
    templates: '/repo/AgentWorkSpace/templates',
    implementationSteps: '/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps',
    qmd: '/repo/AgentWorkSpace/qmd',
    errorItems: '/repo/AgentWorkSpace/error-items',
    platformState: '/repo/.platform-state',
    guardrails: '/repo/.platform-state/runtime/guardrails',
    taskRuntime: '/repo/.platform-state/runtime',
  });
  mockedLoadAgentRegistry.mockResolvedValue({ agents: [] } as never);
  mockedResolveAgentProfile.mockReturnValue({
    id: 'dalton',
    registryId: 'software-engineer',
    displayName: 'Dalton',
    role: 'Software Engineer',
    requiredModel: 'gpt-4.1',
    autonomyProfile: 'repo-executor',
    workflowOrder: 4,
    wallClockTimeoutS: 600,
  } as never);
  mockedResolveActiveModel.mockReturnValue('gpt-4.1');
  mockedResolveAutonomyProfile.mockReturnValue({
    model: 'gpt-4.1',
    autonomyProfile: 'repo-executor',
    allowedDirs: [],
    disallowTempDir: false,
  });
  mockedBuildAgentArgs.mockImplementation((_repoRoot, _profile, _intent, options) => ({
    args: ['--agent', 'software-engineer'],
    launchCwd: options.launchContext.requestedCwd,
    inlineAgentContext: false,
    resolvedToolPolicy: {
      allowAllTools: true,
      noAskUser: true,
      allowTools: [],
      denyTools: [],
    },
  }));
  mockedBuildAgentEnvironment.mockReturnValue({});
  mockedBuildAutonomyEnvironment.mockReturnValue({
    RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: '{"profile":"repo-executor"}',
    RUN_ROLE_AGENT_AUTONOMY_ALLOW_TOOLS_JSON: '["editFiles","runCommand"]',
  });
  mockedResolveFocusedRepoRoot.mockResolvedValue(undefined);
  mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
  mockTaskSidecarWorktrees(
    [{ originalRoot: '/ctx/crud-app', worktreeRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app' }],
    [{ originalRoot: '/ctx/shared-lib', worktreeRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib' }],
  );
  mockedLoadTaskPackSnapshot.mockResolvedValue({
    schemaVersion: 2,
    stagedAt: '2026-01-01T00:00:00Z',
    taskId: 'task-test-001',
    contextPackDir: '/ctx',
    contextPackId: 'ctx',
    estateType: 'distributed-platform',
    primary: { repoId: 'crud-app', focusId: null, repoRoot: '/ctx/crud-app', primaryFocusRelativePath: null },
    support: [],
    focusAreas: [],
    selectedFocusIds: [],
    qmdScopeRoot: '',
    estateRepoIds: ['crud-app'],
    declaredRepoRoots: ['/ctx/crud-app'],
    deepFocus: {
      enabled: false,
      primaryFocusTargetKind: null,
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      writableRoots: [],
      readonlyContextRoots: [],
      warnings: [],
    },
  } as never);
  mockedRunRuntimePolicyCheck.mockResolvedValue({
    stdout: '',
    stderr: '',
    exitCode: 0,
  });
  mockedCaptureChangedPathsSnapshot.mockImplementation(async (roots: string[]) => ({
    byRepoRoot: Object.fromEntries(roots.map((root) => [root, []])),
  }));
  mockedValidateDaltonBoundaryChanges.mockResolvedValue(undefined);
  mockedCaptureCodeDiff.mockResolvedValue({
    stdout: 'crud-app',
    stderr: '',
    exitCode: 0,
  });
  mockedPrepareExternalMcpLaunchContext.mockResolvedValue({
    status: 'not-applicable',
    reason: 'no external MCP servers apply to this agent',
    injectionEnabled: false,
    launchDir: `${process.cwd()}/.platform-state/runtime/copilot-home/test-launch`,
    envExports: {
      EXTERNAL_MCP_CONTEXT_STATUS: 'not-applicable',
    },
    resolvedServers: [],
    selectedServerIds: [],
    excludedServerIds: [],
  });
  mockedCheckAgentArtifactCompletionDetails.mockResolvedValue({ complete: true, reasons: [] });
  mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue(
    'Use the exact absolute workflow-artifact path shown below.\n- $COPILOT_HANDOFFS_DIR/issues.md',
  );
  mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/dalton.json');
  mockedWriteGuardrailReceipt.mockResolvedValue(undefined);
  mockedWriteSessionStartReceipt.mockResolvedValue('/repo/.platform-state/runtime/role-sessions/dalton.json');
  mockedWriteSessionTerminalReceipt.mockResolvedValue(undefined);
  mockedReadTextFile.mockImplementation(async (filePath: string) => {
    if (filePath.endsWith('/.github/copilot/prompts/execute-task.prompt.md')) {
      return 'Execute the assigned implementation slice now.';
    }
    if (filePath.endsWith('/.github/copilot/prompts/execute-task-retry.prompt.md')) {
      return 'Fix the boundary mistake and finish the assigned slice.';
    }
    if (filePath.includes('/.github/copilot/prompts/')) return 'Continue the current task.';
    return '';
  });
}

function useDaltonVerifyProfile(): void {
  mockedResolveAgentProfile.mockReturnValue({
    id: 'dalton-verify',
    registryId: 'software-engineer-verify',
    displayName: 'Dalton (Verify)',
    role: 'Verification Engineer',
    requiredModel: 'gpt-4.1',
    autonomyProfile: 'repo-executor',
    workflowOrder: 99,
    wallClockTimeoutS: 600,
  } as never);
}

describe('runRoleAgent skip-workflow-check guardrail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
    delete process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];
  });

  afterEach(() => {
    delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
    delete process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];
    vi.restoreAllMocks();
  });

  it('rejects skip-workflow-check without ALLOW_INTERNAL_BYPASS', async () => {
    await expect(
      runRoleAgent({
        agentId: 'dalton',
        taskId: 't1',
        skipWorkflowValidation: true,
        dryRun: true,
      }),
    ).rejects.toThrow('RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS');
  });

  it('rejects skip-workflow-check with unknown orchestrator ID', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'rogue-script';

    await expect(
      runRoleAgent({
        agentId: 'dalton',
        taskId: 't1',
        skipWorkflowValidation: true,
        dryRun: true,
      }),
    ).rejects.toThrow('known orchestrator ID');
  });

  it('accepts skip-workflow-check with valid bypass env vars', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    mockedFormatAgentCommand.mockReturnValue('copilot --agent software-engineer');

    const result = await runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      skipWorkflowValidation: true,
      dryRun: true,
    });

    expect(result.exitCode).toBe(0);
  });

  it('launches Dalton from the focused primary repo with inlined agent context and targeting metadata', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'crud-app',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      declaredRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['crud-app', 'shared-lib'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    const launchCall = mockedLaunchAgent.mock.calls[0];
    const launchOpts = launchCall[1] as { cwd: string };
    expect(launchOpts.cwd).toBe('/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app');
    expect(mockedBuildAgentArgs).toHaveBeenCalledWith(
      '/repo',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        launchContext: expect.objectContaining({ requestedCwd: '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app' }),
      }),
    );
    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(autonomyArgs.allowedDirs).not.toContain('/repo');
    expect(autonomyArgs.allowedDirs).not.toContain('/repo/AgentWorkSpace');
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(1, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(2, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(mockedBuildAutonomyEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      autonomyArgs,
      expect.anything(),
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo',
      expect.objectContaining({
        primaryRepoRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
        visibleRepoRoots: ['/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app', '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib'],
        selectedRepoIds: ['crud-app', 'shared-lib'],
      }),
      '/ctx',
      expect.anything(),
    );
    expect(mockedBuildAgentEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      '/workspace/context-pack',
      '/repo',
      expect.objectContaining({ skipHandoffEnvVars: true }),
      't1',
    );
  });

  it('adds focused repo roots for Lily instead of the full context pack dir', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    mockedResolveAgentProfile.mockReturnValue({
      id: 'lily',
      registryId: 'planning-agent',
      displayName: 'Lily',
      role: 'Planning Intake',
      requiredModel: 'gpt-4.1',
      autonomyProfile: 'artifact-author',
      workflowOrder: 1,
      wallClockTimeoutS: 600,
    } as never);
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: ['/repo/AgentWorkSpace/dropbox', '/repo/AgentWorkSpace/templates'],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveFocusedRepoRoot.mockResolvedValue({
      primaryRepoId: 'crud-app',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      declaredRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['crud-app', 'shared-lib'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'lily',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace/dropbox',
      '/repo/AgentWorkSpace/templates',
      '/repo/AgentWorkSpace/tasks/t1',
      '/repo/AgentWorkSpace/qmd',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    // Lily must NOT have pendingitems access — only product-manager (Alice)
    // gets it via per-profile allowed_dirs in registry.json.
    expect(autonomyArgs.allowedDirs).not.toContain('/repo/AgentWorkSpace/pendingitems');
    expect(mockedBuildAgentEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lily' }),
      '/workspace/context-pack',
      '/repo',
      expect.objectContaining({ skipHandoffEnvVars: false }),
      't1',
    );
    expect(mockedBuildAutonomyEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lily' }),
      autonomyArgs,
      expect.anything(),
      '/repo',
      '/repo',
      expect.objectContaining({
        primaryRepoRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
        visibleRepoRoots: ['/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app', '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib'],
        selectedRepoIds: ['crud-app', 'shared-lib'],
      }),
      '/ctx',
      expect.anything(),
    );
  });

  it('§2.10 fences artifact-author launches to per-task tasks/<taskId> across two parallel taskIds', async () => {
    // Cross-task isolation regression: Alice on T1 must not see T2's task subtree
    // and vice versa. The only --add-dir backstop preventing two parallel
    // artifact-author launches from writing into each other's task workspaces
    // lives in roleAgent.ts. If that catch-all reverts to bare AgentWorkSpace
    // both launches would share the same writable surface and this test fails.
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    mockedResolveAgentProfile.mockReturnValue({
      id: 'alice',
      registryId: 'product-manager',
      displayName: 'Alice',
      role: 'Product Manager',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 2,
      wallClockTimeoutS: 600,
    } as never);
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    // Each runRoleAgent invocation reuses the same autonomyArgs object via the
    // mock, so use a fresh object per invocation to capture per-launch state.
    const t1Autonomy = {
      model: 'gpt-5.4',
      autonomyProfile: 'artifact-author' as const,
      allowedDirs: [],
      disallowTempDir: true,
    };
    const t2Autonomy = {
      model: 'gpt-5.4',
      autonomyProfile: 'artifact-author' as const,
      allowedDirs: [],
      disallowTempDir: true,
    };

    mockedResolveAutonomyProfile.mockReturnValueOnce(t1Autonomy);
    await runRoleAgent({
      agentId: 'alice',
      taskId: 'task-A',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    mockedResolveAutonomyProfile.mockReturnValueOnce(t2Autonomy);
    await runRoleAgent({
      agentId: 'alice',
      taskId: 'task-B',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    // T1 sees only task-A's subtree.
    expect(t1Autonomy.allowedDirs).toContain('/repo/AgentWorkSpace/tasks/task-A');
    expect(t1Autonomy.allowedDirs).not.toContain('/repo/AgentWorkSpace/tasks/task-B');
    expect(t1Autonomy.allowedDirs).not.toContain('/repo/AgentWorkSpace');

    // T2 sees only task-B's subtree.
    expect(t2Autonomy.allowedDirs).toContain('/repo/AgentWorkSpace/tasks/task-B');
    expect(t2Autonomy.allowedDirs).not.toContain('/repo/AgentWorkSpace/tasks/task-A');
    expect(t2Autonomy.allowedDirs).not.toContain('/repo/AgentWorkSpace');

    // Both share the read-mostly roots (templates, qmd).
    for (const shared of [
      '/repo/AgentWorkSpace/templates',
      '/repo/AgentWorkSpace/qmd',
    ]) {
      expect(t1Autonomy.allowedDirs).toContain(shared);
      expect(t2Autonomy.allowedDirs).toContain(shared);
    }

    // pendingitems is NOT a universal grant — it must come from the per-profile
    // allowed_dirs in registry.json (currently only product-manager declares it).
    // The mock here returns Alice's profile without allowed_dirs, so neither
    // launch should see pendingitems via the universal catch-all.
    expect(t1Autonomy.allowedDirs).not.toContain('/repo/AgentWorkSpace/pendingitems');
    expect(t2Autonomy.allowedDirs).not.toContain('/repo/AgentWorkSpace/pendingitems');
  });

  it('launches Dalton from the selected monolith focus subfolder when present', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'mono',
      primaryRepoRoot: '/ctx/mono',
      primaryFocusId: 'sink',
      primaryFocusRelativePath: 'services/sink',
      visibleRepoRoots: ['/ctx/mono'],
      declaredRepoRoots: ['/ctx/mono'],
      estateType: 'monolith',
      selectedRepoIds: ['mono'],
      selectedFocusIds: ['sink'],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockTaskSidecarWorktrees([{ originalRoot: '/ctx/mono', worktreeRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/mono' }]);
    mockedLoadTaskPackSnapshot.mockResolvedValueOnce({
      schemaVersion: 2,
      stagedAt: '2026-01-01T00:00:00Z',
      taskId: 't1',
      contextPackDir: '/ctx',
      contextPackId: 'ctx',
      estateType: 'monolith',
      primary: { repoId: 'mono', focusId: 'sink', repoRoot: '/ctx/mono', primaryFocusRelativePath: 'services/sink' },
      support: [],
      focusAreas: [],
      selectedFocusIds: ['sink'],
      qmdScopeRoot: '',
      estateRepoIds: ['mono'],
      declaredRepoRoots: ['/ctx/mono'],
      deepFocus: {
        enabled: false,
        primaryFocusTargetKind: 'directory',
        primaryFocusTargets: [],
        selectedTestTarget: null,
        supportTargets: [],
        writableRoots: [],
        readonlyContextRoots: [],
        warnings: [],
      },
    } as never);
    mockedExistsSync.mockImplementation((candidate: string) => candidate === '/repo/AgentWorkSpace/tasks/t1/worktrees/mono/services/sink');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    const launchCall = mockedLaunchAgent.mock.calls[0];
    const launchOpts = launchCall[1] as { cwd: string };
    expect(launchOpts.cwd).toBe('/repo/AgentWorkSpace/tasks/t1/worktrees/mono/services/sink');
    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace/tasks/t1/worktrees/mono',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(1, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/mono',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(2, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/mono',
    ]);
  });

  it('launches Dalton from the parent directory when Deep Focus selects a file', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'mono',
      primaryRepoRoot: '/ctx/mono',
      primaryFocusRelativePath: 'services/sink/index.ts',
      primaryFocusTargetKind: 'file',
      visibleRepoRoots: ['/ctx/mono'],
      declaredRepoRoots: ['/ctx/mono'],
      estateType: 'monolith',
      selectedRepoIds: ['mono'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedExistsSync.mockImplementation((candidate: string) => candidate === '/ctx/mono/services/sink');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    const launchCall = mockedLaunchAgent.mock.calls[0];
    const launchOpts = launchCall[1] as { cwd: string };
    expect(launchOpts.cwd).toBe('/ctx/mono/services/sink');
  });

  it('fails closed when Dalton cannot resolve an authoritative selected primary boundary', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('authoritative active task/workspace selection');
    expect(mockedLaunchAgent).not.toHaveBeenCalled();
  });

  it('blocks Dalton before provider spawn when Alice artifacts contain selected original roots', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    mockedReadTaskJsonSafe.mockReturnValue({
      contextPackBinding: {
        repoBindings: [{
          originalRoot: '/ctx/crud-app',
          worktreeRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
          worktreeBranch: 'task/t1',
          baseCommitSha: 'abc123',
        }],
      },
    } as never);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'crud-app',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app'],
      declaredRepoRoots: ['/ctx/crud-app'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['crud-app'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedReadTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('/.github/copilot/prompts/execute-task.prompt.md')) return 'Execute.';
      if (filePath.endsWith('/implementation-spec.md')) return 'Run validation from /ctx/crud-app.';
      return '';
    });

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('Agent artifact containment failed');
    expect(mockedLaunchAgent).not.toHaveBeenCalled();
  });

  it('allows Dalton launch when Alice artifacts contain worktree or repo-relative paths', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    mockedReadTaskJsonSafe.mockReturnValue({
      contextPackBinding: {
        repoBindings: [{
          originalRoot: '/ctx/crud-app',
          worktreeRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
          worktreeBranch: 'task/t1',
          baseCommitSha: 'abc123',
        }],
      },
    } as never);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'crud-app',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app'],
      declaredRepoRoots: ['/ctx/crud-app'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['crud-app'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedReadTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('/.github/copilot/prompts/execute-task.prompt.md')) return 'Execute.';
      if (filePath.endsWith('/implementation-spec.md')) return 'Run validation from /repo/AgentWorkSpace/tasks/t1/worktrees/crud-app and edit crud-app/src/index.ts.';
      return '';
    });
    mockedLaunchAgent.mockReturnValue({ pid: 1234 } as never);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).resolves.toMatchObject({ exitCode: 0 });
    expect(mockedLaunchAgent).toHaveBeenCalled();
  });

  it('fails closed when dalton-verify cannot resolve an authoritative selected primary boundary', async () => {
    useDaltonVerifyProfile();
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';

    await expect(runRoleAgent({
      agentId: 'dalton-verify',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('authoritative active task/workspace selection');
    expect(mockedLaunchAgent).not.toHaveBeenCalled();
  });

  it('limits dalton-verify TaskSail visibility to the staged verification temp dir', async () => {
    useDaltonVerifyProfile();
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'mono',
      primaryRepoRoot: '/ctx/mono',
      visibleRepoRoots: ['/ctx/mono'],
      declaredRepoRoots: ['/ctx/mono'],
      estateType: 'monolith',
      selectedRepoIds: ['mono'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'dalton-verify',
      taskId: 't1',
      contextPackDir: '/ctx',
      verificationTempAllowedDir: '/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z',
      skipWorkflowValidation: true,
    });

    expect(autonomyArgs.allowedDirs).toEqual([
      '/ctx/mono',
      '/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z',
    ]);
    expect(autonomyArgs.allowedDirs).not.toContain('/repo');
    expect(autonomyArgs.allowedDirs).not.toContain('/repo/AgentWorkSpace');
  });

  it('fails closed when the selected monolith focus subfolder is missing on disk', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'mono',
      primaryRepoRoot: '/ctx/mono',
      primaryFocusId: 'sink',
      primaryFocusRelativePath: 'services/sink',
      visibleRepoRoots: ['/ctx/mono'],
      declaredRepoRoots: ['/ctx/mono'],
      estateType: 'monolith',
      selectedRepoIds: ['mono'],
      selectedFocusIds: ['sink'],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedExistsSync.mockReturnValue(false);

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow(
      'Cannot launch agent "dalton": selected monolith focus subfolder "services/sink" does not exist at "/ctx/mono/services/sink".',
    );
    expect(mockedLaunchAgent).not.toHaveBeenCalled();
  });

  it('fails closed when the parent directory for a Deep Focus file target is missing on disk', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'mono',
      primaryRepoRoot: '/ctx/mono',
      primaryFocusRelativePath: 'services/sink/index.ts',
      primaryFocusTargetKind: 'file',
      visibleRepoRoots: ['/ctx/mono'],
      declaredRepoRoots: ['/ctx/mono'],
      estateType: 'monolith',
      selectedRepoIds: ['mono'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedExistsSync.mockReturnValue(false);

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow(
      'Cannot launch agent "dalton": parent directory for selected focus file "services/sink/index.ts" does not exist at "/ctx/mono/services/sink".',
    );
    expect(mockedLaunchAgent).not.toHaveBeenCalled();
  });

  it('fails when the Dalton confinement retry exits non-zero', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'crud-app',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      declaredRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['crud-app', 'shared-lib'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedCaptureChangedPathsSnapshot
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': [], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': [] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': ['src/app.ts'], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': ['src/leak.ts'] } });
    mockedValidateDaltonBoundaryChanges.mockImplementation(() => {
      throw new DaltonConfinementError('out-of-bound edits', ['/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib/src/leak.ts']);
    });
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed
      .mockResolvedValueOnce({
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdoutTail: '',
        stderrTail: 'retry failed',
        terminationReason: 'exited',
        signalCode: null,
      });

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('confinement retry exited with code 1');

    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(1, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(2, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/dalton.json',
      expect.objectContaining({
        status: 'failed',
        exit_code: 1,
        stderr_tail: 'retry failed',
      }),
    );
  });

  it('does not retry when only the live TaskSail checkout is dirty outside task sidecar roots', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockTaskSidecarWorktrees(
      [{ originalRoot: '/ctx/crud-app', worktreeRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/tasksail' }],
      [{ originalRoot: '/ctx/shared-lib', worktreeRoot: '/repo/AgentWorkSpace/tasks/t1/worktrees/support' }],
    );
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'tasksail',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      declaredRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['tasksail'],
      selectedFocusIds: [],
      writableRoots: [{
        repoLocalPath: '/repo/AgentWorkSpace/tasks/t1/worktrees/tasksail',
        path: '',
        kind: 'directory',
        reason: 'selected-primary',
      }],
      readonlyContextRoots: [{
        repoLocalPath: '/repo/AgentWorkSpace/tasks/t1/worktrees/support',
        path: '',
        kind: 'directory',
        reason: 'support-target',
      }],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedCaptureChangedPathsSnapshot.mockImplementation(async (roots: string[]) => ({
      byRepoRoot: Object.fromEntries(roots.map((root) => [
        root,
        root === '/repo' || root === '/live/tasksail'
          ? ['operator-live-edit.ts']
          : [],
      ])),
    }));
    mockedValidateDaltonBoundaryChanges.mockImplementation(async (options: {
      after: { byRepoRoot: Record<string, string[]> };
    }) => {
      if (options.after.byRepoRoot['/repo']?.length || options.after.byRepoRoot['/live/tasksail']?.length) {
        throw new DaltonConfinementError('live checkout should not be monitored', ['/repo/operator-live-edit.ts']);
      }
    });
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).resolves.toMatchObject({ exitCode: 0 });

    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(1, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/tasksail',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/support',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(2, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/tasksail',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/support',
    ]);
    expect(mockedLaunchAgent).toHaveBeenCalledTimes(1);
    expect(testLogger.warn).not.toHaveBeenCalledWith(
      'dalton.confinement_retry.launching',
      expect.anything(),
    );
  });

  it('reruns Dalton once with the retry prompt after a confinement violation', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'crud-app',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      declaredRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['crud-app', 'shared-lib'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedCaptureChangedPathsSnapshot
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': [], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': [] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': ['src/app.ts'], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': ['src/leak.ts'] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': ['src/app.ts'], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': [] } });
    let sidecarReadsAtFirstValidation = 0;
    mockedValidateDaltonBoundaryChanges
      .mockImplementationOnce(() => {
        sidecarReadsAtFirstValidation = mockedReadTaskJsonSafe.mock.calls.length;
        throw new DaltonConfinementError('out-of-bound edits', ['/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib/src/leak.ts']);
      })
      .mockImplementationOnce(async () => undefined);
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed
      .mockResolvedValueOnce({
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      });

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(2);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(1, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(2, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(3, [
      '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app',
      '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib',
    ]);
    expect(mockedReadTaskJsonSafe.mock.calls.length).toBe(sidecarReadsAtFirstValidation);
    expect(mockedWriteSessionStartReceipt).toHaveBeenCalledTimes(2);
    const initialReceipt = mockedWriteSessionStartReceipt.mock.calls[0]?.[0] as {
      launchId: string;
    };
    const retryReceipt = mockedWriteSessionStartReceipt.mock.calls[1]?.[0] as {
      launchId: string;
      launchPhase?: string;
      retryOfLaunchId?: string;
    };
    expect(retryReceipt.launchId).not.toBe(initialReceipt.launchId);
    expect(retryReceipt.launchPhase).toBe('Confinement retry');
    expect(retryReceipt.retryOfLaunchId).toBe(initialReceipt.launchId);
    expect(testLogger.warn).toHaveBeenCalledWith(
      'dalton.confinement_retry.launching',
      { agentId: 'dalton', violationPathCount: 1 },
    );
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('Fix the boundary mistake and finish the assigned slice.'),
      ]),
    );
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib/src/leak.ts'),
      ]),
    );
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('writable roots listed below'),
      ]),
    );
    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/dalton.json',
      expect.objectContaining({
        status: 'passed',
      }),
    );
  });

  it('reruns dalton-verify once with the Dalton-family retry prompt after a confinement violation', async () => {
    useDaltonVerifyProfile();
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'crud-app',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      declaredRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['crud-app', 'shared-lib'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedCaptureChangedPathsSnapshot
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': [], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': [] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': ['src/app.ts'], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': ['src/leak.ts'] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': ['src/app.ts'], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': [] } });
    mockedValidateDaltonBoundaryChanges
      .mockImplementationOnce(() => {
        throw new DaltonConfinementError('out-of-bound edits', ['/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib/src/leak.ts']);
      })
      .mockImplementationOnce(async () => undefined);
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed
      .mockResolvedValueOnce({
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      });

    await expect(runRoleAgent({
      agentId: 'dalton-verify',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton-verify',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(2);
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('Fix the boundary mistake and finish the assigned slice.'),
      ]),
    );
    expect(mockedReadTextFile).toHaveBeenCalledWith('/repo/.github/copilot/prompts/execute-task-retry.prompt.md');
  });

  it('fails permanently when Dalton still violates confinement after the retry pass', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    const autonomyArgs = {
      model: 'gpt-4.1',
      allowTools: [],
      denyTools: [],
      allowedDirs: [],
      additionalFlags: [],
    };
    mockedResolveAutonomyProfile.mockReturnValue(autonomyArgs);
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoId: 'crud-app',
      primaryRepoRoot: '/ctx/crud-app',
      visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      declaredRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
      estateType: 'distributed-platform',
      selectedRepoIds: ['crud-app', 'shared-lib'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedCaptureChangedPathsSnapshot
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': [], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': [] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': ['src/app.ts'], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': ['src/leak.ts'] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo/AgentWorkSpace/tasks/t1/worktrees/crud-app': ['src/app.ts'], '/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib': ['src/leak.ts'] } });
    mockedValidateDaltonBoundaryChanges
      .mockImplementationOnce(() => {
        throw new DaltonConfinementError('out-of-bound edits', ['/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib/src/leak.ts']);
      })
      .mockImplementationOnce(() => {
        throw new DaltonConfinementError('retry still out-of-bound', ['/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib/src/leak.ts']);
      });
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed
      .mockResolvedValueOnce({
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      });

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('retry still out-of-bound');

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(2);
    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/dalton.json',
      expect.objectContaining({
        status: 'failed',
        termination_reason: 'confinement-violation',
        violation_paths: ['/repo/AgentWorkSpace/tasks/t1/worktrees/shared-lib/src/leak.ts'],
        writable_roots: [],
        readonly_context_roots: [],
      }),
    );
  });

  it('surfaces workflow-policy details from stdout JSON when stderr is empty', async () => {
    mockedRunRuntimePolicyCheck.mockResolvedValue({
      stdout: JSON.stringify({
        violations: [
          { message: 'Requested agent transition is not legal for the current workflow state.' },
        ],
        next_steps: ['Invoke qa for the current workflow state.'],
      }),
      stderr: '',
      exitCode: 1,
    });

    await expect(
      runRoleAgent({
        agentId: 'dalton',
      taskId: 't1',
      }),
    ).rejects.toThrow('Requested agent transition is not legal');

    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/dalton.json',
      expect.objectContaining({
        violations: expect.stringContaining('Requested agent transition is not legal'),
        policy_stdout: expect.stringContaining('"violations"'),
        policy_stderr: '',
      }),
    );
  });
});
