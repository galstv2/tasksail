import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsSync = vi.fn(() => true);
const ensureDir = vi.fn(async () => undefined);
const writeUniqueGuardrailReceipt = vi.fn(async (options: {
  agentId: string;
  data: Record<string, unknown>;
  launchPhase?: string;
}) => `/repo/.platform-state/runtime/tasks/task-test-001/guardrails/${options.agentId}.json`);
const buildArtifactCleanupPrompt = vi.fn((options: { artifactPrompt: string }) => options.artifactPrompt);
const runAgentSession = vi.fn();
const correctSessionReceipt = vi.fn(async () => undefined);

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync };
});

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    ...actual,
    ensureDir,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: function child() { return this; } }),
    newSpanId: vi.fn(() => 'span-1'),
    resolvePaths: vi.fn(() => ({
      repoRoot: '/repo',
      agentWorkSpace: '/repo/AgentWorkSpace',
      handoffs: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs',
      templates: '/repo/AgentWorkSpace/templates',
      implementationSteps: '/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps',
      qmd: '/repo/AgentWorkSpace/qmd',
      taskRuntime: '/repo/.platform-state/runtime/tasks/task-test-001',
      platformState: '/repo/.platform-state',
    })),
  };
});

vi.mock('../metadata.js', () => ({
  loadAgentRegistry: vi.fn(async () => ({ agents: [] })),
  resolveAgentProfile: vi.fn(() => ({
    id: 'alice',
    registryId: 'product-manager',
    displayName: 'Alice',
    role: 'Product Manager',
    requiredModel: 'gpt-4.1',
    autonomyProfile: 'planner',
    workflowOrder: 1,
    wallClockTimeoutS: 600,
    idleTimeoutS: 60,
  })),
  resolveActiveModel: vi.fn(() => 'gpt-4.1'),
}));

vi.mock('../autonomy.js', () => ({
  resolveAutonomyProfile: vi.fn(() => ({
    model: 'gpt-4.1',
    autonomyProfile: 'planner',
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
}));

vi.mock('../environment.js', () => ({
  buildAgentEnvironment: vi.fn(() => ({
    COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs',
    COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps',
  })),
  buildAutonomyEnvironment: vi.fn(() => ({})),
}));

vi.mock('../guardrails.js', () => ({
  runRuntimePolicyCheck: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  writeUniqueGuardrailReceipt,
}));

vi.mock('../artifactCompletion.js', async () => {
  const actual = await vi.importActual<typeof import('../artifactCompletion.js')>('../artifactCompletion.js');
  return {
    ...actual,
    checkAgentArtifactCompletion: vi.fn(),
    checkAgentArtifactCompletionDetails: vi.fn(),
    buildAgentArtifactRemediationPrompt: vi.fn(async () => (
      '- /repo/AgentWorkSpace/tasks/task-test-001/handoffs/parallel-ok.md: fill Decision.'
    )),
  };
});

vi.mock('../agentSession.js', () => ({
  runAgentSession,
  correctSessionReceipt,
  refreshQaCodeDiff: vi.fn(async () => undefined),
  mergeExternalMcpLaunchEnvironment: vi.fn(async () => ({
    status: 'not-applicable',
    injectionEnabled: false,
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
}));

vi.mock('../worktreeInjection.js', () => ({
  buildWorktreeBindingMap: vi.fn(async () => new Map()),
  applyWorktreeInjectionToFocused: vi.fn((focused) => focused),
  applyWorktreeInjectionToAllowedDirs: vi.fn((allowedDirs) => allowedDirs),
}));

vi.mock('../../context-pack/focusedRepo.js', () => ({
  explainSelectedPrimaryBoundaryFailure: vi.fn(async () => 'no selected primary'),
  resolveFocusedRepoRoot: vi.fn(),
  resolveSelectedPrimaryRepoRoot: vi.fn(),
}));

vi.mock('../daltonLaunchPrep.js', async () => {
  const actual = await vi.importActual<typeof import('../daltonLaunchPrep.js')>('../daltonLaunchPrep.js');
  return { ...actual, buildArtifactCleanupPrompt };
});

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: vi.fn(() => ({
    id: 'copilot',
    resolvePromptPath: () => '.github/copilot/prompts/start-task.prompt.md',
    promptPathEnvVars: () => ({
      handoffsDir: 'COPILOT_HANDOFFS_DIR',
      implStepsDir: 'COPILOT_IMPL_STEPS_DIR',
    }),
    materializePrompt: ({ prompt }: { prompt: string }) => ({
      effectivePrompt: prompt,
      inlineAgentContext: false,
    }),
    runtimeManifestEnvVars: () => [
      { name: 'COPILOT_HANDOFFS_DIR', kind: 'path', description: 'handoffs' },
      { name: 'COPILOT_IMPL_STEPS_DIR', kind: 'path', description: 'steps' },
    ],
    mcpConfigArgs: () => [],
    agentConfigPaths: () => ({ registry: '.github/agents/registry.json' }),
  })),
}));

vi.mock('../../core/io.js', () => ({
  readTextFile: vi.fn(async () => 'Start task.'),
}));

vi.mock('../../container/sharedMcp.js', () => ({
  resolveContextPackContainerPath: vi.fn(() => '/repo/context-pack'),
  runtimeRequiresContainerPaths: vi.fn(async () => false),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn(async () => ({
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  })),
}));

vi.mock('../pipeline/requirementVerification.js', () => ({
  prepopulateRequirementVerification: vi.fn(),
}));

const { runRoleAgent } = await import('../roleAgent.js');
const { checkAgentArtifactCompletionDetails } = await import('../artifactCompletion.js');
const { buildAgentArtifactRemediationPrompt } = await import('../artifactCompletion.js');
const { prepopulateRequirementVerification } = await import('../pipeline/requirementVerification.js');
const mockedCheckAgentArtifactCompletionDetails = vi.mocked(checkAgentArtifactCompletionDetails);
const mockedBuildAgentArtifactRemediationPrompt = vi.mocked(buildAgentArtifactRemediationPrompt);
const mockedPrepopulateRequirementVerification = vi.mocked(prepopulateRequirementVerification);

describe('roleAgent artifact recovery receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    mockedCheckAgentArtifactCompletionDetails
      .mockResolvedValueOnce({ complete: false, reasons: ['parallel-ok.md missing or Decision is not Simple or Complex'] })
      .mockResolvedValueOnce({ complete: false, reasons: ['parallel-ok.md missing or Decision is not Simple or Complex'] })
      .mockResolvedValueOnce({ complete: false, reasons: ['parallel-ok.md missing or Decision is not Simple or Complex'] });
    runAgentSession
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'initial stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      })
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 1,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'cleanup stdout',
          stderrTail: 'cleanup failed',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      });
  });

  it('writes separate initial and cleanup receipts with cleanup launch metadata and precreated dirs', async () => {
    await expect(runRoleAgent({
      agentId: 'alice',
      taskId: 'task-test-001',
    })).rejects.toThrow('cleanup pass exited with code 1');

    expect(writeUniqueGuardrailReceipt).toHaveBeenCalledTimes(2);
    expect(writeUniqueGuardrailReceipt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentId: 'alice',
      launchId: expect.any(String),
      data: expect.objectContaining({
        termination_reason: 'artifact-incomplete',
        artifact_completion_reasons: ['parallel-ok.md missing or Decision is not Simple or Complex'],
        stdout_tail: 'initial stdout',
      }),
    }));
    expect(writeUniqueGuardrailReceipt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      agentId: 'alice',
      launchId: expect.any(String),
      launchPhase: 'Artifact Cleanup',
      data: expect.objectContaining({
        termination_reason: 'exited',
        stderr_tail: 'cleanup failed',
      }),
    }));
    expect(ensureDir).toHaveBeenCalledWith('/repo/AgentWorkSpace/tasks/task-test-001/handoffs');
    expect(ensureDir).toHaveBeenCalledWith('/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps');
    expect(buildArtifactCleanupPrompt).toHaveBeenCalledWith(expect.objectContaining({
      forbiddenPathTokens: [
        '$COPILOT_HANDOFFS_DIR',
        '$COPILOT_IMPL_STEPS_DIR',
        'AgentWorkSpace/tasks/active',
      ],
    }));
    expect(runAgentSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      session: expect.objectContaining({ launchPhase: 'Artifact Cleanup' }),
    }));
  });

  it('adds bounded diagnostic reasons to cleanup-pass still-incomplete receipts and errors', async () => {
    const reasons = Array.from({ length: 21 }, (_, index) => `reason-${index + 1}`);
    mockedCheckAgentArtifactCompletionDetails
      .mockReset()
      .mockResolvedValue({ complete: false, reasons });
    runAgentSession
      .mockReset()
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'initial stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      })
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'cleanup stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      });

    await expect(runRoleAgent({
      agentId: 'alice',
      taskId: 'task-test-001',
    })).rejects.toThrow(/Incomplete artifact reasons:\n- reason-1/);

    const finalReceipt = writeUniqueGuardrailReceipt.mock.calls.at(-1)?.[0]?.data;
    expect(finalReceipt).toEqual(expect.objectContaining({
      termination_reason: 'artifact-incomplete',
      artifact_completion_reasons: [
        ...reasons.slice(0, 19),
        'additional artifact completion reasons omitted: 2',
      ],
    }));
  });

  it('accepts Alice cleanup when a non-zero cleanup exit still leaves artifacts complete', async () => {
    mockedCheckAgentArtifactCompletionDetails
      .mockReset()
      .mockResolvedValueOnce({ complete: false, reasons: ['parallel-ok.md missing or Decision is not Simple or Complex'] })
      .mockResolvedValueOnce({ complete: false, reasons: ['parallel-ok.md missing or Decision is not Simple or Complex'] })
      .mockResolvedValueOnce({ complete: true, reasons: [] });
    runAgentSession
      .mockReset()
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'initial stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      })
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 1,
          terminationReason: 'exited',
          signalCode: 'SIGTERM',
          stdoutTail: 'cleanup repaired artifacts',
          stderrTail: 'provider exited non-zero',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: '/repo/session-cleanup.json',
      });

    await expect(runRoleAgent({
      agentId: 'alice',
      taskId: 'task-test-001',
    })).resolves.toMatchObject({ exitCode: 0, durationMs: expect.any(Number) });

    expect(correctSessionReceipt).toHaveBeenCalledWith('/repo/session-cleanup.json', 'alice');
    expect(writeUniqueGuardrailReceipt).toHaveBeenCalledTimes(2);
    expect(writeUniqueGuardrailReceipt.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      agentId: 'alice',
      launchPhase: 'Artifact Cleanup',
      data: expect.objectContaining({
        status: 'passed',
        exit_code: 0,
        termination_reason: 'exited',
        stdout_tail: 'cleanup repaired artifacts',
      }),
    }));
  });

  it('adds Ron cleanup-pass still-incomplete diagnostic reasons to receipts and thrown errors', async () => {
    mockedCheckAgentArtifactCompletionDetails
      .mockReset()
      .mockResolvedValue({ complete: false, reasons: ['final-summary.md Task branches section is missing or empty'] });
    runAgentSession
      .mockReset()
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'initial stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      })
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'cleanup stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      });

    await expect(runRoleAgent({
      agentId: 'ron',
      taskId: 'task-test-001',
    })).rejects.toThrow(/Incomplete artifact reasons:\n- final-summary\.md Task branches section is missing or empty/);

    const finalReceipt = writeUniqueGuardrailReceipt.mock.calls.at(-1)?.[0];
    expect(finalReceipt).toEqual(expect.objectContaining({
      agentId: 'ron',
      data: expect.objectContaining({
        termination_reason: 'artifact-incomplete',
        artifact_completion_reasons: ['final-summary.md Task branches section is missing or empty'],
      }),
    }));
  });

  it('prepopulates Requirement Verification before building Ron cleanup prompt', async () => {
    mockedCheckAgentArtifactCompletionDetails
      .mockReset()
      .mockResolvedValueOnce({ complete: false, reasons: ['final-summary.md Requirement Verification missing or empty for generated requirements'] })
      .mockResolvedValueOnce({ complete: false, reasons: ['final-summary.md Requirement Verification incomplete: CR-001 pending'] })
      .mockResolvedValueOnce({ complete: true, reasons: [] });
    runAgentSession
      .mockReset()
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'initial stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      })
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'cleanup stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      });

    await expect(runRoleAgent({
      agentId: 'ron',
      taskId: 'task-test-001',
    })).resolves.toMatchObject({ exitCode: 0, durationMs: expect.any(Number) });

    expect(mockedPrepopulateRequirementVerification).toHaveBeenCalledTimes(2);
    expect(mockedPrepopulateRequirementVerification).toHaveBeenNthCalledWith(2, {
      handoffsDir: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs',
      repoRoot: '/repo',
    });
    expect(mockedPrepopulateRequirementVerification.mock.invocationCallOrder[1]).toBeLessThan(
      mockedBuildAgentArtifactRemediationPrompt.mock.invocationCallOrder[0]!,
    );
    expect(runAgentSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      session: expect.objectContaining({ launchPhase: 'Artifact Cleanup' }),
    }));
  });

  it('accepts Ron cleanup when a non-zero cleanup exit still leaves closeout artifacts complete', async () => {
    mockedCheckAgentArtifactCompletionDetails
      .mockReset()
      .mockResolvedValueOnce({ complete: false, reasons: ['final-summary.md Task branches section is missing or empty'] })
      .mockResolvedValueOnce({ complete: false, reasons: ['final-summary.md Task branches section is missing or empty'] })
      .mockResolvedValueOnce({ complete: true, reasons: [] });
    runAgentSession
      .mockReset()
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'initial stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      })
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 1,
          terminationReason: 'exited',
          signalCode: 'SIGTERM',
          stdoutTail: 'cleanup repaired closeout artifacts',
          stderrTail: 'provider exited non-zero',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: '/repo/ron-cleanup-session.json',
      });

    await expect(runRoleAgent({
      agentId: 'ron',
      taskId: 'task-test-001',
    })).resolves.toMatchObject({ exitCode: 0, durationMs: expect.any(Number) });

    expect(correctSessionReceipt).toHaveBeenCalledWith('/repo/ron-cleanup-session.json', 'ron');
    expect(writeUniqueGuardrailReceipt).toHaveBeenCalledTimes(2);
    expect(writeUniqueGuardrailReceipt.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      agentId: 'ron',
      launchPhase: 'Artifact Cleanup',
      data: expect.objectContaining({
        status: 'passed',
        exit_code: 0,
        termination_reason: 'exited',
        stdout_tail: 'cleanup repaired closeout artifacts',
      }),
    }));
  });

  it('prepopulates Requirement Verification before Ron promptOverride cleanup prompt', async () => {
    mockedCheckAgentArtifactCompletionDetails
      .mockReset()
      .mockResolvedValueOnce({ complete: false, reasons: ['final-summary.md Requirement Verification missing or empty for generated requirements'] })
      .mockResolvedValueOnce({ complete: false, reasons: ['final-summary.md Requirement Verification incomplete: CR-001 pending'] })
      .mockResolvedValueOnce({ complete: true, reasons: [] });
    runAgentSession
      .mockReset()
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'initial stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      })
      .mockResolvedValueOnce({
        runSummary: {
          exitCode: 0,
          terminationReason: 'exited',
          signalCode: null,
          stdoutTail: 'cleanup stdout',
          stderrTail: '',
        },
        greedyStopTriggered: false,
        sessionReceiptFile: null,
      });

    await expect(runRoleAgent({
      agentId: 'ron',
      taskId: 'task-test-001',
      promptOverride: 'Review this retry.',
    })).resolves.toMatchObject({ exitCode: 0, durationMs: expect.any(Number) });

    expect(mockedPrepopulateRequirementVerification).toHaveBeenCalledTimes(1);
    expect(mockedPrepopulateRequirementVerification).toHaveBeenCalledWith({
      handoffsDir: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs',
      repoRoot: '/repo',
    });
    expect(mockedPrepopulateRequirementVerification.mock.invocationCallOrder[0]).toBeLessThan(
      mockedBuildAgentArtifactRemediationPrompt.mock.invocationCallOrder[0]!,
    );
    expect(runAgentSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      session: expect.objectContaining({ launchPhase: 'Artifact Cleanup' }),
    }));
  });
});
