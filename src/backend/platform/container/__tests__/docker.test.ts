import { describe, it, expect, vi } from 'vitest';

// Mock toEngineHostPath so the WSL test does not shell out.
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

import { buildComposeBaseCommand, buildComposeCommand } from '../compose.js';

describe('production compose command form', () => {
  it('docker backend uses integrated [docker, compose] form', () => {
    const cmd = buildComposeBaseCommand('docker', {});
    expect(cmd).toEqual(['docker', 'compose']);
  });

  it('podman backend uses integrated [podman, compose] form', () => {
    const cmd = buildComposeBaseCommand('podman', {});
    expect(cmd).toEqual(['podman', 'compose']);
  });

  it('docker up produces integrated compose command', () => {
    const cmd = buildComposeCommand('docker', 'up', {});
    expect(cmd[0]).toBe('docker');
    expect(cmd[1]).toBe('compose');
  });

  it('podman up produces integrated compose command', () => {
    const cmd = buildComposeCommand('podman', 'up', {});
    expect(cmd[0]).toBe('podman');
    expect(cmd[1]).toBe('compose');
  });

  it('WSL engine mode wraps docker with [wsl.exe, -d, distro, --, docker, compose]', () => {
    const cmd = buildComposeBaseCommand('docker', { engineHost: 'wsl', wslDistro: 'Ubuntu' });
    expect(cmd).toEqual(['wsl.exe', '-d', 'Ubuntu', '--', 'docker', 'compose']);
  });

  it('WSL engine mode wraps podman with [wsl.exe, -d, distro, --, podman, compose]', () => {
    const cmd = buildComposeBaseCommand('podman', { engineHost: 'wsl', wslDistro: 'Debian' });
    expect(cmd).toEqual(['wsl.exe', '-d', 'Debian', '--', 'podman', 'compose']);
  });

  it('WSL engine mode full command starts with wsl.exe prefix then backend compose', () => {
    toEngineHostPathMock.mockImplementationOnce(() => '/mnt/c/repo/docker-compose.yml');

    const cmd = buildComposeCommand('docker', 'up', {
      engineHost: 'wsl',
      wslDistro: 'Ubuntu',
      composeFile: 'C:\\repo\\docker-compose.yml',
    });

    expect(cmd.slice(0, 6)).toEqual(['wsl.exe', '-d', 'Ubuntu', '--', 'docker', 'compose']);
  });

  it('standalone docker-compose is never used as the base command for docker', () => {
    const cmd = buildComposeBaseCommand('docker', {});
    expect(cmd).not.toContain('docker-compose');
  });

  it('standalone podman-compose is never used as the base command for podman', () => {
    const cmd = buildComposeBaseCommand('podman', {});
    expect(cmd).not.toContain('podman-compose');
  });
});
