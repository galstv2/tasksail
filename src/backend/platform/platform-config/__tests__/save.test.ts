import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { readSystemSettings, saveSystemSettings, SystemSettingsSaveError } from '../save.js';
import * as getModule from '../get.js';
import { _clearPlatformConfigCache } from '../get.js';
import * as cliProviderIndex from '../../cli-provider/index.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from '../types.js';
import type { PlatformConfig } from '../types.js';

// Mirrors config/platform.default.json field values.
const FULL_DEFAULT = {
  schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
  cli_provider: 'copilot',
  slice_artifact_format: 'markdown',
  container_runtime: 'direct',
  container_engine_host: 'auto',
  container_engine_wsl_distro: null,
  max_parallel_tasks: 10,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  auto_merge: false,
  external_mcp_local_enabled: true,
  mcp_port: 8811,
  repo_context_mcp_external_mount_roots: [],
} satisfies PlatformConfig;

function draft(overrides: Record<string, unknown> = {}): PlatformConfig {
  return { ...FULL_DEFAULT, ...overrides } as unknown as PlatformConfig;
}

function serialize(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

let tmpDir: string;

function defaultPath(): string {
  return path.join(tmpDir, 'config', 'platform.default.json');
}

function runtimePath(): string {
  return path.join(tmpDir, '.platform-state', 'platform.json');
}

function writeDefaultFile(raw: string): void {
  fs.mkdirSync(path.dirname(defaultPath()), { recursive: true });
  fs.writeFileSync(defaultPath(), raw, 'utf-8');
}

function writeRuntimeFile(raw: string): void {
  fs.mkdirSync(path.dirname(runtimePath()), { recursive: true });
  fs.writeFileSync(runtimePath(), raw, 'utf-8');
}

function readRaw(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-config-save-'));
  _clearPlatformConfigCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  _clearPlatformConfigCache();
  vi.restoreAllMocks();
});

describe('readSystemSettings', () => {
  it('returns default config, hash, and a valid runtime mirror', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize(FULL_DEFAULT));

    const result = await readSystemSettings(tmpDir, { env: {} });

    expect(result.config.cli_provider).toBe('copilot');
    expect(result.config.mcp_port).toBe(8811);
    expect(result.defaultFileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.runtimeStatus).toBe('valid');
    expect(result.runtimeConfig?.cli_provider).toBe('copilot');
    expect(result.runtimeWarning).toBeNull();
    expect(result.runtimeFileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.defaultConfigPath).toBe(defaultPath());
    expect(result.runtimeConfigPath).toBe(runtimePath());
  });

  it('reports runtimeStatus missing without blocking the read', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));

    const result = await readSystemSettings(tmpDir, { env: {} });

    expect(result.config.cli_provider).toBe('copilot');
    expect(result.runtimeStatus).toBe('missing');
    expect(result.runtimeConfig).toBeNull();
    expect(result.runtimeFileHash).toBeNull();
    expect(result.runtimeWarning).toContain('missing or invalid');
  });

  it('reports runtimeStatus invalid without blocking the read', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile('{ broken json');

    const result = await readSystemSettings(tmpDir, { env: {} });

    expect(result.config.cli_provider).toBe('copilot');
    expect(result.runtimeStatus).toBe('invalid');
    expect(result.runtimeConfig).toBeNull();
    expect(result.runtimeFileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.runtimeWarning).toContain('missing or invalid');
  });

  it('reports supported env overrides with correct fields and scopes', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));

    const result = await readSystemSettings(tmpDir, {
      env: {
        TASKSAIL_MAX_PARALLEL_TASKS: '4',
        CONTAINER_RUNTIME: 'podman',
        CONTAINER_ENGINE_HOST: 'wsl',
        CONTAINER_ENGINE_WSL_DISTRO: 'Ubuntu',
        TASKSAIL_CLI_PROVIDER: 'copilot',
      },
    });

    expect(result.envOverrides).toHaveLength(5);
    const byVar = Object.fromEntries(result.envOverrides.map((o) => [o.envVar, o]));
    expect(byVar['TASKSAIL_MAX_PARALLEL_TASKS']).toMatchObject({ field: 'max_parallel_tasks', value: '4', scope: 'effective-config' });
    expect(byVar['CONTAINER_RUNTIME']).toMatchObject({ field: 'container_runtime', value: 'podman', scope: 'effective-config' });
    expect(byVar['CONTAINER_ENGINE_HOST']).toMatchObject({ field: 'container_engine_host', value: 'wsl', scope: 'engine-resolution' });
    expect(byVar['CONTAINER_ENGINE_WSL_DISTRO']).toMatchObject({ field: 'container_engine_wsl_distro', value: 'Ubuntu', scope: 'engine-resolution' });
    expect(byVar['TASKSAIL_CLI_PROVIDER']).toMatchObject({ field: 'cli_provider', value: 'copilot', scope: 'provider-resolution' });

    const empty = await readSystemSettings(tmpDir, { env: {} });
    expect(empty.envOverrides).toEqual([]);
  });
});

describe('saveSystemSettings', () => {
  async function baseHash(): Promise<string> {
    const result = await readSystemSettings(tmpDir, { env: {} });
    return result.defaultFileHash;
  }

  it('writes default then runtime with two-space JSON and a trailing newline', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize(FULL_DEFAULT));

    const result = await saveSystemSettings(tmpDir, {
      baseDefaultFileHash: await baseHash(),
      config: draft({ auto_merge: true, max_parallel_tasks: 6 }),
    });

    const defaultRaw = readRaw(defaultPath());
    const runtimeRaw = readRaw(runtimePath());

    // Canonical two-space + trailing newline formatting for both files.
    expect(defaultRaw).toBe(serialize(JSON.parse(defaultRaw)));
    expect(runtimeRaw).toBe(serialize(JSON.parse(runtimeRaw)));

    expect(JSON.parse(defaultRaw).auto_merge).toBe(true);
    expect(JSON.parse(defaultRaw).max_parallel_tasks).toBe(6);
    expect(JSON.parse(runtimeRaw).auto_merge).toBe(true);
    expect(result.config.auto_merge).toBe(true);
    expect(result.runtimeConfig.max_parallel_tasks).toBe(6);
    expect(result.defaultFileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.runtimeFileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves runtime-only keys from a valid runtime file', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize({ ...FULL_DEFAULT, runtime_only_marker: 'keep-me' }));

    await saveSystemSettings(tmpDir, {
      baseDefaultFileHash: await baseHash(),
      config: draft({ container_runtime: 'podman' }),
    });

    const runtimeData = JSON.parse(readRaw(runtimePath()));
    expect(runtimeData.runtime_only_marker).toBe('keep-me');
    expect(runtimeData.container_runtime).toBe('podman');
  });

  it('repairs a missing runtime config from the saved default', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    expect(fs.existsSync(runtimePath())).toBe(false);

    const result = await saveSystemSettings(tmpDir, {
      baseDefaultFileHash: await baseHash(),
      config: draft({ auto_merge: true }),
    });

    expect(fs.existsSync(runtimePath())).toBe(true);
    const runtimeData = JSON.parse(readRaw(runtimePath()));
    expect(runtimeData.auto_merge).toBe(true);
    expect(result.runtimeConfig.auto_merge).toBe(true);
  });

  it('repairs a corrupt runtime config and drops corrupt runtime-only keys', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile('{ "runtime_only_marker": "lost", broken');

    await saveSystemSettings(tmpDir, {
      baseDefaultFileHash: await baseHash(),
      config: draft({ auto_merge: true }),
    });

    const runtimeData = JSON.parse(readRaw(runtimePath()));
    expect(runtimeData.runtime_only_marker).toBeUndefined();
    expect(runtimeData.auto_merge).toBe(true);
    expect(runtimeData.container_runtime).toBe('direct');
  });

  it('preserves unknown default keys while replacing known keys from the draft', async () => {
    writeDefaultFile(serialize({ ...FULL_DEFAULT, experimental_flag: true }));
    writeRuntimeFile(serialize(FULL_DEFAULT));

    await saveSystemSettings(tmpDir, {
      baseDefaultFileHash: await baseHash(),
      config: draft({ container_runtime: 'podman' }),
    });

    const defaultData = JSON.parse(readRaw(defaultPath()));
    expect(defaultData.experimental_flag).toBe(true);
    expect(defaultData.container_runtime).toBe('podman');
  });

  it('rejects a stale default hash without writing either file', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize(FULL_DEFAULT));
    const staleHash = await baseHash();

    // External edit changes the on-disk default (and its hash) after the modal loaded.
    writeDefaultFile(serialize({ ...FULL_DEFAULT, max_parallel_tasks: 99 }));
    const defaultBefore = readRaw(defaultPath());
    const runtimeBefore = readRaw(runtimePath());

    await expect(
      saveSystemSettings(tmpDir, {
        baseDefaultFileHash: staleHash,
        config: draft({ auto_merge: true }),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    expect(readRaw(defaultPath())).toBe(defaultBefore);
    expect(readRaw(runtimePath())).toBe(runtimeBefore);
  });

  it('rejects invalid fields without writing either file', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize(FULL_DEFAULT));
    const hash = await baseHash();
    const defaultBefore = readRaw(defaultPath());

    const invalidDrafts: Array<{ field: string; config: PlatformConfig }> = [
      { field: 'schema_version', config: draft({ schema_version: 2 }) },
      { field: 'mcp_port', config: draft({ mcp_port: 70000 }) },
      { field: 'max_parallel_tasks', config: draft({ max_parallel_tasks: 0 }) },
      { field: 'max_retained_failed_task_worktrees', config: draft({ max_retained_failed_task_worktrees: -1 }) },
      { field: 'container_engine_wsl_distro', config: draft({ container_engine_host: 'wsl', container_engine_wsl_distro: '' }) },
      { field: 'container_engine_wsl_distro', config: draft({ container_engine_host: 'wsl', container_engine_wsl_distro: 'a/b' }) },
      { field: 'slice_artifact_format', config: draft({ slice_artifact_format: 'json' }) },
      { field: 'repo_context_mcp_external_mount_roots', config: draft({ repo_context_mcp_external_mount_roots: ['relative/path'] }) },
    ];

    for (const { field, config } of invalidDrafts) {
      const error = await saveSystemSettings(tmpDir, { baseDefaultFileHash: hash, config })
        .then(() => null)
        .catch((err: unknown) => err);
      expect(error, `expected ${field} draft to be rejected`).toBeInstanceOf(SystemSettingsSaveError);
      expect((error as SystemSettingsSaveError).code).toBe('validation');
      expect((error as SystemSettingsSaveError).details.join(' ')).toContain(field);
    }

    expect(readRaw(defaultPath())).toBe(defaultBefore);
  });

  it('rejects an unknown cli_provider before writing', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize(FULL_DEFAULT));
    const hash = await baseHash();
    const defaultBefore = readRaw(defaultPath());

    const error = await saveSystemSettings(tmpDir, {
      baseDefaultFileHash: hash,
      config: draft({ cli_provider: 'definitely-not-registered' }),
    })
      .then(() => null)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SystemSettingsSaveError);
    expect((error as SystemSettingsSaveError).code).toBe('validation');
    expect((error as SystemSettingsSaveError).details.join(' ')).toContain('cli_provider');
    expect(readRaw(defaultPath())).toBe(defaultBefore);
  });

  it('returns a partial-propagation error when default write succeeds but runtime write fails', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize(FULL_DEFAULT));
    const hash = await baseHash();

    const error = await saveSystemSettings(
      tmpDir,
      { baseDefaultFileHash: hash, config: draft({ auto_merge: true }) },
      {
        writeFileAtomic: async (filePath, content) => {
          if (filePath === runtimePath()) {
            throw new Error('disk full');
          }
          fs.writeFileSync(filePath, content, 'utf-8');
        },
      },
    )
      .then(() => null)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SystemSettingsSaveError);
    expect((error as SystemSettingsSaveError).code).toBe('partial-propagation');
    expect((error as SystemSettingsSaveError).message).toContain('failed to update .platform-state/platform.json');
    // Default file WAS written; runtime file was NOT updated to the new draft.
    expect(JSON.parse(readRaw(defaultPath())).auto_merge).toBe(true);
    expect(JSON.parse(readRaw(runtimePath())).auto_merge).toBe(false);
  });

  it('clears the platform config cache after runtime write', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize(FULL_DEFAULT));
    const cacheSpy = vi.spyOn(getModule, 'resetPlatformConfigCache');

    await saveSystemSettings(tmpDir, {
      baseDefaultFileHash: await baseHash(),
      config: draft({ auto_merge: true }),
    });

    expect(cacheSpy).toHaveBeenCalled();
  });

  it('resets the provider registry cache for the repo after runtime write', async () => {
    writeDefaultFile(serialize(FULL_DEFAULT));
    writeRuntimeFile(serialize(FULL_DEFAULT));
    const providerSpy = vi.spyOn(cliProviderIndex, 'resetProvider');

    await saveSystemSettings(tmpDir, {
      baseDefaultFileHash: await baseHash(),
      config: draft({ cli_provider: 'copilot' }),
    });

    expect(providerSpy).toHaveBeenCalledWith(tmpDir);
  });
});
