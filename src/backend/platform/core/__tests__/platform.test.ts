import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isWindowsPlatform,
  isMacOSPlatform,
  isLinuxPlatform,
  isWSLWindowsPath,
  toEngineHostPath,
  toContainerPath,
  _resetPlatformDetectionForTests,
} from '../platform.js';

describe('platform predicates', () => {
  beforeEach(() => {
    _resetPlatformDetectionForTests();
  });

  it('returns mutually-exclusive booleans for the host platform', () => {
    const flags = [isWindowsPlatform(), isMacOSPlatform(), isLinuxPlatform()];
    const trueCount = flags.filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it('isWSLWindowsPath returns false on macOS/Windows hosts', () => {
    if (isMacOSPlatform() || isWindowsPlatform()) {
      expect(isWSLWindowsPath('/mnt/c/Users/foo')).toBe(false);
    }
  });

  it('isWSLWindowsPath rejects non-/mnt paths even on Linux', () => {
    if (isLinuxPlatform()) {
      expect(isWSLWindowsPath('/home/user/foo')).toBe(false);
      expect(isWSLWindowsPath('/etc/passwd')).toBe(false);
    }
  });

  it('isWSLWindowsPath accepts /mnt/<letter>/ shape on WSL only', () => {
    // The WSL gate is internal; we only assert shape acceptance here.
    if (process.env['WSL_DISTRO_NAME']) {
      expect(isWSLWindowsPath('/mnt/c/Users/foo')).toBe(true);
      expect(isWSLWindowsPath('/mnt/D/Users/foo')).toBe(true);
    }
  });
});

describe('toContainerPath', () => {
  it('joins a host path under the mount source onto the container target as POSIX', () => {
    const result = toContainerPath(
      '/host/repo/AgentWorkSpace/qmd',
      '/host/repo',
      '/workspace',
    );
    expect(result).toBe('/workspace/AgentWorkSpace/qmd');
  });

  it('throws when host path is not under the mount source', () => {
    expect(() =>
      toContainerPath('/etc/passwd', '/host/repo', '/workspace'),
    ).toThrow(/not under bind-mount source/);
  });

  it('rejects sibling paths that merely share the mount-source prefix', () => {
    expect(() =>
      toContainerPath('/host/repo-sibling/file', '/host/repo', '/workspace'),
    ).toThrow(/not under bind-mount source/);
  });

  it('emits POSIX path separators regardless of host OS', () => {
    const result = toContainerPath(
      '/host/repo/sub/dir',
      '/host/repo',
      '/mnt/x',
    );
    expect(result).not.toContain('\\');
    expect(result.startsWith('/mnt/x/')).toBe(true);
  });
});

describe('toEngineHostPath', () => {
  it('passes through host paths on macOS, native Linux, native Windows', () => {
    if (!process.env['WSL_DISTRO_NAME']) {
      expect(toEngineHostPath('/Users/foo')).toBe('/Users/foo');
      expect(toEngineHostPath('C:\\Users\\foo')).toBe('C:\\Users\\foo');
    }
  });

  it('fails clearly when WSL engine host is requested without a distro', () => {
    expect(() =>
      toEngineHostPath('C:\\Users\\foo', { engineHost: 'wsl', wslDistro: null }),
    ).toThrow(/container_engine_wsl_distro/);
  });
});
