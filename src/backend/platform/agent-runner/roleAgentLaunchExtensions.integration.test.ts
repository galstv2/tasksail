import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cleanupSpy = vi.fn(async () => undefined);
  const stageSpy = vi.fn(async (_opts: { agentId: string }) => ({
    launchId: 'L',
    agentId: 'software-engineer',
    stageDir: '/repo/.platform-state/runtime/agent-extension-stage/L',
    launchExtensions: { pluginDirs: ['/stage/L/plugins/p1'], skillDirs: ['/stage/L/skills'] },
    availabilityEntries: [
      { id: 'sk1', kind: 'skill' as const, display_name: 'Skill One', description: 'does X', metadata: {} },
      { id: 'pl1', kind: 'plugin' as const, display_name: 'Plugin One', description: 'does Y', metadata: { skill_names: ['bundledA'] } },
    ],
    cleanup: cleanupSpy,
  }));
  const assignmentsSpy = vi.fn(async () => ({
    schema_version: 1,
    assignments: [{ agent_id: 'software-engineer', extension_ids: ['ext-1'] }],
  }));
  return {
    existsSync: vi.fn(() => true),
    ensureDir: vi.fn(async () => undefined),
    resolvePaths: vi.fn(() => ({
      repoRoot: '/repo', agentWorkSpace: '/repo/AgentWorkSpace',
      handoffs: '/repo/AgentWorkSpace/tasks/task-1/handoffs',
      templates: '/repo/AgentWorkSpace/templates',
      implementationSteps: '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps',
      qmd: '/repo/AgentWorkSpace/qmd', taskRuntime: '/repo/.platform-state/runtime/tasks/task-1',
      platformState: '/repo/.platform-state',
    })),
    writeProtocolStdout: vi.fn(),
    loadAgentRegistry: vi.fn(async () => ({ agents: [] })),
    resolveAgentProfile: vi.fn(),
    resolveActiveModel: vi.fn(() => 'gpt-5'),
    resolveAutonomyProfile: vi.fn(() => ({ model: 'gpt-5', autonomyProfile: 'artifact-author', allowedDirs: [], disallowTempDir: false })),
    buildAgentArgs: vi.fn((_repoRoot: string, profile: { registryId: string }, _intent: unknown, options: { launchExtensions?: { pluginDirs?: string[] } }) => ({
      args: ['--agent', profile.registryId, ...(options?.launchExtensions?.pluginDirs ?? []).flatMap((d: string) => ['--plugin-dir', d])],
      launchCwd: '/repo', inlineAgentContext: false,
      resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] },
    })),
    formatAgentCommand: vi.fn((_repoRoot: string, _args: string[]) => 'cmd'),
    buildAgentEnvironment: vi.fn((_profile: unknown, _ctx: unknown, _repo: unknown, options: { launchExtensions?: { skillDirs?: string[] } }) => ({
      TASKSAIL_TASK_ID: 'task-1',
      COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-1/handoffs',
      COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps',
      ...(options?.launchExtensions?.skillDirs?.length ? { COPILOT_SKILLS_DIRS: options.launchExtensions.skillDirs.join(',') } : {}),
    })),
    buildAutonomyEnvironment: vi.fn(() => ({ RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: '{"profile":"artifact-author"}' })),
    runRuntimePolicyCheck: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    writeUniqueGuardrailReceipt: vi.fn(async () => '/receipt.json'),
    runAgentSession: vi.fn(),
    correctSessionReceipt: vi.fn(async () => undefined),
    refreshQaCodeDiff: vi.fn(async () => undefined),
    mergeExternalMcpLaunchEnvironment: vi.fn(async () => ({
      status: 'not-applicable', reason: 'none', injectionEnabled: false,
      envExports: {}, resolvedServers: [], selectedServerIds: [], excludedServerIds: [],
    })),
    summarizeExternalMcpLaunchContext: vi.fn(() => ({
      status: 'not-applicable', injectionEnabled: false, selectedServerIds: [], excludedServerIds: [],
    })),
    logExternalMcpLaunchStatus: vi.fn(),
    buildAgentRuntimePathManifest: vi.fn((a: object) => ({ ...a })),
    prependRuntimePathManifestToPrompt: vi.fn(({ prompt }: { prompt: string }) => `## Runtime Path Manifest\n\n${prompt}`),
    prepopulateRequirementVerification: vi.fn(async () => undefined),
    createAgentExtensionStage: stageSpy,
    loadAgentLaunchExtensionAssignments: assignmentsSpy,
    cleanupSpy,
  };
});

vi.mock('node:fs', async () => { const a = await vi.importActual<typeof import('node:fs')>('node:fs'); return { ...a, existsSync: mocks.existsSync }; });
vi.mock('../core/index.js', async () => { const a = await vi.importActual<typeof import('../core/index.js')>('../core/index.js'); return { ...a, ensureDir: mocks.ensureDir, resolvePaths: mocks.resolvePaths, writeProtocolStdout: mocks.writeProtocolStdout, newSpanId: vi.fn(() => 'span-1'), createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: function child() { return this; } }) }; });
vi.mock('./metadata.js', () => ({ loadAgentRegistry: mocks.loadAgentRegistry, resolveAgentProfile: mocks.resolveAgentProfile, resolveActiveModel: mocks.resolveActiveModel, toRegistryId: (id: string) => ({ lily: 'planning-agent', alice: 'product-manager', dalton: 'software-engineer', 'dalton-verify': 'software-engineer-verify', ron: 'qa' } as Record<string, string>)[id] }));
vi.mock('./autonomy.js', () => ({ resolveAutonomyProfile: mocks.resolveAutonomyProfile, buildAgentArgs: mocks.buildAgentArgs, formatAgentCommand: mocks.formatAgentCommand }));
vi.mock('./environment.js', () => ({ buildAgentEnvironment: mocks.buildAgentEnvironment, buildAutonomyEnvironment: mocks.buildAutonomyEnvironment }));
vi.mock('./guardrails.js', () => ({ runRuntimePolicyCheck: mocks.runRuntimePolicyCheck, writeUniqueGuardrailReceipt: mocks.writeUniqueGuardrailReceipt }));
vi.mock('./agentSession.js', () => ({ runAgentSession: mocks.runAgentSession, correctSessionReceipt: mocks.correctSessionReceipt, refreshQaCodeDiff: mocks.refreshQaCodeDiff, mergeExternalMcpLaunchEnvironment: mocks.mergeExternalMcpLaunchEnvironment, summarizeExternalMcpLaunchContext: mocks.summarizeExternalMcpLaunchContext, logExternalMcpLaunchStatus: mocks.logExternalMcpLaunchStatus }));
vi.mock('./artifactCompletion.js', async () => { const a = await vi.importActual<typeof import('./artifactCompletion.js')>('./artifactCompletion.js'); return { ...a, checkAgentArtifactCompletionDetails: vi.fn(async () => ({ complete: true, reasons: [] })), buildAgentArtifactRemediationPrompt: vi.fn(async () => '- /repo/AgentWorkSpace/tasks/task-1/handoffs/final-summary.md: fix.') }; });
vi.mock('./pipeline/requirementVerification.js', () => ({ prepopulateRequirementVerification: mocks.prepopulateRequirementVerification }));
vi.mock('./agentRuntimePathManifest.js', () => ({ buildAgentRuntimePathManifest: mocks.buildAgentRuntimePathManifest, prependRuntimePathManifestToPrompt: mocks.prependRuntimePathManifestToPrompt }));
vi.mock('./daltonLaunchPrep.js', () => ({ isDaltonFamilyAgent: (id: string) => id === 'dalton' || id === 'dalton-verify', daltonFamilyRuntimeLabel: (id: string) => id, prepareDaltonBoundary: vi.fn(), handleDaltonConfinementValidation: vi.fn(async () => undefined), buildArtifactCleanupPrompt: vi.fn(({ artifactPrompt }: { artifactPrompt: string }) => `CLEANUP: ${artifactPrompt}`) }));
vi.mock('./worktreeInjection.js', () => ({ buildWorktreeBindingMap: vi.fn(async () => new Map()), applyWorktreeInjectionToFocused: vi.fn((f: unknown) => f), applyWorktreeInjectionToAllowedDirs: vi.fn((d: unknown) => d) }));
vi.mock('../context-pack/focusedRepo.js', () => ({ resolveFocusedRepoRoot: vi.fn(async () => undefined), resolveSelectedPrimaryRepoRoot: vi.fn(async () => undefined), explainSelectedPrimaryBoundaryFailure: vi.fn(async () => 'none') }));
vi.mock('../queue/taskJson.js', () => ({ readTaskJsonSafe: vi.fn(() => null) }));
vi.mock('../platform-config/get.js', () => ({ getPlatformConfig: vi.fn(async () => ({ mcp_port: 8811, repo_context_mcp_external_mount_roots: [] })) }));
vi.mock('../container/sharedMcp.js', () => ({ resolveContextPackContainerPath: vi.fn(() => '/repo/cp'), runtimeRequiresContainerPaths: vi.fn(async () => false) }));
vi.mock('../cli-provider/index.js', () => ({ getActiveProvider: vi.fn(() => ({ id: 'copilot', resolvePromptPath: () => '.github/copilot/prompts/start-task.prompt.md', promptPathEnvVars: () => ({ handoffsDir: 'COPILOT_HANDOFFS_DIR', implStepsDir: 'COPILOT_IMPL_STEPS_DIR' }), materializePrompt: ({ prompt }: { prompt: string }) => ({ effectivePrompt: prompt, inlineAgentContext: false }), mcpConfigArgs: () => [], runtimeManifestEnvVars: () => [{ name: 'COPILOT_HANDOFFS_DIR', kind: 'path', description: 'h' }], agentConfigPaths: () => ({ registry: '.github/agents/registry.json' }) })), normalizeReasoningEffort: (e?: string) => (e && e !== 'none' ? e : undefined), validateReasoningEffortForCapabilities: () => ({ status: 'ok' as const }), isReasoningEffortRejectionOutput: () => false }));
vi.mock('../core/io.js', () => ({ readTextFile: vi.fn(async () => 'prompt') }));
vi.mock('../agent-extensions/assignment.js', () => ({ loadAgentLaunchExtensionAssignments: mocks.loadAgentLaunchExtensionAssignments }));
vi.mock('../agent-extensions/stage.js', () => ({ createAgentExtensionStage: mocks.createAgentExtensionStage }));

const { runRoleAgent } = await import('./roleAgent.js');
const { checkAgentArtifactCompletionDetails, buildAgentArtifactRemediationPrompt } = await import('./artifactCompletion.js');
const mockedCheck = vi.mocked(checkAgentArtifactCompletionDetails);
const mockedBuildRemediation = vi.mocked(buildAgentArtifactRemediationPrompt);
const { prepareDaltonBoundary, handleDaltonConfinementValidation } = await import('./daltonLaunchPrep.js');
const mockedPrepareDaltonBoundary = vi.mocked(prepareDaltonBoundary);
const mockedHandleDaltonConfinementValidation = vi.mocked(handleDaltonConfinementValidation);
const { resolveSelectedPrimaryRepoRoot } = await import('../context-pack/focusedRepo.js');
const mockedResolveSelectedPrimaryRepoRoot = vi.mocked(resolveSelectedPrimaryRepoRoot);

function makeSuccessSession() {
  return { runSummary: { exitCode: 0, terminationReason: 'exited', signalCode: null, stdoutTail: '', stderrTail: '' }, greedyStopTriggered: false, sessionReceiptFile: null };
}

function profileFor(agentId: 'dalton' | 'alice' | 'ron' | 'dalton-verify' | 'lily') {
  const registryIdMap: Record<string, string> = { dalton: 'software-engineer', alice: 'product-manager', ron: 'qa', 'dalton-verify': 'software-engineer-verify', lily: 'planning-agent' };
  const autonomyMap: Record<string, string> = { dalton: 'repo-executor', 'dalton-verify': 'repo-executor', alice: 'artifact-author', ron: 'artifact-author', lily: 'artifact-author' };
  return { id: agentId, registryId: registryIdMap[agentId], displayName: agentId, role: agentId, requiredModel: 'gpt-5', autonomyProfile: autonomyMap[agentId], workflowOrder: 1, wallClockTimeoutS: 600, idleTimeoutS: 60 };
}

function makeStage(agentId: string, launchId = 'L') {
  return { launchId, agentId, stageDir: `/repo/.platform-state/runtime/agent-extension-stage/${launchId}`, launchExtensions: { pluginDirs: ['/stage/L/plugins/p1'], skillDirs: ['/stage/L/skills'] }, availabilityEntries: [], cleanup: mocks.cleanupSpy };
}

// Shared setup: env vars, common mocks, stage/assignment defaults for agentId.
function setupAssignedStage(agentId: 'dalton' | 'alice' | 'ron' | 'dalton-verify' | 'lily') {
  vi.clearAllMocks();
  process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
  process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
  mocks.existsSync.mockReturnValue(true);
  mocks.runAgentSession.mockResolvedValue(makeSuccessSession());
  mocks.resolveAgentProfile.mockReturnValue(profileFor(agentId));
  mockedCheck.mockResolvedValue({ complete: true, reasons: [] });
  mocks.createAgentExtensionStage.mockResolvedValue({
    launchId: 'L', agentId: profileFor(agentId).registryId,
    stageDir: '/repo/.platform-state/runtime/agent-extension-stage/L',
    launchExtensions: { pluginDirs: ['/stage/L/plugins/p1'], skillDirs: ['/stage/L/skills'] },
    availabilityEntries: [
      { id: 'sk1', kind: 'skill' as const, display_name: 'Skill One', description: 'does X', metadata: {} },
      { id: 'pl1', kind: 'plugin' as const, display_name: 'Plugin One', description: 'does Y', metadata: { skill_names: ['bundledA'] } },
    ],
    cleanup: mocks.cleanupSpy,
  });
  mocks.loadAgentLaunchExtensionAssignments.mockResolvedValue({
    schema_version: 1,
    assignments: [{ agent_id: profileFor(agentId).registryId, extension_ids: ['ext-1'] }],
  });
}

function cleanupEnv() {
  delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
  delete process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];
}

// ---------------------------------------------------------------------------
// Scenario A: Normal Dalton launch with assignments
// ---------------------------------------------------------------------------
describe('A: Normal Dalton launch — skill/plugin injection', () => {
  beforeEach(() => { setupAssignedStage('dalton'); });
  afterEach(cleanupEnv);

  it('includes --plugin-dir arg and availability note in final prompt', async () => {
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1', skipWorkflowValidation: true });
    expect(mocks.runAgentSession).toHaveBeenCalledOnce();
    const { cliArgs } = mocks.runAgentSession.mock.calls[0][0];
    expect(cliArgs).toContain('--plugin-dir');
    expect(cliArgs).toContain('/stage/L/plugins/p1');
    const prompt = cliArgs.at(-1) as string;
    expect(prompt).toContain('Optional Skills And Plugins Available For This Agent Launch');
    expect(prompt).toContain('- Skill: Skill One - does X');
    expect(prompt).toContain('- Plugin: Plugin One - does Y');
    expect(prompt).toContain('Bundled skills: bundledA');
  });

  it('calls buildAgentEnvironment with launchExtensions', async () => {
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1', skipWorkflowValidation: true });
    const envCall = mocks.buildAgentEnvironment.mock.calls[0];
    expect(envCall[3]).toEqual(expect.objectContaining({ launchExtensions: expect.objectContaining({ skillDirs: ['/stage/L/skills'] }) }));
  });

  it('calls createAgentExtensionStage with agentId:software-engineer', async () => {
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1', skipWorkflowValidation: true });
    expect(mocks.createAgentExtensionStage).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'software-engineer' }));
  });
});

// ---------------------------------------------------------------------------
// Scenario B: Stage reuse across cleanup pass (Alice)
// ---------------------------------------------------------------------------
describe('B: Stage reuse across artifact cleanup pass', () => {
  beforeEach(() => {
    setupAssignedStage('alice');
    mocks.createAgentExtensionStage.mockResolvedValue({
      launchId: 'L2', agentId: 'product-manager',
      stageDir: '/repo/.platform-state/runtime/agent-extension-stage/L2',
      launchExtensions: { pluginDirs: ['/stage/L2/plugins/p1'], skillDirs: ['/stage/L2/skills'] },
      availabilityEntries: [{ id: 'sk1', kind: 'skill' as const, display_name: 'Skill One', description: 'does X', metadata: {} }],
      cleanup: mocks.cleanupSpy,
    });
    mockedCheck.mockResolvedValueOnce({ complete: false, reasons: ['x'] }).mockResolvedValueOnce({ complete: true, reasons: [] });
    mockedBuildRemediation.mockResolvedValue('- /repo/AgentWorkSpace/tasks/task-1/handoffs/impl.md: fix it.');
  });
  afterEach(cleanupEnv);

  it('creates stage once, both passes include --plugin-dir, cleanup called exactly once', async () => {
    await runRoleAgent({ agentId: 'alice', taskId: 'task-1', skipWorkflowValidation: true });
    expect(mocks.createAgentExtensionStage).toHaveBeenCalledOnce();
    expect(mocks.createAgentExtensionStage).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'product-manager' }));
    expect(mocks.runAgentSession).toHaveBeenCalledTimes(2);
    for (const call of mocks.runAgentSession.mock.calls) {
      expect(call[0].cliArgs).toContain('--plugin-dir');
    }
    expect(mocks.cleanupSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Scenario C: Denied-action continuation reuse
// ---------------------------------------------------------------------------
describe('C: Denied-action continuation reuse (via runAgentSession args identity)', () => {
  beforeEach(() => {
    setupAssignedStage('alice');
    mocks.createAgentExtensionStage.mockResolvedValue({
      launchId: 'L3', agentId: 'product-manager',
      stageDir: '/repo/.platform-state/runtime/agent-extension-stage/L3',
      launchExtensions: { pluginDirs: ['/stage/L3/plugins/p1'], skillDirs: [] },
      availabilityEntries: [], cleanup: mocks.cleanupSpy,
    });
    mocks.loadAgentLaunchExtensionAssignments.mockResolvedValue({ schema_version: 1, assignments: [{ agent_id: 'product-manager', extension_ids: ['ext-pm'] }] });
    mockedCheck.mockResolvedValue({ complete: true, reasons: [] });
    const deniedSummary = { exitCode: 1, terminationReason: 'exited', signalCode: null, stdoutTail: 'permission denied and could not request permission from user', stderrTail: '' };
    mocks.runAgentSession
      .mockResolvedValueOnce({ runSummary: deniedSummary, greedyStopTriggered: false, sessionReceiptFile: null })
      .mockResolvedValueOnce(makeSuccessSession());
  });
  afterEach(cleanupEnv);

  it('continuation pass reuses the same --plugin-dir args from argsResult', async () => {
    await runRoleAgent({ agentId: 'alice', taskId: 'task-1', skipWorkflowValidation: true });
    expect(mocks.createAgentExtensionStage).toHaveBeenCalledOnce();
    expect(mocks.runAgentSession).toHaveBeenCalled();
    for (const call of mocks.runAgentSession.mock.calls) {
      expect(call[0].cliArgs).toContain('--plugin-dir');
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario D: Dry-run side-effect freedom + guard split
// ---------------------------------------------------------------------------
describe('D: Dry-run side-effect freedom + guard split', () => {
  beforeEach(() => { setupAssignedStage('dalton'); });
  afterEach(cleanupEnv);

  it('dry-run: does not call assignment loader, stage, or runAgentSession; formatAgentCommand args lack --plugin-dir', async () => {
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1', dryRun: true, skipWorkflowValidation: true });
    expect(mocks.loadAgentLaunchExtensionAssignments).not.toHaveBeenCalled();
    expect(mocks.createAgentExtensionStage).not.toHaveBeenCalled();
    expect(mocks.runAgentSession).not.toHaveBeenCalled();
    expect(mocks.formatAgentCommand).toHaveBeenCalled();
    expect(mocks.formatAgentCommand.mock.calls[0][1] as string[]).not.toContain('--plugin-dir');
  });

  it('non-dry-run dalton: runAgentSession cliArgs DO include --plugin-dir (guard split)', async () => {
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1', skipWorkflowValidation: true });
    expect(mocks.runAgentSession).toHaveBeenCalled();
    expect(mocks.runAgentSession.mock.calls[0][0].cliArgs).toContain('--plugin-dir');
  });
});

// ---------------------------------------------------------------------------
// Scenario E: Staging failure before spawn
// ---------------------------------------------------------------------------
describe('E: Staging failure before spawn', () => {
  beforeEach(() => { setupAssignedStage('dalton'); mocks.createAgentExtensionStage.mockRejectedValue(new Error('stage-failure')); });
  afterEach(cleanupEnv);

  it('rejects runRoleAgent and does NOT call runAgentSession', async () => {
    await expect(runRoleAgent({ agentId: 'dalton', taskId: 'task-1', skipWorkflowValidation: true })).rejects.toThrow('stage-failure');
    expect(mocks.runAgentSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scenario F: No-assignments no-op
// ---------------------------------------------------------------------------
describe('F: No-assignments no-op', () => {
  beforeEach(() => {
    setupAssignedStage('dalton');
    mocks.loadAgentLaunchExtensionAssignments.mockResolvedValue({ schema_version: 1, assignments: [{ agent_id: 'software-engineer', extension_ids: [] }] });
  });
  afterEach(cleanupEnv);

  it('skips staging, still calls runAgentSession, prompt lacks availability header', async () => {
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1', skipWorkflowValidation: true });
    expect(mocks.createAgentExtensionStage).not.toHaveBeenCalled();
    expect(mocks.runAgentSession).toHaveBeenCalledOnce();
    expect(mocks.runAgentSession.mock.calls[0][0].cliArgs.at(-1) as string).not.toContain('Optional Skills And Plugins Available');
  });
});

// ---------------------------------------------------------------------------
// Scenario G: Cross-role isolation — agentId passed to createAgentExtensionStage
// ---------------------------------------------------------------------------
describe('G: Cross-role isolation', () => {
  beforeEach(() => {
    setupAssignedStage('dalton');
    mocks.createAgentExtensionStage.mockImplementation(async ({ agentId }: { agentId: string }) => ({
      launchId: `L-${agentId}`, agentId, stageDir: `/repo/.platform-state/runtime/agent-extension-stage/L-${agentId}`,
      launchExtensions: { pluginDirs: [], skillDirs: [] }, availabilityEntries: [], cleanup: mocks.cleanupSpy,
    }));
  });
  afterEach(cleanupEnv);

  it('dalton → software-engineer, ron → qa, dalton-verify → software-engineer-verify', async () => {
    const cases = [
      { agentId: 'dalton' as const, expectedExtAgentId: 'software-engineer' },
      { agentId: 'ron' as const, expectedExtAgentId: 'qa' },
      { agentId: 'dalton-verify' as const, expectedExtAgentId: 'software-engineer-verify' },
    ] as const;
    for (const { agentId, expectedExtAgentId } of cases) {
      vi.clearAllMocks();
      mocks.runAgentSession.mockResolvedValue(makeSuccessSession());
      mocks.loadAgentLaunchExtensionAssignments.mockResolvedValue({ schema_version: 1, assignments: [{ agent_id: expectedExtAgentId, extension_ids: ['ext-1'] }] });
      mocks.createAgentExtensionStage.mockImplementation(async ({ agentId: aid }: { agentId: string }) => ({
        launchId: `L-${aid}`, agentId: aid, stageDir: `/repo/.platform-state/runtime/agent-extension-stage/L-${aid}`,
        launchExtensions: { pluginDirs: [], skillDirs: [] }, availabilityEntries: [], cleanup: mocks.cleanupSpy,
      }));
      mocks.resolveAgentProfile.mockReturnValue(profileFor(agentId));
      await runRoleAgent({ agentId, taskId: 'task-1', skipWorkflowValidation: true });
      expect(mocks.createAgentExtensionStage).toHaveBeenCalledWith(expect.objectContaining({ agentId: expectedExtAgentId }));
    }
  });

  it('fleet Dalton cleanup (launchPhase Artifact Cleanup) receives software-engineer extensions', async () => {
    mocks.resolveAgentProfile.mockReturnValue(profileFor('dalton'));
    mocks.loadAgentLaunchExtensionAssignments.mockResolvedValue({ schema_version: 1, assignments: [{ agent_id: 'software-engineer', extension_ids: ['ext-1'] }] });
    mocks.createAgentExtensionStage.mockResolvedValue({ ...makeStage('software-engineer', 'L-fleet'), launchExtensions: { pluginDirs: ['/stage/L-fleet/plugins/p1'], skillDirs: [] }, availabilityEntries: [] });
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1', launchPhase: 'Artifact Cleanup', skipWorkflowValidation: true });
    expect(mocks.createAgentExtensionStage).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'software-engineer' }));
    expect(mocks.runAgentSession.mock.calls[0][0].cliArgs).toEqual(expect.arrayContaining(['--plugin-dir', '/stage/L-fleet/plugins/p1']));
  });
});

// ---------------------------------------------------------------------------
// H-T1: workflow-policy failure does NOT stage
// ---------------------------------------------------------------------------
describe('H-T1: workflow-policy failure does not stage', () => {
  beforeEach(() => { setupAssignedStage('dalton'); mocks.runRuntimePolicyCheck.mockResolvedValue({ stdout: 'x', stderr: 'blocked', exitCode: 1 }); });
  afterEach(cleanupEnv);

  it('rejects with workflow policy error and staging/session never called', async () => {
    await expect(runRoleAgent({ agentId: 'dalton', taskId: 'task-1' })).rejects.toThrow(/Workflow policy check failed/);
    expect(mocks.loadAgentLaunchExtensionAssignments).not.toHaveBeenCalled();
    expect(mocks.createAgentExtensionStage).not.toHaveBeenCalled();
    expect(mocks.runAgentSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H-T2: unauthorized skipWorkflowValidation does NOT stage
// ---------------------------------------------------------------------------
describe('H-T2: unauthorized skipWorkflowValidation does not stage', () => {
  beforeEach(() => { setupAssignedStage('dalton'); delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS']; });
  afterEach(cleanupEnv);

  it('rejects with reserved-for-orchestrators error and staging/session never called', async () => {
    await expect(runRoleAgent({ agentId: 'dalton', taskId: 'task-1', skipWorkflowValidation: true })).rejects.toThrow(/reserved for controlled internal orchestrators/);
    expect(mocks.loadAgentLaunchExtensionAssignments).not.toHaveBeenCalled();
    expect(mocks.createAgentExtensionStage).not.toHaveBeenCalled();
    expect(mocks.runAgentSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H-T3: denied-action continuation reuse for ron
// ---------------------------------------------------------------------------
describe('H-T3: denied-action continuation reuse for ron', () => {
  beforeEach(() => {
    setupAssignedStage('ron');
    const deniedSummary = { exitCode: 1, terminationReason: 'exited', signalCode: null, stdoutTail: 'permission denied and could not request permission from user', stderrTail: '' };
    mocks.runAgentSession
      .mockResolvedValueOnce({ runSummary: deniedSummary, greedyStopTriggered: false, sessionReceiptFile: null })
      .mockResolvedValueOnce(makeSuccessSession());
    // After denied exit: incomplete → triggers continuation; after continuation: complete.
    mockedCheck.mockResolvedValueOnce({ complete: false, reasons: ['x'] }).mockResolvedValue({ complete: true, reasons: [] });
  });
  afterEach(cleanupEnv);

  it('continuation (2nd) runAgentSession call includes --plugin-dir and skillDirs env, cleanup once', async () => {
    await runRoleAgent({ agentId: 'ron', taskId: 'task-1', skipWorkflowValidation: true });
    expect(mocks.runAgentSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    const cont = mocks.runAgentSession.mock.calls[1][0];
    expect(cont.cliArgs).toContain('--plugin-dir');
    expect(cont.cliArgs).toContain('/stage/L/plugins/p1');
    expect(cont.env['COPILOT_SKILLS_DIRS']).toBe('/stage/L/skills');
    expect(mocks.cleanupSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// H-T4: ron artifact cleanup reuse
// ---------------------------------------------------------------------------
describe('H-T4: ron artifact cleanup reuse', () => {
  beforeEach(() => {
    setupAssignedStage('ron');
    mockedCheck.mockResolvedValueOnce({ complete: false, reasons: ['final-summary.md missing'] }).mockResolvedValue({ complete: true, reasons: [] });
    mockedBuildRemediation.mockResolvedValue('- /repo/AgentWorkSpace/tasks/task-1/handoffs/final-summary.md: fix.');
  });
  afterEach(cleanupEnv);

  it('artifact cleanup (2nd) runAgentSession includes --plugin-dir, cleanup spy called once', async () => {
    await runRoleAgent({ agentId: 'ron', taskId: 'task-1', skipWorkflowValidation: true });
    expect(mocks.runAgentSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    const cleanup = mocks.runAgentSession.mock.calls[1][0];
    expect(cleanup.cliArgs).toContain('--plugin-dir');
    expect(cleanup.cliArgs).toContain('/stage/L/plugins/p1');
    expect(mocks.cleanupSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// H-T5: policy remediation reuse for dalton (no skipWorkflowValidation)
// ---------------------------------------------------------------------------
describe('H-T5: policy remediation reuse for dalton', () => {
  beforeEach(() => {
    // No bypass env — skipWorkflowValidation is NOT passed, so initial policy gate runs.
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.runAgentSession.mockResolvedValue(makeSuccessSession());
    mocks.resolveAgentProfile.mockReturnValue(profileFor('dalton'));
    mockedCheck.mockResolvedValue({ complete: true, reasons: [] });
    mocks.loadAgentLaunchExtensionAssignments.mockResolvedValue({ schema_version: 1, assignments: [{ agent_id: 'software-engineer', extension_ids: ['ext-1'] }] });
    mocks.createAgentExtensionStage.mockResolvedValue(makeStage('software-engineer'));
    // Initial dalton gate passes; next-role (ron) check fails → remediation; re-check passes.
    mocks.runRuntimePolicyCheck
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'blocked', exitCode: 1 })
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  });
  afterEach(cleanupEnv);

  it('policy remediation session includes --plugin-dir and cleanup called once', async () => {
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1' });
    expect(mocks.runAgentSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    const remediation = mocks.runAgentSession.mock.calls[1][0];
    expect(remediation.cliArgs).toContain('--plugin-dir');
    expect(remediation.cliArgs).toContain('/stage/L/plugins/p1');
    expect(mocks.cleanupSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// H-T6: dalton confinement retry reuse
// ---------------------------------------------------------------------------
describe('H-T6: dalton confinement retry reuse', () => {
  beforeEach(() => {
    setupAssignedStage('dalton');
    mocks.resolveAgentProfile.mockReturnValue({ ...profileFor('dalton'), autonomyProfile: 'repo-executor' });
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/repo/target', primaryFocusRelativePath: undefined,
      primaryFocusTargetKind: undefined, visibleRepoRoots: ['/repo/target'],
    } as Awaited<ReturnType<typeof mockedResolveSelectedPrimaryRepoRoot>>);
    mockedPrepareDaltonBoundary.mockResolvedValue({
      agentCwd: '/repo/target', preRunBoundarySnapshot: { byRepoRoot: {} },
    } as Awaited<ReturnType<typeof mockedPrepareDaltonBoundary>>);
    // Invoke the real retry callbacks so runAgentSession is called with --plugin-dir.
    mockedHandleDaltonConfinementValidation.mockImplementation(async (a: Parameters<typeof mockedHandleDaltonConfinementValidation>[0]) => {
      const r = a.buildRetryArgs('retry prompt');
      await a.runAgentSessionForConfinementRetry!(r.cliArgs, r.promptAudit, { launchId: 'retry-1', launchPhase: 'Confinement retry', retryOfLaunchId: 'L' });
      return undefined;
    });
  });
  afterEach(() => {
    cleanupEnv();
    mockedResolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);
    mockedPrepareDaltonBoundary.mockReset();
    mockedHandleDaltonConfinementValidation.mockResolvedValue(undefined);
  });

  it('confinement retry runAgentSession call includes --plugin-dir', async () => {
    await runRoleAgent({ agentId: 'dalton', taskId: 'task-1', contextPackDir: '/repo/context-pack', skipWorkflowValidation: true });
    expect(mocks.runAgentSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    const retry = mocks.runAgentSession.mock.calls[1][0];
    expect(retry.cliArgs).toContain('--plugin-dir');
    expect(retry.cliArgs).toContain('/stage/L/plugins/p1');
  });
});
