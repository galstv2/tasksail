import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const runRoleAgent = vi.fn();
const shouldRunRetrospectivePhase = vi.fn();
const buildCycleContextBundle = vi.fn();
const buildRetrospectivePrompt = vi.fn();
const resolvePaths = vi.fn();
const readTaskJsonSafe = vi.fn();
const writeTextFile = vi.fn();
const ensureDir = vi.fn();
const clearPipelineKill = vi.fn();
const pipelineKillSwitchExists = vi.fn();
const readPipelineKillRequest = vi.fn();
const runPolicyValidation = vi.fn();
const completePendingItem = vi.fn();
const claimRetrospectiveRun = vi.fn();
const retrospectiveRunRelease = vi.fn();

vi.mock('../../roleAgent.js', () => ({ runRoleAgent }));
vi.mock('../retrospectivePhase.js', () => ({
  shouldRunRetrospectivePhase,
  buildCycleContextBundle,
  buildRetrospectivePrompt,
}));
vi.mock('../../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../core/index.js')>('../../../core/index.js');
  return {
    ...actual,
    resolvePaths,
    writeTextFile,
    ensureDir,
    readTextFile: vi.fn().mockResolvedValue(undefined),
    STANDARD_AGENT_ORDER: ['ron'],
    getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    nowIsoCompact: () => '2026-01-01T00-00-00Z',
  };
});
vi.mock('../../../queue/taskJson.js', () => ({ readTaskJsonSafe }));
vi.mock('../../guardrails.js', () => ({
  runRuntimePolicyCheck: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));
vi.mock('../contextPrewarm.js', () => ({ prewarmPipelineContext: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../externalMcpRegistryCache.js', () => ({
  getCachedExternalMcpAssignments: vi.fn(() => undefined),
  getCachedExternalMcpRegistry: vi.fn(() => undefined),
  getCachedExternalMcpRegistryHealth: vi.fn(() => ({ status: 'available', reason: 'ok', serverCount: 0 })),
}));
vi.mock('../remediation.js', () => ({
  remediationHasBlockingFindings: vi.fn().mockResolvedValue(false),
  remediationRunQaLoop: vi.fn().mockResolvedValue(undefined),
  remediationClearCloseoutArtifacts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../testCapture.js', () => ({
  buildTestCapturePrompt: vi.fn(() => 'qa prompt'),
  captureSliceValidation: vi.fn().mockResolvedValue([]),
  resolveTestCaptureCwd: vi.fn().mockResolvedValue('/repo'),
}));
vi.mock('../verificationPass.js', () => ({ resolveVerificationDaltonPrompt: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../runtimeControl.js', () => ({
  clearPipelineKill,
  pipelineKillSwitchExists,
  readPipelineKillRequest,
}));
vi.mock('../../../context-pack/focusedRepo.js', () => ({ resolveSelectedPrimaryRepoRoot: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../queue/policyValidation.js', () => ({ runPolicyValidation }));
vi.mock('../../../queue/completePendingItem.js', () => ({ completePendingItem }));
vi.mock('../../../queue/retrospectiveFlag.js', () => ({ claimRetrospectiveRun }));
vi.mock('../../../queue/errorItems.js', () => ({ moveFailedItemToErrorItems: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../pythonHelpers.js', () => ({
  captureCodeDiff: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

describe('runPipelineSequence retrospective phase', () => {
  let repoRoot: string;
  let contextPackDir: string;
  let taskRuntime: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'sequencer-retrospective-'));
    contextPackDir = path.join(repoRoot, 'contextpacks', 'pack-a');
    taskRuntime = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-1');
    resolvePaths.mockReturnValue({
      repoRoot,
      handoffs: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1', 'handoffs'),
      implementationSteps: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1', 'ImplementationSteps'),
      templates: path.join(repoRoot, 'AgentWorkSpace', 'templates'),
      taskRuntime,
    });
    writeTextFile.mockResolvedValue(undefined);
    ensureDir.mockImplementation(async (dirPath: string) => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dirPath, { recursive: true });
    });
    clearPipelineKill.mockResolvedValue(false);
    pipelineKillSwitchExists.mockReturnValue(false);
    readPipelineKillRequest.mockResolvedValue(undefined);
    runPolicyValidation.mockResolvedValue({ passed: true, stdout: '', stderr: '', exitCode: 0 });
    completePendingItem.mockResolvedValue(undefined);
    retrospectiveRunRelease.mockResolvedValue(undefined);
    claimRetrospectiveRun.mockResolvedValue({
      claimed: true,
      claim: {
        contextPackId: 'pack-a',
        lockDir: path.join(repoRoot, '.platform-state', 'retrospective-runs', 'pack-a.lock'),
        release: retrospectiveRunRelease,
      },
    });
    readTaskJsonSafe.mockReturnValue({ contextPackBinding: { contextPackPath: path.join(contextPackDir, 'tasks.json') } });
    runRoleAgent.mockResolvedValue({ exitCode: 0, agentId: 'ron', durationMs: 1 });
    shouldRunRetrospectivePhase.mockResolvedValue(false);
    buildCycleContextBundle.mockResolvedValue([
      {
        taskId: 'prior-task',
        taskTitle: 'Prior Task',
        taskSummary: '',
        completedWorkSummary: '',
        keyDecisions: [],
        knownLimitations: [],
        retrospectiveSummary: '',
        whatWentWell: [],
        whatCouldHaveGoneBetter: [],
        actionItems: [],
        isCurrentTask: false,
        warnings: [],
      },
      {
        taskId: 'task-1',
        taskTitle: 'Current Task',
        taskSummary: '',
        completedWorkSummary: '',
        keyDecisions: [],
        knownLimitations: [],
        retrospectiveSummary: '',
        whatWentWell: [],
        whatCouldHaveGoneBetter: [],
        actionItems: [],
        isCurrentTask: true,
        warnings: [],
      },
    ]);
    buildRetrospectivePrompt.mockResolvedValue('retrospective prompt');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('does not launch retrospective mode when the label is false', async () => {
    const { runPipelineSequence } = await import('../sequencer.js');

    const receipt = await runPipelineSequence({ repoRoot, taskId: 'task-1', stopAfter: 'ron' });

    expect(runRoleAgent).toHaveBeenCalledTimes(1);
    expect(runRoleAgent.mock.calls[0][0]).toMatchObject({ agentId: 'ron', promptOverride: 'qa prompt' });
    expect(runRoleAgent.mock.calls.some((call) => call[0].launchPhase === 'Retrospective')).toBe(false);
    expect(receipt.agentTimings).not.toHaveProperty('ron-retrospective');
  });

  it('launches retrospective mode after QA and before queue-advance policy validation', async () => {
    shouldRunRetrospectivePhase.mockResolvedValue(true);
    const events: string[] = [];
    runRoleAgent.mockImplementation(async (options: { launchPhase?: string }) => {
      events.push(options.launchPhase === 'Retrospective' ? 'retrospective' : 'qa');
      return { exitCode: 0, agentId: 'ron', durationMs: 1 };
    });
    runPolicyValidation.mockImplementation(async () => {
      events.push('queue-advance');
      return { passed: true, stdout: '', stderr: '', exitCode: 0 };
    });
    const { runPipelineSequence } = await import('../sequencer.js');

    const receipt = await runPipelineSequence({ repoRoot, taskId: 'task-1', stopAfter: 'ron' });

    expect(events).toEqual(['qa', 'retrospective', 'queue-advance']);
    expect(runRoleAgent).toHaveBeenCalledTimes(2);
    expect(runRoleAgent.mock.calls[1][0]).toMatchObject({
      agentId: 'ron',
      launchPhase: 'Retrospective',
      skipWorkflowValidation: true,
      promptOverride: 'retrospective prompt',
      contextPackDir,
    });
    expect(buildCycleContextBundle).toHaveBeenCalledWith({
      repoRoot,
      contextPackDir,
      handoffsDir: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1', 'handoffs'),
      currentTaskId: 'task-1',
    });
    expect(claimRetrospectiveRun).toHaveBeenCalledWith({
      repoRoot,
      contextPackDir,
      taskId: 'task-1',
    });
    expect(retrospectiveRunRelease).toHaveBeenCalledTimes(1);
    expect(receipt.agentTimings).toHaveProperty('ron-retrospective');
  });

  it('skips retrospective mode when another Ron already holds the run lock', async () => {
    shouldRunRetrospectivePhase.mockResolvedValue(true);
    claimRetrospectiveRun.mockResolvedValue({
      claimed: false,
      contextPackId: 'pack-a',
      lockDir: path.join(repoRoot, '.platform-state', 'retrospective-runs', 'pack-a.lock'),
      reason: 'already-running',
    });
    const { runPipelineSequence } = await import('../sequencer.js');

    const receipt = await runPipelineSequence({ repoRoot, taskId: 'task-1', stopAfter: 'ron' });

    expect(runRoleAgent).toHaveBeenCalledTimes(1);
    expect(runRoleAgent.mock.calls.some((call) => call[0].launchPhase === 'Retrospective')).toBe(false);
    expect(buildCycleContextBundle).not.toHaveBeenCalled();
    expect(retrospectiveRunRelease).not.toHaveBeenCalled();
    expect(receipt.agentTimings).not.toHaveProperty('ron-retrospective');
  });

  it('launches retrospective mode when prior entries only contain warnings', async () => {
    shouldRunRetrospectivePhase.mockResolvedValue(true);
    buildCycleContextBundle.mockResolvedValue([
      {
        taskId: 'missing-prior-task',
        taskTitle: '',
        taskSummary: '',
        completedWorkSummary: '',
        keyDecisions: [],
        knownLimitations: [],
        difficultyLevel: '',
        retrospectiveSummary: '',
        whatWentWell: [],
        whatCouldHaveGoneBetter: [],
        actionItems: [],
        isCurrentTask: false,
        warnings: ['Missing archived task record for missing-prior-task.'],
      },
      {
        taskId: 'task-1',
        taskTitle: 'Current Task',
        taskSummary: '',
        completedWorkSummary: '',
        keyDecisions: [],
        knownLimitations: [],
        difficultyLevel: '',
        retrospectiveSummary: '',
        whatWentWell: [],
        whatCouldHaveGoneBetter: [],
        actionItems: [],
        isCurrentTask: true,
        warnings: [],
      },
    ]);
    const { runPipelineSequence } = await import('../sequencer.js');

    await runPipelineSequence({ repoRoot, taskId: 'task-1', stopAfter: 'ron' });

    expect(runRoleAgent).toHaveBeenCalledTimes(2);
    expect(runRoleAgent.mock.calls[1][0]).toMatchObject({
      agentId: 'ron',
      launchPhase: 'Retrospective',
      promptOverride: 'retrospective prompt',
    });
    expect(retrospectiveRunRelease).toHaveBeenCalledTimes(1);
  });

  it('skips retrospective mode when no prior entries are available', async () => {
    shouldRunRetrospectivePhase.mockResolvedValue(true);
    buildCycleContextBundle.mockResolvedValue([
      {
        taskId: 'task-1',
        taskTitle: 'Current Task',
        taskSummary: '',
        completedWorkSummary: '',
        keyDecisions: [],
        knownLimitations: [],
        difficultyLevel: '',
        retrospectiveSummary: '',
        whatWentWell: [],
        whatCouldHaveGoneBetter: [],
        actionItems: [],
        isCurrentTask: true,
        warnings: [],
      },
    ]);
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runPipelineSequence } = await import('../sequencer.js');

    await expect(runPipelineSequence({ repoRoot, taskId: 'task-1', stopAfter: 'ron' })).resolves.toBeDefined();

    expect(runRoleAgent).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls.flat().join('\n'))).toContain('no-prior-cycle-context');
    expect(retrospectiveRunRelease).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('skips retrospective mode without throwing when no active context pack exists', async () => {
    shouldRunRetrospectivePhase.mockResolvedValue(true);
    readTaskJsonSafe.mockReturnValue({ contextPackBinding: { contextPackPath: '' } });
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runPipelineSequence } = await import('../sequencer.js');

    await expect(runPipelineSequence({ repoRoot, taskId: 'task-1', stopAfter: 'ron' })).resolves.toBeDefined();

    expect(runRoleAgent).toHaveBeenCalledTimes(1);
    expect(buildCycleContextBundle).not.toHaveBeenCalled();
    expect(claimRetrospectiveRun).not.toHaveBeenCalled();
    expect(String(warn.mock.calls.flat().join('\n'))).toContain('no-active-context-pack');
    warn.mockRestore();
  });
});
