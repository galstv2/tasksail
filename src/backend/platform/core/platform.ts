import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ContainerEngineHost } from './types.js';

// Keep direct process.platform reads centralized in this module — callers
// should use the predicates below rather than touching process.platform.

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

/**
 * Return the volume root for a Windows path: the drive letter form ("C:\")
 * or the volume GUID prefix ("\\?\Volume{...}\"). Used to compare two
 * paths' volume identity without parsing UNC paths or symlinks.
 *
 * Returns null on non-Windows platforms or when the input cannot be parsed.
 * Does not touch the filesystem.
 */
export function windowsVolumeRoot(p: string): string | null {
  if (!isWindowsPlatform()) return null;
  const driveMatch = /^([A-Za-z]:)[\\/]/.exec(p);
  if (driveMatch) return `${driveMatch[1].toUpperCase()}\\`;
  const guidMatch = /^(\\\\\?\\Volume\{[0-9a-fA-F-]+\})\\/.exec(p);
  if (guidMatch) return `${guidMatch[1]}\\`;
  return null;
}

/** Lowercased filesystem name as reported by `fsutil fsinfo volumeinfo`. */
export type WindowsFilesystemName = 'ntfs' | 'refs' | 'exfat' | string;

const WINDOWS_REFS_FILESYSTEM: WindowsFilesystemName = 'refs';

const _winFsTypeCache = new Map<string, WindowsFilesystemName | null>();

/**
 * Probe the filesystem type of a Windows volume root via `fsutil fsinfo
 * volumeinfo`. Returns the lowercased filesystem name ("ntfs", "refs", "exfat")
 * or null on non-Windows platforms or when fsutil fails.
 *
 * Memoized per volume root for the process lifetime. fsutil output is stable
 * for the lifetime of a Windows volume mount.
 */
export function windowsVolumeFilesystemType(
  volumeRoot: string,
): WindowsFilesystemName | null {
  if (!isWindowsPlatform()) return null;
  // Cached value may legitimately be null (fsutil failure) — preserve null.
  if (_winFsTypeCache.has(volumeRoot)) return _winFsTypeCache.get(volumeRoot) ?? null;
  let fsName: WindowsFilesystemName | null = null;
  try {
    const out = execFileSync('fsutil', ['fsinfo', 'volumeinfo', volumeRoot], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const match = /File System Name\s*:\s*(\w+)/i.exec(out);
    fsName = match ? match[1].toLowerCase() : null;
  } catch {
    fsName = null;
  }
  _winFsTypeCache.set(volumeRoot, fsName);
  return fsName;
}

/**
 * True when both paths resolve to the same Windows volume root and that volume
 * is formatted as ReFS. Returns false on non-Windows hosts.
 *
 * Best-effort: UNC roots (`\\server\share`, Dev Drive UNC) are not recognized as
 * ReFS volumes here, so the CoW reflink optimization is skipped for them and the
 * code falls back to a plain copy. That is a performance/experience limitation,
 * not a correctness one — the copy fallback preserves correct behavior.
 */
export function windowsVolumesShareReFS(
  srcPath: string,
  dstPath: string,
): boolean {
  const srcRoot = windowsVolumeRoot(srcPath);
  const dstRoot = windowsVolumeRoot(dstPath);
  if (!srcRoot || !dstRoot || srcRoot !== dstRoot) return false;
  return windowsVolumeFilesystemType(srcRoot) === WINDOWS_REFS_FILESYSTEM;
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
  _winFsTypeCache.clear();
  _engineHostPathCache.clear();
}

export interface EngineHostPathOptions {
  engineHost?: ContainerEngineHost;
  wslDistro?: string | null;
}

const _engineHostPathCache = new Map<string, string>();

export function toEngineHostPath(
  hostPath: string,
  options: EngineHostPathOptions = {},
): string {
  const cacheKey = `${options.engineHost ?? ''}\0${options.wslDistro ?? ''}\0${hostPath}`;
  const cached = _engineHostPathCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const translated = translateEngineHostPath(hostPath, options);
  _engineHostPathCache.set(cacheKey, translated);
  return translated;
}

function translateEngineHostPath(
  hostPath: string,
  options: EngineHostPathOptions,
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
