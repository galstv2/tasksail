import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const existsSync = vi.fn();

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

vi.mock('../guardrails.js', () => ({
  runRuntimePolicyCheck: vi.fn(),
  guardrailReceiptPath: vi.fn(),
  writeGuardrailReceipt: vi.fn(),
}));

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

vi.mock('../../context-pack/focusedRepo.js', () => ({
  resolveFocusedRepoRoot: vi.fn(),
  resolveSelectedPrimaryRepoRoot: vi.fn(),
  explainSelectedPrimaryBoundaryFailure: vi.fn(async () => 'no authoritative selection found.'),
}));

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    resolvePaths: vi.fn(),
    stripWrappingQuotes: actual.stripWrappingQuotes,
    getErrorMessage: actual.getErrorMessage,
  };
});

vi.mock('../../core/io.js', () => ({
  readTextFile: vi.fn(),
}));

vi.mock('../artifactCompletion.js', () => ({
  checkAgentArtifactCompletion: vi.fn(),
  buildAgentArtifactRemediationPrompt: vi.fn(),
}));

vi.mock('../sessionReceipts.js', () => ({
  writeSessionStartReceipt: vi.fn(),
  writeSessionTerminalReceipt: vi.fn(),
}));

vi.mock('../../container/sharedMcp.js', () => ({
  getSharedMcpUrl: vi.fn(),
  resolveContextPackContainerPath: vi.fn(),
  runtimeRequiresContainerPaths: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn(),
}));

const { runRoleAgent } = await import('../roleAgent.js');
const { loadAgentRegistry, resolveAgentProfile, resolveActiveModel } = await import('../metadata.js');
const { resolveAutonomyProfile, buildAgentArgs } = await import('../autonomy.js');
const { buildAgentEnvironment, buildAutonomyEnvironment } = await import('../environment.js');
const { resolvePaths } = await import('../../core/index.js');
const { readTextFile } = await import('../../core/io.js');
const { resolveFocusedRepoRoot } = await import('../../context-pack/focusedRepo.js');
const { resolveSelectedPrimaryRepoRoot } = await import('../../context-pack/focusedRepo.js');
const { launchAgent, waitForAgentDetailed } = await import('../processLifecycle.js');
const { captureCodeDiff, prepareExternalMcpLaunchContext } = await import('../pythonHelpers.js');
const { runRuntimePolicyCheck, writeGuardrailReceipt, guardrailReceiptPath } = await import('../guardrails.js');
const { captureChangedPathsSnapshot, validateDaltonBoundaryChanges } = await import('../confinement.js');
const { checkAgentArtifactCompletion } = await import('../artifactCompletion.js');
const { buildAgentArtifactRemediationPrompt } = await import('../artifactCompletion.js');
const { writeSessionStartReceipt, writeSessionTerminalReceipt } = await import('../sessionReceipts.js');
const { getSharedMcpUrl, resolveContextPackContainerPath, runtimeRequiresContainerPaths } = await import('../../container/sharedMcp.js');
const { getPlatformConfig } = await import('../../platform-config/get.js');

// Shared typed references to mocked functions.
const mockedLoadAgentRegistry = vi.mocked(loadAgentRegistry);
const mockedResolveAgentProfile = vi.mocked(resolveAgentProfile);
const mockedResolveActiveModel = vi.mocked(resolveActiveModel);
const mockedResolveAutonomyProfile = vi.mocked(resolveAutonomyProfile);
const mockedBuildAgentArgs = vi.mocked(buildAgentArgs);
const mockedBuildAgentEnvironment = vi.mocked(buildAgentEnvironment);
const mockedBuildAutonomyEnvironment = vi.mocked(buildAutonomyEnvironment);
const mockedResolvePaths = vi.mocked(resolvePaths);
const mockedReadTextFile = vi.mocked(readTextFile);
const mockedResolveFocusedRepoRoot = vi.mocked(resolveFocusedRepoRoot);
const mockedResolveSelectedPrimaryRepoRoot = vi.mocked(resolveSelectedPrimaryRepoRoot);
const mockedLaunchAgent = vi.mocked(launchAgent);
const mockedWaitForAgentDetailed = vi.mocked(waitForAgentDetailed);
const mockedCaptureCodeDiff = vi.mocked(captureCodeDiff);
const mockedPrepareExternalMcpLaunchContext = vi.mocked(prepareExternalMcpLaunchContext);
const mockedRunRuntimePolicyCheck = vi.mocked(runRuntimePolicyCheck);
const mockedWriteGuardrailReceipt = vi.mocked(writeGuardrailReceipt);
const mockedGuardrailReceiptPath = vi.mocked(guardrailReceiptPath);
const mockedCheckAgentArtifactCompletion = vi.mocked(checkAgentArtifactCompletion);
const mockedBuildAgentArtifactRemediationPrompt = vi.mocked(buildAgentArtifactRemediationPrompt);
const mockedWriteSessionStartReceipt = vi.mocked(writeSessionStartReceipt);
const mockedWriteSessionTerminalReceipt = vi.mocked(writeSessionTerminalReceipt);
const mockedCaptureChangedPathsSnapshot = vi.mocked(captureChangedPathsSnapshot);
const mockedValidateDaltonBoundaryChanges = vi.mocked(validateDaltonBoundaryChanges);
const mockedGetSharedMcpUrl = vi.mocked(getSharedMcpUrl);
const mockedResolveContextPackContainerPath = vi.mocked(resolveContextPackContainerPath);
const mockedRuntimeRequiresContainerPaths = vi.mocked(runtimeRequiresContainerPaths);
const mockedGetPlatformConfig = vi.mocked(getPlatformConfig);

/** Shared mock setup used by all describe blocks. */
function setupCommonMocks(): void {
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
  mockedBuildAgentArgs.mockReturnValue({
    args: ['--agent', 'software-engineer'],
    launchCwd: '/repo',
    inlineAgentContext: false,
    resolvedToolPolicy: {
      allowAllTools: true,
      noAskUser: true,
      allowTools: [],
      denyTools: [],
    },
  });
  mockedBuildAgentEnvironment.mockReturnValue({});
  mockedBuildAutonomyEnvironment.mockReturnValue({
    RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: '{"profile":"repo-executor"}',
    RUN_ROLE_AGENT_AUTONOMY_ALLOW_TOOLS_JSON: '["editFiles","runCommand"]',
  });
  mockedResolveFocusedRepoRoot.mockResolvedValue(undefined);
  mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
  mockedRunRuntimePolicyCheck.mockResolvedValue({
    stdout: '',
    stderr: '',
    exitCode: 0,
  });
  mockedCaptureChangedPathsSnapshot.mockResolvedValue({ byRepoRoot: {} });
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
    envExports: {
      EXTERNAL_MCP_CONTEXT_STATUS: 'not-applicable',
    },
    resolvedServers: [],
    selectedServerIds: [],
    excludedServerIds: [],
  });
  mockedCheckAgentArtifactCompletion.mockResolvedValue(true);
  mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue(
    'Use the exact absolute workflow-artifact path shown below.\n- $COPILOT_HANDOFFS_DIR/issues.md',
  );
  mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/dalton.json');
  mockedWriteGuardrailReceipt.mockResolvedValue(undefined);
  mockedWriteSessionStartReceipt.mockResolvedValue('/repo/.platform-state/runtime/role-sessions/dalton.json');
  mockedWriteSessionTerminalReceipt.mockResolvedValue(undefined);
  mockedGetSharedMcpUrl.mockResolvedValue('http://localhost:8811/sse');
  mockedRuntimeRequiresContainerPaths.mockResolvedValue(true);
  mockedGetPlatformConfig.mockResolvedValue({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'docker',
    container_engine_host: null,
    container_engine_wsl_distro: null,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  } as never);
  mockedResolveContextPackContainerPath.mockReturnValue('/workspace/context-pack');
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

describe('runRoleAgent external MCP launch integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
  });

  afterEach(() => {
    delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
    delete process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];
    vi.restoreAllMocks();
  });

  it('merges external MCP env exports when launch context injection is enabled', async () => {
    const launchDir = path.join(process.cwd(), '.platform-state', 'runtime', 'copilot-home', 'dalton-launch-test');
    const configPath = path.join(launchDir, 'mcp-config.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedPrepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      launchDir,
      contextFile: path.join(launchDir, 'mcp-capability-summary.md'),
      resolvedServers: [{
        id: 'github',
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: {},
      }],
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'available',
      },
      selectedServerIds: ['github'],
      excludedServerIds: [],
    });

    await runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      skipWorkflowValidation: true,
    });

    expect(mockedPrepareExternalMcpLaunchContext).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'dalton',
      repoRoot: '/repo',
      env: expect.objectContaining({
        RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: '{"profile":"repo-executor"}',
      }),
      abortSignal: undefined,
    }));
    const launchCall = mockedLaunchAgent.mock.calls[0];
    const argsArg = launchCall?.[0] as string[];
    const envArg = (launchCall?.[1] as { env: Record<string, string> }).env;
    expect(argsArg).toEqual(expect.arrayContaining([
      '--additional-mcp-config',
      `@${configPath}`,
    ]));
    expect(envArg['COPILOT_HOME']).toBeUndefined();
    expect(envArg['EXTERNAL_MCP_CONTEXT_STATUS']).toBe('available');
    expect(mockedBuildAutonomyEnvironment).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '/repo',
      '/repo',
      undefined,
      undefined,
      expect.objectContaining({
        status: 'available',
        injectionEnabled: true,
        selectedServerIds: ['github'],
        excludedServerIds: [],
      }),
    );
  });

  it('renders one provider MCP config with builtin repo-context headers and external servers', async () => {
    const launchDir = path.join(process.cwd(), '.platform-state', 'runtime', 'copilot-home', 'dalton-merged-mcp-test');
    const configPath = path.join(launchDir, 'mcp-config.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repo',
      visibleRepoRoots: ['/repo'],
      declaredRepoRoots: ['/repo'],
      estateType: 'monolith',
      primaryRepoId: 'repo',
      selectedRepoIds: ['repo'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedPrepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      launchDir,
      contextFile: path.join(launchDir, 'mcp-capability-summary.md'),
      resolvedServers: [{
        id: 'github',
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer test' },
      }],
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'available',
      },
      selectedServerIds: ['github'],
      excludedServerIds: [],
    });

    await runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/repo/context-pack',
      skipWorkflowValidation: true,
    });

    expect(mockedResolveContextPackContainerPath).toHaveBeenCalledWith(
      '/repo',
      '/repo/context-pack',
      [],
    );
    expect(mockedBuildAgentEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      '/workspace/context-pack',
      '/repo',
      expect.objectContaining({
        mcp: {
          url: 'http://localhost:8811/sse',
          port: 8811,
        },
      }),
      't1',
    );
    const argsArg = mockedLaunchAgent.mock.calls[0]?.[0] as string[];
    expect(argsArg).toEqual(expect.arrayContaining([
      '--additional-mcp-config',
      `@${configPath}`,
    ]));
    expect(JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(configPath, 'utf-8')))).toEqual({
      mcpServers: {
        'repo-context-mcp': {
          type: 'sse',
          url: 'http://localhost:8811/sse',
          headers: {
            'X-TaskSail-Task-Id': 't1',
            'X-TaskSail-Context-Pack-Dir': '/workspace/context-pack',
          },
        },
        github: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer test' },
        },
      },
    });
  });

  it('fails before launching when context pack cannot be mapped into the shared MCP container', async () => {
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repo',
      visibleRepoRoots: ['/repo'],
      declaredRepoRoots: ['/repo'],
      estateType: 'monolith',
      primaryRepoId: 'repo',
      selectedRepoIds: ['repo'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    } as never);
    mockedResolveContextPackContainerPath.mockImplementation(() => {
      throw new Error('context-pack-not-mounted: /external/context-pack');
    });

    await expect(runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      contextPackDir: '/external/context-pack',
      skipWorkflowValidation: true,
    })).rejects.toThrow(/context-pack-not-mounted/);
    expect(mockedLaunchAgent).not.toHaveBeenCalled();
  });

  it('launches without external MCP env when launch context is not applicable', async () => {
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedPrepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'not-applicable',
      reason: 'no external MCP servers apply to this agent',
      injectionEnabled: false,
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'not-applicable',
      },
      resolvedServers: [],
      selectedServerIds: [],
      excludedServerIds: [],
    });

    await expect(
      runRoleAgent({
        agentId: 'dalton',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton',
    });

    const launchCall = mockedLaunchAgent.mock.calls[0];
    const argsArg = launchCall?.[0] as string[];
    const envArg = (launchCall?.[1] as { env: Record<string, string> }).env;
    expect(argsArg).not.toContain('--additional-mcp-config');
    expect(envArg['COPILOT_HOME']).toBeUndefined();
    expect(envArg['EXTERNAL_MCP_CONTEXT_STATUS']).toBeUndefined();
  });

  it('warns and launches without external MCP env when helper preparation fails', async () => {
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedPrepareExternalMcpLaunchContext.mockRejectedValue(new Error('helper boom'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      runRoleAgent({
        agentId: 'dalton',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton',
    });

    const launchCall = mockedLaunchAgent.mock.calls[0];
    const argsArg = launchCall?.[0] as string[];
    const envArg = (launchCall?.[1] as { env: Record<string, string> }).env;
    expect(argsArg).not.toContain('--additional-mcp-config');
    expect(envArg['COPILOT_HOME']).toBeUndefined();
    expect(envArg['EXTERNAL_MCP_CONTEXT_STATUS']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[roleAgent] external MCP launch context failed, continuing without MCP:',
      'helper boom',
    );
  });

  it('warns when helper returns a non-applicable MCP failure status without injection', async () => {
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedPrepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'malformed',
      reason: 'External MCP registry validation failed: runtime registry missing',
      injectionEnabled: false,
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'malformed',
      },
      resolvedServers: [],
      selectedServerIds: [],
      excludedServerIds: [],
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      runRoleAgent({
        agentId: 'dalton',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton',
    });

    const launchCall = mockedLaunchAgent.mock.calls[0];
    const argsArg = launchCall?.[0] as string[];
    const envArg = (launchCall?.[1] as { env: Record<string, string> }).env;
    expect(argsArg).not.toContain('--additional-mcp-config');
    expect(envArg['COPILOT_HOME']).toBeUndefined();
    expect(envArg['EXTERNAL_MCP_CONTEXT_STATUS']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[roleAgent] external MCP launch context unavailable, continuing without MCP:',
      'malformed: External MCP registry validation failed: runtime registry missing',
    );
  });

  it('returns and logs per-agent MCP launch status', async () => {
    const launchDir = path.join(process.cwd(), '.platform-state', 'runtime', 'copilot-home', 'dalton-launch');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedPrepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      launchDir,
      contextFile: path.join(launchDir, 'mcp-capability-summary.md'),
      resolvedServers: [{
        id: 'github',
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: {},
      }],
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'available',
      },
      selectedServerIds: ['github'],
      excludedServerIds: ['filesystem'],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runRoleAgent({
      agentId: 'dalton',
      taskId: 't1',
      skipWorkflowValidation: true,
    });

    expect(result.mcpLaunch).toEqual({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      selectedServerIds: ['github'],
      excludedServerIds: ['filesystem'],
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[roleAgent] MCP launch status:',
      JSON.stringify({
        agentId: 'dalton',
        status: 'available',
        injectionEnabled: true,
        selectedServerIds: ['github'],
        excludedServerIds: ['filesystem'],
        reason: '1 external MCP server(s) injected',
      }),
    );
  });
});
