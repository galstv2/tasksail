import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { flushLoggers } from '../../core/index.js';

type WriteSpy = ReturnType<typeof vi.spyOn>;

const LOG_ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'LOG_DIR',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
  'TASKSAIL_LOG_PROGRESS',
  'TASKSAIL_LOG_PROGRESS_FORCE',
  'NO_COLOR',
  'CI',
] as const;

type RunSummary = {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  terminationReason: 'exited' | 'wall-clock-timeout' | 'idle-timeout' | 'aborted' | 'spawn-error';
  signalCode: NodeJS.Signals | null;
};

let tmpRoot: string;
let logDir: string;
let stderrWrite: WriteSpy;
let stdoutWrite: WriteSpy;
let ttyDescriptor: PropertyDescriptor | undefined;
let realLogSnapshot: string[];

beforeEach(() => {
  vi.resetModules();
  unmockProgressModules();
  realLogSnapshot = snapshotRealLogs();
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'agent-progress-'));
  logDir = mkdtempSync(path.join(tmpdir(), 'agent-progress-logs-'));
  for (const key of LOG_ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv('LOG_DIR', logDir);
  flushLoggers();
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
});

afterEach(() => {
  vi.useRealTimers();
  restoreStderrTty();
  stderrWrite.mockRestore();
  stdoutWrite.mockRestore();
  flushLoggers();
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  rmSync(logDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  unmockProgressModules();
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('agent-runner progress events', () => {
  it('P10 and P11 emit start and terminal success progress for task-bound sessions', async () => {
    enableDefaultHumanProgress();
    const { runAgentSession } = await importAgentSessionWithSummary(summary({ exitCode: 0 }));

    await runAgentSession(agentSessionOptions());

    expect(stderrChunks()).toEqual([
      '[agent] started dalton  pid=4242  model=claude-sonnet-4.6\n',
      '[agent] exited dalton  success  in 0s [ok]\n',
    ]);
    expect(readLevel('info')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        msg: 'agent.launch.started',
        task_id: 'task-agent',
        agent_id: 'dalton',
        provider_id: 'copilot',
        extra: { child_pid: 4242, launch_id: 'launch-1', model_id: 'claude-sonnet-4.6' },
      }),
      expect.objectContaining({
        msg: 'agent.launch.terminal',
        task_id: 'task-agent',
        agent_id: 'dalton',
        provider_id: 'copilot',
        extra: expect.objectContaining({ child_pid: 4242, status: 'success', exit_code: 0 }),
      }),
    ]));
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P11 derives failure status and fail suffix from nonzero exit code', async () => {
    enableDefaultHumanProgress();
    const { runAgentSession } = await importAgentSessionWithSummary(summary({ exitCode: 1 }));

    await runAgentSession(agentSessionOptions());

    const terminal = readLevel('info').find((record) => record.msg === 'agent.launch.terminal');
    expect((terminal?.extra as Record<string, unknown>).status).toBe('failure');
    expect(stderrChunks()[1]).toBe('[agent] exited dalton  failure  in 0s [fail]\n');
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P11 derives killed status from aborted termination without a suffix', async () => {
    enableDefaultHumanProgress();
    const { runAgentSession } = await importAgentSessionWithSummary(summary({
      exitCode: 1,
      terminationReason: 'aborted',
    }));

    await runAgentSession(agentSessionOptions());

    const terminal = readLevel('info').find((record) => record.msg === 'agent.launch.terminal');
    expect((terminal?.extra as Record<string, unknown>).status).toBe('killed');
    expect(stderrChunks()[1]).toBe('[agent] exited dalton  killed  in 0s\n');
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P11 derives timeout status from both timeout termination reasons', async () => {
    enableDefaultHumanProgress();
    for (const terminationReason of ['wall-clock-timeout', 'idle-timeout'] as const) {
      vi.resetModules();
      unmockProgressModules();
      stderrWrite.mockClear();
      const { runAgentSession } = await importAgentSessionWithSummary(summary({
        exitCode: 1,
        terminationReason,
      }));

      await runAgentSession(agentSessionOptions());

      const terminalRecords = readLevel('info').filter((record) => record.msg === 'agent.launch.terminal');
      const terminal = terminalRecords[terminalRecords.length - 1]!;
      expect((terminal.extra as Record<string, unknown>).status).toBe('timeout');
      expect(stderrChunks()[1]).toBe('[agent] exited dalton  timeout  in 0s\n');
    }
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P12 requires an explicit pipeline task id and never parses taskRuntime', async () => {
    enableDefaultHumanProgress();
    mockTestCapture();
    const { runTestCaptureWithPhaseTracking } = await import('../pipeline/sequencer.js');
    const taskRuntime = path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', 'fake-task-from-path');
    const implementationStepsDir = path.join(tmpRoot, 'steps');
    const captureCwd = path.join(tmpRoot, 'repo');
    mkdirSync(captureCwd, { recursive: true });

    await runTestCaptureWithPhaseTracking({ taskRuntime, implementationStepsDir, captureCwd });
    expect(readLevel('info').filter((record) => record.msg === 'pipeline.phase')).toHaveLength(0);
    expect(stderrWrite).not.toHaveBeenCalled();

    await runTestCaptureWithPhaseTracking({
      taskRuntime,
      implementationStepsDir,
      captureCwd,
      pipelineTaskId: 'explicit-pipeline-task',
    });

    const phaseRecords = readLevel('info').filter((record) => record.msg === 'pipeline.phase');
    expect(phaseRecords).toHaveLength(2);
    expect(phaseRecords[0]).toMatchObject({
      task_id: 'explicit-pipeline-task',
      extra: { phase: 'test-capture-started', prior_phase: null },
    });
    expect(phaseRecords[1]).toMatchObject({
      task_id: 'explicit-pipeline-task',
      extra: { phase: 'test-capture-completed', prior_phase: 'test-capture-started' },
    });
    expect(stderrChunks()).toEqual([
      '[pipeline] test-capture-started\n',
      '[pipeline] test-capture-started -> test-capture-completed\n',
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P13 promotes dalton verification launching to info progress', async () => {
    enableDefaultHumanProgress();
    await runSequencerScenario({ verificationPrompt: 'verify' });

    expect(stderrChunks()).toContain('[pipeline] dalton verification launching\n');
    expect(readLevel('info')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        msg: 'dalton_verification.launching',
        task_id: 'pipeline-task',
      }),
    ]));
    expect(stderrChunks().every((line) => !line.includes('"msg":"dalton_verification.launching"'))).toBe(true);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P14 promotes closeout remediation launching with the legacy reason payload', async () => {
    enableDefaultHumanProgress();
    await runSequencerScenario({
      verificationPrompt: undefined,
      policyPassed: false,
    });

    expect(stderrChunks()).toContain('[pipeline] closeout remediation — queue-advance-policy-blocked\n');
    expect(readLevel('info')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        msg: 'closeout_remediation.launching',
        task_id: 'pipeline-task',
        extra: { reason: 'queue-advance-policy-blocked' },
      }),
    ]));
    expect(readRuntimeTerminalEvents('pipeline-task')).toEqual([
      expect.objectContaining({
        eventId: 'closeout_remediation.launching',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'warning',
        message: 'Closeout remediation launching.',
      }),
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('default-off mode keeps agent progress structured and suppresses human stderr', async () => {
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', '');
    stubStderrTty(false);
    const { runAgentSession } = await importAgentSessionWithSummary(summary({ exitCode: 0 }));

    await runAgentSession(agentSessionOptions());

    expect(stderrWrite).not.toHaveBeenCalled();
    expect(readLevel('info').map((record) => record.msg)).toEqual([
      'agent.launch.started',
      'agent.launch.terminal',
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('does not emit agent launch progress without session identity', async () => {
    enableDefaultHumanProgress();
    const { runAgentSession } = await importAgentSessionWithSummary(summary({ exitCode: 0 }));

    await runAgentSession({
      ...agentSessionOptions(),
      session: undefined,
    });

    expect(readLevel('info')).toHaveLength(0);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('starts monitor heartbeats after creating a session receipt', async () => {
    const { runAgentSession } = await importAgentSessionWithSummary(summary({ exitCode: 0 }));
    const receipts = await import('../sessionReceipts.js');

    await runAgentSession(agentSessionOptions());

    expect(receipts.writeSessionMonitorHeartbeat).toHaveBeenCalledWith({
      receiptPath: path.join(tmpRoot, 'receipt.json'),
      monitorPid: process.pid,
      monitorStartedAt: expect.any(String),
    });
  });

  it('clears the heartbeat timer after the run resolves', async () => {
    vi.useFakeTimers();
    let resolveWait!: (value: RunSummary) => void;
    const waitPromise = new Promise<RunSummary>((resolve) => {
      resolveWait = resolve;
    });
    const { runAgentSession } = await importAgentSessionWithWait(waitPromise);
    const receipts = await import('../sessionReceipts.js');

    const run = runAgentSession(agentSessionOptions());
    await Promise.resolve();
    expect(receipts.writeSessionMonitorHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(receipts.writeSessionMonitorHeartbeat).toHaveBeenCalledTimes(2);

    resolveWait(summary({ exitCode: 0 }));
    await run;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(receipts.writeSessionMonitorHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('writes terminal receipt after monitor cleanup', async () => {
    const { runAgentSession } = await importAgentSessionWithSummary(summary({ exitCode: 0 }));
    const receipts = await import('../sessionReceipts.js');

    await runAgentSession(agentSessionOptions());

    expect(receipts.writeSessionTerminalReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptPath: path.join(tmpRoot, 'receipt.json'),
      terminalStatus: 'completed',
    }));
    expect(
      vi.mocked(receipts.writeSessionMonitorHeartbeat).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(receipts.writeSessionTerminalReceipt).mock.invocationCallOrder[0]!,
    );
  });

  it('swallows heartbeat write failures', async () => {
    const { runAgentSession } = await importAgentSessionWithSummary(summary({ exitCode: 0 }), {
      writeSessionMonitorHeartbeat: vi.fn().mockRejectedValue(new Error('heartbeat failed')),
    });

    await expect(runAgentSession(agentSessionOptions())).resolves.toMatchObject({
      runSummary: expect.objectContaining({ exitCode: 0 }),
    });
  });

  it('waits for an in-flight heartbeat before writing terminal completion', async () => {
    let resolveHeartbeat!: () => void;
    const heartbeatPromise = new Promise<void>((resolve) => {
      resolveHeartbeat = resolve;
    });
    let resolveWait!: (value: RunSummary) => void;
    const waitPromise = new Promise<RunSummary>((resolve) => {
      resolveWait = resolve;
    });
    const { runAgentSession } = await importAgentSessionWithWait(waitPromise, {
      writeSessionMonitorHeartbeat: vi.fn().mockReturnValue(heartbeatPromise),
    });
    const receipts = await import('../sessionReceipts.js');

    const run = runAgentSession(agentSessionOptions());
    await Promise.resolve();
    resolveWait(summary({ exitCode: 0 }));
    await Promise.resolve();

    expect(receipts.writeSessionTerminalReceipt).not.toHaveBeenCalled();
    resolveHeartbeat();
    await run;
    expect(receipts.writeSessionTerminalReceipt).toHaveBeenCalledTimes(1);
  });

  it('skips interval heartbeats while a prior heartbeat is in flight', async () => {
    vi.useFakeTimers();
    let resolveHeartbeat!: () => void;
    const heartbeatPromise = new Promise<void>((resolve) => {
      resolveHeartbeat = resolve;
    });
    let resolveWait!: (value: RunSummary) => void;
    const waitPromise = new Promise<RunSummary>((resolve) => {
      resolveWait = resolve;
    });
    const { runAgentSession } = await importAgentSessionWithWait(waitPromise, {
      writeSessionMonitorHeartbeat: vi.fn().mockReturnValue(heartbeatPromise),
    });
    const receipts = await import('../sessionReceipts.js');

    const run = runAgentSession(agentSessionOptions());
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(receipts.writeSessionMonitorHeartbeat).toHaveBeenCalledTimes(1);
    resolveWait(summary({ exitCode: 0 }));
    resolveHeartbeat();
    await run;
  });

  it('does not start new heartbeat writes after the run has resolved', async () => {
    vi.useFakeTimers();
    const { runAgentSession } = await importAgentSessionWithSummary(summary({ exitCode: 0 }));
    const receipts = await import('../sessionReceipts.js');

    await runAgentSession(agentSessionOptions());
    await vi.advanceTimersByTimeAsync(30_000);

    expect(receipts.writeSessionMonitorHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('P12 emits skipped phase only when an explicit task id is supplied', async () => {
    enableDefaultHumanProgress();
    mockTestCapture();
    const { runTestCaptureWithPhaseTracking } = await import('../pipeline/sequencer.js');

    await runTestCaptureWithPhaseTracking({
      taskRuntime: path.join(tmpRoot, 'runtime'),
      implementationStepsDir: path.join(tmpRoot, 'steps'),
      captureCwd: null,
      pipelineTaskId: 'pipeline-skip-task',
    });

    expect(stderrChunks()).toEqual(['[pipeline] test-capture-skipped\n']);
    expect(readLevel('info')).toMatchObject([
      {
        msg: 'pipeline.phase',
        task_id: 'pipeline-skip-task',
        extra: { phase: 'test-capture-skipped', prior_phase: null },
      },
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('P12 remediation-loop test capture uses options.taskId as the explicit pipeline task id', async () => {
    enableDefaultHumanProgress();
    await runRemediationProgressScenario();

    const phaseRecords = readLevel('info').filter((record) => record.msg === 'pipeline.phase');
    expect(phaseRecords).toHaveLength(2);
    expect(phaseRecords[0]).toMatchObject({
      task_id: 'remediation-task',
      extra: { phase: 'test-capture-started', prior_phase: null },
    });
    expect(phaseRecords[1]).toMatchObject({
      task_id: 'remediation-task',
      extra: { phase: 'test-capture-completed', prior_phase: 'test-capture-started' },
    });
    expect(stderrChunks()).toEqual([
      '[pipeline] test-capture-started\n',
      '[pipeline] test-capture-started -> test-capture-completed\n',
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

async function importAgentSessionWithSummary(
  runSummary: RunSummary,
  receiptMocks: Partial<Record<
    'writeSessionStartReceipt' | 'writeSessionTerminalReceipt' | 'writeSessionMonitorHeartbeat',
    ReturnType<typeof vi.fn>
  >> = {},
): Promise<typeof import('../agentSession.js')> {
  return importAgentSessionWithWait(Promise.resolve(runSummary), receiptMocks);
}

async function importAgentSessionWithWait(
  waitPromise: Promise<RunSummary>,
  receiptMocks: Partial<Record<
    'writeSessionStartReceipt' | 'writeSessionTerminalReceipt' | 'writeSessionMonitorHeartbeat',
    ReturnType<typeof vi.fn>
  >> = {},
): Promise<typeof import('../agentSession.js')> {
  vi.doMock('../processLifecycle.js', () => ({
    launchAgent: vi.fn(() => ({
      pid: 4242,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    })),
    waitForAgentDetailed: vi.fn().mockReturnValue(waitPromise),
  }));
  vi.doMock('../../cli-provider/index.js', () => ({
    getActiveProvider: vi.fn(() => ({ id: 'copilot' })),
  }));
  vi.doMock('../sessionReceipts.js', () => ({
    writeSessionStartReceipt: receiptMocks.writeSessionStartReceipt ??
      vi.fn().mockResolvedValue(path.join(tmpRoot, 'receipt.json')),
    writeSessionTerminalReceipt: receiptMocks.writeSessionTerminalReceipt ??
      vi.fn().mockResolvedValue(undefined),
    writeSessionMonitorHeartbeat: receiptMocks.writeSessionMonitorHeartbeat ??
      vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../pythonHelpers.js', () => ({
    captureCodeDiff: vi.fn(),
    prepareExternalMcpLaunchContext: vi.fn(),
  }));
  return import('../agentSession.js');
}

function agentSessionOptions(): Parameters<typeof import('../agentSession.js')['runAgentSession']>[0] {
  return {
    repoRoot: tmpRoot,
    cliArgs: ['run'],
    cwd: tmpRoot,
    env: {
      TASKSAIL_TASK_ID: 'task-agent',
      RUN_ROLE_AGENT_ACTIVE_MODEL: 'claude-sonnet-4.6',
    },
    session: {
      taskRuntime: path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', 'task-agent'),
      launchId: 'launch-1',
      agentId: 'dalton',
      roleName: 'Software Engineer',
      displayName: 'Dalton',
    },
  };
}

function summary(overrides: Partial<RunSummary>): RunSummary {
  return {
    exitCode: 0,
    stdoutTail: '',
    stderrTail: '',
    terminationReason: 'exited',
    signalCode: null,
    ...overrides,
  };
}

function mockTestCapture(): void {
  vi.doMock('../pipeline/testCapture.js', () => ({
    captureSliceValidation: vi.fn().mockResolvedValue([]),
    buildTestCapturePrompt: vi.fn(() => 'test capture prompt'),
    resolveTestCaptureCwd: vi.fn().mockResolvedValue(tmpRoot),
  }));
}

async function runSequencerScenario(options: {
  verificationPrompt?: string;
  policyPassed?: boolean;
}): Promise<void> {
  mockSequencerDependencies(options);
  const { runPipelineSequence } = await import('../pipeline/sequencer.js');
  await runPipelineSequence({
    repoRoot: tmpRoot,
    taskId: 'pipeline-task',
    startAt: options.policyPassed === false ? 'alice' : 'dalton',
    stopAfter: options.policyPassed === false ? 'alice' : 'dalton',
  });
}

async function runRemediationProgressScenario(): Promise<void> {
  mockRemediationDependencies();
  const { remediationRunQaLoop } = await import('../pipeline/remediation.js');
  await remediationRunQaLoop({
    repoRoot: tmpRoot,
    taskId: 'remediation-task',
    maxCycles: 1,
    contextPackDir: path.join(tmpRoot, 'context-pack'),
  });
}

function mockRemediationDependencies(): void {
  const paths = {
    repoRoot: tmpRoot,
    handoffs: path.join(tmpRoot, 'AgentWorkSpace', 'tasks', 'remediation-task', 'handoffs'),
    implementationSteps: path.join(tmpRoot, 'AgentWorkSpace', 'tasks', 'remediation-task', 'ImplementationSteps'),
    platformState: path.join(tmpRoot, '.platform-state'),
    taskRuntime: path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', 'fake-task-from-path'),
    templates: path.join(tmpRoot, 'AgentWorkSpace', 'templates'),
  };
  mkdirSync(paths.handoffs, { recursive: true });
  mkdirSync(paths.implementationSteps, { recursive: true });
  mkdirSync(paths.taskRuntime, { recursive: true });
  mkdirSync(paths.templates, { recursive: true });
  writeFileSync(
    path.join(paths.handoffs, 'issues.md'),
    [
      '# QA Issues',
      '',
      '## Review Outcome',
      '',
      'blocking',
      '',
      '## Finding',
      '',
      'Fix the issue.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(paths.templates, 'issues.md'),
    [
      '# QA Issues',
      '',
      '## Task Metadata',
      '',
      '- Task ID: remediation-task',
      '',
      '## Review Outcome',
      '',
      'clear',
      '',
    ].join('\n'),
  );

  vi.doMock('../../core/index.js', async () => {
    const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
    return {
      ...actual,
      resolvePaths: vi.fn(() => paths),
      readTextFile: vi.fn(async (filePath: string) => (
        existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined
      )),
      writeTextFile: vi.fn(async (filePath: string, content: string) => {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf-8');
      }),
      newSpanId: vi.fn(() => 'span-remediation'),
      STANDARD_AGENT_ORDER: ['alice', 'dalton', 'ron'],
    };
  });
  vi.doMock('../roleAgent.js', () => ({
    runRoleAgent: vi.fn().mockResolvedValue({ exitCode: 0, agentId: 'dalton', durationMs: 1 }),
  }));
  vi.doMock('../../context-pack/active.js', () => ({
    requireAuthorizedActiveContextPack: vi.fn().mockResolvedValue(path.join(tmpRoot, 'context-pack')),
  }));
  vi.doMock('../../cli-provider/index.js', () => ({
    getActiveProvider: vi.fn(() => ({
      promptPathEnvVars: () => ({ handoffsDir: 'HANDOFFS_DIR' }),
    })),
  }));
  vi.doMock('../pipeline/testCapture.js', () => ({
    captureSliceValidation: vi.fn().mockResolvedValue([]),
    buildTestCapturePrompt: vi.fn(() => 'test capture prompt'),
    resolveTestCaptureCwd: vi.fn().mockResolvedValue(tmpRoot),
  }));
}

function mockSequencerDependencies(options: {
  verificationPrompt?: string;
  policyPassed?: boolean;
}): void {
  const paths = {
    repoRoot: tmpRoot,
    handoffs: path.join(tmpRoot, 'AgentWorkSpace', 'tasks', 'pipeline-task', 'handoffs'),
    implementationSteps: path.join(tmpRoot, 'AgentWorkSpace', 'tasks', 'pipeline-task', 'ImplementationSteps'),
    platformState: path.join(tmpRoot, '.platform-state'),
    taskRuntime: path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', 'pipeline-task'),
    templates: path.join(tmpRoot, 'AgentWorkSpace', 'templates'),
  };
  mkdirSync(paths.handoffs, { recursive: true });
  mkdirSync(paths.implementationSteps, { recursive: true });
  mkdirSync(paths.taskRuntime, { recursive: true });
  writeFileSync(path.join(paths.handoffs, 'code-changes.diff'), 'diff\n');

  vi.doMock('../../core/index.js', async () => {
    const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
    return {
      ...actual,
      resolvePaths: vi.fn(() => paths),
      readTextFile: vi.fn(async (filePath: string) => (
        existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined
      )),
      newSpanId: vi.fn(() => 'span-test'),
      STANDARD_AGENT_ORDER: ['alice', 'dalton', 'ron'],
    };
  });
  vi.doMock('../roleAgent.js', () => ({
    runRoleAgent: vi.fn().mockResolvedValue({ exitCode: 0, agentId: 'dalton', durationMs: 1 }),
  }));
  vi.doMock('../guardrails.js', () => ({
    runRuntimePolicyCheck: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  }));
  vi.doMock('../artifactCompletion.js', async () => {
    const actual = await vi.importActual<typeof import('../artifactCompletion.js')>('../artifactCompletion.js');
    return {
      ...actual,
      detectParallelOk: vi.fn().mockResolvedValue(false),
      listSliceFiles: vi.fn().mockResolvedValue([]),
    };
  });
  vi.doMock('../pipeline/contextPrewarm.js', () => ({
    prewarmPipelineContext: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../pipeline/externalMcpRegistryCache.js', () => ({
    getCachedExternalMcpRegistry: vi.fn(() => undefined),
    getCachedExternalMcpRegistryHealth: vi.fn(() => ({ status: 'not-configured' })),
  }));
  vi.doMock('../pipeline/remediation.js', () => ({
    remediationHasBlockingFindings: vi.fn().mockResolvedValue(false),
    remediationRunQaLoop: vi.fn().mockResolvedValue(undefined),
    remediationClearCloseoutArtifacts: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../pipeline/verificationPass.js', () => ({
    resolveVerificationDaltonPrompt: vi.fn().mockResolvedValue(options.verificationPrompt),
  }));
  vi.doMock('../pipeline/testCapture.js', () => ({
    captureSliceValidation: vi.fn().mockResolvedValue([]),
    buildTestCapturePrompt: vi.fn(() => 'test capture prompt'),
    resolveTestCaptureCwd: vi.fn().mockResolvedValue(tmpRoot),
  }));
  vi.doMock('../pythonHelpers.js', () => ({
    captureCodeDiff: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  }));
  vi.doMock('../../queue/policyValidation.js', () => ({
    runPolicyValidation: vi.fn().mockResolvedValue({
      passed: options.policyPassed ?? true,
      stdout: 'policy stdout',
      stderr: '',
      exitCode: options.policyPassed === false ? 1 : 0,
    }),
  }));
  vi.doMock('../../queue/completePendingItem.js', () => ({
    completePendingItem: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../../queue/errorItems.js', () => ({
    moveFailedItemToErrorItems: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../../queue/taskJson.js', () => ({
    readTaskJsonSafe: vi.fn(() => null),
  }));
  vi.doMock('../../context-pack/focusedRepo.js', () => ({
    resolveSelectedPrimaryRepoRoot: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../pipeline/runtimeControl.js', () => ({
    clearPipelineKill: vi.fn().mockResolvedValue(undefined),
    pipelineKillSwitchExists: vi.fn(() => false),
    readPipelineKillRequest: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock('../pipeline/retrospectivePhase.js', () => ({
    buildCycleContextBundle: vi.fn().mockResolvedValue([]),
    buildRetrospectivePrompt: vi.fn().mockResolvedValue('retrospective'),
    shouldRunRetrospectivePhase: vi.fn().mockResolvedValue(false),
  }));
}

function stdoutChunks(): string[] {
  return stdoutWrite.mock.calls.map((call) => String(call[0]));
}

function stderrChunks(): string[] {
  return stderrWrite.mock.calls.map((call) => stripAnsi(String(call[0])));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function stubStderrTty(value: boolean): void {
  Object.defineProperty(process.stderr, 'isTTY', {
    configurable: true,
    value,
  });
}

function enableDefaultHumanProgress(): void {
  vi.stubEnv('TASKSAIL_LOG_PROGRESS', '');
  vi.stubEnv('CI', '');
  stubStderrTty(true);
}

function restoreStderrTty(): void {
  if (ttyDescriptor) {
    Object.defineProperty(process.stderr, 'isTTY', ttyDescriptor);
  } else {
    delete (process.stderr as Partial<typeof process.stderr>).isTTY;
  }
  ttyDescriptor = undefined;
}

function readLevel(level: 'info' | 'warn' | 'error'): Array<Record<string, unknown>> {
  const dir = path.join(logDir, level);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.jsonl'))
    .flatMap((entry) => readJsonLines(path.join(dir, entry)));
}

function readRuntimeTerminalEvents(taskId: string): Array<Record<string, unknown>> {
  const filePath = path.join(tmpRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json');
  if (!existsSync(filePath)) {
    return [];
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')).events;
}

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

function snapshotRealLogs(): string[] {
  const root = path.join(process.cwd(), '.platform-state', 'logs');
  if (!existsSync(root)) {
    return [];
  }
  const entries: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const filePath = path.join(dir, entry);
      const relative = path.relative(root, filePath);
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        entries.push(`${relative}/`);
        visit(filePath);
      } else {
        entries.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  visit(root);
  return entries;
}

function unmockProgressModules(): void {
  vi.doUnmock('../processLifecycle.js');
  vi.doUnmock('../../cli-provider/index.js');
  vi.doUnmock('../sessionReceipts.js');
  vi.doUnmock('../pythonHelpers.js');
  vi.doUnmock('../../core/index.js');
  vi.doUnmock('../roleAgent.js');
  vi.doUnmock('../guardrails.js');
  vi.doUnmock('../artifactCompletion.js');
  vi.doUnmock('../pipeline/contextPrewarm.js');
  vi.doUnmock('../pipeline/externalMcpRegistryCache.js');
  vi.doUnmock('../pipeline/remediation.js');
  vi.doUnmock('../pipeline/verificationPass.js');
  vi.doUnmock('../pipeline/testCapture.js');
  vi.doUnmock('../../context-pack/active.js');
  vi.doUnmock('../../queue/policyValidation.js');
  vi.doUnmock('../../queue/completePendingItem.js');
  vi.doUnmock('../../queue/errorItems.js');
  vi.doUnmock('../../queue/taskJson.js');
  vi.doUnmock('../../context-pack/focusedRepo.js');
  vi.doUnmock('../pipeline/runtimeControl.js');
  vi.doUnmock('../pipeline/retrospectivePhase.js');
}
