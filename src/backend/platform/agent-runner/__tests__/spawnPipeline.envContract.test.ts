import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const forkMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  fork: forkMock,
}));

class FakeForkedChild extends EventEmitter {
  pid = 4321;
  stdout = new PassThrough();
  stderr = new PassThrough();
}

function withParentEnv(
  values: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = values[key];
  }

  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function latestForkOptions(): {
  cwd: string;
  env: Record<string, string>;
  execArgv: string[];
  stdio: string[];
} {
  return forkMock.mock.calls.at(-1)?.[2];
}

describe('spawnPipelineForTask env contract', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('scrubs stale parent launch metadata before applying explicit pipeline env', async () => {
    const { spawnPipelineForTask } = await import('../spawnPipeline.js');
    const child = new FakeForkedChild();
    forkMock.mockReturnValue(child);

    await withParentEnv({
      PATH: '/usr/bin',
      HOME: '/home/operator',
      NODE_ENV: 'test',
      FAKE_AUTH_TOKEN: 'token-value',
      ACTIVE_CONTEXT_PACK_DIR: '/stale',
      COPILOT_PRIMARY_FOCUS_PATH: 'stale-focus',
      COPILOT_PRIMARY_FOCUS_TARGETS_JSON: 'stale-targets',
      TASKSAIL_TASK_BRANCHES: 'stale-branches',
      TASKSAIL_TASK_WORKTREES: 'stale-worktrees',
      RUN_ROLE_AGENT_ACTIVE_MODEL: 'stale-model',
      REPO_CONTEXT_MCP_URL: 'http://stale.example',
      REPO_CONTEXT_MCP_PORT: '9999',
      EXTERNAL_MCP_CONTEXT_STATUS: 'stale',
    }, async () => {
      const result = await spawnPipelineForTask({
        taskId: 'task-abc',
        repoRoot: '/repo',
      });
      expect(result.pid).toBe(4321);
    });

    const [entryFile, argv] = forkMock.mock.calls.at(-1)!;
    expect(typeof entryFile).toBe('string');
    expect(argv).toEqual(['--task-id', 'task-abc', '--repo-root', '/repo']);

    const options = latestForkOptions();
    expect(options.cwd).toBe('/repo');
    expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe', 'ipc']);
    expect(Array.isArray(options.execArgv)).toBe(true);

    expect(options.env['PATH']).toBe('/usr/bin');
    expect(options.env['HOME']).toBe('/home/operator');
    expect(options.env['NODE_ENV']).toBe('test');
    expect(options.env['FAKE_AUTH_TOKEN']).toBe('token-value');
    expect(options.env['TASKSAIL_TASK_ID']).toBe('task-abc');
    expect(options.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS']).toBe('true');
    expect(options.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID']).toBe('pipeline-sequencer');
    expect(options.env).not.toHaveProperty('ACTIVE_CONTEXT_PACK_DIR');
    expect(options.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_PATH');
    expect(options.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGETS_JSON');
    expect(options.env).not.toHaveProperty('TASKSAIL_TASK_BRANCHES');
    expect(options.env).not.toHaveProperty('TASKSAIL_TASK_WORKTREES');
    expect(options.env).not.toHaveProperty('RUN_ROLE_AGENT_ACTIVE_MODEL');
    expect(options.env).not.toHaveProperty('REPO_CONTEXT_MCP_URL');
    expect(options.env).not.toHaveProperty('REPO_CONTEXT_MCP_PORT');
    expect(options.env).not.toHaveProperty('EXTERNAL_MCP_CONTEXT_STATUS');

    child.emit('exit', 0);
  });
});
