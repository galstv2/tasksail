import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_COMPOSE_FILE } from '../types.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('../../core/index.js', () => ({
  ensureEnvFile: vi.fn().mockResolvedValue(true),
}));

vi.mock('../compose.js', () => ({
  validateComposeConfig: vi.fn(),
  buildComposeCommand: vi.fn().mockReturnValue(['docker', 'compose', '-f', '/repo/docker/compose/docker-compose.yml', 'config']),
  execCommand: vi.fn().mockResolvedValue({ stdout: 'repo-context-mcp\n', stderr: '' }),
}));

vi.mock('../../mcp-registry/seed.js', () => ({
  seedMcpRegistry: vi.fn().mockResolvedValue({
    action: 'up-to-date',
    registry: {
      schema_version: 1,
      services: [
        {
          id: 'repo-context-mcp',
          displayName: 'Repository Context',
          kind: 'container-http',
          enabled: true,
          builtin: true,
          compose: { serviceName: 'repo-context-mcp' },
          health: { url: 'http://localhost:8811/health', maxRetries: 10, retryIntervalMs: 2000 },
        },
      ],
    },
  }),
}));

vi.mock('../../mcp-registry/healthSpecs.js', () => ({
  toServiceHealthSpecs: vi.fn().mockReturnValue([
    { name: 'repo-context-mcp', url: 'http://localhost:8811/health', maxRetries: 10, retryIntervalMs: 2000 },
  ]),
}));

vi.mock('../../mcp-registry/composeMetadata.js', () => ({
  getEnabledComposeServices: vi.fn().mockReturnValue([
    { id: 'repo-context-mcp', displayName: 'Repository Context', compose: { serviceName: 'repo-context-mcp' } },
  ]),
}));

const { bootstrapServices } = await import('../bootstrap.js');
const { ensureEnvFile } = await import('../../core/index.js');
const { validateComposeConfig, buildComposeCommand, execCommand } = await import('../compose.js');
const { seedMcpRegistry } = await import('../../mcp-registry/seed.js');
const { toServiceHealthSpecs } = await import('../../mcp-registry/healthSpecs.js');
const { getEnabledComposeServices } = await import('../../mcp-registry/composeMetadata.js');

describe('bootstrapServices', () => {
  const mockRuntime = {
    backend: 'docker' as const,
    composeUp: vi.fn().mockResolvedValue(undefined),
    composeDown: vi.fn().mockResolvedValue(undefined),
    healthcheck: vi.fn().mockResolvedValue([
      { service: 'repo-context-mcp', healthy: true, attempts: 1 },
    ]),
    bootstrap: vi.fn(),
    seedIndex: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildComposeCommand).mockReturnValue(['docker', 'compose', '-f', '/repo/docker/compose/docker-compose.yml', 'config']);
    vi.mocked(execCommand).mockResolvedValue({ stdout: 'repo-context-mcp\n', stderr: '' });
    vi.mocked(getEnabledComposeServices).mockReturnValue([
      { id: 'repo-context-mcp', displayName: 'Repository Context', compose: { serviceName: 'repo-context-mcp' } as never },
    ]);
    mockRuntime.composeUp.mockResolvedValue(undefined);
    mockRuntime.healthcheck.mockResolvedValue([
      { service: 'repo-context-mcp', healthy: true, attempts: 1 },
    ]);
    vi.mocked(ensureEnvFile).mockResolvedValue(true);
    vi.mocked(seedMcpRegistry).mockResolvedValue({
      action: 'up-to-date',
      registry: {
        schema_version: 1,
        services: [
          {
            id: 'repo-context-mcp',
            displayName: 'Repository Context',
            kind: 'container-http',
            enabled: true,
            builtin: true,
            compose: { serviceName: 'repo-context-mcp' } as never,
            health: { url: 'http://localhost:8811/health', maxRetries: 10, retryIntervalMs: 2000 },
          },
        ],
      },
    });
    vi.mocked(toServiceHealthSpecs).mockReturnValue([
      { name: 'repo-context-mcp', url: 'http://localhost:8811/health', maxRetries: 10, retryIntervalMs: 2000 },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws if compose file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await expect(
      bootstrapServices(mockRuntime, { repoRoot: '/repo' }),
    ).rejects.toThrow('Compose file not found');
  });

  it('calls ensureEnvFile and seedMcpRegistry in parallel', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo' });

    expect(ensureEnvFile).toHaveBeenCalledWith('/repo');
    expect(seedMcpRegistry).toHaveBeenCalledWith('/repo');
  });

  it('validates compose config before starting', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo' });

    const expectedFile = path.resolve('/repo', DEFAULT_COMPOSE_FILE);
    expect(validateComposeConfig).toHaveBeenCalledWith(expectedFile, 'docker');
  });

  it('starts services with composeUp', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo', build: true });

    expect(mockRuntime.composeUp).toHaveBeenCalledWith(
      expect.objectContaining({
        detach: true,
        build: true,
      }),
    );
  });

  it('throws if any health check fails', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mockRuntime.healthcheck.mockResolvedValueOnce([
      { service: 'repo-context-mcp', healthy: false, attempts: 10, error: 'timeout' },
    ]);

    await expect(
      bootstrapServices(mockRuntime, { repoRoot: '/repo' }),
    ).rejects.toThrow('Health check failed for: repo-context-mcp');
    expect(mockRuntime.composeDown).toHaveBeenCalledWith({
      composeFile: path.resolve('/repo', DEFAULT_COMPOSE_FILE),
    });
  });

  it('uses custom compose file when specified', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, {
      repoRoot: '/repo',
      composeFile: 'custom/compose.yml',
    });

    const expectedFile = path.resolve('/repo', 'custom/compose.yml');
    expect(validateComposeConfig).toHaveBeenCalledWith(expectedFile, 'docker');
  });

  it('throws with validation errors if seed fails', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(seedMcpRegistry).mockResolvedValueOnce({
      action: 'failed',
      errors: [{ field: 'schema_version', message: 'too high', fix: 'update tooling' }],
    });

    await expect(
      bootstrapServices(mockRuntime, { repoRoot: '/repo' }),
    ).rejects.toThrow('MCP registry validation failed');
  });

  it('passes registry-derived health specs to runtime.healthcheck', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo' });

    expect(toServiceHealthSpecs).toHaveBeenCalled();
    expect(mockRuntime.healthcheck).toHaveBeenCalledWith([
      { name: 'repo-context-mcp', url: 'http://localhost:8811/health', maxRetries: 10, retryIntervalMs: 2000 },
    ]);
  });

  it('fails closed when no enabled services are configured for health checks', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(toServiceHealthSpecs).mockReturnValueOnce([]);

    await expect(
      bootstrapServices(mockRuntime, { repoRoot: '/repo' }),
    ).rejects.toThrow(
      'No enabled container services are configured for bootstrap.',
    );

    expect(mockRuntime.composeUp).not.toHaveBeenCalled();
    expect(mockRuntime.healthcheck).not.toHaveBeenCalled();
  });
});
