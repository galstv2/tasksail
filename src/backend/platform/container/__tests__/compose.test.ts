import { describe, it, expect } from 'vitest';
import { buildComposeCommand } from '../compose.js';
import { DEFAULT_COMPOSE_FILE, resolveDefaultComposeFile } from '../types.js';

describe('buildComposeCommand', () => {
  it('builds docker compose up with defaults', () => {
    const cmd = buildComposeCommand('docker', 'up', {});
    expect(cmd).toEqual(['docker', 'compose', 'up', '-d']);
  });

  it('includes compose file flag', () => {
    const cmd = buildComposeCommand('docker', 'up', {
      composeFile: '/path/to/docker-compose.yml',
    });
    expect(cmd).toEqual([
      'docker', 'compose',
      '-f', '/path/to/docker-compose.yml',
      'up', '-d',
    ]);
  });

  it('includes build flag for up', () => {
    const cmd = buildComposeCommand('docker', 'up', { build: true });
    expect(cmd).toEqual(['docker', 'compose', 'up', '-d', '--build']);
  });

  it('respects detach=false', () => {
    const cmd = buildComposeCommand('docker', 'up', { detach: false });
    expect(cmd).toEqual(['docker', 'compose', 'up']);
  });

  it('appends service names', () => {
    const cmd = buildComposeCommand('docker', 'up', {
      services: ['web', 'db'],
    });
    expect(cmd).toEqual(['docker', 'compose', 'up', '-d', 'web', 'db']);
  });

  it('builds docker compose down', () => {
    const cmd = buildComposeCommand('docker', 'down', {});
    expect(cmd).toEqual(['docker', 'compose', 'down']);
  });

  it('builds docker compose config', () => {
    const cmd = buildComposeCommand('docker', 'config', {
      composeFile: '/path/to/compose.yml',
    });
    expect(cmd).toEqual([
      'docker', 'compose',
      '-f', '/path/to/compose.yml',
      'config',
    ]);
  });

  it('builds podman compose up', () => {
    const cmd = buildComposeCommand('podman', 'up', {});
    expect(cmd).toEqual(['podman', 'compose', 'up', '-d']);
  });

  it('builds podman compose down with compose file', () => {
    const cmd = buildComposeCommand('podman', 'down', {
      composeFile: '/etc/compose.yml',
    });
    expect(cmd).toEqual([
      'podman', 'compose',
      '-f', '/etc/compose.yml',
      'down',
    ]);
  });

  it('wraps docker compose commands for WSL engine hosts', () => {
    const wslExe = ['wsl', 'exe'].join('.');
    const cmd = buildComposeCommand('docker', 'up', {
      engineHost: 'wsl',
      wslDistro: 'Ubuntu',
    });

    expect(cmd.slice(0, 6)).toEqual([
      wslExe,
      '-d',
      'Ubuntu',
      '--',
      'docker',
      'compose',
    ]);
  });

  it('keeps docker and podman compose direct for desktop-linux engine hosts', () => {
    expect(buildComposeCommand('docker', 'down', {
      engineHost: 'desktop-linux',
    })).toEqual(['docker', 'compose', 'down']);
    expect(buildComposeCommand('podman', 'down', {
      engineHost: 'desktop-linux',
    })).toEqual(['podman', 'compose', 'down']);
  });

  it('throws when WSL engine host has no distro', () => {
    expect(() => buildComposeCommand('docker', 'up', {
      engineHost: 'wsl',
    })).toThrow('container_engine_host=wsl requires container_engine_wsl_distro');
  });

  it('resolves the default compose file for docker', () => {
    expect(resolveDefaultComposeFile('docker')).toBe(
      'docker/compose/docker-compose.yml',
    );
    expect(DEFAULT_COMPOSE_FILE).toBe('docker/compose/docker-compose.yml');
  });

  it('resolves the default compose file for podman', () => {
    expect(resolveDefaultComposeFile('podman')).toBe(
      'podman/compose/podman-compose.yml',
    );
  });
});
