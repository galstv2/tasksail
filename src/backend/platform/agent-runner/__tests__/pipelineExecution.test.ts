import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const readTextFile = vi.fn<(_: string) => Promise<string | null>>();
const resolvePaths = vi.fn();
const writeTextFile = vi.fn();
const ensureDir = vi.fn();
const runRoleAgent = vi.fn();
const runRuntimePolicyCheck = vi.fn();
const buildAgentArtifactRemediationPrompt = vi.fn();
const prewarmPipelineContext = vi.fn();
const remediationHasBlockingFindings = vi.fn();
const remediationRunQaLoop = vi.fn();
const captureRetryBaseline = vi.fn();
const resolveVerificationDaltonPrompt = vi.fn();
const captureCodeDiff = vi.fn();
const nowIsoCompact = vi.fn(() => '2026-03-26T00-00-00Z');
const readEnvAssignment = vi.fn(() => undefined);
const safeJsonParse = vi.fn((content: string) => JSON.parse(content));
const getErrorMessage = vi.fn((error: unknown) => error instanceof Error ? error.message : String(error));

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    ...actual,
    readTextFile,
    resolvePaths,
    writeTextFile,
    ensureDir,
    nowIsoCompact,
    readEnvAssignment,
    safeJsonParse,
    getErrorMessage,
    STANDARD_AGENT_ORDER: ['alice', 'dalton', 'ron'],
    FAST_PATH_AGENT_ORDER: ['alice', 'dalton', 'ron'],
  };
});

vi.mock('../roleAgent.js', () => ({
  runRoleAgent,
}));

vi.mock('../guardrails.js', () => ({
  runRuntimePolicyCheck,
}));

vi.mock('../artifactCompletion.js', async () => {
  const actual = await vi.importActual<typeof import('../artifactCompletion.js')>('../artifactCompletion.js');
  return {
    ...actual,
    buildAgentArtifactRemediationPrompt,
  };
});

vi.mock('../pipeline/contextPrewarm.js', () => ({
  prewarmPipelineContext,
}));

vi.mock('../pipeline/remediation.js', () => ({
  remediationHasBlockingFindings,
  remediationRunQaLoop,
}));

vi.mock('../pipeline/verificationPass.js', () => ({
  resolveVerificationDaltonPrompt,
}));

vi.mock('../pythonHelpers.js', () => ({
  captureCodeDiff,
}));

vi.mock('../../queue/retryBaseline.js', () => ({
  captureRetryBaseline,
}));

const runPolicyValidation = vi.fn();
vi.mock('../../queue/policyValidation.js', () => ({
  runPolicyValidation,
}));

const completePendingItem = vi.fn();
vi.mock('../../queue/completePendingItem.js', () => ({
  completePendingItem,
}));

describe('runPipelineSequence', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'pipeline-exec-'));
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'test-task-id'), { recursive: true });
    resolvePaths.mockReturnValue({
      repoRoot,
      handoffs: path.join(repoRoot, 'AgentWorkSpace', 'handoffs'),
      implementationSteps: path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps'),
      platformState: path.join(repoRoot, '.platform-state'),
      taskRuntime: path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'test-task-id'),
      templates: path.join(repoRoot, 'AgentWorkSpace', 'templates'),
    });
    mkdirSync(path.join(repoRoot, '.git'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'handoffs'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true });
    // Seed a full platform.json so failure-path callers (finalizeTaskWorktrees
    // → getPlatformConfig) don't throw. Without this, moveFailedItemToErrorItems
    // swallows an "Invalid platform config" error and the rename to error-items
    // never runs.
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'platform.json'),
      JSON.stringify({
        schema_version: 1,
        container_runtime: 'docker',
        max_parallel_tasks: 2,
        retain_failed_task_worktrees: false,
        max_retained_failed_task_worktrees: 5,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port_range: { min: 8811, max: 8820 },
      }, null, 2) + '\n',
      'utf-8',
    );
    readTextFile.mockImplementation(async (filePath: string) => {
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8');
      }
      if (filePath.endsWith('parallel-ok.md')) {
        return '# Parallel OK\n\n## Decision\n\nComplex execution authorized.\n';
      }
      return null;
    });
    prewarmPipelineContext.mockResolvedValue(undefined);
    runRoleAgent.mockResolvedValue({
      exitCode: 0,
      agentId: 'alice',
      durationMs: 1,
      mcpLaunch: {
        status: 'not-applicable',
        reason: 'no external MCP servers apply to this agent',
        injectionEnabled: false,
        selectedServerIds: [],
        excludedServerIds: [],
      },
    });
    runRuntimePolicyCheck.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
    buildAgentArtifactRemediationPrompt.mockResolvedValue(
      'Address the blocking qa findings in AgentWorkSpace/handoffs/issues.md.',
    );
    remediationHasBlockingFindings.mockResolvedValue(false);
    remediationRunQaLoop.mockResolvedValue(undefined);
    resolveVerificationDaltonPrompt.mockResolvedValue(undefined);
    captureCodeDiff.mockImplementation(async ({ outputPath }: { outputPath: string }) => {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, '# --- Repo: repo ---\n+change\n', 'utf-8');
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    runPolicyValidation.mockResolvedValue({ passed: true, stdout: '', stderr: '', exitCode: 0 });
    completePendingItem.mockResolvedValue(undefined);
    captureRetryBaseline.mockResolvedValue({
      capturedAt: '2026-03-26T00:00:00Z',
      repos: [{ repoRoot, head: 'abc123' }],
    });
    ensureDir.mockImplementation(async (dirPath: string) => {
      mkdirSync(dirPath, { recursive: true });
    });
    writeTextFile.mockImplementation(async (filePath: string, content: string) => {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
    });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('runs the reduced standard-only pipeline order', async () => {
    readTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('parallel-ok.md')) {
        return null;
      }
      return null;
    });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id' });

    expect(runRoleAgent.mock.calls.map(([call]) => call.agentId)).toEqual([
      'alice',
      'dalton',
      'ron',
    ]);
    expect(runRoleAgent.mock.calls.map(([call]) => call.skipWorkflowValidation)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('logs pipeline MCP registry status and writes per-agent MCP receipt data', async () => {
    readTextFile.mockImplementation(async () => null);
    runRoleAgent
      .mockResolvedValueOnce({
        exitCode: 0,
        agentId: 'alice',
        durationMs: 1,
        mcpLaunch: {
          status: 'available',
          reason: '1 external MCP server(s) injected',
          injectionEnabled: true,
          selectedServerIds: ['github'],
          excludedServerIds: [],
        },
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        agentId: 'dalton',
        durationMs: 1,
        mcpLaunch: {
          status: 'not-applicable',
          reason: 'no external MCP servers apply to this agent',
          injectionEnabled: false,
          selectedServerIds: [],
          excludedServerIds: [],
        },
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        agentId: 'ron',
        durationMs: 1,
        mcpLaunch: {
          status: 'unavailable',
          reason: 'launch context helper failed',
          injectionEnabled: false,
          selectedServerIds: [],
          excludedServerIds: [],
        },
      });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id' });

    const receiptRaw = await import('node:fs/promises').then(({ readFile }) => readFile(
      path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'test-task-id', 'pipeline-receipt.json'),
      'utf-8',
    ));
    const receipt = JSON.parse(receiptRaw) as {
      externalMcp?: {
        registry: { status: string; reason: string; serverCount: number };
        agents: Record<string, { status: string; reason: string; injectionEnabled: boolean }>;
      };
    };

    expect(logSpy).toHaveBeenCalledWith(
      '[pipeline] external MCP registry status:',
      JSON.stringify({
        status: 'degraded',
        reason: 'registry not prewarmed',
        serverCount: 0,
      }),
    );
    expect(receipt.externalMcp).toEqual({
      registry: {
        status: 'degraded',
        reason: 'registry not prewarmed',
        serverCount: 0,
      },
      agents: {
        alice: {
          status: 'available',
          reason: '1 external MCP server(s) injected',
          injectionEnabled: true,
          selectedServerIds: ['github'],
          excludedServerIds: [],
        },
        dalton: {
          status: 'not-applicable',
          reason: 'no external MCP servers apply to this agent',
          injectionEnabled: false,
          selectedServerIds: [],
          excludedServerIds: [],
        },
        ron: {
          status: 'unavailable',
          reason: 'launch context helper failed',
          injectionEnabled: false,
          selectedServerIds: [],
          excludedServerIds: [],
        },
      },
    });
  });

  it('does not mutate RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS in the sequencer process — bypass gate is child-env responsibility (§5.1 MG-7)', async () => {
    // After §5.1 MG-7 deletion, the sequencer no longer sets or restores these
    // env vars in the caller process. Instead, spawnPipelineForTask injects them
    // into the child via fork options. Pre-existing values must be left unchanged
    // by runPipelineSequence itself.
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'previous-bypass';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'previous-orchestrator';
    readTextFile.mockImplementation(async () => null);
    const observedEnv: Array<{ allow: string | undefined; orchestrator: string | undefined }> = [];
    runRoleAgent.mockImplementation(async () => {
      observedEnv.push({
        allow: process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'],
        orchestrator: process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'],
      });
      return { exitCode: 0, agentId: 'alice', durationMs: 1 };
    });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id', stopAfter: 'alice' });

    // The sequencer no longer modifies the caller's env — the child inherits
    // RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS=true from the fork env options.
    // Pre-existing values are unmodified throughout.
    expect(process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS']).toBe('previous-bypass');
    expect(process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID']).toBe('previous-orchestrator');
    // When run in-process (as in tests with mocked runRoleAgent), the pre-existing
    // env values are visible to the mock implementation.
    expect(observedEnv[0]).toEqual({
      allow: 'previous-bypass',
      orchestrator: 'previous-orchestrator',
    });
  });

  it('runs single Dalton when parallel-ok.md only contains the template shell', async () => {
    readTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('parallel-ok.md')) {
        return '# Parallel OK\n\nUse this file only when slice independence is real.\n\n## Task Metadata\n\n- Task ID:\n\n## Decision\n<!-- (1 word) — write "complex" or "simple" -->\n';
      }
      return null;
    });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id' });

    expect(runRoleAgent.mock.calls.map(([call]) => call.agentId)).toEqual([
      'alice',
      'dalton',
      'ron',
    ]);
  });

  it('runs single Dalton during QA remediation even when parallel-ok.md is active', async () => {
    readTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('parallel-ok.md')) {
        return '# Parallel OK\n\n## Decision\n\nComplex execution authorized.\n';
      }
      return null;
    });
    remediationHasBlockingFindings
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id', startAt: 'dalton' });

    expect(runRoleAgent.mock.calls.map(([call]) => call.agentId)).toEqual([
      'dalton',
      'ron',
    ]);
  });

  it('launches the verification pass as dalton-verify', async () => {
    readTextFile.mockImplementation(async () => null);
    resolveVerificationDaltonPrompt.mockImplementation(async (
      _handoffsDir: string,
      _implementationStepsDir: string,
      _primaryFocusRelativePath: string | undefined,
      _externalMcpRegistry: unknown,
      verificationDiffAbsolutePath?: string,
    ) => {
      expect(verificationDiffAbsolutePath).toBe(path.join(
        repoRoot,
        '.platform-state',
        'runtime',
        'tasks',
        'test-task-id',
        'verification',
        '2026-03-26T00-00-00Z',
        'code-changes.diff',
      ));
      expect(existsSync(verificationDiffAbsolutePath!)).toBe(true);
      return 'verify the implementation';
    });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id', startAt: 'dalton' });

    expect(runRoleAgent.mock.calls.map(([call]) => call.agentId)).toEqual([
      'dalton',
      'dalton-verify',
      'ron',
    ]);
    expect(captureCodeDiff).toHaveBeenCalledTimes(2);
    expect(captureCodeDiff.mock.invocationCallOrder[0]).toBeLessThan(
      resolveVerificationDaltonPrompt.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(runRoleAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'dalton-verify',
      launchPhase: 'Verification',
      promptOverride: 'verify the implementation',
      verificationTempAllowedDir: path.join(
        repoRoot,
        '.platform-state',
        'runtime',
        'tasks',
        'test-task-id',
        'verification',
        '2026-03-26T00-00-00Z',
      ),
      skipWorkflowValidation: true,
    }));
    expect(resolveVerificationDaltonPrompt).toHaveBeenCalledWith(
      path.join(repoRoot, 'AgentWorkSpace', 'handoffs'),
      path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps'),
      undefined,
      undefined,
      path.join(
        repoRoot,
        '.platform-state',
        'runtime',
        'tasks',
        'test-task-id',
        'verification',
        '2026-03-26T00-00-00Z',
        'code-changes.diff',
      ),
      undefined,
    );
    expect(existsSync(path.join(
      repoRoot,
      '.platform-state',
      'runtime',
      'tasks',
      'test-task-id',
      'verification',
      '2026-03-26T00-00-00Z',
    ))).toBe(false);
  });

  it('cleans stale verification temp state before staging and removes it after verification failures', async () => {
    readTextFile.mockImplementation(async () => null);
    const staleDir = path.join(
      repoRoot,
      '.platform-state',
      'runtime',
      'tasks',
      'test-task-id',
      'verification',
      '2026-03-26T00-00-00Z',
    );
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(path.join(staleDir, 'code-changes.diff'), 'stale diff', 'utf-8');
    resolveVerificationDaltonPrompt.mockImplementation(async (
      _handoffsDir: string,
      _implementationStepsDir: string,
      _primaryFocusRelativePath: string | undefined,
      _externalMcpRegistry: unknown,
      verificationDiffAbsolutePath?: string,
    ) => {
      expect(verificationDiffAbsolutePath).toBe(path.join(staleDir, 'code-changes.diff'));
      expect(existsSync(verificationDiffAbsolutePath!)).toBe(true);
      expect(readFileSync(verificationDiffAbsolutePath!, 'utf-8')).toContain('fresh change');
      return 'verify the implementation';
    });
    captureCodeDiff.mockImplementation(async ({ outputPath }: { outputPath: string }) => {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, '# --- Repo: repo ---\n+fresh change\n', 'utf-8');
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    runRoleAgent.mockImplementation(async ({ agentId }: { agentId: string }) => {
      if (agentId === 'dalton-verify') {
        throw new Error('verification failed');
      }
      return {
        exitCode: 0,
        agentId,
        durationMs: 1,
        mcpLaunch: {
          status: 'not-applicable',
          reason: 'no external MCP servers apply to this agent',
          injectionEnabled: false,
          selectedServerIds: [],
          excludedServerIds: [],
        },
      };
    });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');

    await expect(runPipelineSequence({ repoRoot, taskId: 'test-task-id', startAt: 'dalton' })).rejects.toThrow('verification failed');
    expect(existsSync(path.join(staleDir, 'code-changes.diff'))).toBe(false);
    expect(existsSync(staleDir)).toBe(false);
    expect(captureCodeDiff).toHaveBeenCalledTimes(1);
  });

  it('removes slice-template.md before starting Dalton', async () => {
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps', 'slice-template.md'),
      '# Slice Template\n',
    );
    readTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('parallel-ok.md')) {
        return null;
      }
      return null;
    });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id', startAt: 'dalton' });

    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps', 'slice-template.md'))).toBe(false);
    expect(runRoleAgent.mock.calls.map(([call]) => call.agentId)).toEqual([
      'dalton',
      'ron',
    ]);
  });

  it('uses fleet mode with promptOverride when Complex is approved and slices exist', async () => {
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps', 'slice-1.md'),
      '# Slice 1\n\n## Purpose\n\nFirst slice.\n',
    );
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps', 'slice-2.md'),
      '# Slice 2\n\n## Purpose\n\nSecond slice.\n',
    );

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id' });

    const daltonCalls = runRoleAgent.mock.calls.filter(([call]) => call.agentId === 'dalton');
    expect(daltonCalls.length).toBe(1);
    expect(daltonCalls[0][0].promptOverride).toContain('fleet mode');
    expect(daltonCalls[0][0].promptOverride).toContain('Total slices: 2');
    expect(daltonCalls[0][0].promptOverride).toContain('Slice: slice-1');
    expect(daltonCalls[0][0].promptOverride).toContain('Slice: slice-2');
  });

  it('runs a single Dalton cleanup pass when fleet mode leaves QA blocked', async () => {
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps', 'slice-1.md'),
      '# Slice 1\n\n## Purpose\n\nFirst slice.\n',
    );
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'handoffs', 'issues.md'),
      '# QA Issues\n\n## Review Outcome\n\nblocking\n\n## Required Fix\n\nTighten validation.\n',
    );
    runRuntimePolicyCheck
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          guardrail: {
            requested_agent_id: 'qa',
            expected_agent_id: 'software-engineer',
          },
          violations: [
            {
              severity: 'error',
              rule_id: 'closeout.qa-review-approved',
              artifact: 'AgentWorkSpace/handoffs/issues.md',
              message: 'Review Outcome is blocking.',
              remediation: 'Resolve the blocking findings before QA handoff.',
            },
          ],
        }),
        stderr: '',
        exitCode: 1,
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id' });

    const daltonCalls = runRoleAgent.mock.calls.filter(([call]) => call.agentId === 'dalton');
    expect(daltonCalls).toHaveLength(2);
    expect(daltonCalls[1][0]).toEqual(expect.objectContaining({
      agentId: 'dalton',
      skipWorkflowValidation: true,
      promptOverride: expect.stringContaining('did not leave the workflow ready for QA'),
    }));
    expect(daltonCalls[1][0].promptOverride).toContain('## Inline Blocking Artifact Context');
    expect(daltonCalls[1][0].promptOverride).toContain('Tighten validation.');
    expect(daltonCalls[1][0].promptOverride).not.toContain('AgentWorkSpace/handoffs/issues.md');
    expect(daltonCalls[1][0].promptOverride).not.toContain('$COPILOT_HANDOFFS_DIR');
    expect(daltonCalls[1][0].promptOverride).not.toContain('$COPILOT_IMPL_STEPS_DIR');
    expect(buildAgentArtifactRemediationPrompt).not.toHaveBeenCalled();
  });

  it('skips Ron entry validation immediately after a successful fleet Dalton handoff', async () => {
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps', 'slice-1.md'),
      '# Slice 1\n\n## Purpose\n\nFirst slice.\n',
    );

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id' });

    const ronCall = runRoleAgent.mock.calls.find(([call]) => call.agentId === 'ron');
    expect(ronCall).toBeDefined();
    expect(ronCall![0].skipWorkflowValidation).toBe(true);
  });

  it('rejects when a pipeline lock already exists', async () => {
    const lockDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'test-task-id', 'pipeline.lock');
    mkdirSync(lockDir, { recursive: true });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');

    await expect(runPipelineSequence({ repoRoot, taskId: 'test-task-id' })).rejects.toThrow(
      'Another pipeline run is already active',
    );
  });

  it('moves failed item to error-items onagent failure', async () => {
    // §4.1B: taskId is now the canonical task identity; pending file is <taskId>.md
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'handoffs', 'professional-task.md'), 'task content');
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps', 'slice-01.md'), '# Slice');
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'test-task-id.md'), '# Pending task');
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'error-items'), { recursive: true });
    readTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('parallel-ok.md')) {
        return null;
      }
      // Fall through to disk so platform.json (seeded in beforeEach) is read
      // by the failure-path getPlatformConfig → loadPlatformConfig chain.
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8');
      }
      return null;
    });
    runRoleAgent.mockRejectedValue(new Error('product manager failed'));

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');

    await expect(runPipelineSequence({ repoRoot, taskId: 'test-task-id' })).rejects.toThrow('product manager failed');
    // §4.14A parallel model: moveFailedItemToErrorItems no longer touches the
    // shared singleton handoffs/ or ImplementationSteps/ dirs (that would be a
    // blast-radius violation against peer tasks). Per-task clones live under
    // AgentWorkSpace/tasks/<taskId>/ and are reaped via finalizeTaskWorktrees.
    // Only the pending→error-items rename is asserted here.
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'error-items', 'test-task-id.md'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'test-task-id.md'))).toBe(false);
  });

  it('moves failed item to error-items onkill-switch request', async () => {
    // §4.1B: taskId is now the canonical task identity; pending file is <taskId>.md
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'handoffs', 'professional-task.md'), 'task content');
    writeFileSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', 'test-task-id.md'), '# Pending task');
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'error-items'), { recursive: true });
    readTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('parallel-ok.md')) {
        return null;
      }
      // Fall through to disk so platform.json (seeded in beforeEach) is read
      // by the failure-path getPlatformConfig → loadPlatformConfig chain.
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8');
      }
      return null;
    });
    runRoleAgent.mockImplementation(async ({ abortSignal }: { abortSignal?: AbortSignal }) => (
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ exitCode: 0, agentId: 'alice', durationMs: 1 }), 1000);
        abortSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        }, { once: true });
      })
    ));

    setTimeout(() => {
      writeFileSync(
        path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'test-task-id', 'pipeline-kill-switch.json'),
        JSON.stringify({ requestedAt: '2026-03-25T00:00:00Z', reason: 'operator requested kill' }),
        'utf-8',
      );
    }, 50);

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');

    await expect(runPipelineSequence({ repoRoot, taskId: 'test-task-id' })).rejects.toThrow('Pipeline killed');
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'error-items', 'test-task-id.md'))).toBe(true);
    expect(existsSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'test-task-id', 'pipeline-kill-switch.json'))).toBe(false);
  });

  it('launches Ron closeout remediation when queue-advance policy fails', async () => {
    readTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('parallel-ok.md')) return null;
      return null;
    });
    runPolicyValidation.mockResolvedValue({
      passed: false,
      stdout: 'queue.retrospective-required: missing sections',
      stderr: '',
      exitCode: 1,
    });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id' });

    const ronCalls = runRoleAgent.mock.calls.filter(([call]) => call.agentId === 'ron');
    // First Ron call is the main QA run; second is closeout remediation.
    expect(ronCalls.length).toBe(2);
    expect(ronCalls[1][0].launchPhase).toBe('Closeout Remediation');
    expect(ronCalls[1][0].promptOverride).toContain('queue.retrospective-required');
  });

  it('skips closeout remediation when queue-advance policy passes', async () => {
    readTextFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('parallel-ok.md')) return null;
      return null;
    });
    runPolicyValidation.mockResolvedValue({ passed: true, stdout: '', stderr: '', exitCode: 0 });

    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await runPipelineSequence({ repoRoot, taskId: 'test-task-id' });

    const ronCalls = runRoleAgent.mock.calls.filter(([call]) => call.agentId === 'ron');
    expect(ronCalls.length).toBe(1);
  });

  it('kill-switch for task-B does not abort task-A pipeline', async () => {
    const taskAId = 'task-A';
    const taskBId = 'task-B';

    // Set up per-task runtime dirs for both tasks.
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskAId), { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskBId), { recursive: true });

    // Make resolvePaths return per-task-A paths so the sequencer reads task-A runtime.
    resolvePaths.mockReturnValue({
      repoRoot,
      handoffs: path.join(repoRoot, 'AgentWorkSpace', 'handoffs'),
      implementationSteps: path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps'),
      platformState: path.join(repoRoot, '.platform-state'),
      taskRuntime: path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskAId),
      templates: path.join(repoRoot, 'AgentWorkSpace', 'templates'),
    });

    readTextFile.mockImplementation(async (filePath: string) => {
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8');
      }
      if (filePath.endsWith('parallel-ok.md')) return null;
      return null;
    });

    // Write the kill-switch file for task-B BEFORE the pipeline runs.
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskBId, 'pipeline-kill-switch.json'),
      JSON.stringify({ requestedAt: '2026-03-25T00:00:00Z', reason: 'operator killed task-B' }),
      'utf-8',
    );

    // Task-A pipeline must complete normally — the task-B kill switch is irrelevant.
    const { runPipelineSequence } = await import('../pipeline/sequencer.js');
    await expect(runPipelineSequence({ repoRoot, taskId: taskAId })).resolves.not.toThrow();

    // Task-A's kill-switch path must remain absent.
    expect(
      existsSync(
        path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskAId, 'pipeline-kill-switch.json'),
      ),
    ).toBe(false);

    // Task-B's kill-switch is untouched by task-A's pipeline.
    expect(
      existsSync(
        path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskBId, 'pipeline-kill-switch.json'),
      ),
    ).toBe(true);
  });
});
