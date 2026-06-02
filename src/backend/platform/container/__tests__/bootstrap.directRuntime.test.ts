import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ContainerRuntime, ServiceHealthSpec } from '../types.js';

const existsSyncMock = vi.hoisted(() => vi.fn());
const validateComposeConfigMock = vi.hoisted(() => vi.fn());
const execCommandMock = vi.hoisted(() => vi.fn());
const seedMcpRegistryMock = vi.hoisted(() => vi.fn());
const seedPlatformConfigMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: existsSyncMock,
}));

vi.mock('../compose.js', () => ({
  buildComposeCommand: vi.fn(() => ['docker', 'compose', 'config']),
  execCommand: execCommandMock,
  validateComposeConfig: validateComposeConfigMock,
}));

vi.mock('../../core/index.js', () => ({
  ensureEnvFile: vi.fn().mockResolvedValue(undefined),
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    progress: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../mcp-registry/seed.js', () => ({
  seedMcpRegistry: seedMcpRegistryMock,
}));

vi.mock('../../mcp-registry/healthSpecs.js', () => ({
  toServiceHealthSpecs: vi.fn(() => [{ name: 'repo-context-mcp', url: 'http://localhost:8811/health' }]),
}));

vi.mock('../../mcp-registry/composeMetadata.js', () => ({
  getEnabledComposeServices: vi.fn(() => [{ compose: { serviceName: 'repo-context-mcp' } }]),
}));

vi.mock('../../platform-config/seed.js', () => ({
  seedPlatformConfig: seedPlatformConfigMock,
}));

const { bootstrapServices } = await import('../bootstrap.js');

function makeRuntime(requiresComposeFile: boolean): ContainerRuntime {
  return {
    backend: requiresComposeFile ? 'docker' : 'direct',
    engineHost: 'native',
    wslDistro: null,
    requiresComposeFile,
    composeUp: vi.fn(),
    composeDown: vi.fn(),
    healthcheck: vi.fn<ContainerRuntime['healthcheck']>().mockResolvedValue([
      { service: 'repo-context-mcp', healthy: true, attempts: 1 },
    ]),
    bootstrap: vi.fn(),
    seedIndex: vi.fn(),
  };
}

describe('bootstrap direct runtime gating', () => {
  beforeEach(() => {
    existsSyncMock.mockReset().mockReturnValue(true);
    validateComposeConfigMock.mockReset().mockResolvedValue(undefined);
    execCommandMock.mockReset().mockResolvedValue({ stdout: 'repo-context-mcp\n', stderr: '', exitCode: 0 });
    seedMcpRegistryMock.mockReset().mockResolvedValue({ action: 'exists', registry: {} });
    seedPlatformConfigMock.mockReset().mockResolvedValue({ action: 'exists', config: { mcp_port: 8811 } });
  });

  it('skips compose-file checks and validation for direct runtime', async () => {
    const runtime = makeRuntime(false);

    await bootstrapServices(runtime, { repoRoot: '/repo', env: { TASKSAIL_REPO_ROOT: '/repo' } });

    expect(existsSyncMock).not.toHaveBeenCalledWith(expect.stringContaining('runtime/docker/compose'));
    expect(existsSyncMock).not.toHaveBeenCalledWith(expect.stringContaining('runtime/podman/compose'));
    expect(execCommandMock).not.toHaveBeenCalled();
    expect(validateComposeConfigMock).not.toHaveBeenCalled();
    expect(runtime.composeUp).toHaveBeenCalledWith(expect.objectContaining({
      composeFile: undefined,
      composeFiles: undefined,
      detach: true,
    }));
  });

  it('keeps compose validation for compose runtimes', async () => {
    const runtime = makeRuntime(true);

    await bootstrapServices(runtime, { repoRoot: '/repo' });

    expect(existsSyncMock).toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalled();
    expect(validateComposeConfigMock).toHaveBeenCalled();
  });
});
