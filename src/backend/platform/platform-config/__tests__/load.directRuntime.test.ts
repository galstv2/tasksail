import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadPlatformConfig } from '../load.js';
import { resolveContainerRuntime } from '../resolve.js';
import { seedPlatformConfig } from '../seed.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-direct-'));
  delete process.env['CONTAINER_RUNTIME'];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['CONTAINER_RUNTIME'];
});

function writeConfig(relativePath: string, runtime: string): string {
  const configPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: 1,
    container_runtime: runtime,
  }), 'utf-8');
  return configPath;
}

describe('direct runtime platform config', () => {
  it('accepts direct, docker, and podman runtime values', async () => {
    for (const runtime of ['direct', 'docker', 'podman']) {
      const result = await loadPlatformConfig(writeConfig(`${runtime}.json`, runtime));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.container_runtime).toBe(runtime);
      }
    }
  });

  it('rejects unknown runtimes with all valid values in the fix text', async () => {
    const result = await loadPlatformConfig(writeConfig('bad.json', 'rkt'));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      const error = result.errors.find((item) => item.field === 'container_runtime');
      expect(error?.message).toContain('"docker", "podman", or "direct"');
      expect(error?.fix).toContain('"docker", "podman", or "direct"');
    }
  });

  it('resolves CONTAINER_RUNTIME=direct and ignores invalid env overrides', async () => {
    writeConfig('.platform-state/platform.json', 'podman');
    process.env['CONTAINER_RUNTIME'] = 'direct';
    await expect(resolveContainerRuntime(tmpDir)).resolves.toBe('direct');

    process.env['CONTAINER_RUNTIME'] = 'garbage';
    await expect(resolveContainerRuntime(tmpDir)).resolves.toBe('podman');
  });

  it('seedPlatformConfig round-trips direct without rewriting the runtime file', async () => {
    const defaultPath = path.join(tmpDir, 'config', 'platform.default.json');
    fs.mkdirSync(path.dirname(defaultPath), { recursive: true });
    const configRaw = JSON.stringify({
      schema_version: 1,
      cli_provider: 'copilot',
      container_runtime: 'direct',
      container_engine_host: 'auto',
      container_engine_wsl_distro: null,
      max_parallel_tasks: 10,
      retain_failed_task_worktrees: true,
      max_retained_failed_task_worktrees: 10,
      max_retry_generations_per_slug: 5,
      completed_task_runtime_retention_ms: 3600000,
      mcp_port: 8811,
      repo_context_mcp_external_mount_roots: [],
    }, null, 2);
    fs.writeFileSync(defaultPath, configRaw);
    const runtimePath = path.join(tmpDir, '.platform-state', 'platform.json');
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, configRaw);

    const before = fs.readFileSync(runtimePath, 'utf-8');
    const result = await seedPlatformConfig(tmpDir);
    const after = fs.readFileSync(runtimePath, 'utf-8');

    expect(result.action).toBe('up-to-date');
    expect(after).toBe(before);
  });
});
