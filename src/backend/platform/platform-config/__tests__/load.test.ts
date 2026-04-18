import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { loadPlatformConfig } from '../load.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from '../types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-config-load-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: string): string {
  const configPath = path.join(tmpDir, 'platform.json');
  fs.writeFileSync(configPath, content, 'utf-8');
  return configPath;
}

// A full valid config matching config/platform.default.json
const FULL_DEFAULT = {
  schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
  container_runtime: 'podman',
  max_parallel_tasks: 10,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  mcp_port_range: { min: 8811, max: 8820 },
};

describe('loadPlatformConfig', () => {
  it('loads valid docker config', async () => {
    const configPath = writeConfig(JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      container_runtime: 'docker',
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.container_runtime).toBe('docker');
      expect(result.config.schema_version).toBe(CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION);
    }
  });

  it('loads valid podman config', async () => {
    const configPath = writeConfig(JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      container_runtime: 'podman',
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.container_runtime).toBe('podman');
    }
  });

  it('rejects missing file', async () => {
    const configPath = path.join(tmpDir, 'nonexistent.json');
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe('(file)');
      expect(result.errors[0].message).toContain('not found');
    }
  });

  it('rejects invalid JSON', async () => {
    const configPath = writeConfig('{ not valid json');
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe('(file)');
    }
  });

  it('rejects wrong schema_version', async () => {
    const configPath = writeConfig(JSON.stringify({
      schema_version: 999,
      container_runtime: 'docker',
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'schema_version')).toBe(true);
    }
  });

  it('rejects invalid container_runtime value', async () => {
    const configPath = writeConfig(JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      container_runtime: 'lxc',
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'container_runtime')).toBe(true);
    }
  });

  it('rejects non-object JSON', async () => {
    const configPath = writeConfig('"just a string"');
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe('(root)');
    }
  });

  // ---- §4.4 new fields ----

  it('loads full default config with all six new fields', async () => {
    const configPath = writeConfig(JSON.stringify(FULL_DEFAULT));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config).toEqual({
        schema_version: 1,
        container_runtime: 'podman',
        max_parallel_tasks: 10,
        retain_failed_task_worktrees: true,
        max_retained_failed_task_worktrees: 10,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        mcp_port_range: { min: 8811, max: 8820 },
      });
    }
  });

  it('returns defensive defaults for pre-refactor config (only schema_version + container_runtime)', async () => {
    const configPath = writeConfig(JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      container_runtime: 'podman',
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Defensive defaults MUST match JSON defaults verbatim
      expect(result.config.max_parallel_tasks).toBe(10);
      expect(result.config.retain_failed_task_worktrees).toBe(true);
      expect(result.config.max_retained_failed_task_worktrees).toBe(10);
      expect(result.config.max_retry_generations_per_slug).toBe(5);
      expect(result.config.completed_task_runtime_retention_ms).toBe(3600000);
      expect(result.config.mcp_port_range).toEqual({ min: 8811, max: 8820 });
    }
  });

  it('rejects max_retry_generations_per_slug=0', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      max_retry_generations_per_slug: 0,
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'max_retry_generations_per_slug')).toBe(true);
    }
  });

  it('rejects max_retry_generations_per_slug="five" (string)', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      max_retry_generations_per_slug: 'five',
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'max_retry_generations_per_slug')).toBe(true);
    }
  });

  it('rejects max_retry_generations_per_slug=-1', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      max_retry_generations_per_slug: -1,
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'max_retry_generations_per_slug')).toBe(true);
    }
  });

  it('rejects invalid mcp_port_range (min > max)', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      mcp_port_range: { min: 8820, max: 8811 },
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'mcp_port_range')).toBe(true);
    }
  });

  it('rejects invalid mcp_port_range (max > 65535)', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      mcp_port_range: { min: 8811, max: 70000 },
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'mcp_port_range')).toBe(true);
    }
  });

  it('rejects invalid mcp_port_range (min < 1)', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      mcp_port_range: { min: 0, max: 8820 },
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'mcp_port_range')).toBe(true);
    }
  });

  it('rejects max_parallel_tasks=0', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      max_parallel_tasks: 0,
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'max_parallel_tasks')).toBe(true);
    }
  });

  it('rejects max_retained_failed_task_worktrees=-1 (negative)', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      max_retained_failed_task_worktrees: -1,
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'max_retained_failed_task_worktrees')).toBe(true);
    }
  });

  it('accepts max_retained_failed_task_worktrees=0', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      max_retained_failed_task_worktrees: 0,
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.max_retained_failed_task_worktrees).toBe(0);
    }
  });
});
