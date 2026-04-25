import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ContainerEngineHost } from './types.js';

/** True when running on native Windows (not WSL). */
export function isWindowsPlatform(): boolean {
  return process.platform === 'win32';
}

/** True when running on macOS. */
export function isMacOSPlatform(): boolean {
  return process.platform === 'darwin';
}

/** True when running on a Linux kernel (includes WSL). */
export function isLinuxPlatform(): boolean {
  return process.platform === 'linux';
}

let _isWSL: boolean | undefined;

/** True when running inside Windows Subsystem for Linux. */
export function isWSL(): boolean {
  if (_isWSL === undefined) {
    _isWSL = false;
    if (process.platform === 'linux') {
      if (process.env['WSL_DISTRO_NAME']) {
        _isWSL = true;
      } else {
        try {
          const release = readFileSync('/proc/version', 'utf-8');
          _isWSL = /microsoft/i.test(release);
        } catch {
          _isWSL = false;
        }
      }
    }
  }
  return _isWSL;
}

/** True when path is on a Windows filesystem accessed via WSL's /mnt/<drive>/ bridge. */
export function isWSLWindowsPath(filePath: string): boolean {
  return isWSL() && /^\/mnt\/[a-zA-Z]\//.test(filePath);
}

let _isDockerDesktop: boolean | undefined;

/**
 * Detects whether Docker Desktop is the active backend for the `docker` CLI.
 * Docker Desktop's WSL integration creates a proxy CLI whose context endpoint
 * is `npipe://` (Windows) or `desktop-linux`. Native Linux Docker reports
 * `unix://`. Memoized — context cannot change during process lifetime.
 */
export function isDockerDesktopBackend(): boolean {
  if (_isDockerDesktop !== undefined) return _isDockerDesktop;
  _isDockerDesktop = false;
  try {
    const ctx = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    _isDockerDesktop = ctx.includes('npipe://') || ctx.includes('desktop-linux');
  } catch {
    _isDockerDesktop = false;
  }
  return _isDockerDesktop;
}

/** Test-only cache reset. Throws outside NODE_ENV=test. */
export function _resetPlatformDetectionForTests(): void {
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error('_resetPlatformDetectionForTests called outside test env');
  }
  _isWSL = undefined;
  _isDockerDesktop = undefined;
}

export interface EngineHostPathOptions {
  engineHost?: ContainerEngineHost;
  wslDistro?: string | null;
}

export function toEngineHostPath(
  hostPath: string,
  options: EngineHostPathOptions = {},
): string {
  if (options.engineHost === 'wsl') {
    if (!options.wslDistro) {
      throw new Error('container_engine_host=wsl requires container_engine_wsl_distro');
    }
    if (!isWindowsPlatform()) {
      throw new Error('container_engine_host=wsl requires a native Windows platform process');
    }
    return execFileSync(
      'wsl.exe',
      ['-d', options.wslDistro, '--', 'wslpath', '-a', '-u', hostPath],
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
  }

  if (!isWSLWindowsPath(hostPath) || !isDockerDesktopBackend()) {
    return hostPath;
  }
  try {
    return execFileSync('wslpath', ['-w', hostPath], {
      encoding: 'utf-8',
    }).trim();
  } catch {
    const m = hostPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (m) return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
    return hostPath;
  }
}

export function toContainerPath(
  hostPath: string,
  mountSource: string,
  mountTarget: string,
): string {
  const normalizedHost = path.resolve(hostPath);
  const normalizedSource = path.resolve(mountSource);
  const rel = path.relative(normalizedSource, normalizedHost);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `path ${hostPath} is not under bind-mount source ${mountSource}`,
    );
  }
  return path.posix.join(mountTarget, rel.split(path.sep).join('/'));
}
