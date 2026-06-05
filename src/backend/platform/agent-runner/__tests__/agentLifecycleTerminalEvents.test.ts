import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

type RunSummary = {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  terminationReason: 'exited' | 'timeout' | 'aborted';
  timedOut: boolean;
  aborted: boolean;
};

let repoRoot: string;
let child: { pid: number; exitCode: number | null; signalCode: string | null; kill: ReturnType<typeof vi.fn> };

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'agent-lifecycle-terminal-'));
  child = { pid: 4242, exitCode: null, signalCode: null, kill: vi.fn() };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../processLifecycle.js');
  vi.doUnmock('../sessionReceipts.js');
  vi.doUnmock('../../cli-provider/index.js');
  vi.resetModules();
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('runAgentSession lifecycle terminal projection', () => {
  it('projects greedy artifact-complete stops as completed launch terminal events and receipts', async () => {
    const { projectAgentSessionTerminal } = await import('../agentSession.js');

    expect(projectAgentSessionTerminal({
      runSummary: summary({ exitCode: 1 }),
      greedyStopTriggered: true,
    })).toEqual({
      progressStatus: 'success',
      outcome: 'completed',
      terminalStatus: 'completed',
      exitCode: 0,
    });
  });

  it('writes completed terminal records when greedy artifact-complete stop triggers', async () => {
    let resolveWait!: (value: RunSummary) => void;
    const waitPromise = new Promise<RunSummary>((resolve) => {
      resolveWait = resolve;
    });
    const terminalReceipt = vi.fn().mockResolvedValue(undefined);
    const { runAgentSession } = await importAgentSession(waitPromise, terminalReceipt);
    const completionCheck = vi.fn().mockResolvedValue(true);

    const run = runAgentSession({
      ...agentSessionOptions(),
      greedyStopOnArtifactCompletion: {
        completionCheck,
        pollIntervalMs: 1000,
      },
    });

    await vi.waitFor(() => {
      expect(readTerminalEvents()).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventId: 'agent.launch.started:ron:initial:launch-1' }),
      ]));
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(completionCheck).toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    resolveWait(summary({ exitCode: 1 }));

    await expect(run).resolves.toMatchObject({
      runSummary: expect.objectContaining({ exitCode: 1 }),
      greedyStopTriggered: true,
    });
    expect(terminalReceipt).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'completed',
      exitCode: 0,
    }));
    expect(readTerminalEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'agent.launch.terminal:ron:initial:launch-1',
        role: 'agent',
        severity: 'success',
        message: 'Ron - QA completed.',
        extra: expect.objectContaining({
          outcome: 'completed',
          exitCode: 0,
        }),
      }),
    ]));
  });

  it('preserves non-greedy provider failures as failed launch terminal events and receipts', async () => {
    const terminalReceipt = vi.fn().mockResolvedValue(undefined);
    const { runAgentSession } = await importAgentSession(Promise.resolve(summary({ exitCode: 1 })), terminalReceipt);

    await runAgentSession(agentSessionOptions());

    expect(terminalReceipt).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'failed',
      exitCode: 1,
    }));
    expect(readTerminalEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'agent.launch.terminal:ron:initial:launch-1',
        role: 'agent',
        severity: 'error',
        message: 'Ron - QA failed.',
        extra: expect.objectContaining({
          outcome: 'failed',
          exitCode: 1,
        }),
      }),
    ]));
  });
});

describe('roleAgent lifecycle wiring guards', () => {
  it('keeps greedy artifact monitoring wired for Alice and Ron initial plus continuation launches only', () => {
    const source = roleAgentSource();
    const initialStart = source.indexOf('const initialSession = await runAgentSession({');
    const continuationStart = source.indexOf('const continuationSession = await runAgentSession({');
    const overrideStart = source.indexOf('const runPromptOverrideSession = async');
    const overrideEnd = source.indexOf('const wallClockTimeoutS', overrideStart);

    expect(initialStart).toBeGreaterThan(-1);
    expect(continuationStart).toBeGreaterThan(-1);
    expect(overrideStart).toBeGreaterThan(-1);
    expect(overrideEnd).toBeGreaterThan(overrideStart);

    const initialBody = source.slice(initialStart, continuationStart);
    const continuationBody = source.slice(continuationStart, source.indexOf('runSummary = continuationSession.runSummary', continuationStart));
    const overrideBody = source.slice(overrideStart, overrideEnd);

    expect(initialBody).toContain("greedyStopOnArtifactCompletion: options.agentId === 'alice' || options.agentId === 'ron'");
    expect(continuationBody).toContain("greedyStopOnArtifactCompletion: options.agentId === 'alice' || options.agentId === 'ron'");
    expect(overrideBody).not.toContain('greedyStopOnArtifactCompletion');
  });

  it('does not emit provisional artifact-check failed events from polling', () => {
    const source = roleAgentSource();
    const start = source.indexOf('const artifactCompletionDetailsCheck = async');
    const end = source.indexOf('const artifactCompletionCheck = async', start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const body = source.slice(start, end);
    expect(body).not.toContain("agent.artifact_check.failed");
    expect(body).not.toContain('emitArtifactCheckResult(result.complete)');
    expect(body).toContain("emitAgentLifecycleEvent('agent.artifact_check.started')");
    expect(body).toContain("emitAgentLifecycleEvent('agent.artifact_check.completed')");
    expect(body).not.toContain('artifactCheckStartedLogged');
  });

  it('keeps final artifact-incomplete guardrail receipts visible through the terminal gate', () => {
    const source = roleAgentSource();
    expect(source).toContain("terminationReason === 'artifact-incomplete'");
    expect(source).toContain("type: 'guardrail.receipt.artifact_incomplete'");
  });
});

async function importAgentSession(
  waitPromise: Promise<RunSummary>,
  writeSessionTerminalReceipt: ReturnType<typeof vi.fn>,
): Promise<typeof import('../agentSession.js')> {
  vi.doMock('../processLifecycle.js', () => ({
    launchAgent: vi.fn(() => child),
    waitForAgentDetailed: vi.fn().mockReturnValue(waitPromise),
  }));
  vi.doMock('../sessionReceipts.js', () => ({
    writeSessionStartReceipt: vi.fn().mockResolvedValue(path.join(repoRoot, 'receipt.json')),
    writeSessionMonitorHeartbeat: vi.fn().mockResolvedValue(undefined),
    writeSessionTerminalReceipt,
  }));
  vi.doMock('../../cli-provider/index.js', () => ({
    getActiveProvider: vi.fn(() => ({ id: 'copilot' })),
  }));
  vi.doMock('../pythonHelpers.js', () => ({
    captureCodeDiff: vi.fn(),
    prepareExternalMcpLaunchContext: vi.fn(),
  }));
  return import('../agentSession.js');
}

function agentSessionOptions(): Parameters<typeof import('../agentSession.js')['runAgentSession']>[0] {
  return {
    repoRoot,
    cliArgs: ['run'],
    cwd: repoRoot,
    env: {
      TASKSAIL_TASK_ID: 'task-agent',
      RUN_ROLE_AGENT_ACTIVE_MODEL: 'model-a',
    },
    session: {
      taskRuntime: path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-agent'),
      launchId: 'launch-1',
      agentId: 'ron',
      roleName: 'QA Engineer',
      displayName: 'Ron',
    },
  };
}

function summary(overrides: Partial<RunSummary>): RunSummary {
  return {
    exitCode: 0,
    stdoutTail: '',
    stderrTail: '',
    terminationReason: 'exited',
    timedOut: false,
    aborted: false,
    ...overrides,
  };
}

function readTerminalEvents(): Array<Record<string, unknown>> {
  const eventPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'task-agent', 'terminal-events.json');
  return (JSON.parse(readFileSync(eventPath, 'utf8')) as { events: Array<Record<string, unknown>> }).events;
}

function roleAgentSource(): string {
  return readFileSync(path.join(process.cwd(), 'src/backend/platform/agent-runner/roleAgent.ts'), 'utf8');
}
