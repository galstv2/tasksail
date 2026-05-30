import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareExternalMcpLaunchContext: vi.fn(),
  renderMcpConfig: vi.fn(),
}));

vi.mock('../pythonHelpers.js', () => ({
  prepareExternalMcpLaunchContext: mocks.prepareExternalMcpLaunchContext,
}));

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: vi.fn(() => ({
    renderMcpConfig: mocks.renderMcpConfig,
    homeDirName: () => 'copilot-home',
  })),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn(),
}));

const { mergeExternalMcpLaunchEnvironment } = await import('../agentSession.js');
const { getPlatformConfig } = await import('../../platform-config/get.js');
const mockedGetPlatformConfig = vi.mocked(getPlatformConfig);

describe('mergeExternalMcpLaunchEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: local MCP disabled. Individual tests override as needed.
    mockedGetPlatformConfig.mockResolvedValue({ external_mcp_local_enabled: false } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a non-fatal warning and disables external MCP when provider rendering fails', async () => {
    mocks.prepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'available',
      },
      launchDir: '/repo/.platform-state/runtime/copilot-home/dalton-launch',
      contextFile: '/repo/.platform-state/runtime/copilot-home/dalton-launch/mcp-capability-summary.md',
      resolvedServers: [{
        id: 'docs',
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: {},
      }],
      selectedServerIds: ['docs'],
      excludedServerIds: [],
    });
    mocks.renderMcpConfig.mockImplementation(() => {
      throw new Error('render failed');
    });
    const agentEnv: Record<string, string> = {};
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await mergeExternalMcpLaunchEnvironment({
      agentId: 'dalton',
      repoRoot: '/repo',
      taskId: 't1',
      agentEnv,    });

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'external MCP config render failed: render failed',
      injectionEnabled: false,
      envExports: {},
      resolvedServers: [],
      selectedServerIds: ['docs'],
      excludedServerIds: [],
    });
    expect(agentEnv).toEqual({});
    const warnings = String(warnSpy.mock.calls.flat().join('\n'));
    expect(warnings).toContain('external_mcp.config_render.failed');
    expect(warnings).toContain('render failed');
  });

  it('reads the opt-in flag from platform config and passes it to the helper subprocess env only', async () => {
    mocks.prepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'not-applicable',
      reason: 'no external MCP servers apply to this agent',
      injectionEnabled: false,
      envExports: {},
      resolvedServers: [],
      selectedServerIds: [],
      excludedServerIds: [],
    });

    // Enabled → TASKSAIL_LOCAL_MCP_ENABLED='1', and the flag must not leak into agentEnv.
    mockedGetPlatformConfig.mockResolvedValue({ external_mcp_local_enabled: true } as never);
    const enabledEnv: Record<string, string> = { EXISTING: 'value' };
    await mergeExternalMcpLaunchEnvironment({ agentId: 'dalton', repoRoot: '/repo', taskId: 't1', agentEnv: enabledEnv });
    expect(mocks.prepareExternalMcpLaunchContext).toHaveBeenLastCalledWith(expect.objectContaining({
      env: expect.objectContaining({ EXISTING: 'value', TASKSAIL_LOCAL_MCP_ENABLED: '1' }),
    }));
    expect(enabledEnv['TASKSAIL_LOCAL_MCP_ENABLED']).toBeUndefined();

    // Disabled → ''.
    mockedGetPlatformConfig.mockResolvedValue({ external_mcp_local_enabled: false } as never);
    await mergeExternalMcpLaunchEnvironment({ agentId: 'dalton', repoRoot: '/repo', taskId: 't1', agentEnv: {} });
    expect(mocks.prepareExternalMcpLaunchContext).toHaveBeenLastCalledWith(expect.objectContaining({
      env: expect.objectContaining({ TASKSAIL_LOCAL_MCP_ENABLED: '' }),
    }));

    // Unreadable config → fail-closed ''.
    mockedGetPlatformConfig.mockRejectedValue(new Error('platform.json missing'));
    await mergeExternalMcpLaunchEnvironment({ agentId: 'dalton', repoRoot: '/repo', taskId: 't1', agentEnv: {} });
    expect(mocks.prepareExternalMcpLaunchContext).toHaveBeenLastCalledWith(expect.objectContaining({
      env: expect.objectContaining({ TASKSAIL_LOCAL_MCP_ENABLED: '' }),
    }));
  });

  it('renders internal repo-context MCP without external injection', async () => {
    mocks.prepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'not-applicable',
      reason: 'no external MCP servers apply to this agent',
      injectionEnabled: false,
      envExports: {
        EXTERNAL_MCP_CONTEXT_STATUS: 'not-applicable',
      },
      resolvedServers: [],
      selectedServerIds: [],
      excludedServerIds: [],
    });
    mocks.renderMcpConfig.mockReturnValue('/repo/.platform-state/runtime/copilot-home/dalton-1/mcp-config.json');
    const agentEnv: Record<string, string> = {};
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await mergeExternalMcpLaunchEnvironment({
      agentId: 'dalton',
      repoRoot: process.cwd(),
      taskId: 't1',
      agentEnv,      internalMcpServer: {
        id: 'repo-context-mcp',
        transport: 'sse',
        url: 'http://localhost:8811/sse',
        headers: {
          'X-TaskSail-Task-Id': 't1',
          'X-TaskSail-Context-Pack-Dir': '/workspace/context-pack',
        },
      },
    });

    expect(mocks.renderMcpConfig).toHaveBeenCalledWith(
      expect.stringContaining('/.platform-state/runtime/copilot-home/dalton-'),
      [{
        id: 'repo-context-mcp',
        transport: 'sse',
        url: 'http://localhost:8811/sse',
        headers: {
          'X-TaskSail-Task-Id': 't1',
          'X-TaskSail-Context-Pack-Dir': '/workspace/context-pack',
        },
      }],
    );
    expect(agentEnv).toEqual({});
    expect(result).toMatchObject({
      status: 'available',
      reason: 'internal repo-context MCP injected',
      injectionEnabled: true,
      configFilePath: '/repo/.platform-state/runtime/copilot-home/dalton-1/mcp-config.json',
    });
    expect(String(warnSpy.mock.calls.flat().join('\n'))).not.toContain('external_mcp.unavailable.internal_wired');
  });

  it('surfaces external MCP launch failure while rendering internal repo-context MCP', async () => {
    mocks.prepareExternalMcpLaunchContext.mockRejectedValue(new Error('mocked-python-error-XYZ'));
    mocks.renderMcpConfig.mockReturnValue('/repo/.platform-state/runtime/copilot-home/dalton-2/mcp-config.json');
    const agentEnv: Record<string, string> = {};
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await mergeExternalMcpLaunchEnvironment({
      agentId: 'dalton',
      repoRoot: process.cwd(),
      taskId: 't1',
      agentEnv,      internalMcpServer: {
        id: 'repo-context-mcp',
        transport: 'sse',
        url: 'http://localhost:8811/sse',
        headers: {
          'X-TaskSail-Task-Id': 't1',
          'X-TaskSail-Context-Pack-Dir': '/workspace/context-pack',
        },
      },
    });

    expect(result).toMatchObject({
      status: 'degraded',
      reason: expect.stringContaining('external MCP launch context failed: mocked-python-error-XYZ'),
      injectionEnabled: true,
      configFilePath: '/repo/.platform-state/runtime/copilot-home/dalton-2/mcp-config.json',
    });
    const warnings = String(warnSpy.mock.calls.flat().join('\n'));
    expect(warnings).toContain('external_mcp.unavailable.internal_wired');
    expect(warnings).toContain('mocked-python-error-XYZ');
  });

  it('fails closed when required internal MCP config rendering fails', async () => {
    mocks.prepareExternalMcpLaunchContext.mockResolvedValue({
      status: 'not-applicable',
      reason: 'no external MCP servers apply to this agent',
      injectionEnabled: false,
      envExports: {},
      resolvedServers: [],
      selectedServerIds: [],
      excludedServerIds: [],
    });
    mocks.renderMcpConfig.mockImplementation(() => {
      throw new Error('render failed');
    });

    await expect(mergeExternalMcpLaunchEnvironment({
      agentId: 'dalton',
      repoRoot: process.cwd(),
      taskId: 't1',
      agentEnv: {},      internalMcpServer: {
        id: 'repo-context-mcp',
        transport: 'sse',
        url: 'http://localhost:8811/sse',
        headers: {
          'X-TaskSail-Task-Id': 't1',
          'X-TaskSail-Context-Pack-Dir': '/workspace/context-pack',
        },
      },
    })).rejects.toThrow('internal MCP config render failed: render failed');
  });
});
