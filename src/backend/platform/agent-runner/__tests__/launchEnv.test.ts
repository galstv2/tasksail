import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTaskLaunchBaseEnv } from '../launchEnv.js';

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
    // DUAL-LAYER: spawn call site scrubs stale keys from parent process env
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

const TASKSAIL_LAUNCH_CONTROLLED_ENV_KEYS = [
  'ACTIVE_CONTEXT_PACK_DIR',
  'ACTIVE_CONTEXT_PACK_HOST_DIR',
  'TASKSAIL_TASK_ID',
  'TASKSAIL_TASK_BRANCHES',
  'TASKSAIL_TASK_BRANCHES_FILE',
  'TASKSAIL_TASK_WORKTREES',
  'TASKSAIL_TASK_WORKTREES_FILE',
  'TASKSAIL_SLICE_ARTIFACT_FORMAT',
  'RUN_ROLE_AGENT_ACTIVE_MODEL',
  'RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS',
  'RUN_ROLE_AGENT_ORCHESTRATOR_ID',
  'RUN_ROLE_AGENT_AUTONOMY_PROFILE_ID',
  'RUN_ROLE_AGENT_AUTONOMY_LABEL',
  'RUN_ROLE_AGENT_AUTONOMY_DESCRIPTION',
  'RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_KIND',
  'RUN_ROLE_AGENT_AUTONOMY_ALLOW_ALL_TOOLS',
  'RUN_ROLE_AGENT_AUTONOMY_NO_ASK_USER',
  'RUN_ROLE_AGENT_AUTONOMY_ALLOW_TOOLS_JSON',
  'RUN_ROLE_AGENT_AUTONOMY_DENY_TOOLS_JSON',
  'RUN_ROLE_AGENT_AUTONOMY_ALLOWED_DIRS_JSON',
  'RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR',
  'RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS',
  'RUN_ROLE_AGENT_AUTONOMY_DISALLOW_TEMP_DIR',
  'RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON',
  'REPO_CONTEXT_MCP_URL',
  'REPO_CONTEXT_MCP_PORT',
  'EXTERNAL_MCP_CONTEXT_STATUS',
  'EXTERNAL_MCP_CONTEXT_REASON',
  'EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED',
  'EXTERNAL_MCP_CONTEXT_FILE',
] as const;

const PROVIDER_CONTROLLED_ENV_KEYS = [
  'PROVIDER_MODEL',
  'PROVIDER_AGENT_ID',
  'PROVIDER_HANDOFFS_DIR',
  'PROVIDER_PRIMARY_FOCUS_PATH',
] as const;

describe('buildTaskLaunchBaseEnv', () => {
  it('preserves normal parent env and unknown operator/provider settings', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/operator',
      NODE_ENV: 'test',
      PYTHON_BIN: '/venv/bin/python',
      FAKE_AUTH_TOKEN: 'token-value',
      PROVIDER_OPERATOR_SETTING: 'keep',
      TASKSAIL_CLI_PROVIDER: 'test-provider',
      TASKSAIL_CLI_HOME_DIR_NAME: 'test-provider-home',
      TASKSAIL_AGENT_REGISTRY_PATH: '/repo/.github/agents/registry.json',
      REPO_CONTEXT_MCP_AUTH_TOKEN: 'auth-token',
      REPO_CONTEXT_MCP_AUTH_HEADER: 'Authorization',
      REPO_CONTEXT_MCP_HOST: '127.0.0.1',
      REPO_CONTEXT_MCP_MAX_REQUEST_BYTES: '1024',
      REPO_CONTEXT_MCP_SOCKET_TIMEOUT: '30',
    };

    expect(buildTaskLaunchBaseEnv(baseEnv)).toEqual(baseEnv);
  });

  it('scrubs only exact TaskSail launch-controlled keys', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      KEEP_ME: 'yes',
      PROVIDER_MODEL_EXTRA: 'not-scrubbed',
    };
    for (const key of TASKSAIL_LAUNCH_CONTROLLED_ENV_KEYS) {
      baseEnv[key] = 'stale';
    }
    for (const key of PROVIDER_CONTROLLED_ENV_KEYS) {
      baseEnv[key] = 'stale';
    }

    const env = buildTaskLaunchBaseEnv(baseEnv, PROVIDER_CONTROLLED_ENV_KEYS);

    for (const key of TASKSAIL_LAUNCH_CONTROLLED_ENV_KEYS) {
      expect(env).not.toHaveProperty(key);
    }
    for (const key of PROVIDER_CONTROLLED_ENV_KEYS) {
      expect(env).not.toHaveProperty(key);
    }
    expect(env['KEEP_ME']).toBe('yes');
    expect(env['PROVIDER_MODEL_EXTRA']).toBe('not-scrubbed');
  });

  it('omits undefined values without mutating the source env', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      UNDEFINED_VALUE: undefined,
      TASKSAIL_TASK_ID: 'stale',
    };

    const env = buildTaskLaunchBaseEnv(baseEnv);

    expect(env).toEqual({ PATH: '/usr/bin' });
    expect(baseEnv).toHaveProperty('TASKSAIL_TASK_ID', 'stale');
    expect(baseEnv).toHaveProperty('UNDEFINED_VALUE', undefined);
  });

  it('scrubs TASKSAIL_SLICE_ARTIFACT_FORMAT from inherited operator shell', () => {
    const env = buildTaskLaunchBaseEnv({
      PATH: '/usr/bin',
      TASKSAIL_SLICE_ARTIFACT_FORMAT: 'xml',
    });
    expect(env).not.toHaveProperty('TASKSAIL_SLICE_ARTIFACT_FORMAT');
    expect(env['PATH']).toBe('/usr/bin');
  });

  it('allows explicit per-launch overlays after scrubbing', () => {
    const env = {
      ...buildTaskLaunchBaseEnv({
        PROVIDER_PRIMARY_FOCUS_PATH: 'stale',
        PATH: '/usr/bin',
      }, PROVIDER_CONTROLLED_ENV_KEYS),
      PROVIDER_PRIMARY_FOCUS_PATH: 'fresh',
    };

    expect(env).toEqual({
      PATH: '/usr/bin',
      PROVIDER_PRIMARY_FOCUS_PATH: 'fresh',
    });
  });
});
