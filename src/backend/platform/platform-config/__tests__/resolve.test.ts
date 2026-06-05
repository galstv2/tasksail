import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { resolveContainerEngineHost, resolveContainerRuntime } from '../resolve.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION, isValidWslDistroName } from '../types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-config-resolve-'));
  delete process.env['CONTAINER_RUNTIME'];
  delete process.env['CONTAINER_ENGINE_HOST'];
  delete process.env['CONTAINER_ENGINE_WSL_DISTRO'];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['CONTAINER_RUNTIME'];
  delete process.env['CONTAINER_ENGINE_HOST'];
  delete process.env['CONTAINER_ENGINE_WSL_DISTRO'];
});

function writeRuntimeConfig(containerRuntime: string, containerEngineHost = 'auto', containerEngineWslDistro: string | null = null): void {
  const configPath = path.join(tmpDir, '.platform-state', 'platform.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
    container_runtime: containerRuntime,
    container_engine_host: containerEngineHost,
    container_engine_wsl_distro: containerEngineWslDistro,
  }), 'utf-8');
}

function writeDefaultConfig(containerRuntime: string, containerEngineHost = 'auto', containerEngineWslDistro: string | null = null): void {
  const configPath = path.join(tmpDir, 'config', 'platform.default.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
    container_runtime: containerRuntime,
    container_engine_host: containerEngineHost,
    container_engine_wsl_distro: containerEngineWslDistro,
  }), 'utf-8');
}

describe('isValidWslDistroName', () => {
  it('SEC-TS-10: rejects leading-dash (option injection) and separators', () => {
    expect(isValidWslDistroName('-e')).toBe(false);
    expect(isValidWslDistroName('--exec=evil')).toBe(false);
    expect(isValidWslDistroName('a/b')).toBe(false);
    expect(isValidWslDistroName('a\\b')).toBe(false);
    expect(isValidWslDistroName(null)).toBe(false);
    expect(isValidWslDistroName('')).toBe(false);
  });
  it('accepts normal distro names (incl. non-leading dashes)', () => {
    expect(isValidWslDistroName('Ubuntu')).toBe(true);
    expect(isValidWslDistroName('Ubuntu-22.04')).toBe(true);
  });
});

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

describe('resolveContainerEngineHost', () => {
  it('uses default config, defaulted runtime fields, then runtime config by priority', async () => {
    writeDefaultConfig('podman', 'desktop-linux');
    expect(await resolveContainerEngineHost(tmpDir)).toEqual({
      host: 'desktop-linux',
      wslDistro: null,
    });

    const configPath = path.join(tmpDir, '.platform-state', 'platform.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      container_runtime: 'docker',
    }), 'utf-8');
    expect(await resolveContainerEngineHost(tmpDir)).toMatchObject({ host: 'auto' });

    writeRuntimeConfig('docker', 'native');
    expect(await resolveContainerEngineHost(tmpDir)).toEqual({
      host: 'native',
      wslDistro: null,
    });
  });

  it('resolves wsl with distro from config', async () => {
    writeRuntimeConfig('docker', 'wsl', 'Ubuntu');
    expect(await resolveContainerEngineHost(tmpDir)).toEqual({
      host: 'wsl',
      wslDistro: 'Ubuntu',
    });
  });

  it('throws for invalid config host, missing distro, and distro separators', async () => {
    for (const args of [
      ['invalid-host'],
      ['wsl', null],
      ['wsl', 'Ubuntu\\Latest'],
    ] as const) {
      writeRuntimeConfig('docker', args[0], args[1]);

      await expect(resolveContainerEngineHost(tmpDir)).rejects.toThrow('Invalid platform config');
    }
  });

  it('env overrides host and distro consistently', async () => {
    writeRuntimeConfig('podman', 'native');
    process.env['CONTAINER_ENGINE_HOST'] = 'wsl';
    process.env['CONTAINER_ENGINE_WSL_DISTRO'] = 'Ubuntu';
    expect(await resolveContainerEngineHost(tmpDir)).toEqual({
      host: 'wsl',
      wslDistro: 'Ubuntu',
    });

    delete process.env['CONTAINER_ENGINE_HOST'];
    writeRuntimeConfig('podman', 'wsl', 'Debian');
    process.env['CONTAINER_ENGINE_WSL_DISTRO'] = 'Ubuntu';
    expect(await resolveContainerEngineHost(tmpDir)).toEqual({
      host: 'wsl',
      wslDistro: 'Ubuntu',
    });
  });

  it('throws for invalid env overrides', async () => {
    for (const [host, distro, message] of [
      ['desktop-windows', undefined, 'CONTAINER_ENGINE_HOST'],
      ['wsl', undefined, 'CONTAINER_ENGINE_WSL_DISTRO'],
      ['wsl', 'Ubuntu/Latest', 'CONTAINER_ENGINE_WSL_DISTRO'],
    ] as const) {
      writeRuntimeConfig('podman', 'native');
      process.env['CONTAINER_ENGINE_HOST'] = host;

      if (distro === undefined) {
        delete process.env['CONTAINER_ENGINE_WSL_DISTRO'];
      } else {
        process.env['CONTAINER_ENGINE_WSL_DISTRO'] = distro;
      }

      await expect(resolveContainerEngineHost(tmpDir)).rejects.toThrow(message);
    }
  });
});
