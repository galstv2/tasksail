import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { seedPlatformConfig } from '../seed.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from '../types.js';

const VALID_DEFAULT = JSON.stringify({
  schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
  container_runtime: 'docker',
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-config-seed-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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
    expect(data.container_runtime).toBe('docker');
  });

  it('returns up-to-date when runtime file exists and is valid', async () => {
    writeDefault();
    await seedPlatformConfig(tmpDir);
    const result = await seedPlatformConfig(tmpDir);
    expect(result.action).toBe('up-to-date');
    if (result.action === 'up-to-date') {
      expect(result.config.container_runtime).toBe('docker');
    }
  });

  it('overwrites runtime file when default has changed', async () => {
    writeDefault();
    await seedPlatformConfig(tmpDir);

    // Change the default to podman
    const podmanConfig = JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
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
  });

  it('overwrites corrupt runtime file with valid default', async () => {
    writeDefault();
    fs.mkdirSync(path.dirname(runtimePath()), { recursive: true });
    fs.writeFileSync(runtimePath(), '{ broken json', 'utf-8');

    const result = await seedPlatformConfig(tmpDir);
    expect(result.action).toBe('updated');

    const data = JSON.parse(fs.readFileSync(runtimePath(), 'utf-8'));
    expect(data.container_runtime).toBe('docker');
  });

  it('returns failed when default file is missing', async () => {
    const result = await seedPlatformConfig(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('not found');
    }
  });
});
