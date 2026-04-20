import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { resolveContainerRuntime } from '../resolve.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from '../types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-config-resolve-'));
  delete process.env['CONTAINER_RUNTIME'];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['CONTAINER_RUNTIME'];
});

function writeRuntimeConfig(containerRuntime: string): void {
  const configPath = path.join(tmpDir, '.platform-state', 'platform.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
    container_runtime: containerRuntime,
  }), 'utf-8');
}

function writeDefaultConfig(containerRuntime: string): void {
  const configPath = path.join(tmpDir, 'config', 'platform.default.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
    container_runtime: containerRuntime,
  }), 'utf-8');
}

describe('resolveContainerRuntime', () => {
  it('falls back to config/platform.default.json when runtime config is missing', async () => {
    writeDefaultConfig('podman');
    const result = await resolveContainerRuntime(tmpDir);
    expect(result).toBe('podman');
  });

  it('throws when both runtime and default configs are missing', async () => {
    await expect(resolveContainerRuntime(tmpDir)).rejects.toThrow(
      'Invalid platform config',
    );
  });

  it('reads from platform config file', async () => {
    writeRuntimeConfig('podman');
    const result = await resolveContainerRuntime(tmpDir);
    expect(result).toBe('podman');
  });

  it('runtime config wins over default config when both present', async () => {
    writeRuntimeConfig('docker');
    writeDefaultConfig('podman');
    const result = await resolveContainerRuntime(tmpDir);
    expect(result).toBe('docker');
  });

  it('env var overrides config file', async () => {
    writeRuntimeConfig('podman');
    process.env['CONTAINER_RUNTIME'] = 'docker';
    const result = await resolveContainerRuntime(tmpDir);
    expect(result).toBe('docker');
  });

  it('throws when config exists but is invalid', async () => {
    const configPath = path.join(tmpDir, '.platform-state', 'platform.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      container_runtime: 'invalid-runtime',
    }), 'utf-8');

    await expect(resolveContainerRuntime(tmpDir)).rejects.toThrow('Invalid platform config');
  });
});
