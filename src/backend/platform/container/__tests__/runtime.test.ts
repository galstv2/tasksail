import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRuntime } from '../runtime.js';
import { DockerRuntime } from '../docker.js';
import { PodmanRuntime } from '../podman.js';

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
    const { createRuntimeFromConfig, resolveContainerRuntime } =
      await importRuntimeWithResolveMock();
    resolveContainerRuntime.mockResolvedValue('podman');

    const runtime = await createRuntimeFromConfig('/repo');

    expect(resolveContainerRuntime).toHaveBeenCalledWith('/repo');
    expect(runtime.backend).toBe('podman');
  });

  it('uses the backend override without resolving config', async () => {
    const { createRuntimeFromConfig, resolveContainerRuntime } =
      await importRuntimeWithResolveMock();

    const runtime = await createRuntimeFromConfig('/repo', 'docker');

    expect(resolveContainerRuntime).not.toHaveBeenCalled();
    expect(runtime.backend).toBe('docker');
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
      config: {
        schema_version: 1,
        container_runtime: 'podman',
      },
    });

    const backend = await resolveContainerRuntime('/repo');

    expect(loadPlatformConfig).toHaveBeenCalledWith('/repo/.platform-state/platform.json');
    expect(backend).toBe('podman');
  });

  it('falls back to docker only when the runtime config is missing', async () => {
    const { resolveContainerRuntime, loadPlatformConfig } =
      await importResolveWithLoadMock();
    loadPlatformConfig.mockResolvedValue({
      valid: false,
      errors: [
        {
          field: '(file)',
          message: 'Platform config file not found: /repo/.platform-state/platform.json',
          fix: 'Run "pnpm run setup" to seed the runtime platform config.',
        },
      ],
    });

    await expect(resolveContainerRuntime('/repo')).resolves.toBe('docker');
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
    resolveContainerRuntime: vi.fn(),
  }));

  const runtimeModule = await import('../runtime.js');
  const resolveModule = await import('../../platform-config/resolve.js');

  return {
    createRuntimeFromConfig: runtimeModule.createRuntimeFromConfig,
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
