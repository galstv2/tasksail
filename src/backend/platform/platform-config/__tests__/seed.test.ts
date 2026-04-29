import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { seedPlatformConfig } from '../seed.js';
import { getPlatformConfig, _clearPlatformConfigCache } from '../get.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from '../types.js';

const VALID_DEFAULT = JSON.stringify({
  schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
  cli_provider: 'copilot',
  container_runtime: 'docker',
});

// Full default matching config/platform.default.json (with new fields)
const FULL_DEFAULT_JSON = JSON.stringify({
  schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
  cli_provider: 'copilot',
  container_runtime: 'docker',
  max_parallel_tasks: 10,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  mcp_port: 8811,
  repo_context_mcp_external_mount_roots: [],
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-config-seed-'));
  _clearPlatformConfigCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  _clearPlatformConfigCache();
});

function writeDefault(content?: string): void {
  const defaultPath = path.join(tmpDir, 'config', 'platform.default.json');
  fs.mkdirSync(path.dirname(defaultPath), { recursive: true });
  fs.writeFileSync(defaultPath, content ?? VALID_DEFAULT, 'utf-8');
}

function runtimePath(): string {
  return path.join(tmpDir, '.platform-state', 'platform.json');
}

describe('seedPlatformConfig', () => {
  it('creates runtime file from default when missing', async () => {
    writeDefault();
    const result = await seedPlatformConfig(tmpDir);
    expect(result.action).toBe('created');
    expect(fs.existsSync(runtimePath())).toBe(true);

    const data = JSON.parse(fs.readFileSync(runtimePath(), 'utf-8'));
    expect(data.schema_version).toBe(CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION);
    expect(data.cli_provider).toBe('copilot');
    expect(data.container_runtime).toBe('docker');
  });

  it('returns up-to-date when runtime file exists and is valid', async () => {
    writeDefault();
    await seedPlatformConfig(tmpDir);
    const result = await seedPlatformConfig(tmpDir);
    expect(result.action).toBe('up-to-date');
    if (result.action === 'up-to-date') {
      expect(result.config.container_runtime).toBe('docker');
      expect(result.config.cli_provider).toBe('copilot');
    }
  });

  it('overwrites runtime file when default has changed', async () => {
    writeDefault();
    await seedPlatformConfig(tmpDir);

    // Change the default to podman
    const podmanConfig = JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      cli_provider: 'copilot',
      container_runtime: 'podman',
    });
    writeDefault(podmanConfig);

    const result = await seedPlatformConfig(tmpDir);
    expect(result.action).toBe('updated');
    if (result.action === 'updated') {
      expect(result.config.container_runtime).toBe('podman');
    }

    const data = JSON.parse(fs.readFileSync(runtimePath(), 'utf-8'));
    expect(data.container_runtime).toBe('podman');
    expect(data.cli_provider).toBe('copilot');
  });

  it('overwrites corrupt runtime file with valid default', async () => {
    writeDefault();
    fs.mkdirSync(path.dirname(runtimePath()), { recursive: true });
    fs.writeFileSync(runtimePath(), '{ broken json', 'utf-8');

    const result = await seedPlatformConfig(tmpDir);
    expect(result.action).toBe('updated');

    const data = JSON.parse(fs.readFileSync(runtimePath(), 'utf-8'));
    expect(data.container_runtime).toBe('docker');
    expect(data.cli_provider).toBe('copilot');
  });

  it('returns failed when default file is missing', async () => {
    const result = await seedPlatformConfig(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('not found');
    }
  });

  it('seeding a runtime file missing new fields rewrites it to match default; getPlatformConfig returns seeded values', async () => {
    // Write a full default with all new fields
    writeDefault(FULL_DEFAULT_JSON);

    // Write a runtime file with only the old fields (pre-refactor state)
    fs.mkdirSync(path.dirname(runtimePath()), { recursive: true });
    fs.writeFileSync(
      runtimePath(),
      JSON.stringify({
        schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
        container_runtime: 'docker',
      }),
      'utf-8',
    );

    // Seed rewrites the runtime to match the default
    const seedResult = await seedPlatformConfig(tmpDir);
    expect(seedResult.action).toBe('updated');

    // Runtime file now contains new fields
    const runtimeData = JSON.parse(fs.readFileSync(runtimePath(), 'utf-8'));
    expect(runtimeData.max_parallel_tasks).toBe(10);
    expect(runtimeData.cli_provider).toBe('copilot');
    expect(runtimeData.mcp_port).toBe(8811);
    expect(runtimeData.repo_context_mcp_external_mount_roots).toEqual([]);

    // getPlatformConfig returns seeded values
    const config = await getPlatformConfig(tmpDir);
    expect(config.max_parallel_tasks).toBe(10);
    expect(config.cli_provider).toBe('copilot');
    expect(config.retain_failed_task_worktrees).toBe(true);
    expect(config.max_retained_failed_task_worktrees).toBe(10);
    expect(config.max_retry_generations_per_slug).toBe(5);
    expect(config.completed_task_runtime_retention_ms).toBe(3600000);
    expect(config.mcp_port).toBe(8811);
    expect(config.repo_context_mcp_external_mount_roots).toEqual([]);
  });
});
