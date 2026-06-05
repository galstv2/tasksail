import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger, flushLoggers, type Logger } from '../logger.js';
import { emitTaskProgressEvent, type TaskProgressEvent } from '../taskProgressEvents.js';
import { progressLogDecisionFor } from '../taskProgressEvents.logPolicy.js';

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

const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

let repoRoot: string;
let logDir: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'task-progress-log-policy-'));
  logDir = mkdtempSync(path.join(tmpdir(), 'task-progress-log-policy-logs-'));
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

describe('progressLogDecisionFor', () => {
  it('demotes only explicitly low-signal progress events', () => {
    expect(progressLogDecisionFor(artifactEvent('started'), infoProgress('agent.artifact_check.started')))
      .toEqual({ kind: 'debug' });
    expect(progressLogDecisionFor(artifactEvent('completed'), infoProgress('agent.artifact_check.completed')))
      .toEqual({ kind: 'debug' });
    expect(progressLogDecisionFor(policyEvent('started'), infoProgress('agent.policy_check.started')))
      .toEqual({ kind: 'debug' });
    expect(progressLogDecisionFor(policyEvent('completed'), infoProgress('agent.policy_check.completed')))
      .toEqual({ kind: 'debug' });
    expect(progressLogDecisionFor(guardrailAllowedEvent(), infoProgress('guardrail.receipt.allowed')))
      .toEqual({ kind: 'debug' });
    expect(progressLogDecisionFor(mcpCheckedEvent('available'), infoProgress('mcp.checked')))
      .toEqual({ kind: 'debug' });
    expect(progressLogDecisionFor(mcpCheckedEvent('not-applicable'), infoProgress('mcp.checked')))
      .toEqual({ kind: 'debug' });
    expect(progressLogDecisionFor(mcpCheckedEvent('not-run'), infoProgress('mcp.checked')))
      .toEqual({ kind: 'debug' });

    expect(progressLogDecisionFor(mcpCheckedEvent('unavailable'), infoProgress('mcp.checked')))
      .toEqual({ kind: 'progress', level: 'info' });
    expect(progressLogDecisionFor(artifactEvent('failed'), warnProgress('agent.artifact_check.failed')))
      .toEqual({ kind: 'progress', level: 'warn' });
    expect(progressLogDecisionFor({ type: 'pipeline.phase', input: { phase: 'qa', priorPhase: null } }, infoProgress('pipeline.phase')))
      .toEqual({ kind: 'progress', level: 'info' });
  });
});

describe('emitTaskProgressEvent log policy', () => {
  it('omits hidden artifact check successes from default info while preserving exact terminal payloads', async () => {
    const logger = agentLogger('task-artifact', 'ron');

    await emit('task-artifact', artifactEvent('started'), logger);
    await emit('task-artifact', artifactEvent('completed'), logger);

    expect(recordsWith({ msg: 'agent.artifact_check.started', level: 'info' })).toEqual([]);
    expect(recordsWith({ msg: 'agent.artifact_check.completed', level: 'info' })).toEqual([]);
    expect(readEvents('task-artifact')).toEqual([
      {
        eventId: 'agent.artifact_check.started:ron:cleanup:launch-artifact',
        source: 'runtime.agent',
        role: 'agent',
        severity: 'info',
        visible: false,
        message: 'Checking required agent artifacts.',
        createdAt: expect.stringMatching(CREATED_AT_PATTERN),
        actorName: 'Ron - QA (cleanup)',
        extra: { agentId: 'ron', launchId: 'launch-artifact', displayPhase: 'cleanup' },
      },
      {
        eventId: 'agent.artifact_check.completed:ron:cleanup:launch-artifact',
        source: 'runtime.agent',
        role: 'agent',
        severity: 'info',
        visible: false,
        message: 'Agent artifact check completed.',
        createdAt: expect.stringMatching(CREATED_AT_PATTERN),
        actorName: 'Ron - QA (cleanup)',
        extra: { agentId: 'ron', launchId: 'launch-artifact', displayPhase: 'cleanup' },
      },
    ]);
  });

  it('dedupes repeated artifact polling in terminal-events.json without default info records', async () => {
    const logger = agentLogger('task-polling', 'ron');

    await emit('task-polling', artifactEvent('started'), logger);
    await emit('task-polling', artifactEvent('started'), logger);
    await emit('task-polling', artifactEvent('started'), logger);

    expect(recordsWith({ msg: 'agent.artifact_check.started', level: 'info' })).toEqual([]);
    expect(recordsWith({ msg: 'agent.artifact_check.started' })).toEqual([]);
    expect(readEvents('task-polling')).toEqual([
      {
        eventId: 'agent.artifact_check.started:ron:cleanup:launch-artifact',
        source: 'runtime.agent',
        role: 'agent',
        severity: 'info',
        visible: false,
        message: 'Checking required agent artifacts.',
        createdAt: expect.stringMatching(CREATED_AT_PATTERN),
        actorName: 'Ron - QA (cleanup)',
        extra: { agentId: 'ron', launchId: 'launch-artifact', displayPhase: 'cleanup' },
      },
    ]);
  });

  it('preserves exact hidden terminal payloads for clean MCP and allowed guardrail events', async () => {
    const logger = agentLogger('task-system-hidden', 'alice');

    await emit('task-system-hidden', mcpCheckedEvent('available'), logger);
    await emit('task-system-hidden', guardrailAllowedEvent(), logger);

    expect(recordsWith({ msg: 'mcp.checked', level: 'info' })).toEqual([]);
    expect(recordsWith({ msg: 'guardrail.receipt.allowed', level: 'info' })).toEqual([]);
    expect(readEvents('task-system-hidden')).toEqual([
      {
        eventId: 'mcp.checked',
        source: 'runtime.mcp',
        role: 'system',
        severity: 'info',
        visible: false,
        message: 'MCP context checked.',
        createdAt: expect.stringMatching(CREATED_AT_PATTERN),
        extra: {
          agentId: 'alice',
          status: 'available',
          injectionEnabled: true,
          selectedServerCount: 1,
          excludedServerCount: 0,
        },
      },
      {
        eventId: 'guardrail.receipt.allowed:alice:initial:launch-guardrail',
        source: 'runtime.guardrail',
        role: 'system',
        severity: 'info',
        visible: false,
        message: 'Guardrail receipt allowed launch.',
        createdAt: expect.stringMatching(CREATED_AT_PATTERN),
        extra: {
          agentId: 'alice',
          launchId: 'launch-guardrail',
          displayPhase: 'initial',
        },
      },
    ]);
  });

  it('writes demoted agent-scoped progress as debug with global and agent-shard fanout when debug is enabled', async () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    flushLoggers();
    const logger = agentLogger('task-debug', 'ron');

    await emit('task-debug', artifactEvent('started'), logger);

    const globalDebug = readGlobalLevel('info').filter((record) =>
      record.level === 'debug' && record.msg === 'agent.artifact_check.started'
    );
    const shardDebug = readAgentShard('task-debug', 'ron').filter((record) =>
      record.level === 'debug' && record.msg === 'agent.artifact_check.started'
    );
    expect(globalDebug).toEqual([
      expect.objectContaining({
        level: 'debug',
        msg: 'agent.artifact_check.started',
        task_id: 'task-debug',
        agent_id: 'ron',
        extra: { agentId: 'ron', launchId: 'launch-artifact', displayPhase: 'cleanup' },
      }),
    ]);
    expect(shardDebug).toEqual([
      expect.objectContaining({
        level: 'debug',
        msg: 'agent.artifact_check.started',
        task_id: 'task-debug',
        agent_id: 'ron',
      }),
    ]);
  });

  it('demotes policy checks, clean MCP checks, and allowed guardrail receipts at default info and keeps debug forensics', async () => {
    const taskId = 'task-demotions';
    const logger = agentLogger(taskId, 'alice');
    const events = [
      policyEvent('started'),
      policyEvent('completed'),
      mcpCheckedEvent('available'),
      mcpCheckedEvent('not-applicable'),
      mcpCheckedEvent('not-run'),
      guardrailAllowedEvent(),
    ];

    for (const event of events) {
      await emit(taskId, event, logger);
    }

    expect(recordsWith({ level: 'info' }).map((record) => record.msg)).not.toEqual(expect.arrayContaining([
      'agent.policy_check.started',
      'agent.policy_check.completed',
      'mcp.checked',
      'guardrail.receipt.allowed',
    ]));
    expect(readEvents(taskId).map((event) => event.eventId)).toEqual([
      'agent.policy_check.started:alice:initial:launch-policy',
      'agent.policy_check.completed:alice:initial:launch-policy',
      'mcp.checked',
      'guardrail.receipt.allowed:alice:initial:launch-guardrail',
    ]);

    resetLogs('debug');
    for (const event of events) {
      await emit(taskId, event, logger);
    }

    const debugMessages = recordsWith({ level: 'debug' }).map((record) => record.msg);
    expect(debugMessages).toEqual(expect.arrayContaining([
      'agent.policy_check.started',
      'agent.policy_check.completed',
      'mcp.checked',
      'guardrail.receipt.allowed',
    ]));
  });

  it('keeps unavailable, degraded, failed, denied, malformed, and artifact-failed evidence elevated', async () => {
    const taskId = 'task-elevated';
    const logger = agentLogger(taskId, 'alice');

    await emit(taskId, mcpCheckedEvent('unavailable'), logger);
    await emit(taskId, mcpLifecycleEvent('mcp.degraded', 'degraded'), logger);
    await emit(taskId, mcpLifecycleEvent('mcp.failed', 'failed'), logger);
    await emit(taskId, artifactEvent('failed'), logger);
    await emit(taskId, guardrailReceiptEvent('guardrail.receipt.denied', 'denied'), logger);
    await emit(taskId, guardrailReceiptEvent('guardrail.receipt.malformed', 'failed'), logger);

    expect(recordsWith({ msg: 'mcp.checked', level: 'info' })).toHaveLength(1);
    expect(recordsWith({ msg: 'mcp.degraded', level: 'warn' })).toHaveLength(1);
    expect(recordsWith({ msg: 'mcp.failed', level: 'error' })).toHaveLength(1);
    expect(recordsWith({ msg: 'agent.artifact_check.failed', level: 'warn' })).toHaveLength(1);
    expect(recordsWith({ msg: 'guardrail.receipt.denied', level: 'error' })).toHaveLength(1);
    expect(recordsWith({ msg: 'guardrail.receipt.malformed', level: 'error' })).toHaveLength(1);
    expect(readEvents(taskId).map((event) => event.eventId)).toEqual([
      'mcp.checked',
      'mcp.degraded',
      'mcp.failed',
      'agent.artifact_check.failed:ron:cleanup:launch-artifact',
      'guardrail.receipt.denied:alice:initial:launch-guardrail',
      'guardrail.receipt.malformed:alice:initial:launch-guardrail',
    ]);
  });

  it('does not emit stderr progress lines for demoted hidden events but keeps protected milestones', async () => {
    vi.stubEnv('TASKSAIL_LOG_PROGRESS', 'plain');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = agentLogger('task-stderr', 'ron');

    await emit('task-stderr', artifactEvent('started'), logger);
    await emit('task-stderr', { type: 'pipeline.phase', input: { phase: 'qa', priorPhase: 'build' } }, logger);

    expect(stderrChunks(stderrWrite)).toEqual(['[pipeline] build -> qa\n']);
  });
});

async function emit(taskId: string, event: TaskProgressEvent, logger: Logger): Promise<void> {
  await emitTaskProgressEvent({ logger, repoRoot, taskId, event });
}

function agentLogger(taskId: string, agentId: string): Logger {
  return createLogger('platform/test').child({ taskId, agentId });
}

function resetLogs(level: 'debug' | 'info'): void {
  flushLoggers();
  rmSync(logDir, { recursive: true, force: true });
  vi.stubEnv('LOG_LEVEL', level);
}

function infoProgress(event: TaskProgressEvent['type']): { level: 'info'; event: TaskProgressEvent['type'] } {
  return { level: 'info', event };
}

function warnProgress(event: TaskProgressEvent['type']): { level: 'warn'; event: TaskProgressEvent['type'] } {
  return { level: 'warn', event };
}

function artifactEvent(status: 'started' | 'completed' | 'failed'): TaskProgressEvent {
  return {
    type: `agent.artifact_check.${status}`,
    input: { agentId: 'ron', launchId: 'launch-artifact', displayPhase: 'cleanup' },
  } as TaskProgressEvent;
}

function policyEvent(status: 'started' | 'completed'): TaskProgressEvent {
  return {
    type: `agent.policy_check.${status}`,
    input: { agentId: 'alice', launchId: 'launch-policy', displayPhase: 'initial' },
  } as TaskProgressEvent;
}

function mcpCheckedEvent(status: 'available' | 'not-applicable' | 'not-run' | 'unavailable'): TaskProgressEvent {
  return mcpLifecycleEvent('mcp.checked', status);
}

function mcpLifecycleEvent(
  type: 'mcp.checked' | 'mcp.degraded' | 'mcp.failed',
  status: 'available' | 'degraded' | 'failed' | 'not-applicable' | 'unavailable' | 'not-run',
): TaskProgressEvent {
  return {
    type,
    input: {
      agentId: 'alice',
      status,
      injectionEnabled: true,
      selectedServerCount: 1,
      excludedServerCount: 0,
    },
  } as TaskProgressEvent;
}

function guardrailAllowedEvent(): TaskProgressEvent {
  return guardrailReceiptEvent('guardrail.receipt.allowed');
}

function guardrailReceiptEvent(
  type:
    | 'guardrail.receipt.allowed'
    | 'guardrail.receipt.denied'
    | 'guardrail.receipt.malformed',
  terminationReason?: 'denied' | 'failed',
): TaskProgressEvent {
  return {
    type,
    input: {
      agentId: 'alice',
      launchId: 'launch-guardrail',
      displayPhase: 'initial',
      ...(terminationReason ? { terminationReason } : {}),
    },
  } as TaskProgressEvent;
}

function readEvents(taskId: string): Array<Record<string, unknown>> {
  const eventPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json');
  const parsed = JSON.parse(readFileSync(eventPath, 'utf8')) as { events: Array<Record<string, unknown>> };
  return parsed.events;
}

function recordsWith(criteria: { msg?: string; level?: string }): Array<Record<string, unknown>> {
  return readAllLogRecords().filter((record) =>
    (criteria.msg === undefined || record.msg === criteria.msg) &&
    (criteria.level === undefined || record.level === criteria.level)
  );
}

function readAllLogRecords(): Array<Record<string, unknown>> {
  return [
    ...readGlobalLevel('info'),
    ...readGlobalLevel('warn'),
    ...readGlobalLevel('error'),
  ];
}

function readGlobalLevel(level: 'info' | 'warn' | 'error'): Array<Record<string, unknown>> {
  return readJsonLinesUnder(path.join(logDir, level));
}

function readAgentShard(taskId: string, agentId: string): Array<Record<string, unknown>> {
  return readJsonLinesUnder(path.join(logDir, 'agent', taskId, `${agentId}.jsonl`));
}

function readJsonLinesUnder(target: string): Array<Record<string, unknown>> {
  if (!existsSync(target)) {
    return [];
  }
  if (statSync(target).isFile()) {
    return readFileSync(target, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
  const records: Array<Record<string, unknown>> = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      records.push(...readFileSync(entryPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>));
    }
  };
  visit(target);
  return records;
}

function stderrChunks(writeSpy: ReturnType<typeof vi.spyOn>): string[] {
  return writeSpy.mock.calls
    .map((call) => String(call[0]))
    .filter(Boolean);
}
