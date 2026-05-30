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
  cli_provider: 'copilot',
  container_runtime: 'podman',
  container_engine_host: 'auto',
  container_engine_wsl_distro: null,
  max_parallel_tasks: 10,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  auto_merge: false,
  external_mcp_local_enabled: false,
  mcp_port: 8811,
  repo_context_mcp_external_mount_roots: [],
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
        cli_provider: 'copilot',
        container_runtime: 'podman',
        container_engine_host: 'auto',
        container_engine_wsl_distro: null,
        max_parallel_tasks: 10,
        retain_failed_task_worktrees: true,
        max_retained_failed_task_worktrees: 10,
        max_retry_generations_per_slug: 5,
        completed_task_runtime_retention_ms: 3600000,
        auto_merge: false,
        external_mcp_local_enabled: false,
        mcp_port: 8811,
        repo_context_mcp_external_mount_roots: [],
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
      expect(result.config.cli_provider).toBe('copilot');
      expect(result.config.container_engine_host).toBe('auto');
      expect(result.config.container_engine_wsl_distro).toBeNull();
      expect(result.config.retain_failed_task_worktrees).toBe(true);
      expect(result.config.max_retained_failed_task_worktrees).toBe(10);
      expect(result.config.max_retry_generations_per_slug).toBe(5);
      expect(result.config.completed_task_runtime_retention_ms).toBe(3600000);
      expect(result.config.auto_merge).toBe(false);
      expect(result.config.external_mcp_local_enabled).toBe(false);
      expect(result.config.mcp_port).toBe(8811);
      expect(result.config.repo_context_mcp_external_mount_roots).toEqual([]);
    }
  });

  it('accepts boolean auto_merge and rejects non-boolean auto_merge', async () => {
    const accepted = await loadPlatformConfig(writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      auto_merge: true,
    })));
    expect(accepted.valid).toBe(true);
    if (accepted.valid) {
      expect(accepted.config.auto_merge).toBe(true);
    }

    const rejected = await loadPlatformConfig(writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      auto_merge: 'true',
    })));
    expect(rejected.valid).toBe(false);
    if (!rejected.valid) {
      expect(rejected.errors.some((e) => e.field === 'auto_merge')).toBe(true);
    }
  });

  it('accepts boolean external_mcp_local_enabled and rejects non-boolean', async () => {
    const accepted = await loadPlatformConfig(writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      external_mcp_local_enabled: true,
    })));
    expect(accepted.valid).toBe(true);
    if (accepted.valid) {
      expect(accepted.config.external_mcp_local_enabled).toBe(true);
    }

    const rejected = await loadPlatformConfig(writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      external_mcp_local_enabled: 'true',
    })));
    expect(rejected.valid).toBe(false);
    if (!rejected.valid) {
      expect(rejected.errors.some((e) => e.field === 'external_mcp_local_enabled')).toBe(true);
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

  it('accepts valid container_engine_host values and normalizes distro', async () => {
    for (const host of ['auto', 'native', 'desktop-linux', 'wsl'] as const) {
      const distro = host === 'wsl' ? 'Ubuntu' : 'Ubuntu/Latest';
      const result = await loadPlatformConfig(writeConfig(JSON.stringify({
        ...FULL_DEFAULT,
        container_engine_host: host,
        container_engine_wsl_distro: distro,
      })));

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config).toMatchObject({
          container_engine_host: host,
          container_engine_wsl_distro: distro,
        });
      }
    }
  });

  it('rejects invalid engine host topology config', async () => {
    for (const [field, patch] of [
      ['container_engine_host', { container_engine_host: 'desktop-windows' }],
      ['container_engine_wsl_distro', { container_engine_host: 'wsl' }],
      [
        'container_engine_wsl_distro',
        {
          container_engine_host: 'wsl',
          container_engine_wsl_distro: 'Ubuntu/Latest',
        },
      ],
    ] as const) {
      const result = await loadPlatformConfig(writeConfig(JSON.stringify({
        ...FULL_DEFAULT,
        ...patch,
      })));

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === field)).toBe(true);
      }
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

  it('uses mcp_port over migration-window compatibility mcp_port_range', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      mcp_port: 9000,
      mcp_port_range: { min: 8811, max: 8820 },
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.mcp_port).toBe(9000);
    }
  });

  it('derives mcp_port from migration-window compatibility mcp_port_range when mcp_port is absent', async () => {
    const { mcp_port: _mcpPort, ...legacyConfig } = FULL_DEFAULT;
    const configPath = writeConfig(JSON.stringify({
      ...legacyConfig,
      mcp_port_range: { min: 8817, max: 8820 },
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.mcp_port).toBe(8817);
    }
  });

  it('defaults mcp_port to 8811 when mcp_port and migration-window compatibility mcp_port_range are absent', async () => {
    const configPath = writeConfig(JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      container_runtime: 'podman',
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.mcp_port).toBe(8811);
    }
  });

  it('rejects invalid mcp_port values', async () => {
    for (const mcpPort of [0, 65536, 8811.5, '8811'] as const) {
      const result = await loadPlatformConfig(writeConfig(JSON.stringify({
        ...FULL_DEFAULT,
        mcp_port: mcpPort,
      })));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'mcp_port')).toBe(true);
      }
    }
  });

  it('rejects relative external mount roots', async () => {
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      repo_context_mcp_external_mount_roots: ['relative/path'],
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.field === 'repo_context_mcp_external_mount_roots'),
      ).toBe(true);
    }
  });

  it('accepts absolute external mount roots', async () => {
    const root = path.join(path.sep, 'context-packs');
    const configPath = writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      repo_context_mcp_external_mount_roots: [root],
    }));
    const result = await loadPlatformConfig(configPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.repo_context_mcp_external_mount_roots).toEqual([root]);
    }
  });

  it('rejects invalid migration-window compatibility mcp_port_range (min > max)', async () => {
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

  it('rejects invalid migration-window compatibility mcp_port_range (max > 65535)', async () => {
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

  it('rejects invalid migration-window compatibility mcp_port_range (min < 1)', async () => {
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

  it('accepts a valid cli_provider string', async () => {
    const result = await loadPlatformConfig(writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      cli_provider: 'copilot',
    })));

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.cli_provider).toBe('copilot');
    }
  });

  it('rejects a blank cli_provider when present', async () => {
    const result = await loadPlatformConfig(writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      cli_provider: '   ',
    })));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'cli_provider')).toBe(true);
    }
  });

  it('rejects a non-string cli_provider when present', async () => {
    const result = await loadPlatformConfig(writeConfig(JSON.stringify({
      ...FULL_DEFAULT,
      cli_provider: 42,
    })));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === 'cli_provider')).toBe(true);
    }
  });
});
