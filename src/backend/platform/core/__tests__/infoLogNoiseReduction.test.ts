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
  repoRoot = mkdtempSync(path.join(tmpdir(), 'info-log-noise-proof-'));
  logDir = mkdtempSync(path.join(tmpdir(), 'info-log-noise-proof-logs-'));
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
});

describe('info log noise reduction proof', () => {
  it('keeps operator milestones at default info and moves hidden success noise to debug', async () => {
    await emitRepresentativeSequence('task-default');

    expect(readGlobalLevel('info').map((record) => record.msg)).toEqual([
      'queue.branch.created',
      'agent.launch.started',
      'agent.launch.terminal',
      'pipeline.completed',
    ]);
    expect(readGlobalLevel('warn').map((record) => record.msg)).toEqual([
      'agent.artifact_check.failed',
    ]);
    expect(noisyHiddenMessages(readGlobalLevel('info'))).toEqual([]);
    expect(readTerminalEventIds('task-default')).toEqual([
      'queue.branch.created:api:task/task-default:/tmp/worktree/api',
      'agent.launch.started:ron:cleanup:launch-main',
      'agent.launch.terminal:ron:cleanup:launch-main',
      'agent.artifact_check.started:ron:cleanup:launch-main',
      'agent.artifact_check.completed:ron:cleanup:launch-main',
      'agent.policy_check.started:ron:cleanup:launch-main',
      'agent.policy_check.completed:ron:cleanup:launch-main',
      'mcp.checked',
      'guardrail.receipt.allowed:ron:cleanup:launch-main',
      'agent.artifact_check.failed:ron:cleanup:launch-main',
      'pipeline.completed',
    ]);

    resetLogs('debug');
    await emitRepresentativeSequence('task-debug');

    const globalInfo = readGlobalLevel('info');
    const debugMessages = globalInfo
      .filter((record) => record.level === 'debug')
      .map((record) => record.msg);
    expect(globalInfo.filter((record) => record.level === 'info')).toHaveLength(4);
    expect(debugMessages).toEqual([
      'agent.artifact_check.started',
      'agent.artifact_check.started',
      'agent.artifact_check.completed',
      'agent.policy_check.started',
      'agent.policy_check.completed',
      'mcp.checked',
      'guardrail.receipt.allowed',
    ]);
    expect(readAgentShard('task-debug', 'ron').filter((record) => record.level === 'debug').map((record) => record.msg))
      .toEqual(debugMessages);
  });
});

async function emitRepresentativeSequence(taskId: string): Promise<void> {
  const taskLogger = createLogger('platform/test').child({ taskId });
  const agentLogger = createLogger('platform/test').child({ taskId, agentId: 'ron' });
  await emit(taskId, taskLogger, {
    type: 'queue.branch.created',
    input: {
      repo: 'api',
      branch: `task/${taskId}`,
      worktreeRoot: '/tmp/worktree/api',
      materializationStrategy: 'copy',
    },
  });
  await emit(taskId, agentLogger, {
    type: 'agent.launch.started',
    input: {
      agentId: 'ron',
      launchId: 'launch-main',
      displayPhase: 'cleanup',
      childPid: 4242,
      modelId: 'model-a',
    },
  });
  await emit(taskId, agentLogger, {
    type: 'agent.launch.terminal',
    input: {
      agentId: 'ron',
      launchId: 'launch-main',
      displayPhase: 'cleanup',
      childPid: 4242,
      status: 'success',
      durationMs: 1000,
      exitCode: 0,
    },
  });
  await emit(taskId, agentLogger, agentLifecycleEvent('agent.artifact_check.started'));
  await emit(taskId, agentLogger, agentLifecycleEvent('agent.artifact_check.started'));
  await emit(taskId, agentLogger, agentLifecycleEvent('agent.artifact_check.completed'));
  await emit(taskId, agentLogger, agentLifecycleEvent('agent.policy_check.started'));
  await emit(taskId, agentLogger, agentLifecycleEvent('agent.policy_check.completed'));
  await emit(taskId, agentLogger, {
    type: 'mcp.checked',
    input: {
      agentId: 'ron',
      status: 'available',
      injectionEnabled: true,
      selectedServerCount: 1,
      excludedServerCount: 0,
    },
  });
  await emit(taskId, agentLogger, {
    type: 'guardrail.receipt.allowed',
    input: { agentId: 'ron', launchId: 'launch-main', displayPhase: 'cleanup' },
  });
  await emit(taskId, agentLogger, agentLifecycleEvent('agent.artifact_check.failed'));
  await emit(taskId, taskLogger, { type: 'pipeline.completed' });
}

async function emit(taskId: string, logger: Logger, event: TaskProgressEvent): Promise<void> {
  await emitTaskProgressEvent({ logger, repoRoot, taskId, event });
}

function agentLifecycleEvent(
  type:
    | 'agent.artifact_check.started'
    | 'agent.artifact_check.completed'
    | 'agent.artifact_check.failed'
    | 'agent.policy_check.started'
    | 'agent.policy_check.completed',
): TaskProgressEvent {
  return {
    type,
    input: { agentId: 'ron', launchId: 'launch-main', displayPhase: 'cleanup' },
  } as TaskProgressEvent;
}

function resetLogs(level: 'debug' | 'info'): void {
  flushLoggers();
  rmSync(logDir, { recursive: true, force: true });
  vi.stubEnv('LOG_LEVEL', level);
}

function noisyHiddenMessages(records: Array<Record<string, unknown>>): string[] {
  const noisy = new Set([
    'agent.artifact_check.started',
    'agent.artifact_check.completed',
    'agent.policy_check.started',
    'agent.policy_check.completed',
    'mcp.checked',
    'guardrail.receipt.allowed',
  ]);
  return records
    .map((record) => String(record.msg))
    .filter((msg) => noisy.has(msg));
}

function readTerminalEventIds(taskId: string): string[] {
  const eventPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json');
  const parsed = JSON.parse(readFileSync(eventPath, 'utf8')) as { events: Array<{ eventId: string }> };
  return parsed.events.map((event) => event.eventId);
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
