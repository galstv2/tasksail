import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRuntime, createRuntimeFromConfig } from '../runtime.js';
import { DockerRuntime } from '../docker.js';
import { PodmanRuntime } from '../podman.js';
import { DirectRuntime } from '../directRuntime.js';
import type { ContainerBackend } from '../../core/index.js';
import type { PlatformConfig } from '../../platform-config/types.js';

function makeConfig(containerRuntime: ContainerBackend): PlatformConfig {
  return {
    schema_version: 1,
    container_runtime: containerRuntime,
    container_engine_host: 'auto',
    container_engine_wsl_distro: null,
    max_parallel_tasks: 10,
    retain_failed_task_worktrees: true,
    max_retained_failed_task_worktrees: 10,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    mcp_port_range: { min: 8811, max: 8820 },
  };
}

describe('createRuntime', () => {
  afterEach(() => {
    delete process.env['CONTAINER_RUNTIME'];
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('defaults to DockerRuntime when no env var is set', () => {
    delete process.env['CONTAINER_RUNTIME'];
    const runtime = createRuntime();
    expect(runtime).toBeInstanceOf(DockerRuntime);
    expect(runtime.backend).toBe('docker');
  });

  it('returns DockerRuntime when CONTAINER_RUNTIME=docker', () => {
    process.env['CONTAINER_RUNTIME'] = 'docker';
    const runtime = createRuntime();
    expect(runtime).toBeInstanceOf(DockerRuntime);
  });

  it('returns PodmanRuntime when CONTAINER_RUNTIME=podman', () => {
    process.env['CONTAINER_RUNTIME'] = 'podman';
    const runtime = createRuntime();
    expect(runtime).toBeInstanceOf(PodmanRuntime);
    expect(runtime.backend).toBe('podman');
  });

  it('accepts explicit backend parameter over env var', () => {
    process.env['CONTAINER_RUNTIME'] = 'docker';
    const runtime = createRuntime('podman');
    expect(runtime).toBeInstanceOf(PodmanRuntime);
  });

  it('throws on unsupported backend', () => {
    expect(() => createRuntime('lxc' as never)).toThrow('Unsupported container backend');
  });
});

describe('createRuntimeFromConfig', () => {
  afterEach(() => {
    delete process.env['CONTAINER_RUNTIME'];
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('creates the runtime resolved from platform config', async () => {
    const { createRuntimeFromConfig, resolveContainerEngineHost, resolveContainerRuntime } =
      await importRuntimeWithResolveMock();
    resolveContainerRuntime.mockResolvedValue('podman');
    resolveContainerEngineHost.mockResolvedValue({
      host: 'desktop-linux',
      wslDistro: null,
    });

    const runtime = await createRuntimeFromConfig('/repo');

    expect(resolveContainerEngineHost).toHaveBeenCalledWith('/repo');
    expect(resolveContainerRuntime).toHaveBeenCalledWith('/repo');
    expect(runtime.backend).toBe('podman');
    expect(runtime.engineHost).toBe('desktop-linux');
  });

  it('uses the backend override without overriding engine-host topology', async () => {
    const { createRuntimeFromConfig, resolveContainerEngineHost, resolveContainerRuntime } =
      await importRuntimeWithResolveMock();
    resolveContainerEngineHost.mockResolvedValue({
      host: 'wsl',
      wslDistro: 'Ubuntu',
    });

    const runtime = await createRuntimeFromConfig('/repo', 'docker');

    expect(resolveContainerEngineHost).toHaveBeenCalledWith('/repo');
    expect(resolveContainerRuntime).not.toHaveBeenCalled();
    expect(runtime.backend).toBe('docker');
    expect(runtime.engineHost).toBe('wsl');
    expect(runtime.wslDistro).toBe('Ubuntu');
  });

  it('propagates invalid config errors', async () => {
    const { createRuntimeFromConfig, resolveContainerRuntime } =
      await importRuntimeWithResolveMock();
    resolveContainerRuntime.mockRejectedValue(
      new Error('Invalid platform config at /repo/.platform-state/platform.json'),
    );

    await expect(createRuntimeFromConfig('/repo')).rejects.toThrow(
      'Invalid platform config',
    );
  });
});

describe('resolveContainerRuntime', () => {
  afterEach(() => {
    delete process.env['CONTAINER_RUNTIME'];
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('prefers the env override over the runtime config', async () => {
    const { resolveContainerRuntime, loadPlatformConfig } =
      await importResolveWithLoadMock();
    process.env['CONTAINER_RUNTIME'] = 'podman';

    const backend = await resolveContainerRuntime('/repo');

    expect(backend).toBe('podman');
    expect(loadPlatformConfig).not.toHaveBeenCalled();
  });

  it('uses the runtime config when no env override is present', async () => {
    const { resolveContainerRuntime, loadPlatformConfig } =
      await importResolveWithLoadMock();
    loadPlatformConfig.mockResolvedValue({
      valid: true,
      config: makeConfig('podman'),
      raw: '',
    });

    const backend = await resolveContainerRuntime('/repo');

    expect(loadPlatformConfig).toHaveBeenCalledWith('/repo/.platform-state/platform.json');
    expect(backend).toBe('podman');
  });

  it('falls back to config/platform.default.json when runtime config is missing', async () => {
    const { resolveContainerRuntime, loadPlatformConfig } =
      await importResolveWithLoadMock();
    loadPlatformConfig
      .mockResolvedValueOnce({
        valid: false,
        errors: [
          {
            field: '(file)',
            message: 'Platform config file not found: /repo/.platform-state/platform.json',
            fix: 'Run "pnpm run setup" to seed the runtime platform config.',
          },
        ],
      })
      .mockResolvedValueOnce({
        valid: true,
        config: makeConfig('podman'),
        raw: '',
      });

    await expect(resolveContainerRuntime('/repo')).resolves.toBe('podman');
    expect(loadPlatformConfig).toHaveBeenNthCalledWith(
      1,
      '/repo/.platform-state/platform.json',
    );
    expect(loadPlatformConfig).toHaveBeenNthCalledWith(
      2,
      '/repo/config/platform.default.json',
    );
  });

  it('fails closed when both runtime and default configs are missing', async () => {
    const { resolveContainerRuntime, loadPlatformConfig } =
      await importResolveWithLoadMock();
    const missingError = {
      valid: false as const,
      errors: [
        {
          field: '(file)',
          message: 'Platform config file not found',
          fix: 'Run "pnpm run setup" to seed the runtime platform config.',
        },
      ],
    };
    loadPlatformConfig
      .mockResolvedValueOnce(missingError)
      .mockResolvedValueOnce(missingError);

    await expect(resolveContainerRuntime('/repo')).rejects.toThrow(
      'Invalid platform config at /repo/config/platform.default.json',
    );
  });

  it('fails closed for invalid existing config', async () => {
    const { resolveContainerRuntime, loadPlatformConfig } =
      await importResolveWithLoadMock();
    loadPlatformConfig.mockResolvedValue({
      valid: false,
      errors: [
        {
          field: 'container_runtime',
          message: 'Must be "docker" or "podman", got "invalid".',
          fix: 'Set container_runtime to "docker" or "podman".',
        },
      ],
    });

    await expect(resolveContainerRuntime('/repo')).rejects.toThrow(
      'Invalid platform config at /repo/.platform-state/platform.json',
    );
  });
});

async function importRuntimeWithResolveMock() {
  vi.resetModules();
  vi.doUnmock('../../platform-config/load.js');
  vi.doMock('../../platform-config/resolve.js', () => ({
    resolveContainerEngineHost: vi.fn().mockResolvedValue({
      host: 'auto',
      wslDistro: null,
    }),
    resolveContainerRuntime: vi.fn(),
  }));

  const runtimeModule = await import('../runtime.js');
  const resolveModule = await import('../../platform-config/resolve.js');

  return {
    createRuntimeFromConfig: runtimeModule.createRuntimeFromConfig,
    resolveContainerEngineHost: vi.mocked(resolveModule.resolveContainerEngineHost),
    resolveContainerRuntime: vi.mocked(resolveModule.resolveContainerRuntime),
  };
}

async function importResolveWithLoadMock() {
  vi.resetModules();
  vi.doUnmock('../../platform-config/resolve.js');
  vi.doMock('../../platform-config/load.js', () => ({
    loadPlatformConfig: vi.fn(),
  }));

  const resolveModule = await import('../../platform-config/resolve.js');
  const loadModule = await import('../../platform-config/load.js');

  return {
    resolveContainerRuntime: resolveModule.resolveContainerRuntime,
    loadPlatformConfig: vi.mocked(loadModule.loadPlatformConfig),
  };
}

describe('direct runtime factory', () => {
  afterEach(() => {
    delete process.env['CONTAINER_RUNTIME'];
    vi.restoreAllMocks();
  });

  it('createRuntime constructs direct and ignores compose engine args', () => {
    const runtime = createRuntime('direct', 'wsl', 'Ubuntu');

    expect(runtime).toBeInstanceOf(DirectRuntime);
    expect(runtime.backend).toBe('direct');
    expect(runtime.engineHost).toBe('native');
    expect(runtime.wslDistro).toBeNull();
  });

  it('createRuntimeFromConfig resolves direct, docker, podman, and env overrides', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-factory-direct-'));
    try {
      const configPath = path.join(tmpDir, '.platform-state', 'platform.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ schema_version: 1, container_runtime: 'direct' }), 'utf-8');

      await expect(createRuntimeFromConfig(tmpDir)).resolves.toBeInstanceOf(DirectRuntime);
      await expect(createRuntimeFromConfig(tmpDir, 'docker')).resolves.toBeInstanceOf(DockerRuntime);
      await expect(createRuntimeFromConfig(tmpDir, 'podman')).resolves.toBeInstanceOf(PodmanRuntime);

      process.env['CONTAINER_RUNTIME'] = 'podman';
      await expect(createRuntimeFromConfig(tmpDir)).resolves.toBeInstanceOf(PodmanRuntime);
      process.env['CONTAINER_RUNTIME'] = 'direct';
      await expect(createRuntimeFromConfig(tmpDir)).resolves.toBeInstanceOf(DirectRuntime);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
