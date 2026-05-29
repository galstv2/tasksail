import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveDefaultComposeFile } from '../types.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('../../core/index.js', () => ({
  ensureEnvFile: vi.fn().mockResolvedValue(true),
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    progress: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../agent-extensions/index.js', () => ({
  reconcileAgentExtensions: vi.fn().mockResolvedValue({ materialized: 0, repaired: 0, unavailable: 0 }),
  recoverAgentExtensionStagesOnStartup: vi.fn().mockResolvedValue({ removedStageCount: 0, skippedEntryCount: 0 }),
}));

vi.mock('../compose.js', () => ({
  validateComposeConfig: vi.fn(),
  buildComposeCommand: vi.fn().mockReturnValue(['docker', 'compose', '-f', '/repo/runtime/docker/compose/docker-compose.yml', 'config']),
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

vi.mock('../../platform-config/seed.js', () => ({
  seedPlatformConfig: vi.fn().mockResolvedValue({
    action: 'up-to-date',
    config: {
      schema_version: 1,
      container_runtime: 'docker',
      container_engine_host: 'auto',
      container_engine_wsl_distro: null,
      max_parallel_tasks: 10,
      retain_failed_task_worktrees: true,
      max_retained_failed_task_worktrees: 10,
      max_retry_generations_per_slug: 5,
      completed_task_runtime_retention_ms: 3600000,
      mcp_port: 8811,
      repo_context_mcp_external_mount_roots: [],
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
const { seedPlatformConfig } = await import('../../platform-config/seed.js');
const { toServiceHealthSpecs } = await import('../../mcp-registry/healthSpecs.js');
const { getEnabledComposeServices } = await import('../../mcp-registry/composeMetadata.js');
const { reconcileAgentExtensions, recoverAgentExtensionStagesOnStartup } = await import('../../agent-extensions/index.js');

describe('bootstrapServices', () => {
  const mockRuntime = {
    backend: 'docker' as const,
    engineHost: 'auto' as const,
    wslDistro: null,
    requiresComposeFile: true as const,
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
    vi.mocked(reconcileAgentExtensions).mockResolvedValue({ materialized: 0, repaired: 0, unavailable: 0 });
    vi.mocked(recoverAgentExtensionStagesOnStartup).mockResolvedValue({ removedStageCount: 0, skippedEntryCount: 0 });
    vi.mocked(buildComposeCommand).mockReturnValue(['docker', 'compose', '-f', '/repo/runtime/docker/compose/docker-compose.yml', 'config']);
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
    vi.mocked(seedPlatformConfig).mockResolvedValue({
      action: 'up-to-date',
      config: {
        schema_version: 1,
        container_runtime: 'docker',
        container_engine_host: 'auto',
        container_engine_wsl_distro: null,
        max_parallel_tasks: 10,
        retain_failed_task_worktrees: true,
        max_retained_failed_task_worktrees: 10,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port: 8811,
        repo_context_mcp_external_mount_roots: [],
      },
    });
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

  it('calls ensureEnvFile, seedMcpRegistry, and seedPlatformConfig in parallel', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo' });

    expect(ensureEnvFile).toHaveBeenCalledWith('/repo');
    expect(seedMcpRegistry).toHaveBeenCalledWith('/repo');
    expect(seedPlatformConfig).toHaveBeenCalledWith('/repo');
  });

  it('throws with validation errors if platform config seed fails', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(seedPlatformConfig).mockResolvedValueOnce({
      action: 'failed',
      errors: [{ field: 'container_runtime', message: 'Must be docker or podman', fix: 'Fix the value.' }],
    });

    await expect(
      bootstrapServices(mockRuntime, { repoRoot: '/repo' }),
    ).rejects.toThrow('Platform config validation failed');
  });

  it('validates compose config before starting', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo' });

    const expectedFile = path.resolve('/repo', resolveDefaultComposeFile('docker'));
    expect(validateComposeConfig).toHaveBeenCalledWith('docker', {
      composeFile: expectedFile,
      composeFiles: [expectedFile],
      env: undefined,
      engineHost: 'auto',
      wslDistro: null,
    });
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

  it('passes shared compose env through validation and compose up without changing health specs from env', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const env = {
      ...process.env,
      REPO_CONTEXT_MCP_PORT: '8817',
    };

    await bootstrapServices(mockRuntime, { repoRoot: '/repo', env });

    const expectedFile = path.resolve('/repo', resolveDefaultComposeFile('docker'));
    expect(validateComposeConfig).toHaveBeenCalledWith('docker', {
      composeFile: expectedFile,
      composeFiles: [expectedFile],
      env,
      engineHost: 'auto',
      wslDistro: null,
    });
    expect(mockRuntime.composeUp).toHaveBeenCalledWith(expect.objectContaining({ env }));
    expect(mockRuntime.healthcheck).toHaveBeenCalledWith([
      { name: 'repo-context-mcp', url: 'http://localhost:8811/health', maxRetries: 10, retryIntervalMs: 2000 },
    ]);
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
      composeFile: path.resolve('/repo', resolveDefaultComposeFile('docker')),
      composeFiles: [path.resolve('/repo', resolveDefaultComposeFile('docker'))],
      env: undefined,
      engineHost: 'auto',
      wslDistro: null,
    });
  });

  it('uses custom compose file when specified', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, {
      repoRoot: '/repo',
      composeFile: 'custom/compose.yml',
    });

    const expectedFile = path.resolve('/repo', 'custom/compose.yml');
    expect(validateComposeConfig).toHaveBeenCalledWith('docker', {
      composeFile: expectedFile,
      composeFiles: [expectedFile],
      env: undefined,
      engineHost: 'auto',
      wslDistro: null,
    });
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

  it('uses the podman compose file for podman runtimes by default', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const podmanRuntime = {
      ...mockRuntime,
      backend: 'podman' as const,
    };

    await bootstrapServices(podmanRuntime, { repoRoot: '/repo' });

    expect(validateComposeConfig).toHaveBeenCalledWith('podman', {
      composeFile: path.resolve('/repo', resolveDefaultComposeFile('podman')),
      composeFiles: [path.resolve('/repo', resolveDefaultComposeFile('podman'))],
      env: undefined,
      engineHost: 'auto',
      wslDistro: null,
    });
    expect(podmanRuntime.composeUp).toHaveBeenCalledWith({
      composeFile: path.resolve('/repo', resolveDefaultComposeFile('podman')),
      composeFiles: [path.resolve('/repo', resolveDefaultComposeFile('podman'))],
      detach: true,
      build: undefined,
      env: undefined,
      engineHost: 'auto',
      wslDistro: null,
    });
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

  it('calls reconcileAgentExtensions once during bootstrap', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo' });

    expect(reconcileAgentExtensions).toHaveBeenCalledOnce();
    expect(reconcileAgentExtensions).toHaveBeenCalledWith('/repo');
  });

  it('does not block bootstrap when reconcileAgentExtensions throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(reconcileAgentExtensions).mockRejectedValueOnce(
      new Error('unexpected reconcile failure'),
    );

    // Bootstrap must succeed even if reconcile throws
    await expect(bootstrapServices(mockRuntime, { repoRoot: '/repo' })).resolves.toBeUndefined();
    expect(mockRuntime.composeUp).toHaveBeenCalled();
  });

  it('calls recoverAgentExtensionStagesOnStartup once during bootstrap', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo' });

    expect(recoverAgentExtensionStagesOnStartup).toHaveBeenCalledOnce();
    expect(recoverAgentExtensionStagesOnStartup).toHaveBeenCalledWith('/repo');
  });

  it('does not block bootstrap when stage recovery throws (failure logs and continues)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(recoverAgentExtensionStagesOnStartup).mockRejectedValueOnce(
      new Error('unexpected stage recovery failure'),
    );

    await expect(bootstrapServices(mockRuntime, { repoRoot: '/repo' })).resolves.toBeUndefined();
    expect(mockRuntime.composeUp).toHaveBeenCalled();
  });

  it('keeps existing seed behavior (ensureEnvFile, seedMcpRegistry, seedPlatformConfig all called)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await bootstrapServices(mockRuntime, { repoRoot: '/repo' });

    expect(ensureEnvFile).toHaveBeenCalledWith('/repo');
    expect(seedMcpRegistry).toHaveBeenCalledWith('/repo');
    expect(seedPlatformConfig).toHaveBeenCalledWith('/repo');
  });
});
