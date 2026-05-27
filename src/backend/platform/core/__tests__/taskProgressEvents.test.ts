import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger, flushLoggers } from '../logger.js';
import { emitTaskProgressEvent } from '../taskProgressEvents.js';

const LOG_ENV_KEYS = [
  'LOG_LEVEL',
  'LOG_FORMAT',
  'LOG_DIR',
  'TASKSAIL_LOG_MAX_BYTES',
  'TASKSAIL_LOG_RETENTION_DAYS',
  'TASKSAIL_LOG_PROGRESS',
] as const;

let repoRoot: string;
let logDir: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'task-progress-events-'));
  logDir = mkdtempSync(path.join(tmpdir(), 'task-progress-events-logs-'));
  for (const key of LOG_ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv('LOG_DIR', logDir);
  vi.stubEnv('TASKSAIL_LOG_PROGRESS', '');
  flushLoggers();
});

afterEach(() => {
  flushLoggers();
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('emitTaskProgressEvent', () => {
  it('writes backend progress and terminal events for representative lifecycle events', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-1' });

    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-1',
      event: {
        type: 'queue.branch.created',
        input: {
          repo: 'api',
          branch: 'task/task-1',
          worktreeRoot: '/tmp/worktree/api',
          materializationStrategy: 'copy',
        },
      },
    });
    await emitTaskProgressEvent({
      logger: logger.child({ agentId: 'dalton', providerId: 'copilot' }),
      repoRoot,
      taskId: 'task-1',
      event: {
        type: 'agent.launch.started',
        input: {
          agentId: 'dalton',
          providerId: 'copilot',
          launchId: 'launch-1',
          childPid: 42,
          modelId: 'model-a',
        },
      },
    });
    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-1',
      event: { type: 'pipeline.phase', input: { phase: 'qa', priorPhase: 'build' } },
    });
    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-1',
      event: {
        type: 'pipeline.dalton_mode.selected',
        input: { mode: 'complex', reason: 'parallel-ok-complex' },
      },
    });
    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-1',
      event: {
        type: 'closeout.target_branch_update',
        input: {
          repoLabel: 'api',
          targetRepoRoot: '/repos/api',
          sourceBranch: 'task/task-1',
          targetBranch: 'main',
          status: 'applied',
          detail: 'Applied task branch patch to the target index.',
        },
      },
    });
    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-1',
      event: { type: 'auto_merge.skipped_child_chain' },
    });
    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-1',
      event: {
        type: 'child_chain_failure_branch.branch_delete_skipped',
        input: {
          taskId: 'task-1',
          repoRoot: '/repo',
          branch: 'task/task-1',
          worktreeRoot: '/worktree',
          reason: 'chain-owned',
          retainFailedWorktree: true,
        },
      },
    });

    expect(readLogMessages()).toEqual(expect.arrayContaining([
      'queue.branch.created',
      'agent.launch.started',
      'pipeline.phase',
      'pipeline.dalton_mode.selected',
      'closeout.target_branch_update',
      'auto_merge.skipped_child_chain',
      'child_chain_failure_branch.branch_delete_skipped',
    ]));
    expect(readEvents('task-1')).toMatchObject([
      {
        eventId: 'queue.branch.created:api:task/task-1:/tmp/worktree/api',
        source: 'runtime.branch',
        role: 'pipeline',
        severity: 'info',
        message: 'Created writable task branch worktree for api on branch task/task-1.',
        extra: {
          repo: 'api',
          branch: 'task/task-1',
          worktreeRoot: '/tmp/worktree/api',
          materializationStrategy: 'copy',
        },
      },
      {
        eventId: 'agent.launch.started:dalton:initial:launch-1',
        source: 'runtime.agent',
        role: 'agent',
        severity: 'info',
        message: 'Started Dalton - SWE.',
        extra: {
          agentId: 'dalton',
          launchId: 'launch-1',
          childPid: 42,
          modelId: 'model-a',
        },
      },
      {
        eventId: 'pipeline.phase:build->qa',
        extra: { phase: 'qa', priorPhase: 'build' },
      },
      {
        eventId: 'pipeline.dalton_mode.selected',
        message: 'Dalton mode selected: complex.',
        extra: { mode: 'complex', reason: 'parallel-ok-complex' },
      },
      {
        eventId: 'closeout.target_branch_update:api:task/task-1:applied:main',
        message: 'Code changes from task branch task/task-1 were successfully staged on target branch main in target repo api at /repos/api.',
        extra: {
          repoLabel: 'api',
          targetRepoRoot: '/repos/api',
          sourceBranch: 'task/task-1',
          targetBranch: 'main',
          status: 'applied',
        },
      },
      {
        eventId: 'auto_merge.skipped_child_chain',
        message: 'Auto-merge skipped for child task chain: chain branches are manually integrated by the operator.',
      },
      {
        eventId: 'child_chain_failure_branch.branch_delete_skipped',
        extra: {
          taskId: 'task-1',
          repoRoot: '/repo',
          branch: 'task/task-1',
          worktreeRoot: '/worktree',
          reason: 'chain-owned',
          retainFailedWorktree: true,
        },
      },
    ]);
  });

  it('maps terminal-only task state and activation events to both surfaces', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-2' });
    const events = [
      { type: 'archive.started' as const },
      { type: 'archive.completed' as const },
      { type: 'archive.failed' as const },
      { type: 'queue.task.completed' as const },
      { type: 'queue.task.failed' as const },
      {
        type: 'activation.blocked.dirty-repos' as const,
        input: { taskTitle: 'Fix task', repoLabels: ['api'], repoRoots: ['/repo/api'] },
      },
      {
        type: 'activation.returned-open.branch-conflict' as const,
        input: {
          conflictingTaskId: 'task-active',
          repoLabel: 'api',
          repoRoot: '/repo/api',
          branch: 'task/conflict',
          openItemPath: '/open/task-2.md',
        },
      },
    ];

    for (const event of events) {
      await emitTaskProgressEvent({ logger, repoRoot, taskId: 'task-2', event });
    }

    expect(readLogMessages()).toEqual(expect.arrayContaining(events.map((event) => event.type)));
    expect(readEvents('task-2').map((event) => event.eventId)).toEqual([
      'archive.started',
      'archive.completed',
      'archive.failed',
      'queue.task.completed',
      'queue.task.failed',
      'activation.blocked.dirty-repos',
      'activation.returned-open.branch-conflict:task/conflict:task-active',
    ]);
  });

  it('maps agent terminal success and failure severities', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-agent' });

    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-agent',
      event: {
        type: 'agent.launch.terminal',
        input: {
          agentId: 'alice',
          launchId: 'success',
          childPid: 1,
          status: 'success',
          durationMs: 1000,
          exitCode: 0,
        },
      },
    });
    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-agent',
      event: {
        type: 'agent.launch.terminal',
        input: {
          agentId: 'alice',
          launchId: 'failure',
          childPid: 2,
          status: 'failure',
          durationMs: 2000,
          exitCode: 1,
        },
      },
    });

    expect(readEvents('task-agent')).toMatchObject([
      { eventId: 'agent.launch.terminal:alice:initial:success', severity: 'success' },
      { eventId: 'agent.launch.terminal:alice:initial:failure', severity: 'error' },
    ]);
  });

  it('keeps artifact incomplete checks hidden and non-error', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-artifacts' });

    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-artifacts',
      event: {
        type: 'agent.artifact_check.failed',
        input: { agentId: 'ron', launchId: 'launch-cleanup', displayPhase: 'cleanup' },
      },
    });

    expect(readLogRecords().find((record) => record.msg === 'agent.artifact_check.failed')).toMatchObject({
      level: 'warn',
    });
    expect(readEvents('task-artifacts')).toMatchObject([
      {
        eventId: 'agent.artifact_check.failed:ron:cleanup:launch-cleanup',
        role: 'agent',
        severity: 'warning',
        visible: false,
        actorName: 'Ron - QA (cleanup)',
      },
    ]);
  });

  it('adds agent identity to visible lifecycle events', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-cleanup' });

    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-cleanup',
      event: {
        type: 'agent.cleanup.started',
        input: { agentId: 'ron', launchId: 'launch-cleanup', displayPhase: 'cleanup' },
      },
    });

    expect(readEvents('task-cleanup')).toMatchObject([
      {
        eventId: 'agent.cleanup.started:ron:cleanup:launch-cleanup',
        role: 'agent',
        visible: true,
        actorName: 'Ron - QA (cleanup)',
        message: 'Agent cleanup started.',
      },
    ]);
  });

  it('writes read-only support context and pipeline completion terminal events', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-terminal-new-events' });

    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-terminal-new-events',
      event: {
        type: 'activation.readonly_context.materialized',
        input: {
          repo: 'tools',
          worktreeRoot: '/tmp/worktree/tools',
          materializationStrategy: 'detached-readonly-context',
        },
      },
    });
    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-terminal-new-events',
      event: { type: 'pipeline.completed' },
    });

    expect(readLogMessages()).toEqual(expect.arrayContaining([
      'activation.readonly_context.materialized',
      'pipeline.completed',
    ]));
    expect(readEvents('task-terminal-new-events')).toMatchObject([
      {
        eventId: 'activation.readonly_context.materialized:tools:/tmp/worktree/tools',
        source: 'runtime.queue',
        role: 'queue',
        severity: 'info',
        visible: true,
        message: 'Read-only support context materialized for tools; no target branch was created.',
        extra: {
          repo: 'tools',
          worktreeRoot: '/tmp/worktree/tools',
          materializationStrategy: 'detached-readonly-context',
        },
      },
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

  it('renders QA remediation cycle messages with cycle numbers and distinct event IDs', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-remediation-cycles' });

    for (const event of [
      { type: 'qa_remediation.cycle_started' as const, input: { cycle: 1 } },
      { type: 'qa_remediation.cycle_started' as const, input: { cycle: 2 } },
      { type: 'qa_remediation.cycle_completed' as const, input: { cycle: 1 } },
      { type: 'qa_remediation.cycle_completed' as const, input: { cycle: 2 } },
      { type: 'qa_remediation.exhausted' as const, input: { cycle: 2 } },
      { type: 'qa_remediation.completed' as const },
    ]) {
      await emitTaskProgressEvent({ logger, repoRoot, taskId: 'task-remediation-cycles', event });
    }

    expect(readEvents('task-remediation-cycles')).toMatchObject([
      {
        eventId: 'qa_remediation.cycle_started:1',
        message: 'QA remediation cycle 1 started.',
      },
      {
        eventId: 'qa_remediation.cycle_started:2',
        message: 'QA remediation cycle 2 started.',
      },
      {
        eventId: 'qa_remediation.cycle_completed:1',
        message: 'QA remediation cycle 1 completed.',
      },
      {
        eventId: 'qa_remediation.cycle_completed:2',
        message: 'QA remediation cycle 2 completed.',
      },
      {
        eventId: 'qa_remediation.exhausted:2',
        message: 'QA remediation exhausted after 2 cycle(s).',
      },
      {
        eventId: 'qa_remediation.completed',
        message: 'QA remediation completed.',
      },
    ]);
    expect(readLogRecords().map((record) => record.extra)).toEqual(expect.arrayContaining([
      expect.objectContaining({ cycle: 1 }),
      expect.objectContaining({ cycle: 2 }),
    ]));
  });

  it('does not add agent identity to system guardrail receipt events', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-guardrail' });

    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-guardrail',
      event: {
        type: 'guardrail.receipt.artifact_incomplete',
        input: {
          agentId: 'ron',
          launchId: 'launch-guardrail',
          displayPhase: 'initial',
          terminationReason: 'artifact-incomplete',
        },
      },
    });

    expect(readEvents('task-guardrail')).toMatchObject([
      {
        eventId: 'guardrail.receipt.artifact_incomplete:ron:initial:launch-guardrail',
        role: 'system',
        severity: 'error',
        visible: true,
        message: 'Guardrail receipt reported incomplete artifacts.',
      },
    ]);
    expect(readEvents('task-guardrail')[0]).not.toHaveProperty('actorName');
  });

  it('maps reasoning effort pre-spawn rejection to visible pipeline error output', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-effort' });

    await emitTaskProgressEvent({
      logger,
      repoRoot,
      taskId: 'task-effort',
      event: {
        type: 'pipeline.agent_reasoning_effort.rejected_before_spawn',
        input: {
          agentId: 'dalton',
          modelId: 'gpt-5.4',
          effort: 'ultra',
          reason: 'unsupported-by-cli',
        },
      },
    });

    expect(readEvents('task-effort')).toMatchObject([
      {
        eventId: 'pipeline.agent_reasoning_effort.rejected_before_spawn:task-effort:dalton:ultra',
        source: 'runtime.pipeline',
        role: 'pipeline',
        severity: 'error',
        visible: true,
        message: 'Agent dalton cannot launch model gpt-5.4 with reasoning effort ultra. Update Agent Configuration to None or a Copilot-advertised effort before relaunching the task.',
        extra: {
          agentId: 'dalton',
          modelId: 'gpt-5.4',
          effort: 'ultra',
          reason: 'unsupported-by-cli',
        },
      },
    ]);
    expect(readLogRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        msg: 'pipeline.agent_reasoning_effort.rejected_before_spawn',
        level: 'error',
        extra: expect.objectContaining({
          agentId: 'dalton',
          modelId: 'gpt-5.4',
          effort: 'ultra',
          reason: 'unsupported-by-cli',
        }),
      }),
    ]));
  });

  it('keeps terminal write failures non-fatal after backend progress writes', async () => {
    const fileRoot = path.join(repoRoot, 'not-a-dir');
    writeFileSync(fileRoot, 'blocking-file');
    const logger = createLogger('platform/test').child({ taskId: 'task-failure' });

    await expect(emitTaskProgressEvent({
      logger,
      repoRoot: fileRoot,
      taskId: 'task-failure',
      event: { type: 'queue.task.failed' },
    })).resolves.toBeUndefined();

    expect(readLogMessages()).toContain('queue.task.failed');
    expect(readLogMessages()).toContain('runtime_terminal_event.write.failed');
  });

  it('preserves terminal event order for sequential awaited helper calls', async () => {
    const logger = createLogger('platform/test').child({ taskId: 'task-order' });

    await emitTaskProgressEvent({ logger, repoRoot, taskId: 'task-order', event: { type: 'archive.started' } });
    await emitTaskProgressEvent({ logger, repoRoot, taskId: 'task-order', event: { type: 'archive.completed' } });

    expect(readEvents('task-order').map((event) => event.eventId)).toEqual([
      'archive.started',
      'archive.completed',
    ]);
  });
});

describe('task progress structural guards', () => {
  it('rejects direct terminal-owned Logger.progress events outside the helper', () => {
    const terminalOwned = [
      'queue.branch.created',
      'activation.readonly_context.materialized',
      'queue.active.activated',
      'agent.launch.started',
      'agent.launch.terminal',
      'queue.active.skipped',
      'pipeline.phase',
      'pipeline.agent_reasoning_effort.rejected_before_spawn',
      'dalton_verification.launching',
      'closeout_remediation.launching',
      'archive.started',
      'archive.completed',
      'archive.failed',
      'pipeline.completed',
      'queue.task.completed',
      'queue.task.failed',
      'queue.error_items.moved',
      'auto_merge.disabled',
      'auto_merge.applied',
      'auto_merge.skipped',
      'auto_merge.skipped_child_chain',
      'closeout.target_branch_update',
      'closeout.finalized',
      'closeout.stranded.resumed',
      'activation.blocked.dirty-repos',
      'activation.returned-open.branch-conflict',
      'child_chain_failure_branch.rollback_preflight_failed',
      'child_chain_failure_branch.rollback_completed',
      'child_chain_failure_branch.rollback_failed',
      'child_chain_failure_branch.branch_delete_skipped',
    ];
    const allowed = new Set([
      'src/backend/platform/core/taskProgressEvents.ts',
      'src/backend/platform/core/logger.ts',
    ]);

    const failures = productionFiles()
      .filter((file) => !allowed.has(file))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        const directTerminalOwnedFailures = terminalOwned
          .filter((event) => event !== 'queue.active.skipped')
          .filter((event) => source.includes(`event: '${event}'`) || source.includes(`event: "${event}"`))
          .map((event) => `${file}: ${event}`);
        const activeSkippedFailures = [...source.matchAll(/event:\s*['"]queue\.active\.skipped['"]/g)]
          .filter((match) => !isAllowedGlobalActiveSkipped(file, source, match.index ?? 0))
          .map(() => `${file}: queue.active.skipped`);
        return [...directTerminalOwnedFailures, ...activeSkippedFailures];
      });

    expect(failures).toEqual([]);
  });

  it('rejects direct production RuntimeTerminalEvents.forTask outside helper and storage', () => {
    const allowed = new Set([
      'src/backend/platform/core/taskProgressEvents.ts',
      'src/backend/platform/core/runtimeTerminalEvents.ts',
    ]);
    const failures = productionFiles()
      .filter((file) => !allowed.has(file))
      .filter((file) => readFileSync(file, 'utf8').includes('RuntimeTerminalEvents.forTask('));

    expect(failures).toEqual([]);
  });

  it('keeps logger-only progress events legal', () => {
    const source = readFileSync('src/backend/platform/queue/operations.ts', 'utf8');

    expect(source).toContain("event: 'queue.pending.promoted'");
    expect(source).toContain("event: 'queue.active.skipped'");
    expect(readFileSync('src/backend/platform/agent-runner/pipelineSupervisor.ts', 'utf8'))
      .toContain("event: 'startup_recovery.branch_delete.skipped_child_chain'");
  });
});

function isAllowedGlobalActiveSkipped(file: string, source: string, index: number): boolean {
  const context = source.slice(Math.max(0, index - 500), Math.min(source.length, index + 500));
  return file === 'src/backend/platform/queue/operations.ts'
    && context.includes('concurrency-cap-reached')
    && context.includes('log.progress');
}

function readEvents(taskId: string): Array<Record<string, unknown>> {
  const eventPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json');
  const parsed = JSON.parse(readFileSync(eventPath, 'utf8')) as { events: Array<Record<string, unknown>> };
  return parsed.events;
}

function readLogMessages(): string[] {
  return readLogRecords().map((record) => String(record.msg));
}

function readLogRecords(): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const visit = (dir: string): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of execFileSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)) {
      if (!statSync(entry).isFile()) {
        continue;
      }
      for (const line of readFileSync(entry, 'utf8').split('\n').filter(Boolean)) {
        records.push(JSON.parse(line) as Record<string, unknown>);
      }
    }
  };
  visit(logDir);
  return records;
}

function productionFiles(): string[] {
  return execFileSync('rg', ['--files', 'src/backend/platform', '-g', '*.ts'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.includes('/__tests__/'));
}
