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
  loadAgentLaunchExtensionAssignments: vi.fn(),
  createAgentExtensionStage: vi.fn(),
}));

vi.mock('../metadata.js', () => ({
  loadAgentRegistry: mocks.loadAgentRegistry,
  resolveAgentProfile: mocks.resolveAgentProfile,
  toRegistryId: (id: string) => (
    { lily: 'planning-agent', alice: 'product-manager', dalton: 'software-engineer', 'dalton-verify': 'software-engineer-verify', ron: 'qa' }[id]
  ),
}));

vi.mock('../../agent-extensions/assignment.js', () => ({
  loadAgentLaunchExtensionAssignments: mocks.loadAgentLaunchExtensionAssignments,
}));

vi.mock('../../agent-extensions/stage.js', () => ({
  createAgentExtensionStage: mocks.createAgentExtensionStage,
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
  // Faithful to the provider: append one --plugin-dir pair per staged plugin dir.
  mocks.buildAgentArgs.mockImplementation((_repoRoot, _profile, _intent, options) => ({
    args: ['--agent', 'qa', ...((options?.launchExtensions?.pluginDirs ?? []).flatMap((dir: string) => ['--plugin-dir', dir]))],
    launchCwd: '/repo',
    inlineAgentContext: false,
    resolvedToolPolicy: {
      allowAllTools: true,
      noAskUser: true,
      allowTools: [],
      denyTools: [],
    },
  }));
  // Faithful to the provider: add COPILOT_SKILLS_DIRS only when skill dirs exist.
  mocks.buildAgentEnvironment.mockImplementation((_profile, _ctx, _repo, options) => ({
    COPILOT_MODEL: 'gpt-4.1',
    COPILOT_AGENT_ID: 'qa',
    TASKSAIL_TASK_ID: '',
    ...(options?.launchExtensions?.skillDirs?.length ? { COPILOT_SKILLS_DIRS: options.launchExtensions.skillDirs.join(',') } : {}),
  }));
  // Default: no assignments configured, so the lock-free pre-check short-circuits
  // and createAgentExtensionStage is never reached (existing tests stay inert).
  mocks.loadAgentLaunchExtensionAssignments.mockResolvedValue({
    schema_version: 1,
    assignments: [{ agent_id: 'qa', extension_ids: [] }],
  });
  mocks.createAgentExtensionStage.mockResolvedValue({
    launchId: 'launch-1',
    agentId: 'qa',
    stageDir: null,
    launchExtensions: undefined,
    availabilityEntries: [],
    cleanup: vi.fn().mockResolvedValue(undefined),
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

describe('runStandaloneRoleAgent launch extensions', () => {
  const stageCleanup = vi.fn();

  function withQaAssignments(): void {
    mocks.loadAgentLaunchExtensionAssignments.mockResolvedValue({
      schema_version: 1,
      assignments: [{ agent_id: 'qa', extension_ids: ['ext-1'] }],
    });
    stageCleanup.mockResolvedValue(undefined);
    mocks.createAgentExtensionStage.mockResolvedValue({
      launchId: 'launch-1',
      agentId: 'qa',
      stageDir: '/repo/.platform-state/runtime/agent-extension-stage/launch-1',
      launchExtensions: { pluginDirs: ['/stage/launch-1/plugins/p1'], skillDirs: ['/stage/launch-1/skills'] },
      availabilityEntries: [
        { id: 'sk1', kind: 'skill', display_name: 'Skill One', description: 'does X', metadata: {} },
        { id: 'pl1', kind: 'plugin', display_name: 'Plugin One', description: 'does Y', metadata: { skill_names: ['bundledA'] } },
      ],
      cleanup: stageCleanup,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    stageCleanup.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('injects qa-assigned plugin args, skills env, and the availability note, then cleans up once on success', async () => {
    withQaAssignments();

    await runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: 'Analyze.',
    });

    // ron maps to the qa assignment owner.
    expect(mocks.createAgentExtensionStage).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'qa' }));
    const call = mocks.runAgentSession.mock.calls[0][0];
    expect(call.cliArgs).toEqual(expect.arrayContaining(['--plugin-dir', '/stage/launch-1/plugins/p1']));
    expect(call.env['COPILOT_SKILLS_DIRS']).toBe('/stage/launch-1/skills');
    const effectivePrompt = call.cliArgs.at(-1) as string;
    expect(effectivePrompt).toContain('Optional Skills And Plugins Available For This Agent Launch');
    expect(effectivePrompt).toContain('- Skill: Skill One - does X');
    expect(effectivePrompt).toContain('- Plugin: Plugin One - does Y');
    expect(effectivePrompt).toContain('Bundled skills: bundledA');
    expect(stageCleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans up the stage exactly once even when the standalone launch fails', async () => {
    withQaAssignments();
    mocks.runAgentSession.mockResolvedValue({
      runSummary: { exitCode: 7, stdoutTail: '', stderrTail: '', terminationReason: 'exited', signalCode: null },
      greedyStopTriggered: false,
      sessionReceiptFile: null,
    });

    await expect(runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: 'Analyze.',
    })).rejects.toThrow(/exited with code 7/);

    expect(stageCleanup).toHaveBeenCalledTimes(1);
  });

  it('does not stage or inject extensions when qa has no assignment', async () => {
    await runStandaloneRoleAgent({
      agentId: 'ron',
      repoRoot: '/repo',
      runtimeDir: '/runtime/realignment/r-1',
      launchPhase: 'Realignment Analysis',
      promptOverride: 'Analyze.',
    });

    expect(mocks.createAgentExtensionStage).not.toHaveBeenCalled();
    const call = mocks.runAgentSession.mock.calls[0][0];
    expect(call.cliArgs).not.toContain('--plugin-dir');
    expect(call.env).not.toHaveProperty('COPILOT_SKILLS_DIRS');
    expect(call.cliArgs.at(-1) as string).not.toContain('Optional Skills And Plugins Available');
  });
});
