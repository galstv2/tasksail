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
const { captureCodeDiff } = await import('../pythonHelpers.js');
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
    handoffs: '/repo/AgentWorkSpace/handoffs',
    templates: '/repo/AgentWorkSpace/templates',
    implementationSteps: '/repo/AgentWorkSpace/ImplementationSteps',
    qmd: '/repo/AgentWorkSpace/qmd',
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
      skipWorkflowValidation: true,
    });

    // Verify the env passed to launchCopilot contains the autonomy vars
    const launchCall = mockedLaunchCopilot.mock.calls[0];
    const envArg = (launchCall[1] as { env: Record<string, string> }).env;
    expect(envArg['RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON']).toBe('{"profile":"repo-executor"}');
    expect(envArg['RUN_ROLE_AGENT_AUTONOMY_ALLOW_TOOLS_JSON']).toBe('["editFiles","runCommand"]');
  });

  it('passes a repo-owned launch prompt to copilot', async () => {
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
      skipWorkflowValidation: true,
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledWith(
      ['--agent', 'software-engineer', '-p', 'Execute the assigned implementation slice now.'],
      expect.anything(),
    );
  });

  it('records prompt audit metadata in session and guardrail receipts for Dalton launches', async () => {
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
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
      exitCode: 1,
      stdoutTail: 'planning started',
      stderrTail: 'missing artifact section',
      terminationReason: 'exited',
      signalCode: null,
    });

    await expect(
      runRoleAgent({
        agentId: 'dalton',
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'product-manager']);
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed
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
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(2);
    expect(mockedLaunchCopilot.mock.calls[1]?.[0]).toEqual(
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'product-manager']);
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
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
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(1);
    expect(mockedWriteGuardrailReceipt).toHaveBeenCalledWith(
      '/repo/.platform-state/runtime/guardrails/alice.json',
      expect.objectContaining({
        status: 'passed',
      }),
    );
  });

  it('skips artifact completion check for Dalton (no required SWE artifacts)', async () => {
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
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
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'dalton',
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(1);
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'product-manager']);
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
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
        skipWorkflowValidation: true,
      }),
    ).rejects.toThrow('no concrete incomplete Alice artifacts were detected');

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(1);
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'product-manager']);
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
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
    mockedCheckAgentArtifactCompletion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue(
      'Fill in AgentWorkSpace/handoffs/parallel-ok.md with a Simple or Complex decision.',
    );

    await expect(
      runRoleAgent({
        agentId: 'alice',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(2);
    expect(mockedLaunchCopilot.mock.calls[1]?.[0]).toEqual(
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'product-manager']);
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/alice.json');
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
      'Fill in AgentWorkSpace/handoffs/parallel-ok.md with a Simple or Complex decision.',
    );

    await expect(
      runRoleAgent({
        agentId: 'alice',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'alice',
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(2);
    expect(mockedRunRuntimePolicyCheck).toHaveBeenCalledTimes(2);
    expect(mockedLaunchCopilot.mock.calls[1]?.[0]).toEqual(
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'qa']);
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/ron.json');
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
    mockedCheckAgentArtifactCompletion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockedBuildAgentArtifactRemediationPrompt.mockResolvedValue(
      'Fill in AgentWorkSpace/handoffs/final-summary.md and AgentWorkSpace/handoffs/retrospective-input.md.',
    );

    await expect(
      runRoleAgent({
        agentId: 'ron',
        contextPackDir: '/repo/context-pack',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'ron',
    });

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(2);
    expect(mockedCaptureCodeDiff).toHaveBeenCalledWith({
      contextPackDir: '/repo/context-pack',
      outputPath: '/repo/AgentWorkSpace/handoffs/code-changes.diff',
      repoRoot: '/repo',
      abortSignal: undefined,
    });
    expect(mockedLaunchCopilot.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '-p',
        expect.stringContaining('Fill in AgentWorkSpace/handoffs/final-summary.md'),
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'qa']);
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/ron.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await expect(
      runRoleAgent({
        agentId: 'ron',
        contextPackDir: '/repo/context-pack',
        skipWorkflowValidation: true,
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      agentId: 'ron',
    });

    expect(mockedCaptureCodeDiff.mock.invocationCallOrder[0]).toBeLessThan(
      mockedLaunchCopilot.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mockedCaptureCodeDiff).toHaveBeenCalledWith({
      contextPackDir: '/repo/context-pack',
      outputPath: '/repo/AgentWorkSpace/handoffs/code-changes.diff',
      repoRoot: '/repo',
      abortSignal: undefined,
    });
  });

  it('does not generate code-changes.diff for non-QA agents', async () => {
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      terminationReason: 'exited',
      signalCode: null,
    });

    await expect(
      runRoleAgent({
        agentId: 'dalton',
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'qa']);
    mockedGuardrailReceiptPath.mockReturnValue('/repo/.platform-state/runtime/guardrails/ron.json');
    const fakeChild = { pid: 1234 } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockResolvedValue({
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
        skipWorkflowValidation: true,
      }),
    ).rejects.toThrow('no concrete incomplete Ron artifacts were detected');

    expect(mockedLaunchCopilot).toHaveBeenCalledTimes(1);
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'product-manager']);
    const fakeChild = {
      pid: 1234,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockImplementation(async () => {
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
    mockedBuildCopilotArgs.mockReturnValue(['--agent', 'qa']);
    const fakeChild = {
      pid: 1234,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    } as never;
    mockedLaunchCopilot.mockReturnValue(fakeChild);
    mockedWaitForCopilotDetailed.mockImplementation(async () => {
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
    // Dalton now launches from the focused repo CWD with inlined agent context
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
