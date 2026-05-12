import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const resolveCommandMock = vi.hoisted(() => vi.fn(() => 'provider-cli'));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: vi.fn(() => ({
    resolveCommand: resolveCommandMock,
    controlledEnvKeys: () => ['PROVIDER_MODEL', 'PROVIDER_HANDOFFS_DIR'],
  })),
}));

class FakeChild extends EventEmitter {
  pid = 1234;
  killed = false;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
}

function withParentEnv(
  values: Record<string, string>,
  fn: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = values[key];
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function latestSpawnOptions(): {
  cwd?: string;
  env: Record<string, string>;
  stdio: string[];
} {
  return spawnMock.mock.calls.at(-1)?.[2];
}

describe('launchAgent env contract', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('scrubs stale TaskSail launch metadata from parent env while preserving normal env', async () => {
    const { launchAgent } = await import('../processLifecycle.js');
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    withParentEnv({
      PATH: '/usr/bin',
      HOME: '/home/operator',
      NODE_ENV: 'test',
      FAKE_AUTH_TOKEN: 'token-value',
      PROVIDER_HANDOFFS_DIR: '/stale/handoffs',
      ACTIVE_CONTEXT_PACK_DIR: '/stale',
      TASKSAIL_TASK_BRANCHES: 'stale-branches',
      TASKSAIL_TASK_WORKTREES: 'stale-worktrees',
      RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS: 'true',
      RUN_ROLE_AGENT_ORCHESTRATOR_ID: 'stale-orchestrator',
      RUN_ROLE_AGENT_ACTIVE_MODEL: 'stale-model',
      REPO_CONTEXT_MCP_URL: 'http://stale.example',
      REPO_CONTEXT_MCP_PORT: '9999',
      EXTERNAL_MCP_CONTEXT_STATUS: 'stale',
    }, () => {
      launchAgent(['run', '--agent-id', 'software-engineer'], {
        repoRoot: '/repo',
        cwd: '/repo/worktree',
      });
    });

    expect(spawnMock).toHaveBeenCalledWith('provider-cli', ['run', '--agent-id', 'software-engineer'], {
      cwd: '/repo/worktree',
      env: expect.any(Object),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(resolveCommandMock).toHaveBeenCalled();

    const env = latestSpawnOptions().env;
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['HOME']).toBe('/home/operator');
    expect(env['NODE_ENV']).toBe('test');
    expect(env['FAKE_AUTH_TOKEN']).toBe('token-value');
    expect(env).not.toHaveProperty('PROVIDER_HANDOFFS_DIR');
    expect(env).not.toHaveProperty('ACTIVE_CONTEXT_PACK_DIR');
    expect(env).not.toHaveProperty('TASKSAIL_TASK_BRANCHES');
    expect(env).not.toHaveProperty('TASKSAIL_TASK_WORKTREES');
    expect(env).not.toHaveProperty('RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS');
    expect(env).not.toHaveProperty('RUN_ROLE_AGENT_ORCHESTRATOR_ID');
    expect(env).not.toHaveProperty('RUN_ROLE_AGENT_ACTIVE_MODEL');
    expect(env).not.toHaveProperty('REPO_CONTEXT_MCP_URL');
    expect(env).not.toHaveProperty('REPO_CONTEXT_MCP_PORT');
    expect(env).not.toHaveProperty('EXTERNAL_MCP_CONTEXT_STATUS');

    child.emit('close', 0);
  });

  it('lets explicit launch env override scrubbed parent keys', async () => {
    const { launchAgent } = await import('../processLifecycle.js');
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    withParentEnv({
      PROVIDER_HANDOFFS_DIR: '/stale/handoffs',
      ACTIVE_CONTEXT_PACK_DIR: '/stale',
      TASKSAIL_TASK_ID: 'stale-task',
      REPO_CONTEXT_MCP_URL: 'http://stale.example',
      EXTERNAL_MCP_CONTEXT_STATUS: 'stale',
    }, () => {
      launchAgent(['run'], {
        repoRoot: '/repo',
        cwd: '/repo',
        env: {
          PROVIDER_HANDOFFS_DIR: '/fresh/handoffs',
          ACTIVE_CONTEXT_PACK_DIR: '/fresh/context-pack',
          TASKSAIL_TASK_ID: 'task-abc',
          REPO_CONTEXT_MCP_URL: 'http://fresh.example',
          EXTERNAL_MCP_CONTEXT_STATUS: 'enabled',
        },
      });
    });

    expect(latestSpawnOptions().env).toMatchObject({
      PROVIDER_HANDOFFS_DIR: '/fresh/handoffs',
      ACTIVE_CONTEXT_PACK_DIR: '/fresh/context-pack',
      TASKSAIL_TASK_ID: 'task-abc',
      REPO_CONTEXT_MCP_URL: 'http://fresh.example',
      EXTERNAL_MCP_CONTEXT_STATUS: 'enabled',
    });

    child.emit('close', 0);
  });
});
