import { spawn } from 'node:child_process';
import path from 'node:path';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';

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

export function validateDaltonBoundaryChanges(options: {
  platformRepoRoot: string;
  focused: FocusedRepoResult;
  before: ChangedPathsSnapshot;
  after: ChangedPathsSnapshot;
}): void {
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
        violations.push(path.join(repoRoot, relativePath));
      }
    }
  }

  if (violations.length > 0) {
    throw new DaltonConfinementError(
      `Dalton edited files outside the enforced primary boundary: ${violations.join(', ')}`,
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
  if (options.repoRoot === options.platformRepoRoot) {
    return ALLOWED_PLATFORM_WRITE_PATHS.includes(normalizedPath as (typeof ALLOWED_PLATFORM_WRITE_PATHS)[number]);
  }

  if (options.repoRoot !== options.focused.primaryRepoRoot) {
    return false;
  }

  if (!options.focused.primaryFocusRelativePath) {
    return true;
  }

  const focusPath = normalizeRelativePath(options.focused.primaryFocusRelativePath);
  return normalizedPath === focusPath || normalizedPath.startsWith(`${focusPath}/`);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
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
