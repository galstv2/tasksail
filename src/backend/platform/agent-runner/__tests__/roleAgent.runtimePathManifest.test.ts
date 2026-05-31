import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  ensureDir: vi.fn(async () => undefined),
  resolvePaths: vi.fn(() => ({
    repoRoot: '/repo',
    agentWorkSpace: '/repo/AgentWorkSpace',
    handoffs: '/repo/AgentWorkSpace/tasks/task-1/handoffs',
    templates: '/repo/AgentWorkSpace/templates',
    implementationSteps: '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps',
    qmd: '/repo/AgentWorkSpace/qmd',
    taskRuntime: '/repo/.platform-state/runtime/tasks/task-1',
    platformState: '/repo/.platform-state',
  })),
  writeProtocolStdout: vi.fn(),
  loadAgentRegistry: vi.fn(async () => ({ agents: [] })),
  resolveAgentProfile: vi.fn(),
  resolveActiveModel: vi.fn(() => 'gpt-5'),
  resolveAutonomyProfile: vi.fn(() => ({
    model: 'gpt-5',
    autonomyProfile: 'artifact-author',
    allowedDirs: [],
    disallowTempDir: false,
  })),
  buildAgentArgs: vi.fn(() => ({
    args: ['--agent', 'product-manager'],
    launchCwd: '/repo',
    inlineAgentContext: false,
    resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] },
  })),
  formatAgentCommand: vi.fn(() => 'cmd'),
  buildAgentEnvironment: vi.fn(() => ({
    TASKSAIL_TASK_ID: 'task-1',
    TASKSAIL_SLICE_ARTIFACT_FORMAT: 'markdown',
    TASKSAIL_TASK_BRANCHES: '[{"repoId":"platform","role":"primary","branch":"task"}]',
    COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-1/handoffs',
    COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps',
    COPILOT_WRITABLE_ROOTS_JSON: '[{"path":"/worktree","kind":"directory"}]',
  })),
  buildAutonomyEnvironment: vi.fn(() => ({
    RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: '{"profile":"artifact-author"}',
  })),
  runRuntimePolicyCheck: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  writeUniqueGuardrailReceipt: vi.fn(async () => '/receipt.json'),
  runAgentSession: vi.fn(),
  correctSessionReceipt: vi.fn(async () => undefined),
  refreshQaCodeDiff: vi.fn(async () => undefined),
  mergeExternalMcpLaunchEnvironment: vi.fn(async () => ({
    status: 'not-applicable',
    reason: 'none',
    injectionEnabled: false,
    envExports: {},
    resolvedServers: [],
    selectedServerIds: [],
    excludedServerIds: [],
  })),
  summarizeExternalMcpLaunchContext: vi.fn(() => ({
    status: 'not-applicable',
    injectionEnabled: false,
    selectedServerIds: [],
    excludedServerIds: [],
  })),
  logExternalMcpLaunchStatus: vi.fn(),
  buildAgentRuntimePathManifest: vi.fn((args) => ({ ...args, entries: [] })),
  prependRuntimePathManifestToPrompt: vi.fn(({ prompt }) => `## Runtime Path Manifest\nCOPILOT_HANDOFFS_DIR=/repo/AgentWorkSpace/tasks/task-1/handoffs\nCOPILOT_IMPL_STEPS_DIR=/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps\nCOPILOT_WRITABLE_ROOTS_JSON=[{"path":"/worktree","kind":"directory"}]\nTASKSAIL_TASK_BRANCHES=[{"repoId":"platform","role":"primary","branch":"task"}]\n\n${prompt}`),
  prepopulateRequirementVerification: vi.fn(async () => undefined),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: mocks.existsSync };
});

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    ...actual,
    ensureDir: mocks.ensureDir,
    resolvePaths: mocks.resolvePaths,
    writeProtocolStdout: mocks.writeProtocolStdout,
    newSpanId: vi.fn(() => 'span-1'),
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: function child() { return this; } }),
  };
});
vi.mock('../metadata.js', () => ({
  loadAgentRegistry: mocks.loadAgentRegistry,
  resolveAgentProfile: mocks.resolveAgentProfile,
  resolveActiveModel: mocks.resolveActiveModel,
}));
vi.mock('../autonomy.js', () => ({
  resolveAutonomyProfile: mocks.resolveAutonomyProfile,
  buildAgentArgs: mocks.buildAgentArgs,
  formatAgentCommand: mocks.formatAgentCommand,
}));
vi.mock('../environment.js', () => ({
  buildAgentEnvironment: mocks.buildAgentEnvironment,
  buildAutonomyEnvironment: mocks.buildAutonomyEnvironment,
}));
vi.mock('../guardrails.js', () => ({
  runRuntimePolicyCheck: mocks.runRuntimePolicyCheck,
  writeUniqueGuardrailReceipt: mocks.writeUniqueGuardrailReceipt,
}));
vi.mock('../agentSession.js', () => ({
  runAgentSession: mocks.runAgentSession,
  correctSessionReceipt: mocks.correctSessionReceipt,
  refreshQaCodeDiff: mocks.refreshQaCodeDiff,
  mergeExternalMcpLaunchEnvironment: mocks.mergeExternalMcpLaunchEnvironment,
  summarizeExternalMcpLaunchContext: mocks.summarizeExternalMcpLaunchContext,
  logExternalMcpLaunchStatus: mocks.logExternalMcpLaunchStatus,
}));
vi.mock('../artifactCompletion.js', async () => {
  const actual = await vi.importActual<typeof import('../artifactCompletion.js')>('../artifactCompletion.js');
  return {
    ...actual,
    checkAgentArtifactCompletionDetails: vi.fn(async () => ({ complete: true, reasons: [] })),
    buildAgentArtifactRemediationPrompt: vi.fn(async () => '- /repo/AgentWorkSpace/tasks/task-1/handoffs/final-summary.md: fix.'),
  };
});
vi.mock('../pipeline/requirementVerification.js', () => ({
  prepopulateRequirementVerification: mocks.prepopulateRequirementVerification,
}));
vi.mock('../agentRuntimePathManifest.js', () => ({
  buildAgentRuntimePathManifest: mocks.buildAgentRuntimePathManifest,
  prependRuntimePathManifestToPrompt: mocks.prependRuntimePathManifestToPrompt,
}));
vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: vi.fn(() => ({
    id: 'copilot',
    resolvePromptPath: () => '.github/copilot/prompts/start-task.prompt.md',
    promptPathEnvVars: () => ({ handoffsDir: 'COPILOT_HANDOFFS_DIR', implStepsDir: 'COPILOT_IMPL_STEPS_DIR' }),
    materializePrompt: ({ prompt }: { prompt: string }) => ({ effectivePrompt: prompt, inlineAgentContext: false }),
    mcpConfigArgs: () => [],
    runtimeManifestEnvVars: () => [
      { name: 'COPILOT_HANDOFFS_DIR', kind: 'path', description: 'handoffs' },
      { name: 'COPILOT_IMPL_STEPS_DIR', kind: 'path', description: 'steps' },
      { name: 'COPILOT_WRITABLE_ROOTS_JSON', kind: 'json', description: 'writable roots' },
    ],
    agentConfigPaths: () => ({ registry: '.github/agents/registry.json' }),
  })),
  normalizeReasoningEffort: (effort?: string) => (effort && effort !== 'none' ? effort : undefined),
  validateReasoningEffortForCapabilities: () => ({ status: 'ok' as const }),
  isReasoningEffortRejectionOutput: () => false,
}));
vi.mock('../../core/io.js', () => ({ readTextFile: vi.fn(async () => 'Launch prompt.') }));
vi.mock('../../container/sharedMcp.js', () => ({
  resolveContextPackContainerPath: vi.fn(() => '/repo/context-pack'),
  runtimeRequiresContainerPaths: vi.fn(async () => false),
}));
vi.mock('../../platform-config/get.js', () => ({ getPlatformConfig: vi.fn(async () => ({ mcp_port: 8811, repo_context_mcp_external_mount_roots: [] })) }));
vi.mock('../worktreeInjection.js', () => ({
  buildWorktreeBindingMap: vi.fn(async () => new Map()),
  applyWorktreeInjectionToFocused: vi.fn((focused) => focused),
  applyWorktreeInjectionToAllowedDirs: vi.fn((allowedDirs) => allowedDirs),
}));
vi.mock('../../context-pack/focusedRepo.js', () => ({
  resolveFocusedRepoRoot: vi.fn(),
  resolveSelectedPrimaryRepoRoot: vi.fn(),
  explainSelectedPrimaryBoundaryFailure: vi.fn(async () => 'none'),
}));
vi.mock('../../queue/taskJson.js', () => ({ readTaskJsonSafe: vi.fn(() => null) }));

const { runRoleAgent } = await import('../roleAgent.js');
const { checkAgentArtifactCompletionDetails } = await import('../artifactCompletion.js');
const mockedCheckAgentArtifactCompletionDetails = vi.mocked(checkAgentArtifactCompletionDetails);

function profile(id: 'alice' | 'ron') {
  return {
    id,
    registryId: id === 'alice' ? 'product-manager' : 'qa',
    displayName: id === 'alice' ? 'Alice' : 'Ron',
    role: id === 'alice' ? 'Product Manager' : 'QA',
    requiredModel: 'gpt-5',
    autonomyProfile: id === 'alice' ? 'artifact-author' : 'qa-executor',
    workflowOrder: id === 'alice' ? 1 : 3,
    wallClockTimeoutS: 600,
    idleTimeoutS: 60,
  };
}

describe('roleAgent Runtime Path Manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'remediation-loop';
    mocks.existsSync.mockReturnValue(true);
    mocks.runAgentSession.mockResolvedValue({
      runSummary: { exitCode: 0, terminationReason: 'exited', signalCode: null, stdoutTail: '', stderrTail: '' },
      greedyStopTriggered: false,
      sessionReceiptFile: null,
    });
    mockedCheckAgentArtifactCompletionDetails.mockResolvedValue({ complete: true, reasons: [] });
  });

  afterEach(() => {
    delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
    delete process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];
  });

  it('injects Runtime Path Manifest into normal Alice and Ron prompts from final env', async () => {
    for (const agentId of ['alice', 'ron'] as const) {
      mocks.resolveAgentProfile.mockReturnValue(profile(agentId));
      await runRoleAgent({ agentId, taskId: 'task-1', skipWorkflowValidation: true });
    }

    const prompts = mocks.runAgentSession.mock.calls.map((call) => call[0].cliArgs.at(-1));
    expect(prompts[0]).toContain('## Runtime Path Manifest');
    expect(prompts[0]).toContain('COPILOT_HANDOFFS_DIR=/repo/AgentWorkSpace/tasks/task-1/handoffs');
    expect(prompts[1]).toContain('## Runtime Path Manifest');
    expect(prompts[1]).toContain('COPILOT_WRITABLE_ROOTS_JSON=');
    expect(prompts[1]).toContain('TASKSAIL_TASK_BRANCHES=');
    expect(mocks.buildAgentRuntimePathManifest).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: '{"profile":"artifact-author"}',
      }),
      includeRoleArtifactChecklist: true,
    }));
  });

  it('injects Runtime Path Manifest into Artifact Cleanup prompts and preserves exact-path wrapper', async () => {
    mocks.resolveAgentProfile.mockReturnValue(profile('ron'));
    mockedCheckAgentArtifactCompletionDetails
      .mockResolvedValueOnce({ complete: false, reasons: ['final-summary.md missing or empty'] })
      .mockResolvedValueOnce({ complete: true, reasons: [] });

    await runRoleAgent({ agentId: 'ron', taskId: 'task-1', skipWorkflowValidation: true });

    const cleanupPrompt = mocks.runAgentSession.mock.calls[1][0].cliArgs.at(-1);
    expect(cleanupPrompt).toContain('## Runtime Path Manifest');
    expect(cleanupPrompt).toContain('Use only the exact absolute artifact paths listed below.');
    expect(mocks.prependRuntimePathManifestToPrompt.mock.calls[1][0].manifest)
      .toEqual(expect.objectContaining({
        launchPhase: 'Artifact Cleanup',
        includeRoleArtifactChecklist: false,
      }));
  });

  it('injects Runtime Path Manifest into Revalidation and Closeout Remediation promptOverride launches', async () => {
    for (const launchPhase of ['Revalidation', 'Closeout Remediation']) {
      mocks.resolveAgentProfile.mockReturnValue(profile('ron'));
      await runRoleAgent({
        agentId: 'ron',
        taskId: 'task-1',
        promptOverride: `${launchPhase} prompt.`,
        launchPhase,
        skipWorkflowValidation: true,
      });
    }

    expect(mocks.runAgentSession.mock.calls.at(-2)?.[0].cliArgs.at(-1)).toContain('## Runtime Path Manifest');
    expect(mocks.runAgentSession.mock.calls.at(-1)?.[0].cliArgs.at(-1)).toContain('## Runtime Path Manifest');
    for (const call of mocks.buildAgentRuntimePathManifest.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ includeRoleArtifactChecklist: false }));
    }
  });

  it('keeps COPILOT_SKILLS_DIRS, --plugin-dir, and staged extension paths out of the manifest prompt', async () => {
    for (const agentId of ['alice', 'ron'] as const) {
      mocks.resolveAgentProfile.mockReturnValue(profile(agentId));
      await runRoleAgent({ agentId, taskId: 'task-1', skipWorkflowValidation: true });
    }

    const prompts = mocks.runAgentSession.mock.calls.map((call) => call[0].cliArgs.at(-1) as string);
    for (const prompt of prompts) {
      expect(prompt).toContain('## Runtime Path Manifest');
      expect(prompt).not.toContain('COPILOT_SKILLS_DIRS');
      expect(prompt).not.toContain('--plugin-dir');
      expect(prompt).not.toContain('.platform-state/agent-extension-stage');
    }
    // The provider env-var descriptors that feed the manifest never include the
    // skills env, so staged skill dirs cannot reach prompt-visible manifest content.
    for (const call of mocks.buildAgentRuntimePathManifest.mock.calls) {
      const providerEnvVars = call[0].providerEnvVars as Array<{ name: string }>;
      expect(providerEnvVars.map((entry) => entry.name)).not.toContain('COPILOT_SKILLS_DIRS');
    }
  });

  it('passes TASKSAIL_SLICE_ARTIFACT_FORMAT from final env into the manifest', async () => {
    mocks.resolveAgentProfile.mockReturnValue(profile('alice'));
    await runRoleAgent({ agentId: 'alice', taskId: 'task-1', skipWorkflowValidation: true });

    const manifestCall = mocks.buildAgentRuntimePathManifest.mock.calls[0];
    expect(manifestCall[0].env).toHaveProperty('TASKSAIL_SLICE_ARTIFACT_FORMAT', 'markdown');
  });

  it('keeps dry-run side-effect-free and skips Runtime Path Manifest construction', async () => {
    mocks.resolveAgentProfile.mockReturnValue(profile('ron'));

    await runRoleAgent({ agentId: 'ron', taskId: 'task-1', dryRun: true, skipWorkflowValidation: true });

    expect(mocks.mergeExternalMcpLaunchEnvironment).not.toHaveBeenCalled();
    expect(mocks.refreshQaCodeDiff).not.toHaveBeenCalled();
    expect(mocks.prepopulateRequirementVerification).not.toHaveBeenCalled();
    expect(mocks.buildAgentRuntimePathManifest).not.toHaveBeenCalled();
    expect(mocks.prependRuntimePathManifestToPrompt).not.toHaveBeenCalled();
    expect(mocks.runAgentSession).not.toHaveBeenCalled();
    expect(mocks.formatAgentCommand).toHaveBeenCalledWith('/repo', [
      '--agent',
      'product-manager',
      '-p',
      'Launch prompt.',
    ]);
  });
});
