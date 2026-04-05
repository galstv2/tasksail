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
});
