import { describe, it, expect, vi } from 'vitest';

// Default-passthrough mock for `core.toEngineHostPath`. The compose builder
// pipes `composeFile` through this helper before emitting `-f`, so without a
// stub the real implementation would shell out to `wsl.exe` / `wslpath` in
// the WSL test case below. The default identity behavior preserves the
// existing tests' expectations (paths flow through unchanged) while the new
// WSL test overrides per-call to assert on the translation wiring.
//
// `vi.hoisted` is required because `vi.mock` is hoisted to the top of the
// file by Vitest; without hoisting the mock variable in tandem, the factory
// would dereference `toEngineHostPathMock` before its `const` initializer ran.
const { toEngineHostPathMock } = vi.hoisted(() => ({
  toEngineHostPathMock: vi.fn((p: string) => p),
}));

vi.mock('../../core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/index.js')>();
  return {
    ...actual,
    toEngineHostPath: toEngineHostPathMock,
  };
});

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

  it('includes multiple compose file flags in order', () => {
    const cmd = buildComposeCommand('docker', 'up', {
      composeFile: '/path/to/ignored.yml',
      composeFiles: [
        '/path/to/docker-compose.yml',
        '/path/to/shared-mcp-compose.override.yml',
      ],
    });
    expect(cmd).toEqual([
      'docker', 'compose',
      '-f', '/path/to/docker-compose.yml',
      '-f', '/path/to/shared-mcp-compose.override.yml',
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

  it('scopes compose down to a project name', () => {
    const cmd = buildComposeCommand('docker', 'down', {
      composeFile: '/path/to/docker-compose.yml',
      projectName: 'tasksail-legacy-task',
    });
    expect(cmd).toEqual([
      'docker', 'compose',
      '-p', 'tasksail-legacy-task',
      '-f', '/path/to/docker-compose.yml',
      'down',
    ]);
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

  it('translates composeFile through toEngineHostPath for WSL engine hosts', () => {
    // Stand in for the wsl.exe + wslpath shell-out so the test runs on any host.
    // The fixed input/output is a representative C: drive translation; we only
    // assert the wiring (composeFile → toEngineHostPath → -f arg), not the
    // translation logic itself (covered by platform.test.ts).
    toEngineHostPathMock.mockImplementationOnce(
      () => '/mnt/c/repo/docker-compose.yml',
    );

    const cmd = buildComposeCommand('docker', 'up', {
      engineHost: 'wsl',
      wslDistro: 'Ubuntu',
      composeFile: 'C:\\repo\\docker-compose.yml',
    });

    expect(toEngineHostPathMock).toHaveBeenCalledWith(
      'C:\\repo\\docker-compose.yml',
      { engineHost: 'wsl', wslDistro: 'Ubuntu' },
    );
    const fIdx = cmd.indexOf('-f');
    expect(fIdx).toBeGreaterThanOrEqual(0);
    expect(cmd[fIdx + 1]).toBe('/mnt/c/repo/docker-compose.yml');
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
      'runtime/docker/compose/docker-compose.yml',
    );
    expect(DEFAULT_COMPOSE_FILE).toBe('runtime/docker/compose/docker-compose.yml');
  });

  it('resolves the default compose file for podman', () => {
    expect(resolveDefaultComposeFile('podman')).toBe(
      'runtime/podman/compose/podman-compose.yml',
    );
  });
});
