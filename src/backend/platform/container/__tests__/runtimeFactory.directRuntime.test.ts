import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DockerRuntime } from '../docker.js';
import { PodmanRuntime } from '../podman.js';
import { DirectRuntime } from '../directRuntime.js';
import { createRuntime, createRuntimeFromConfig } from '../runtime.js';

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
