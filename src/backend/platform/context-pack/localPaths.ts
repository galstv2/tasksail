import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

export interface ManifestLocalPath {
  host: string;
  container?: string | null;
  git_root?: string | null;
}

export type ManifestLocalPathInput = string | ManifestLocalPath;

export function normalizeManifestLocalPath(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.replace(/\\/g, '/').trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const host = (value as Record<string, unknown>).host;
  if (typeof host !== 'string') {
    return null;
  }
  const normalized = host.replace(/\\/g, '/').trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeManifestGitRoot(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const gitRoot = (value as Record<string, unknown>).git_root;
  if (typeof gitRoot !== 'string') {
    return null;
  }
  const normalized = gitRoot.replace(/\\/g, '/').trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeManifestLocalPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map(normalizeManifestLocalPath)
      .filter((item): item is string => item !== null)
    : [];
}

function resolveExistingNormalizedPath(
  normalized: string | null,
  baseDir: string,
): string | undefined {
  if (!normalized) {
    return undefined;
  }
  const candidate = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(baseDir, normalized);
  if (!existsSync(candidate)) {
    return undefined;
  }
  try {
    return realpathSync(candidate);
  } catch {
    return undefined;
  }
}

export function resolveExistingManifestLocalPath(
  value: unknown,
  baseDir: string,
): string | undefined {
  return resolveExistingNormalizedPath(normalizeManifestLocalPath(value), baseDir);
}

export function resolveExistingManifestGitRoot(
  value: unknown,
  baseDir: string,
): string | undefined {
  return resolveExistingNormalizedPath(normalizeManifestGitRoot(value), baseDir);
}
