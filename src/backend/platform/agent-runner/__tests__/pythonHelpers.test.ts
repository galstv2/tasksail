import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/index.js', () => ({
  runPython: vi.fn(),
  resolvePaths: vi.fn(),
  safeJsonParse: vi.fn(),
}));

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: vi.fn(() => ({
    homeDirName: () => 'copilot-home',
    agentConfigPaths: () => ({
      registry: '.github/agents/registry.json',
    }),
  })),
}));

import { resolvePaths, runPython, safeJsonParse } from '../../core/index.js';
import { captureCodeDiff, prepareExternalMcpLaunchContext } from '../pythonHelpers.js';

const mockedResolvePaths = vi.mocked(resolvePaths);
const mockedRunPython = vi.mocked(runPython);
const mockedSafeJsonParse = vi.mocked(safeJsonParse);

const TEST_TASK_ID = 'task-test-001';

describe('captureCodeDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolvePaths.mockReturnValue({
      repoRoot: '/repo',
    } as never);
    mockedRunPython.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
    mockedSafeJsonParse.mockImplementation((content: string) => JSON.parse(content));
  });

  it('passes task id as a named flag', async () => {
    await captureCodeDiff({
      outputPath: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    });

    expect(mockedRunPython).toHaveBeenCalledWith(
      '/repo/src/backend/scripts/python/run-role-agent-helper.py',
      [
        'capture-code-diff',
        '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
        '--repo-root',
        '/repo',
        '--task-id',
        TEST_TASK_ID,
      ],
      {
        cwd: '/repo',
        abortSignal: undefined,
      },
    );
  });

  it('uses the resolved repo root', async () => {
    await captureCodeDiff({
      outputPath: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    });

    expect(mockedRunPython).toHaveBeenCalledWith(
      '/repo/src/backend/scripts/python/run-role-agent-helper.py',
      [
        'capture-code-diff',
        '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
        '--repo-root',
        '/repo',
        '--task-id',
        TEST_TASK_ID,
      ],
      {
        cwd: '/repo',
        abortSignal: undefined,
      },
    );
  });
});

describe('prepareExternalMcpLaunchContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolvePaths.mockReturnValue({
      repoRoot: '/repo',
    } as never);
    mockedRunPython.mockResolvedValue({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });
  });

  it('parses exact camelCase external MCP launch context output', async () => {
    mockedSafeJsonParse.mockReturnValue({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'available',
        EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED: 'true',
      },
      launchDir: '/repo/.platform-state/runtime/copilot-home/software-engineer-1',
      contextFile: '/repo/.platform-state/runtime/copilot-home/software-engineer-1/mcp-capability-summary.md',
      resolvedServers: [{
        id: 'docs',
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer token' },
      }],
      selectedServerIds: ['docs'],
      excludedServerIds: [],
    });

    await expect(prepareExternalMcpLaunchContext({
      agentId: 'dalton',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    })).resolves.toEqual({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'available',
        EXTERNAL_MCP_CONTEXT_INJECTION_ENABLED: 'true',
      },
      launchDir: '/repo/.platform-state/runtime/copilot-home/software-engineer-1',
      contextFile: '/repo/.platform-state/runtime/copilot-home/software-engineer-1/mcp-capability-summary.md',
      resolvedServers: [{
        id: 'docs',
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer token' },
      }],
      selectedServerIds: ['docs'],
      excludedServerIds: [],
    });

    expect(mockedRunPython).toHaveBeenCalledWith(
      '/repo/src/backend/scripts/python/run-role-agent-helper.py',
      [
        'prepare-external-mcp-launch-context',
        'dalton',
        '--repo-root',
        '/repo',
      ],
      {
        cwd: '/repo',
        env: {
          TASKSAIL_CLI_HOME_DIR_NAME: 'copilot-home',
          TASKSAIL_AGENT_REGISTRY_PATH: '/repo/.github/agents/registry.json',
        },
        abortSignal: undefined,
      },
    );
  });

  it('parses a local resolved MCP server with command/args/env/cwd/tools', async () => {
    mockedSafeJsonParse.mockReturnValue({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      envExports: { EXTERNAL_MCP_CONTEXT_STATUS: 'available' },
      launchDir: '/repo/.platform-state/runtime/copilot-home/dalton-1',
      contextFile: '/repo/.platform-state/runtime/copilot-home/dalton-1/mcp-capability-summary.md',
      resolvedServers: [{
        id: 'local-fs',
        transport: 'local',
        command: 'npx',
        args: ['-y', '@scope/fs'],
        env: { API_KEY: 'sek' },
        cwd: '/abs/work',
        tools: ['read_file', 'list_dir'],
      }],
      selectedServerIds: ['local-fs'],
      excludedServerIds: [],
    });

    const result = await prepareExternalMcpLaunchContext({
      agentId: 'dalton',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    });
    expect(result.resolvedServers).toEqual([{
      id: 'local-fs',
      transport: 'local',
      command: 'npx',
      args: ['-y', '@scope/fs'],
      env: { API_KEY: 'sek' },
      cwd: '/abs/work',
      tools: ['read_file', 'list_dir'],
    }]);
    expect(result.injectionEnabled).toBe(true);
  });

  it('rejects a local resolved server missing its tools allowlist', async () => {
    mockedSafeJsonParse.mockReturnValue({
      status: 'available',
      reason: 'x',
      injectionEnabled: true,
      envExports: {},
      launchDir: '/repo/.platform-state/runtime/copilot-home/dalton-1',
      contextFile: '/repo/.platform-state/runtime/copilot-home/dalton-1/mcp-capability-summary.md',
      resolvedServers: [{
        id: 'local-bad',
        transport: 'local',
        command: 'npx',
        args: [],
        env: {},
      }],
      selectedServerIds: ['local-bad'],
      excludedServerIds: [],
    });

    await expect(prepareExternalMcpLaunchContext({
      agentId: 'dalton',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    })).rejects.toThrow(/resolvedServers/);
  });

  it('rejects snake_case launch context fallbacks', async () => {
    mockedSafeJsonParse.mockReturnValue({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injection_enabled: true,
      env_exports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'available',
      },
      launch_dir: '/repo/launch',
      resolved_servers: [],
      selected_server_ids: [],
      excluded_server_ids: [],
    });

    await expect(prepareExternalMcpLaunchContext({
      agentId: 'dalton',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    })).rejects.toThrow('injectionEnabled must be a boolean');
  });

  it('rejects provider-specific home variables in env exports', async () => {
    mockedSafeJsonParse.mockReturnValue({
      status: 'not-applicable',
      reason: 'no external MCP servers apply to this agent',
      injectionEnabled: false,
      envExports: {
        COPILOT_HOME: '/repo/launch',
      },
      resolvedServers: [],
      selectedServerIds: [],
      excludedServerIds: [],
    });

    await expect(prepareExternalMcpLaunchContext({
      agentId: 'dalton',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    })).rejects.toThrow('provider-specific home variables');
  });
});
