import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadAgentRegistry: vi.fn(),
  resolveAgentProfile: vi.fn(),
  resolveAutonomyProfile: vi.fn(),
  buildAgentArgs: vi.fn(),
  buildAgentEnvironment: vi.fn(),
  buildAutonomyEnvironment: vi.fn(),
  runAgentSession: vi.fn(),
  mergeExternalMcpLaunchEnvironment: vi.fn(),
  summarizeExternalMcpLaunchContext: vi.fn(),
  logExternalMcpLaunchStatus: vi.fn(),
  getActiveProvider: vi.fn(),
  getPlatformConfig: vi.fn(),
  runtimeRequiresContainerPaths: vi.fn(),
  resolveContextPackContainerPath: vi.fn(),
  createRoleLaunchId: vi.fn(),
  sha256Hex: vi.fn(),
}));

vi.mock('../metadata.js', () => ({
  loadAgentRegistry: mocks.loadAgentRegistry,
  resolveAgentProfile: mocks.resolveAgentProfile,
}));

vi.mock('../autonomy.js', () => ({
  resolveAutonomyProfile: mocks.resolveAutonomyProfile,
  buildAgentArgs: mocks.buildAgentArgs,
}));

vi.mock('../environment.js', () => ({
  buildAgentEnvironment: mocks.buildAgentEnvironment,
  buildAutonomyEnvironment: mocks.buildAutonomyEnvironment,
}));

vi.mock('../agentSession.js', () => ({
  runAgentSession: mocks.runAgentSession,
  mergeExternalMcpLaunchEnvironment: mocks.mergeExternalMcpLaunchEnvironment,
  summarizeExternalMcpLaunchContext: mocks.summarizeExternalMcpLaunchContext,
  logExternalMcpLaunchStatus: mocks.logExternalMcpLaunchStatus,
}));

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: mocks.getActiveProvider,
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: mocks.getPlatformConfig,
}));

vi.mock('../../container/sharedMcp.js', () => ({
  runtimeRequiresContainerPaths: mocks.runtimeRequiresContainerPaths,
  resolveContextPackContainerPath: mocks.resolveContextPackContainerPath,
}));

vi.mock('../roleAgent.js', () => ({
  createRoleLaunchId: mocks.createRoleLaunchId,
  sha256Hex: mocks.sha256Hex,
}));

const { runStandaloneRoleAgent } = await import('../standaloneRoleAgent.js');

const profile = {
  id: 'ron',
  registryId: 'qa',
  displayName: 'Ron',
  role: 'QA',
  requiredModel: 'gpt-4.1',
  autonomyProfile: 'qa-executor',
  workflowOrder: 5,
  wallClockTimeoutS: 600,
  idleTimeoutS: 120,
} as const;

function setupCommonMocks(): void {
  mocks.loadAgentRegistry.mockResolvedValue({ agents: [] });
  mocks.resolveAgentProfile.mockReturnValue(profile);
  mocks.resolveAutonomyProfile.mockReturnValue({
    model: 'gpt-4.1',
    autonomyProfile: 'qa-executor',
    allowedDirs: ['/repo'],
    disallowTempDir: false,
  });
  mocks.buildAgentArgs.mockReturnValue({
    args: ['--agent', 'qa'],
    launchCwd: '/repo',
    inlineAgentContext: false,
    resolvedToolPolicy: {
      allowAllTools: true,
      noAskUser: true,
      allowTools: [],
      denyTools: [],
    },
  });
  mocks.buildAgentEnvironment.mockReturnValue({
    COPILOT_MODEL: 'gpt-4.1',
    COPILOT_AGENT_ID: 'qa',
    TASKSAIL_TASK_ID: '',
  });
  mocks.buildAutonomyEnvironment.mockImplementation((_profile, intent) => ({
    RUN_ROLE_AGENT_AUTONOMY_ALLOWED_DIRS_JSON: JSON.stringify(intent.allowedDirs),
  }));
  mocks.mergeExternalMcpLaunchEnvironment.mockResolvedValue({
    status: 'not-applicable',
    reason: 'no external MCP servers apply to this agent',
    injectionEnabled: false,
    envExports: {},
    resolvedServers: [],
    selectedServerIds: [],
    excludedServerIds: [],
  });
  mocks.summarizeExternalMcpLaunchContext.mockReturnValue({
    status: 'not-applicable',
    reason: 'no external MCP servers apply to this agent',
    injectionEnabled: false,
    selectedServerIds: [],
    excludedServerIds: [],
  });
  mocks.runAgentSession.mockResolvedValue({
    runSummary: {
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    },
    greedyStopTriggered: false,
    sessionReceiptFile: '/runtime/role-sessions/ron-launch-1.json',
  });
  mocks.getActiveProvider.mockReturnValue({
    materializePrompt: vi.fn(({ prompt, promptSource }) => ({
      effectivePrompt: `${promptSource}:${prompt}`,
      inlineAgentContext: false,
    })),
    mcpConfigArgs: vi.fn((configFilePath: string) => ['--additional-mcp-config', `@${configFilePath}`]),
    runtimeManifestEnvVars: vi.fn(() => [
      { name: 'COPILOT_HANDOFFS_DIR', kind: 'path', description: 'handoffs' },
      { name: 'COPILOT_IMPL_STEPS_DIR', kind: 'path', description: 'steps' },
    ]),
  });
  mocks.getPlatformConfig.mockResolvedValue({
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  });
  mocks.runtimeRequiresContainerPaths.mockResolvedValue(false);
  mocks.resolveContextPackContainerPath.mockImplementation((_repoRoot, contextPackDir) => contextPackDir);
  mocks.createRoleLaunchId.mockReturnValue('launch-1');
  mocks.sha256Hex.mockReturnValue('a'.repeat(64));
}

describe('runStandaloneRoleAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('launches Ron from repoRoot with no taskId and writes receipts under runtimeDir', async () => {
    await expect(runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: 'Analyze the realignment session.',
    })).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'ron',
      mcpLaunch: {
        status: 'not-applicable',
      },
    });

    expect(mocks.buildAgentEnvironment).toHaveBeenCalledWith(
      profile,
      undefined,
      '/repo',
      expect.objectContaining({ skipHandoffEnvVars: true }),
    );
    expect(mocks.buildAgentEnvironment.mock.calls[0]).toHaveLength(4);
    expect(mocks.mergeExternalMcpLaunchEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      taskId: '',
    }));
    expect(mocks.runAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      repoRoot: '/repo',
      cwd: '/repo',
      session: expect.objectContaining({
        taskRuntime: '/runtime/realignment/r-1',
        launchId: 'launch-1',
        agentId: 'ron',
        launchPhase: 'Realignment Analysis',
        promptAudit: expect.objectContaining({
          promptPath: null,
          promptSource: 'override',
          effectivePromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    }));
    const sessionEnv = mocks.runAgentSession.mock.calls[0][0].env;
    expect(sessionEnv).not.toHaveProperty('COPILOT_HANDOFFS_DIR');
    expect(sessionEnv).not.toHaveProperty('COPILOT_IMPL_STEPS_DIR');
    expect(sessionEnv['TASKSAIL_TASK_ID']).toBe('');
  });

  it('materializes promptOverride with provider promptSource override', async () => {
    await runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: '  Standalone prompt.  ',
    });

    const provider = mocks.getActiveProvider.mock.results[0].value;
    const materializedPrompt = provider.materializePrompt.mock.calls[0][0].prompt;
    expect(materializedPrompt).toContain('## Runtime Path Manifest');
    expect(materializedPrompt).toContain('Standalone prompt.');
    expect(provider.materializePrompt).toHaveBeenCalledWith(expect.objectContaining({
      promptPath: null,
      promptSource: 'override',
      profile,
      launchContext: {
        repoRoot: '/repo',
        requestedCwd: '/repo',
      },
      includeGlobalInstructions: true,
    }));
    expect(mocks.runAgentSession.mock.calls[0][0].cliArgs).toEqual([
      '--agent',
      'qa',
      '-p',
      expect.stringContaining('## Runtime Path Manifest'),
    ]);
  });

  it('adds extraAllowedDirs before provider args are built', async () => {
    await runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: 'Analyze.',
      extraAllowedDirs: ['.platform-state/runtime/realignment/r-1', '/repo/AgentWorkSpace/qmd'],
    });

    expect(mocks.buildAgentArgs).toHaveBeenCalledWith(
      '/repo',
      profile,
      expect.objectContaining({
        allowedDirs: [
          '/repo',
          '/repo/.platform-state/runtime/realignment/r-1',
          '/repo/AgentWorkSpace/qmd',
        ],
      }),
      expect.anything(),
    );
  });

  it('exposes TASKSAIL_REALIGNMENT_STAGING_PATH before MCP materialization and to Ron', async () => {
    mocks.mergeExternalMcpLaunchEnvironment.mockImplementation(async ({ agentEnv }) => {
      expect(agentEnv['TASKSAIL_REALIGNMENT_STAGING_PATH']).toBe('/runtime/realignment/r-1/analysis.md');
      return {
        status: 'not-applicable',
        reason: 'no external MCP servers apply to this agent',
        injectionEnabled: false,
        envExports: {},
        resolvedServers: [],
        selectedServerIds: [],
        excludedServerIds: [],
      };
    });

    await runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: 'Analyze.',
      extraEnv: {
        TASKSAIL_REALIGNMENT_STAGING_PATH: '/runtime/realignment/r-1/analysis.md',
      },
    });

    expect(mocks.runAgentSession.mock.calls[0][0].env['TASKSAIL_REALIGNMENT_STAGING_PATH'])
      .toBe('/runtime/realignment/r-1/analysis.md');
    const effectivePrompt = mocks.runAgentSession.mock.calls[0][0].cliArgs.at(3);
    expect(effectivePrompt).toContain('## Runtime Path Manifest');
    expect(effectivePrompt).toContain('- TASKSAIL_REALIGNMENT_STAGING_PATH (path): /runtime/realignment/r-1/analysis.md --');
    expect(effectivePrompt).toContain('Analyze.');
    expect(mocks.sha256Hex).toHaveBeenCalledWith(effectivePrompt);
  });

  it('injects context-pack MCP without a task handoff taskId', async () => {
    mocks.mergeExternalMcpLaunchEnvironment.mockResolvedValue({
      status: 'available',
      reason: 'internal repo-context MCP injected',
      injectionEnabled: true,
      envExports: {},
      resolvedServers: [],
      selectedServerIds: [],
      excludedServerIds: [],
      configFilePath: '/runtime/copilot-home/ron-launch/mcp-config.json',
    });
    mocks.summarizeExternalMcpLaunchContext.mockReturnValue({
      status: 'available',
      reason: 'internal repo-context MCP injected',
      injectionEnabled: true,
      selectedServerIds: [],
      excludedServerIds: [],
    });

    await runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      contextPackDir: '/repo/context-pack',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: 'Analyze.',
    });

    expect(mocks.mergeExternalMcpLaunchEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      taskId: '',
      internalMcpServer: expect.objectContaining({
        headers: {
          'X-TaskSail-Task-Id': '',
          'X-TaskSail-Context-Pack-Dir': '/repo/context-pack',
        },
      }),
    }));
    expect(mocks.runAgentSession.mock.calls[0][0].cliArgs).toEqual([
      '--agent',
      'qa',
      '-p',
      expect.stringContaining('## Runtime Path Manifest'),
      '--additional-mcp-config',
      '@/runtime/copilot-home/ron-launch/mcp-config.json',
    ]);
  });

  it('throws non-zero exits with stdout and stderr tails after session finalization', async () => {
    mocks.runAgentSession.mockResolvedValue({
      runSummary: {
        exitCode: 7,
        stdoutTail: 'last stdout line',
        stderrTail: 'last stderr line',
        terminationReason: 'exited',
        signalCode: null,
      },
      greedyStopTriggered: false,
      sessionReceiptFile: '/runtime/role-sessions/ron-launch-1.json',
    });

    await expect(runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: 'Analyze.',
    })).rejects.toThrow([
      'Standalone agent "ron" exited with code 7 (exited).',
      '--- stdout tail ---',
      'last stdout line',
      '--- stderr tail ---',
      'last stderr line',
    ].join('\n'));
    expect(mocks.runAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        taskRuntime: '/runtime/realignment/r-1',
      }),
    }));
  });
});
