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
  getSharedMcpUrl: vi.fn(async () => 'http://localhost:8811/sse'),
  resolveContextPackContainerPath: vi.fn(() => '/workspace/context-pack'),
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
const { launchAgent, waitForAgentDetailed } = await import('../processLifecycle.js');
const { captureCodeDiff, prepareExternalMcpLaunchContext } = await import('../pythonHelpers.js');
const { runRuntimePolicyCheck, writeGuardrailReceipt, guardrailReceiptPath } = await import('../guardrails.js');
const { captureChangedPathsSnapshot, validateDaltonBoundaryChanges, DaltonConfinementError } = await import('../confinement.js');
const { checkAgentArtifactCompletion } = await import('../artifactCompletion.js');
const { buildAgentArtifactRemediationPrompt } = await import('../artifactCompletion.js');
const { writeSessionStartReceipt, writeSessionTerminalReceipt } = await import('../sessionReceipts.js');

// Shared typed references to mocked functions.
const mockedLoadAgentRegistry = vi.mocked(loadAgentRegistry);
const mockedResolveAgentProfile = vi.mocked(resolveAgentProfile);
const mockedResolveActiveModel = vi.mocked(resolveActiveModel);
const mockedResolveAutonomyProfile = vi.mocked(resolveAutonomyProfile);
const mockedBuildAgentArgs = vi.mocked(buildAgentArgs);
const mockedFormatAgentCommand = vi.mocked(formatAgentCommand);
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
const mockedExistsSync = vi.mocked(existsSync);

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
    launchDir: `${process.cwd()}/.platform-state/runtime/copilot-home/test-launch`,
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

describe('runRoleAgent autonomy env var export', () => {
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

  it('merges RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON into agent env', async () => {
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
      skipWorkflowValidation: true,
    });

    // Verify the env passed to launchAgent contains the autonomy vars
    const launchCall = mockedLaunchAgent.mock.calls[0];
    const envArg = (launchCall[1] as { env: Record<string, string> }).env;
    expect(envArg['RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON']).toBe('{"profile":"repo-executor"}');
    expect(envArg['RUN_ROLE_AGENT_AUTONOMY_ALLOW_TOOLS_JSON']).toBe('["editFiles","runCommand"]');
  });

  it('passes a repo-owned launch prompt to copilot', async () => {
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
      skipWorkflowValidation: true,
    });

    expect(mockedLaunchAgent).toHaveBeenCalledWith(
      ['--agent', 'software-engineer', '-p', 'Execute the assigned implementation slice now.'],
      expect.anything(),
    );
  });

  it('uses the Dalton launch prompt family for dalton-verify', async () => {
    useDaltonVerifyProfile();
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
      skipWorkflowValidation: true,
    });

    expect(mockedLaunchAgent).toHaveBeenCalledWith(
      ['--agent', 'software-engineer', '-p', 'Execute the assigned implementation slice now.'],
      expect.anything(),
    );
  });

  it('records prompt audit metadata in session and guardrail receipts for Dalton launches', async () => {
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
      skipWorkflowValidation: true,
    });

    expect(mockedWriteSessionStartReceipt).toHaveBeenCalledWith(expect.objectContaining({
      promptAudit: expect.objectContaining({
        promptPath: '/repo/.github/copilot/prompts/execute-task.prompt.md',
        promptSource: 'file',
        inlineAgentContext: false,
        effectivePromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/dalton.json',
      expect.objectContaining({
        prompt_audit: expect.objectContaining({
          prompt_path: '/repo/.github/copilot/prompts/execute-task.prompt.md',
          prompt_source: 'file',
          inline_agent_context: false,
          effective_prompt_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it('surfaces detailed agent failure output', async () => {
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 1,
      stdoutTail: 'planning started',
      stderrTail: 'missing artifact section',
      terminationReason: 'exited',
      signalCode: null,
    });

    await expect(
      runRoleAgent({
        agentId: 'dalton',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).rejects.toThrow('missing artifact section');
  });

  it('continues artifact-author work after a denied command instead of failing immediately', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'alice',
      registryId: 'product-manager',
      displayName: 'Alice',
      role: 'Product Manager',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 1,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed
      .mockResolvedValueOnce({
        exitCode: 1,
        stdoutTail: 'Permission denied and could not request permission from user',
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
    mockedCheckAgentArtifactCompletion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    await expect(
      runRoleAgent({
        agentId: 'alice',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(2);
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('Do not run shell commands.'),
      ]),
    );
    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/alice.json',
      expect.objectContaining({
        status: 'passed',
      }),
    );
  });

  it('treats denied artifact-author exits as success when artifacts are already complete', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'alice',
      registryId: 'product-manager',
      displayName: 'Alice',
      role: 'Product Manager',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 1,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 1,
      stdoutTail: 'Permission denied and could not request permission from user',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedCheckAgentArtifactCompletion.mockResolvedValue(true);

    await expect(
      runRoleAgent({
        agentId: 'alice',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(1);
    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/alice.json',
      expect.objectContaining({
        status: 'passed',
      }),
    );
  });

  it('skips artifact completion check for Dalton (no required SWE artifacts)', async () => {
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    // Even if the completion check would return false, Dalton should succeed
    // because the artifact completion check is skipped entirely for Dalton.
    mockedCheckAgentArtifactCompletion.mockResolvedValue(false);

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

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(1);
  });

  it('skips artifact completion check for dalton-verify (same SWE artifact bypass)', async () => {
    useDaltonVerifyProfile();
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedCheckAgentArtifactCompletion.mockResolvedValue(false);

    await expect(
      runRoleAgent({
        agentId: 'dalton-verify',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton-verify',
    });

    expect(mockedCheckAgentArtifactCompletion).not.toHaveBeenCalled();
    expect(mockedLaunchAgent).toHaveBeenCalledTimes(1);
  });

  it('does not rerun Alice when Dalton is blocked but no incomplete Alice artifacts are proven', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'alice',
      registryId: 'product-manager',
      displayName: 'Alice',
      role: 'Product Manager',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 1,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedCheckAgentArtifactCompletion.mockResolvedValue(true);
    mockedRunRuntimePolicyCheck.mockResolvedValueOnce({
      stdout: '{"violations":[{"message":"Requested agent transition is not legal for the current workflow state."}]}',
      stderr: '',
      exitCode: 1,
    });
    mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue('');

    await expect(
      runRoleAgent({
        agentId: 'alice',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).rejects.toThrow('no concrete incomplete Alice artifacts were detected');

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(1);
    expect(mockedRunRuntimePolicyCheck).toHaveBeenCalledTimes(1);
  });

  it('reruns Alice once with a cleanup prompt when PM artifacts are incomplete', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'alice',
      registryId: 'product-manager',
      displayName: 'Alice',
      role: 'Product Manager',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 1,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
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
    mockedCheckAgentArtifactCompletion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue(
      'Fill in AgentWorkSpace/tasks/t1/handoffs/parallel-ok.md with a Simple or Complex decision.',
    );

    await expect(
      runRoleAgent({
        agentId: 'alice',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(2);
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('parallel-ok.md'),
      ]),
    );
  });

  it('reruns Alice once with a cleanup prompt when Dalton is still policy-blocked', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'alice',
      registryId: 'product-manager',
      displayName: 'Alice',
      role: 'Product Manager',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 1,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
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
    mockedCheckAgentArtifactCompletion.mockResolvedValue(true);
    mockedRunRuntimePolicyCheck
      .mockResolvedValueOnce({
        stdout: '{"violations":[{"message":"Requested agent transition is not legal for the current workflow state."}]}',
        stderr: '',
        exitCode: 1,
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue(
      'Fill in AgentWorkSpace/tasks/t1/handoffs/parallel-ok.md with a Simple or Complex decision.',
    );

    await expect(
      runRoleAgent({
        agentId: 'alice',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(2);
    expect(mockedRunRuntimePolicyCheck).toHaveBeenCalledTimes(2);
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('Blocking workflow-policy details'),
      ]),
    );
  });

  it('reruns Ron with a cleanup prompt when QA artifacts are incomplete', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'ron',
      registryId: 'qa',
      displayName: 'Ron',
      role: 'QA',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 3,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/ron.json');
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
    mockedCheckAgentArtifactCompletion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue(
      'Fill in AgentWorkSpace/tasks/t1/handoffs/final-summary.md and AgentWorkSpace/tasks/t1/handoffs/retrospective-input.md.',
    );

    await expect(
      runRoleAgent({
        agentId: 'ron',
        taskId: 't1',
        contextPackDir: '/repo/context-pack',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'ron',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(2);
    expect(mockedCaptureCodeDiff).toHaveBeenCalledWith(expect.objectContaining({
      outputPath: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
      repoRoot: '/repo',
      taskId: 't1',
      abortSignal: undefined,
    }));
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('Fill in'),
      ]),
    );
  });

  it('generates code-changes.diff before launching Ron when a context pack is active', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'ron',
      registryId: 'qa',
      displayName: 'Ron',
      role: 'QA',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 3,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/ron.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await expect(
      runRoleAgent({
        agentId: 'ron',
        taskId: 't1',
        contextPackDir: '/repo/context-pack',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'ron',
    });

    expect(mockedCaptureCodeDiff.mock.invocationCallOrder[0]).toBeLessThan(
      mockedLaunchAgent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mockedCaptureCodeDiff).toHaveBeenCalledWith(expect.objectContaining({
      outputPath: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
      repoRoot: '/repo',
      taskId: 't1',
      abortSignal: undefined,
    }));
  });

  it('warns and still launches Ron when code diff refresh fails', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'ron',
      registryId: 'qa',
      displayName: 'Ron',
      role: 'QA',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 3,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/ron.json');
    mockedCaptureCodeDiff.mockResolvedValueOnce({
      stdout: '',
      stderr: 'git diff failed',
      exitCode: 1,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await expect(
      runRoleAgent({
        agentId: 'ron',
        taskId: 't1',
        contextPackDir: '/repo/context-pack',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'ron',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[roleAgent] failed to generate QA code diff at /repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff; continuing without refreshed diff:',
      'git diff failed',
    );
  });

  it('warns and still reruns Ron for QA cleanup when code diff refresh fails', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'ron',
      registryId: 'qa',
      displayName: 'Ron',
      role: 'QA',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 3,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/ron.json');
    mockedCaptureCodeDiff.mockResolvedValueOnce({
      stdout: 'warning output',
      stderr: '',
      exitCode: 1,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    mockedCheckAgentArtifactCompletion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue(
      'Fill in AgentWorkSpace/tasks/t1/handoffs/final-summary.md and AgentWorkSpace/tasks/t1/handoffs/retrospective-input.md.',
    );

    await expect(
      runRoleAgent({
        agentId: 'ron',
        taskId: 't1',
        contextPackDir: '/repo/context-pack',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'ron',
    });

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      '[roleAgent] failed to generate QA code diff at /repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff; continuing without refreshed diff:',
      'warning output',
    );
    expect(mockedLaunchAgent.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('Fill in AgentWorkSpace/tasks/t1/handoffs/final-summary.md'),
      ]),
    );
  });

  it('does not generate code-changes.diff for non-QA agents', async () => {
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
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

    expect(mockedCaptureCodeDiff).not.toHaveBeenCalled();
  });

  it('does not rerun Ron when QA artifacts are incomplete but no concrete missing artifacts are proven', async () => {
    mockedResolveAgentProfile.mockReturnValue({
      id: 'ron',
      registryId: 'qa',
      displayName: 'Ron',
      role: 'QA',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 3,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/ron.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });
    mockedCheckAgentArtifactCompletion.mockResolvedValue(false);
    mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue('');

    await expect(
      runRoleAgent({
        agentId: 'ron',
        taskId: 't1',
        skipWorkflowValidation: true,
      }),
    ).rejects.toThrow('no concrete incomplete Ron artifacts were detected');

    expect(mockedLaunchAgent).toHaveBeenCalledTimes(1);
  });

  it('greedily stops Alice once required PM artifacts are complete', async () => {
    vi.useFakeTimers();
    mockedResolveAgentProfile.mockReturnValue({
      id: 'alice',
      registryId: 'product-manager',
      displayName: 'Alice',
      role: 'Product Manager',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 1,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    const fakeChild = {
      pid: 1234,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return {
        exitCode: 1,
        stdoutTail: 'Operation cancelled by user',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      };
    });
    mockedCheckAgentArtifactCompletion.mockResolvedValue(true);

    const runPromise = runRoleAgent({
      agentId: 'alice',
      taskId: 't1',
      skipWorkflowValidation: true,
    });

    await vi.advanceTimersByTimeAsync(2500);
    await expect(runPromise).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockedCheckAgentArtifactCompletion).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('greedily stops Ron once required QA closeout artifacts are complete', async () => {
    vi.useFakeTimers();
    mockedResolveAgentProfile.mockReturnValue({
      id: 'ron',
      registryId: 'qa',
      displayName: 'Ron',
      role: 'QA',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 3,
      wallClockTimeoutS: 300,
    } as never);
    mockedResolveActiveModel.mockReturnValue('gpt-5.4');
    mockedBuildAgentArgs.mockReturnValue({ args: [], launchCwd: '/repo', inlineAgentContext: false, resolvedToolPolicy: { allowAllTools: true, noAskUser: true, allowTools: [], denyTools: [] } });
    const fakeChild = {
      pid: 1234,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    } as never;
    mockedLaunchAgent.mockReturnValue(fakeChild);
    mockedWaitForAgentDetailed.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return {
        exitCode: 1,
        stdoutTail: 'Operation cancelled by user',
        stderrTail: '',
        terminationReason: 'exited',
        signalCode: null,
      };
    });
    mockedCheckAgentArtifactCompletion.mockResolvedValue(true);

    const runPromise = runRoleAgent({
      agentId: 'ron',
      taskId: 't1',
      skipWorkflowValidation: true,
    });

    await vi.advanceTimersByTimeAsync(2500);
    await expect(runPromise).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'ron',
    });
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockedCheckAgentArtifactCompletion).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
