import { describe, it, expect, vi, beforeEach } from 'vitest';

const createRuntimeFromConfigMock = vi.hoisted(() => vi.fn());
const ensureSharedMcpRunningMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
const createSharedMcpComposeBootstrapEnvMock = vi.hoisted(() => vi.fn());
const getPlatformConfigMock = vi.hoisted(() => vi.fn());

vi.mock('../../container/runtime.js', () => ({
  createRuntimeFromConfig: createRuntimeFromConfigMock,
}));

vi.mock('../../container/sharedMcp.js', () => ({
  ensureSharedMcpRunning: ensureSharedMcpRunningMock,
  sweepLegacyPortAllocationsOnce: vi.fn(),
  createSharedMcpComposeBootstrapEnv: createSharedMcpComposeBootstrapEnvMock,
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: getPlatformConfigMock,
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: existsSyncMock,
}));

const { startContainerServices } = await import('../setup.js');

describe('setup direct runtime service start', () => {
  beforeEach(() => {
    createRuntimeFromConfigMock.mockReset();
    ensureSharedMcpRunningMock.mockReset();
    existsSyncMock.mockReset();
    createSharedMcpComposeBootstrapEnvMock.mockReset();
    getPlatformConfigMock.mockReset();
    getPlatformConfigMock.mockResolvedValue({ mcp_port: 8811 });
    createSharedMcpComposeBootstrapEnvMock.mockResolvedValue({ REPO_CONTEXT_MCP_PORT: '8811' });
  });

  it('delegates direct runtime startup to ensureSharedMcpRunning', async () => {
    const composeUp = vi.fn();
    createRuntimeFromConfigMock.mockResolvedValue({
      backend: 'direct',
      requiresComposeFile: false,
      composeUp,
    });

    await expect(startContainerServices('/repo')).resolves.toBe('ok');

    expect(ensureSharedMcpRunningMock).toHaveBeenCalledWith('/repo');
    expect(composeUp).not.toHaveBeenCalled();
  });

  it('returns failed when direct startup rejects', async () => {
    createRuntimeFromConfigMock.mockResolvedValue({
      backend: 'direct',
      requiresComposeFile: false,
    });
    ensureSharedMcpRunningMock.mockRejectedValue(new Error('boom'));

    await expect(startContainerServices('/repo')).resolves.toBe('failed');
  });

  it('uses composeUp for compose runtimes when the compose file exists', async () => {
    const composeUp = vi.fn().mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);
    createRuntimeFromConfigMock.mockResolvedValue({
      backend: 'docker',
      requiresComposeFile: true,
      composeUp,
    });

    await expect(startContainerServices('/repo')).resolves.toBe('ok');

    expect(composeUp).toHaveBeenCalledWith({
      composeFile: '/repo/runtime/docker/compose/docker-compose.yml',
      detach: true,
      build: true,
      env: { REPO_CONTEXT_MCP_PORT: '8811' },
    });
  });

  it('passes merged compose env (repo .env base-image override) into composeUp', async () => {
    const composeUp = vi.fn().mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);
    createRuntimeFromConfigMock.mockResolvedValue({
      backend: 'docker',
      requiresComposeFile: true,
      composeUp,
    });
    createSharedMcpComposeBootstrapEnvMock.mockResolvedValue({
      REPO_CONTEXT_MCP_PORT: '8811',
      TASKSAIL_PYTHON_BASE_IMAGE: 'registry.example.internal/python:3.12-alpine',
    });

    await expect(startContainerServices('/repo')).resolves.toBe('ok');

    // Same merged-env construction as bootstrap, scoped to this repoRoot.
    expect(createSharedMcpComposeBootstrapEnvMock).toHaveBeenCalledWith(8811, '/repo');
    expect(composeUp).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          TASKSAIL_PYTHON_BASE_IMAGE: 'registry.example.internal/python:3.12-alpine',
        }),
      }),
    );
  });

  it('skips compose runtime startup when the compose file is missing', async () => {
    existsSyncMock.mockReturnValue(false);
    createRuntimeFromConfigMock.mockResolvedValue({
      backend: 'docker',
      requiresComposeFile: true,
      composeUp: vi.fn(),
    });

    await expect(startContainerServices('/repo')).resolves.toBe('skipped');
  });
});
