import { describe, expect, it } from 'vitest';
import { buildTaskLaunchBaseEnv } from '../launchEnv.js';

const TASKSAIL_LAUNCH_CONTROLLED_ENV_KEYS = [
  'ACTIVE_CONTEXT_PACK_DIR',
  'ACTIVE_CONTEXT_PACK_HOST_DIR',
  'TASKSAIL_TASK_ID',
  'TASKSAIL_TASK_BRANCHES',
  'TASKSAIL_TASK_BRANCHES_FILE',
  'TASKSAIL_TASK_WORKTREES',
  'TASKSAIL_TASK_WORKTREES_FILE',
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
