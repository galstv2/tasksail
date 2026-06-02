import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeTerminalEvents } from '../runtimeTerminalEvents.js';
import { flushLoggers } from '../logger.js';

const LOG_ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'LOG_DIR',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  LOG_ENV_KEYS.map((key) => [key, process.env[key]]),
);

let repoRoot: string;
let logDir: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'runtime-terminal-events-'));
  logDir = mkdtempSync(path.join(tmpdir(), 'runtime-terminal-events-logs-'));
  for (const key of LOG_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.LOG_DIR = logDir;
  flushLoggers();
});

afterEach(() => {
  vi.doUnmock('../io.js');
  vi.resetModules();
  flushLoggers();
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
  for (const key of LOG_ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('RuntimeTerminalEvents', () => {
  it('branchCreated writes the exact terminal event fields', async () => {
    await RuntimeTerminalEvents.forTask(repoRoot, 'task-1').branchCreated({
      repo: 'api',
      branch: 'task/task-1',
      worktreeRoot: '/tmp/worktrees/api',
      materializationStrategy: 'copy',
    });

    expect(readEvents('task-1')).toMatchObject([
      {
        eventId: 'queue.branch.created:api:task/task-1:/tmp/worktrees/api',
        source: 'runtime.branch',
        role: 'pipeline',
        severity: 'info',
        message: 'Created writable task branch worktree for api on branch task/task-1.',
        createdAt: expect.any(String),
        extra: {
          repo: 'api',
          branch: 'task/task-1',
          worktreeRoot: '/tmp/worktrees/api',
          materializationStrategy: 'copy',
        },
      },
    ]);
  });

  it('writes read-only support context materialization events', async () => {
    await RuntimeTerminalEvents.forTask(repoRoot, 'task-readonly-context').readonlyContextMaterialized({
      repo: 'tools',
      worktreeRoot: '/tmp/worktrees/tools',
      materializationStrategy: 'detached-readonly-context',
    });

    expect(readEvents('task-readonly-context')).toMatchObject([
      {
        eventId: 'activation.readonly_context.materialized:tools:/tmp/worktrees/tools',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'info',
        visible: true,
        message: 'Read-only support context materialized for tools; no target branch was created.',
        extra: {
          repo: 'tools',
          worktreeRoot: '/tmp/worktrees/tools',
          materializationStrategy: 'detached-readonly-context',
        },
      },
    ]);
  });

  it('appends archive start, completion, and failure events to one file', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-archive');

    await events.archiveStarted();
    await events.archiveCompleted();
    await events.archiveFailed();

    expect(readEvents('task-archive')).toMatchObject([
      {
        eventId: 'archive.started',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'info',
        message: 'Archiving task.',
      },
      {
        eventId: 'archive.completed',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'success',
        message: 'Task archived.',
      },
      {
        eventId: 'archive.failed',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'error',
        message: 'Task archival failed.',
      },
    ]);
  });

  it('writes closeout and auto-merge events as pipeline terminal events', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-closeout');

    await events.autoMergeDisabled();
    await events.autoMergeApplied({ repos: 'api:task/a->main' });
    await events.autoMergeSkipped({ detail: 'blocked: needs review' });
    await events.targetBranchUpdate({
      repoLabel: 'api',
      targetRepoRoot: '/repos/api',
      sourceBranch: 'task/a',
      targetBranch: 'main',
      status: 'applied',
      detail: 'Applied task branch patch to the target index.',
    });
    await events.targetBranchUpdate({
      repoLabel: 'tools',
      targetRepoRoot: '/repos/tools',
      sourceBranch: 'task/a',
      targetBranch: null,
      status: 'disabled',
      detail: 'Auto-merge is disabled.',
    });
    await events.targetBranchUpdate({
      repoLabel: 'web',
      targetRepoRoot: '/repos/web',
      sourceBranch: 'task/a',
      targetBranch: 'main',
      status: 'skipped',
      detail: 'Target branch has tracked or untracked changes.',
    });
    await events.autoMergeSkippedForChildTaskChain();
    await events.closeoutFinalized();
    await events.strandedCloseoutResumed({ drove: ['finalize-worktrees'] });

    const writtenEvents = readEvents('task-closeout');
    expect(writtenEvents).toMatchObject([
      { eventId: 'auto_merge.disabled', source: 'runtime.closeout', role: 'pipeline', visible: false },
      { eventId: 'auto_merge.applied', source: 'runtime.closeout', role: 'pipeline', visible: false },
      { eventId: 'auto_merge.skipped', source: 'runtime.closeout', role: 'pipeline', visible: false },
      {
        eventId: 'closeout.target_branch_update:api:task/a:applied:main',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'success',
        visible: true,
        message: 'Code changes from task branch task/a were successfully staged on target branch main in target repo api at /repos/api.',
        extra: expect.objectContaining({ targetRepoRoot: '/repos/api' }),
      },
      {
        eventId: 'closeout.target_branch_update:tools:task/a:disabled:(unknown target branch)',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'info',
        visible: true,
        message: 'Auto-merge is disabled for target repo tools at /repos/tools. Task branch task/a is ready for operator review.',
        extra: expect.objectContaining({ targetRepoRoot: '/repos/tools' }),
      },
      {
        eventId: 'closeout.target_branch_update:web:task/a:skipped:main',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'warning',
        visible: true,
        message: 'Target branch was not updated for web at /repos/web: Target branch has tracked or untracked changes. Task branch task/a is ready for operator review.',
        extra: expect.objectContaining({ targetRepoRoot: '/repos/web' }),
      },
      {
        eventId: 'auto_merge.skipped_child_chain',
        source: 'runtime.closeout',
        role: 'pipeline',
        severity: 'warning',
        message: 'Auto-merge skipped for child task chain: chain branches are manually integrated by the operator.',
      },
      { eventId: 'closeout.finalized', source: 'runtime.closeout', role: 'pipeline' },
      { eventId: 'closeout.stranded.resumed', source: 'runtime.closeout', role: 'pipeline' },
    ]);
    expect(writtenEvents.find((event) => event.eventId === 'auto_merge.skipped_child_chain')).not.toHaveProperty('extra');
  });

  it('writes pipeline completion as a visible pipeline success', async () => {
    await RuntimeTerminalEvents.forTask(repoRoot, 'task-pipeline-completed').pipelineCompleted();

    expect(readEvents('task-pipeline-completed')).toMatchObject([
      {
        eventId: 'pipeline.completed',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'success',
        visible: true,
        message: 'Pipeline completed.',
      },
    ]);
  });

  it('writes queue state transition events', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-state');

    await events.taskActivated();
    await events.taskCompleted();
    await events.taskFailed();

    expect(readEvents('task-state')).toMatchObject([
      {
        eventId: 'queue.task.activated',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'info',
        message: 'Moved pending item to active.',
      },
      {
        eventId: 'queue.task.completed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'success',
        message: 'Moved pending item to completed.',
      },
      {
        eventId: 'queue.task.failed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
        message: 'Moved pending item to failed.',
      },
    ]);
  });

  it('writes agent launch lifecycle events', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-agent');

    await events.agentLaunchStarted({
      agentId: 'alice',
      launchId: 'launch-1',
      childPid: 1234,
      modelId: 'auto',
    });
    await events.agentLaunchTerminal({
      agentId: 'alice',
      launchId: 'launch-1',
      childPid: 1234,
      status: 'timeout',
      durationMs: 5_000,
      exitCode: 1,
    });

    expect(readEvents('task-agent')).toMatchObject([
      {
        eventId: 'agent.launch.started:alice:initial:launch-1',
        source: 'runtime.agent',
        role: 'agent',
        severity: 'info',
        message: 'Started Alice - PM.',
        extra: {
          agentId: 'alice',
          launchId: 'launch-1',
          childPid: 1234,
          modelId: 'auto',
        },
      },
      {
        eventId: 'agent.launch.terminal:alice:initial:launch-1',
        source: 'runtime.agent',
        role: 'agent',
        severity: 'error',
        message: 'Alice - PM timed out.',
        extra: {
          agentId: 'alice',
          launchId: 'launch-1',
          childPid: 1234,
          outcome: 'timeout',
          durationMs: 5_000,
          exitCode: 1,
        },
      },
    ]);
  });

  it('writes role-aware launch lifecycle messages for known agents and phases', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-agent-labels');

    await events.agentLaunchStarted({
      agentId: 'dalton',
      launchId: 'launch-dalton',
      childPid: 1,
      modelId: 'auto',
    });
    await events.agentLaunchTerminal({
      agentId: 'dalton',
      launchId: 'launch-dalton',
      childPid: 1,
      status: 'success',
      durationMs: 1,
      exitCode: 0,
    });
    await events.agentLaunchStarted({
      agentId: 'dalton-verify',
      launchId: 'launch-dalton-verify',
      displayPhase: 'verification',
      childPid: 2,
      modelId: 'auto',
    });
    await events.agentLaunchTerminal({
      agentId: 'dalton-verify',
      launchId: 'launch-dalton-verify',
      displayPhase: 'verification',
      childPid: 2,
      status: 'success',
      durationMs: 1,
      exitCode: 0,
    });
    await events.agentLaunchStarted({
      agentId: 'ron',
      launchId: 'launch-ron',
      childPid: 3,
      modelId: 'auto',
    });
    await events.agentLaunchTerminal({
      agentId: 'ron',
      launchId: 'launch-ron',
      childPid: 3,
      status: 'success',
      durationMs: 1,
      exitCode: 0,
    });

    expect(readEvents('task-agent-labels')).toMatchObject([
      { eventId: 'agent.launch.started:dalton:initial:launch-dalton', message: 'Started Dalton - SWE.' },
      { eventId: 'agent.launch.terminal:dalton:initial:launch-dalton', message: 'Dalton - SWE completed.' },
      { eventId: 'agent.launch.started:dalton-verify:verification:launch-dalton-verify', message: 'Started Dalton - SWE (verify).' },
      { eventId: 'agent.launch.terminal:dalton-verify:verification:launch-dalton-verify', message: 'Dalton - SWE (verify) completed.' },
      { eventId: 'agent.launch.started:ron:initial:launch-ron', message: 'Started Ron - QA.' },
      { eventId: 'agent.launch.terminal:ron:initial:launch-ron', message: 'Ron - QA completed.' },
    ]);
  });

  it('writes child-chain failure branch diagnostics', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-chain-fail');
    const extra = { branch: 'task/root', status: 'completed' };

    await events.childChainFailureBranchRollbackPreflightFailed(extra);
    await events.childChainFailureBranchRollbackCompleted(extra);
    await events.childChainFailureBranchRollbackFailed(extra);
    await events.childChainFailureBranchDeleteSkipped(extra);

    expect(readEvents('task-chain-fail')).toMatchObject([
      {
        eventId: 'child_chain_failure_branch.rollback_preflight_failed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
      },
      {
        eventId: 'child_chain_failure_branch.rollback_completed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'info',
      },
      {
        eventId: 'child_chain_failure_branch.rollback_failed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'error',
      },
      {
        eventId: 'child_chain_failure_branch.branch_delete_skipped',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'warning',
      },
    ]);
  });

  it('writes branch-conflict return-to-open events as queue warnings', async () => {
    await RuntimeTerminalEvents.forTask(repoRoot, 'task-conflict').activationReturnedToOpenBranchConflict({
      conflictingTaskId: 'active-a',
      repoLabel: 'api',
      repoRoot: '/repo/api',
      branch: 'task/root',
      openItemPath: '/repo/AgentWorkSpace/dropbox/task-conflict.md',
    });

    expect(readEvents('task-conflict')).toMatchObject([
      {
        eventId: 'activation.returned-open.branch-conflict:task/root:active-a',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'warning',
        message: 'Returned to open because active task active-a already owns branch task/root for repo api.',
        createdAt: expect.any(String),
        extra: {
          conflictingTaskId: 'active-a',
          repoLabel: 'api',
          repoRoot: '/repo/api',
          branch: 'task/root',
          openItemPath: '/repo/AgentWorkSpace/dropbox/task-conflict.md',
        },
      },
    ]);
  });

  it('writes activation skip and pipeline progress events', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-progress');

    await events.activationSkipped({ reason: 'pipeline-spawn-failed' });
    await events.pipelinePhase({ phase: 'test-capture-started', priorPhase: null });
    await events.pipelinePhase({ phase: 'test-capture-completed', priorPhase: 'test-capture-started' });
    await events.daltonVerificationLaunching();

    expect(readEvents('task-progress')).toMatchObject([
      {
        eventId: 'queue.active.skipped:pipeline-spawn-failed',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'warning',
        message: 'Activation skipped: pipeline-spawn-failed.',
        extra: { reason: 'pipeline-spawn-failed' },
      },
      {
        eventId: 'pipeline.phase:test-capture-started',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'info',
        visible: false,
        message: 'Pipeline phase: code-capture-started.',
        extra: { phase: 'test-capture-started', priorPhase: null },
      },
      {
        eventId: 'pipeline.phase:test-capture-started->test-capture-completed',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'info',
        visible: false,
        message: 'Pipeline phase: code-capture-started -> code-capture-completed.',
        extra: {
          phase: 'test-capture-completed',
          priorPhase: 'test-capture-started',
        },
      },
      {
        eventId: 'dalton_verification.launching',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'info',
        message: 'Dalton - SWE verification launching.',
      },
    ]);
  });

  it('dedupes repeated reasoning effort rejection terminal events', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-effort');
    const message = 'Agent dalton cannot launch model gpt-5.4 with reasoning effort ultra. Update Agent Configuration to None or a Copilot-advertised effort before relaunching the task.';
    const input = {
      agentId: 'dalton',
      modelId: 'gpt-5.4',
      effort: 'ultra',
      reason: 'unsupported-by-cli' as const,
      message,
    };

    await events.reasoningEffortRejectedBeforeSpawn(input);
    await events.reasoningEffortRejectedBeforeSpawn(input);

    expect(readEvents('task-effort')).toMatchObject([
      {
        eventId: 'pipeline.agent_reasoning_effort.rejected_before_spawn:task-effort:dalton:ultra',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'error',
        visible: true,
        message,
        extra: {
          agentId: 'dalton',
          modelId: 'gpt-5.4',
          effort: 'ultra',
          reason: 'unsupported-by-cli',
        },
      },
    ]);
  });

  it('keeps non-test-capture pipeline phases visible', async () => {
    await RuntimeTerminalEvents.forTask(repoRoot, 'task-visible-phase').pipelinePhase({
      phase: 'qa',
      priorPhase: 'build',
    });

    expect(readEvents('task-visible-phase')).toMatchObject([
      {
        eventId: 'pipeline.phase:build->qa',
        visible: true,
        message: 'Pipeline phase: build -> qa.',
      },
    ]);
  });

  it('does not append duplicate eventIds', async () => {
    const events = RuntimeTerminalEvents.forTask(repoRoot, 'task-dup');

    await events.archiveStarted();
    await events.archiveStarted();

    expect(readEvents('task-dup')).toHaveLength(1);
  });

  it('preserves all concurrent branchCreated appends for one task', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      RuntimeTerminalEvents.forTask(repoRoot, 'task-concurrent').branchCreated({
        repo: `repo-${index}`,
        branch: `task/branch-${index}`,
        worktreeRoot: `/tmp/worktree-${index}`,
        materializationStrategy: 'copy',
      })
    )));

    const eventIds = readEvents('task-concurrent').map((event) => event.eventId).sort();
    expect(eventIds).toEqual(
      Array.from({ length: 20 }, (_, index) => (
        `queue.branch.created:repo-${index}:task/branch-${index}:/tmp/worktree-${index}`
      )).sort(),
    );
  });

  it('rewrites corrupt existing JSON as a valid event document', async () => {
    const eventPath = terminalEventsPath('task-corrupt');
    mkdirSync(path.dirname(eventPath), { recursive: true });
    writeFileSync(eventPath, 'not-json', 'utf-8');

    await RuntimeTerminalEvents.forTask(repoRoot, 'task-corrupt').archiveStarted();

    expect(JSON.parse(readFileSync(eventPath, 'utf-8'))).toMatchObject({
      events: [
        {
          eventId: 'archive.started',
          message: 'Archiving task.',
        },
      ],
    });
  });

  it('omits extra when the method has no extra payload', async () => {
    await RuntimeTerminalEvents.forTask(repoRoot, 'task-no-extra').archiveStarted();

    expect(readEvents('task-no-extra')[0]).not.toHaveProperty('extra');
  });

  it('does not reject on write failure and logs one warning', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      vi.resetModules();
      vi.doMock('../io.js', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../io.js')>();
        return {
          ...actual,
          writeTextFileAtomic: vi.fn(async () => {
            throw new Error('disk full');
          }),
        };
      });
      const { RuntimeTerminalEvents: MockedRuntimeTerminalEvents } = await import('../runtimeTerminalEvents.js');
      const { flushLoggers: flushMockedLoggers } = await import('../logger.js');

      await expect(
        MockedRuntimeTerminalEvents.forTask(repoRoot, 'task-fail').archiveStarted(),
      ).resolves.toBeUndefined();
      flushMockedLoggers();

      const warnLines = readWarnLogs().filter((line) => line.msg === 'runtime_terminal_event.write.failed');
      expect(warnLines).toHaveLength(1);
      expect(warnLines[0]).toMatchObject({
        module: 'platform/core/runtimeTerminalEvents',
        extra: {
          taskId: 'task-fail',
          eventId: 'archive.started',
        },
      });
    } finally {
      stderrWrite.mockRestore();
    }
  });
});

function terminalEventsPath(taskId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'tasks',
    taskId,
    'terminal-events.json',
  );
}

function readEvents(taskId: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(terminalEventsPath(taskId), 'utf-8')).events;
}

function readWarnLogs(): Array<Record<string, unknown>> {
  const warnDir = path.join(logDir, 'warn');
  if (!existsSync(warnDir)) {
    return [];
  }
  const [warnFile] = readdirSync(warnDir).filter((entry) => entry.endsWith('.jsonl'));
  if (!warnFile) {
    return [];
  }
  return readFileSync(path.join(warnDir, warnFile), 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
