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

describe('resolveContainerRuntime', () => {
  it('returns docker by default when no config exists', async () => {
    const result = await resolveContainerRuntime(tmpDir);
    expect(result).toBe('docker');
  });

  it('reads from platform config file', async () => {
    writeRuntimeConfig('podman');
    const result = await resolveContainerRuntime(tmpDir);
    expect(result).toBe('podman');
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
