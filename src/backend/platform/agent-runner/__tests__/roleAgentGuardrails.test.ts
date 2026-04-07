import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  buildCopilotArgs: vi.fn(),
  formatCopilotCommand: vi.fn(),
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
  launchCopilot: vi.fn(),
  waitForCopilotDetailed: vi.fn(),
}));

vi.mock('../pythonHelpers.js', () => ({
  captureCodeDiff: vi.fn(),
  prepareExternalMcpLaunchContext: vi.fn(),
}));

vi.mock('../../context-pack/focusedRepo.js', () => ({
  resolveFocusedRepoRoot: vi.fn(),
  resolveSelectedPrimaryRepoRoot: vi.fn(),
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

const { runRoleAgent } = await import('../roleAgent.js');
const { loadAgentRegistry, resolveAgentProfile, resolveActiveModel } = await import('../metadata.js');
const { resolveAutonomyProfile, buildCopilotArgs, formatCopilotCommand } = await import('../autonomy.js');
const { buildAgentEnvironment, buildAutonomyEnvironment } = await import('../environment.js');
const { resolvePaths } = await import('../../core/index.js');
const { readTextFile } = await import('../../core/io.js');
const { resolveFocusedRepoRoot } = await import('../../context-pack/focusedRepo.js');
const { resolveSelectedPrimaryRepoRoot } = await import('../../context-pack/focusedRepo.js');
const { launchCopilot, waitForCopilotDetailed } = await import('../processLifecycle.js');
const { captureCodeDiff, prepareExternalMcpLaunchContext } = await import('../pythonHelpers.js');
const { runRuntimePolicyCheck, writeGuardrailReceipt, guardrailReceiptPath } = await import('../guardrails.js');
const { captureChangedPathsSnapshot, validateDaltonBoundaryChanges, DaltonConfinementError } = await import('../confinement.js');
const { checkAgentArtifactCompletion } = await import('../artifactCompletion.js');
const { buildAgentArtifactRemediationPrompt } = await import('../artifactCompletion.js');
const { writeSessionStartReceipt, writeSessionTerminalReceipt } = await import('../sessionReceipts.js');

const mockedLoadAgentRegistry = vi.mocked(loadAgentRegistry);
const mockedResolveAgentProfile = vi.mocked(resolveAgentProfile);
const mockedResolveActiveModel = vi.mocked(resolveActiveModel);
const mockedResolveAutonomyProfile = vi.mocked(resolveAutonomyProfile);
const mockedBuildCopilotArgs = vi.mocked(buildCopilotArgs);
const mockedFormatCopilotCommand = vi.mocked(formatCopilotCommand);
const mockedBuildAgentEnvironment = vi.mocked(buildAgentEnvironment);
const mockedBuildAutonomyEnvironment = vi.mocked(buildAutonomyEnvironment);
const mockedResolvePaths = vi.mocked(resolvePaths);
const mockedReadTextFile = vi.mocked(readTextFile);
const mockedResolveFocusedRepoRoot = vi.mocked(resolveFocusedRepoRoot);
const mockedResolveSelectedPrimaryRepoRoot = vi.mocked(resolveSelectedPrimaryRepoRoot);
const mockedLaunchCopilot = vi.mocked(launchCopilot);
const mockedWaitForCopilotDetailed = vi.mocked(waitForCopilotDetailed);
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
const mockedExistsSync = vi.mocked(existsSync);

function setupCommonMocks(): void {
  mockedResolvePaths.mockReturnValue({
    repoRoot: '/repo',
    agentWorkSpace: '/repo/AgentWorkSpace',
    dropbox: '/repo/AgentWorkSpace/dropbox',
    pendingItems: '/repo/AgentWorkSpace/pendingitems',
    handoffs: '/repo/AgentWorkSpace/handoffs',
    templates: '/repo/AgentWorkSpace/templates',
    implementationSteps: '/repo/AgentWorkSpace/ImplementationSteps',
    qmd: '/repo/AgentWorkSpace/qmd',
    errorItems: '/repo/AgentWorkSpace/erroritems',
    platformState: '/repo/.platform-state',
    guardrails: '/repo/.platform-state/runtime/guardrails',
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
    allowTools: [],
    denyTools: [],
    allowedDirs: [],
    additionalFlags: [],
  });
  mockedBuildCopilotArgs.mockReturnValue(['--agent', 'software-engineer']);
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
  mockedValidateDaltonBoundaryChanges.mockReturnValue(undefined);
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
        skipWorkflowValidation: true,
        dryRun: true,
      }),
    ).rejects.toThrow('known orchestrator ID');
  });

  it('accepts skip-workflow-check with valid bypass env vars', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
    mockedFormatCopilotCommand.mockReturnValue('copilot --agent software-engineer');

    const result = await runRoleAgent({
      agentId: 'dalton',
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
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'dalton',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    const launchCall = mockedLaunchCopilot.mock.calls[0];
    const launchOpts = launchCall[1] as { cwd: string };
    expect(launchOpts.cwd).toBe('/ctx/crud-app');
    expect(mockedBuildCopilotArgs).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ skipAgentFlag: true }),
    );
    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace',
      '/ctx/crud-app',
      '/ctx/shared-lib',
      '/repo',
    ]);
    expect(mockedBuildAutonomyEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      autonomyArgs,
      '/ctx/crud-app',
      '/repo',
      expect.objectContaining({
        primaryRepoRoot: '/ctx/crud-app',
        visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
        selectedRepoIds: ['crud-app', 'shared-lib'],
      }),
      '/ctx',
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
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'lily',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace/dropbox',
      '/repo/AgentWorkSpace/templates',
      '/repo/AgentWorkSpace',
      '/ctx/crud-app',
      '/ctx/shared-lib',
    ]);
    expect(mockedBuildAutonomyEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lily' }),
      autonomyArgs,
      '/repo',
      '/repo',
      expect.objectContaining({
        primaryRepoRoot: '/ctx/crud-app',
        visibleRepoRoots: ['/ctx/crud-app', '/ctx/shared-lib'],
        selectedRepoIds: ['crud-app', 'shared-lib'],
      }),
      '/ctx',
    );
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
    mockedExistsSync.mockImplementation((candidate: string) => candidate === '/ctx/mono/services/sink');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'dalton',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    });

    const launchCall = mockedLaunchCopilot.mock.calls[0];
    const launchOpts = launchCall[1] as { cwd: string };
    expect(launchOpts.cwd).toBe('/ctx/mono/services/sink');
    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace',
      '/ctx/mono',
      '/repo',
    ]);
  });

  it('fails closed when Dalton cannot resolve an authoritative selected primary boundary', async () => {
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';

    await expect(runRoleAgent({
      agentId: 'dalton',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('authoritative active task/workspace selection');
    expect(mockedLaunchCopilot).not.toHaveBeenCalled();
  });

  it('fails closed when dalton-verify cannot resolve an authoritative selected primary boundary', async () => {
    useDaltonVerifyProfile();
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';

    await expect(runRoleAgent({
      agentId: 'dalton-verify',
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('authoritative active task/workspace selection');
    expect(mockedLaunchCopilot).not.toHaveBeenCalled();
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
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await runRoleAgent({
      agentId: 'dalton-verify',
      contextPackDir: '/ctx',
      verificationTempAllowedDir: '/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z',
      skipWorkflowValidation: true,
    });

    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace',
      '/ctx/mono',
      '/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z',
    ]);
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
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow(
      'Cannot launch agent "dalton": selected monolith focus subfolder "services/sink" does not exist at "/ctx/mono/services/sink".',
    );
    expect(mockedLaunchCopilot).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': [], '/ctx/shared-lib': [] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': ['src/app.ts'], '/ctx/shared-lib': ['src/leak.ts'] } });
    mockedValidateDaltonBoundaryChanges.mockImplementation(() => {
      throw new DaltonConfinementError('out-of-bound edits', ['/ctx/shared-lib/src/leak.ts']);
    });
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed
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
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('confinement retry exited with code 1');

    expect(autonomyArgs.allowedDirs).toEqual([
      '/repo/AgentWorkSpace',
      '/ctx/crud-app',
      '/ctx/shared-lib',
      '/repo',
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

  it('reruns Dalton once with the retry prompt after a confinement violation', async () => {
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
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': [], '/ctx/shared-lib': [] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': ['src/app.ts'], '/ctx/shared-lib': ['src/leak.ts'] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': ['src/app.ts'], '/ctx/shared-lib': [] } });
    mockedValidateDaltonBoundaryChanges
      .mockImplementationOnce(() => {
        throw new DaltonConfinementError('out-of-bound edits', ['/ctx/shared-lib/src/leak.ts']);
      })
      .mockImplementationOnce(() => undefined);
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed
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
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton',
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(2);
    expect(mockedLaunchCopilot.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('Fix the boundary mistake and finish the assigned slice.'),
      ]),
    );
    expect(mockedLaunchCopilot.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('/ctx/shared-lib/src/leak.ts'),
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
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': [], '/ctx/shared-lib': [] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': ['src/app.ts'], '/ctx/shared-lib': ['src/leak.ts'] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': ['src/app.ts'], '/ctx/shared-lib': [] } });
    mockedValidateDaltonBoundaryChanges
      .mockImplementationOnce(() => {
        throw new DaltonConfinementError('out-of-bound edits', ['/ctx/shared-lib/src/leak.ts']);
      })
      .mockImplementationOnce(() => undefined);
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed
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
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton-verify',
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(2);
    expect(mockedLaunchCopilot.mock.calls[1]?.[0]).toEqual(
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
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': [], '/ctx/shared-lib': [] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': ['src/app.ts'], '/ctx/shared-lib': ['src/leak.ts'] } })
      .mockResolvedValueOnce({ byRepoRoot: { '/repo': [], '/ctx/crud-app': ['src/app.ts'], '/ctx/shared-lib': ['src/leak.ts'] } });
    mockedValidateDaltonBoundaryChanges
      .mockImplementationOnce(() => {
        throw new DaltonConfinementError('out-of-bound edits', ['/ctx/shared-lib/src/leak.ts']);
      })
      .mockImplementationOnce(() => {
        throw new DaltonConfinementError('retry still out-of-bound', ['/ctx/shared-lib/src/leak.ts']);
      });
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed
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
      contextPackDir: '/ctx',
      skipWorkflowValidation: true,
    })).rejects.toThrow('retry still out-of-bound');

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(2);
    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/dalton.json',
      expect.objectContaining({
        status: 'failed',
        termination_reason: 'confinement-violation',
        violation_paths: ['/ctx/shared-lib/src/leak.ts'],
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
