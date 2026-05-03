import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isMissingPathError } from '../core/index.js';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';
import { hasTraversal, normalizeRelativePath, type WritableRoot } from '../context-pack/deepFocusNormalization.js';

export interface ChangedPathsSnapshot {
  byRepoRoot: Record<string, string[]>;
}

export class DaltonConfinementError extends Error {
  readonly violationPaths: string[];

  constructor(message: string, violationPaths: string[]) {
    super(message);
    this.name = 'DaltonConfinementError';
    this.violationPaths = violationPaths;
  }
}

const ALLOWED_PLATFORM_WRITE_PATHS = [] as const;
const SAFETY_SKEW_MS = 2000;

export async function captureChangedPathsSnapshot(
  repoRoots: string[],
): Promise<ChangedPathsSnapshot> {
  const entries = await Promise.all(
    [...new Set(repoRoots)].map(async (repoRoot) => [repoRoot, await listChangedPaths(repoRoot)] as const),
  );
  return {
    byRepoRoot: Object.fromEntries(entries),
  };
}

export async function validateDaltonBoundaryChanges(options: {
  platformRepoRoot: string;
  focused: FocusedRepoResult;
  before: ChangedPathsSnapshot;
  after: ChangedPathsSnapshot;
  agentSpawnedAtMs?: number;
}): Promise<void> {
  const violations: string[] = [];
  const roots = new Set([
    options.platformRepoRoot,
    ...Object.keys(options.before.byRepoRoot),
    ...Object.keys(options.after.byRepoRoot),
  ]);

  for (const repoRoot of roots) {
    const beforePaths = new Set(options.before.byRepoRoot[repoRoot] ?? []);
    const afterPaths = options.after.byRepoRoot[repoRoot] ?? [];
    for (const relativePath of afterPaths) {
      if (beforePaths.has(relativePath)) {
        continue;
      }
      if (!isAllowedChangedPath({
        repoRoot,
        relativePath,
        platformRepoRoot: options.platformRepoRoot,
        focused: options.focused,
      })) {
        const absolutePath = path.join(repoRoot, relativePath);
        try {
          const stats = await stat(absolutePath);
          if (
            options.agentSpawnedAtMs !== undefined &&
            stats.mtimeMs < options.agentSpawnedAtMs - SAFETY_SKEW_MS
          ) {
            continue;
          }
        } catch (error: unknown) {
          if (isMissingPathError(error)) {
            continue;
          }
          throw error;
        }
        violations.push(absolutePath);
      }
    }
  }

  if (violations.length > 0) {
    throw new DaltonConfinementError(
      `Dalton edited files outside the enforced writable roots: ${violations.join(', ')}`,
      violations,
    );
  }
}

function isAllowedChangedPath(options: {
  repoRoot: string;
  relativePath: string;
  platformRepoRoot: string;
  focused: FocusedRepoResult;
}): boolean {
  const normalizedPath = normalizeRelativePath(options.relativePath);
  if (normalizedPath.startsWith('/') || hasTraversal(normalizedPath)) {
    return false;
  }

  if (options.repoRoot === options.platformRepoRoot) {
    return ALLOWED_PLATFORM_WRITE_PATHS.includes(normalizedPath as (typeof ALLOWED_PLATFORM_WRITE_PATHS)[number]);
  }

  const isPrimaryRepo = options.repoRoot === options.focused.primaryRepoRoot;
  const isVisibleRepo = options.focused.visibleRepoRoots.includes(options.repoRoot);
  if (!isPrimaryRepo && !isVisibleRepo) {
    return false;
  }

  if (options.focused.writableRoots?.length) {
    const writableRootsForRepo = options.focused.writableRoots.filter((root) =>
      root.repoLocalPath === options.repoRoot || (isPrimaryRepo && root.repoLocalPath === undefined),
    );
    return writableRootsForRepo.some((root) => isWithinRelativeRoot(normalizedPath, root));
  }

  if (!isPrimaryRepo) {
    return false;
  }

  if (!options.focused.primaryFocusRelativePath) {
    return true;
  }

  const focusPath = normalizeRelativePath(options.focused.primaryFocusRelativePath);
  const primaryKind = options.focused.primaryFocusTargetKind ?? 'directory';
  const inPrimary = primaryKind === 'file'
    ? isWithinRelativeRoot(normalizedPath, {
        path: path.posix.dirname(focusPath) === '.' ? '' : path.posix.dirname(focusPath),
        kind: 'directory',
        reason: 'primary-focus-parent',
      })
    : isWithinRelativeRoot(normalizedPath, { path: focusPath, kind: 'directory', reason: 'selected-primary' });
  if (inPrimary) {
    return true;
  }

  if (options.focused.testTarget) {
    const testPath = normalizeRelativePath(options.focused.testTarget.path);
    const inTest = isWithinRelativeRoot(normalizedPath, {
      path: testPath,
      kind: options.focused.testTarget.kind,
      reason: 'test-target',
    });
    if (inTest) {
      return true;
    }
  }

  return false;
}

export function isWithinRelativeRoot(relativePath: string, root: WritableRoot): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const rootPath = normalizeRelativePath(root.path);
  if (root.kind === 'file') {
    return normalizedPath === rootPath;
  }
  if (!rootPath) {
    return true;
  }
  return normalizedPath === rootPath || normalizedPath.startsWith(`${rootPath}/`);
}

async function listChangedPaths(repoRoot: string): Promise<string[]> {
  const raw = await runGit(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!raw) {
    return [];
  }

  const parts = raw.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (!entry) {
      continue;
    }
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (filePath) {
      paths.push(normalizeRelativePath(filePath));
    }
    if (status.includes('R') || status.includes('C')) {
      // Porcelain v1 -z emits the source path as the next NUL-delimited entry
      // for renames/copies. Boundary validation keys off the resulting changed
      // path that remains after the operation; source-side cleanup edge cases
      // need deeper dedicated git coverage and are tracked separately.
      index += 1;
    }
  }

  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function runGit(repoRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error: Error) => {
      reject(new Error(`Failed to run git in ${repoRoot}: ${error.message}`, { cause: error }));
    });
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        const details = stderr.trim() || stdout.trim() || '<no output>';
        reject(new Error(`git ${args.join(' ')} failed in ${repoRoot} with exit ${code ?? 1}: ${details}`));
        return;
      }
      resolve(stdout);
    });
  });
}
