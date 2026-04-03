import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRuntime } from '../runtime.js';
import { DockerRuntime } from '../docker.js';
import { PodmanRuntime } from '../podman.js';

describe('createRuntime', () => {
  afterEach(() => {
    delete process.env['CONTAINER_RUNTIME'];
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
