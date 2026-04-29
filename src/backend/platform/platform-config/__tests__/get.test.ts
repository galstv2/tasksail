import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  getPlatformConfig,
  _clearPlatformConfigCache,
  _getReadCount,
  _ENV_SNAPSHOT_KEYS,
} from '../get.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from '../types.js';

let tmpDir: string;

const FULL_CONFIG = {
  schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
  cli_provider: 'copilot',
  container_runtime: 'podman',
  max_parallel_tasks: 10,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  mcp_port: 8811,
  repo_context_mcp_external_mount_roots: [],
};

function writeRuntimeConfig(dir: string, content: object): void {
  const runtimeDir = path.join(dir, '.platform-state');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'platform.json'), JSON.stringify(content), 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-config-get-'));
  _clearPlatformConfigCache();
  delete process.env['TASKSAIL_MAX_PARALLEL_TASKS'];
  delete process.env['CONTAINER_RUNTIME'];
  delete process.env['TASKSAIL_CLI_PROVIDER'];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  _clearPlatformConfigCache();
  delete process.env['TASKSAIL_MAX_PARALLEL_TASKS'];
  delete process.env['CONTAINER_RUNTIME'];
  delete process.env['TASKSAIL_CLI_PROVIDER'];
});

describe('getPlatformConfig', () => {
  it('returns the parsed config for a valid runtime file', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);
    const config = await getPlatformConfig(tmpDir);
    expect(config.schema_version).toBe(1);
    expect(config.cli_provider).toBe('copilot');
    expect(config.container_runtime).toBe('podman');
    expect(config.max_parallel_tasks).toBe(10);
    expect(config.mcp_port).toBe(8811);
    expect(config.repo_context_mcp_external_mount_roots).toEqual([]);
  });

  it('hits cache on second call (file read count = 1)', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);

    await getPlatformConfig(tmpDir);
    const countAfterFirst = _getReadCount();

    await getPlatformConfig(tmpDir);
    const countAfterSecond = _getReadCount();

    // Cache hit: no additional loadPlatformConfig call on second invocation
    expect(countAfterFirst).toBe(1);
    expect(countAfterSecond).toBe(1);
  });

  it('re-reads after file mtime changes (read count increments to 2)', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);

    await getPlatformConfig(tmpDir);
    expect(_getReadCount()).toBe(1);

    // Touch the runtime file to change its mtime
    const runtimeFilePath = path.join(tmpDir, '.platform-state', 'platform.json');
    // Small delay to ensure mtime differs from when the file was written
    await new Promise<void>((r) => setTimeout(r, 10));
    fs.utimesSync(runtimeFilePath, new Date(), new Date());

    await getPlatformConfig(tmpDir);
    expect(_getReadCount()).toBe(2);
  });

  it('re-reads when TASKSAIL_MAX_PARALLEL_TASKS changes (read count increments)', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);

    await getPlatformConfig(tmpDir);
    expect(_getReadCount()).toBe(1);

    // Change env var — env snapshot changes → cache miss
    process.env['TASKSAIL_MAX_PARALLEL_TASKS'] = '3';

    await getPlatformConfig(tmpDir);
    expect(_getReadCount()).toBe(2);
  });

  it('re-reads when TASKSAIL_CLI_PROVIDER changes (read count increments)', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);

    await getPlatformConfig(tmpDir);
    expect(_getReadCount()).toBe(1);

    process.env['TASKSAIL_CLI_PROVIDER'] = 'copilot';

    await getPlatformConfig(tmpDir);
    expect(_getReadCount()).toBe(2);
  });

  it('TASKSAIL_MAX_PARALLEL_TASKS=3 overrides JSON max_parallel_tasks', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);
    process.env['TASKSAIL_MAX_PARALLEL_TASKS'] = '3';

    const config = await getPlatformConfig(tmpDir);
    expect(config.max_parallel_tasks).toBe(3);
  });

  it('TASKSAIL_MAX_PARALLEL_TASKS="bogus" rejects with validation error (fail-closed)', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);
    process.env['TASKSAIL_MAX_PARALLEL_TASKS'] = 'bogus';

    await expect(getPlatformConfig(tmpDir)).rejects.toThrow();
  });

  it('TASKSAIL_MAX_PARALLEL_TASKS="0" rejects (must be ≥ 1)', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);
    process.env['TASKSAIL_MAX_PARALLEL_TASKS'] = '0';

    await expect(getPlatformConfig(tmpDir)).rejects.toThrow();
  });

  it('TASKSAIL_MAX_PARALLEL_TASKS="-1" rejects (must be ≥ 1)', async () => {
    writeRuntimeConfig(tmpDir, FULL_CONFIG);
    process.env['TASKSAIL_MAX_PARALLEL_TASKS'] = '-1';

    await expect(getPlatformConfig(tmpDir)).rejects.toThrow();
  });

  it('throws on missing runtime file', async () => {
    await expect(getPlatformConfig(tmpDir)).rejects.toThrow();
  });

  it('env snapshot keys match the override-layer fields exactly', () => {
    // The env snapshot set MUST stay in lockstep with override-layer entries
    // plus provider-selection env because mixed call paths share this cache.
    // TASKSAIL_MAX_PARALLEL_TASKS → max_parallel_tasks
    // CONTAINER_RUNTIME → container_runtime
    // TASKSAIL_CLI_PROVIDER → cli-provider/registry.ts
    const expected = ['TASKSAIL_MAX_PARALLEL_TASKS', 'CONTAINER_RUNTIME', 'TASKSAIL_CLI_PROVIDER'];
    expect([..._ENV_SNAPSHOT_KEYS]).toEqual(expected);
  });

  it('CONTAINER_RUNTIME env var is included in the env snapshot', () => {
    expect(_ENV_SNAPSHOT_KEYS).toContain('CONTAINER_RUNTIME');
  });

  it('TASKSAIL_CLI_PROVIDER env var is included in the env snapshot', () => {
    expect(_ENV_SNAPSHOT_KEYS).toContain('TASKSAIL_CLI_PROVIDER');
  });

});
