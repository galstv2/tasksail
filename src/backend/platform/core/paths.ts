import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isWindowsPlatform } from './platform.js';
import type { PlatformPaths } from './types.js';

/** Options accepted by {@link resolvePaths}. */
export interface ResolvePathsOptions {
  /** Override the repository root; defaults to {@link findRepoRoot}. */
  repoRoot?: string;
  /** Routes handoffs, implementationSteps, and taskRuntime under per-task subdirectories. */
  taskId: string;
}

/**
 * Detect the repository root by walking up from a starting directory
 * until a `.git` directory or `package.json` with our project name is found.
 */
export function findRepoRoot(startDir?: string): string {
  let dir = startDir ?? process.cwd();

  const MAX_DEPTH = 50;
  for (let i = 0; i < MAX_DEPTH; i++) {
    if (existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Could not find repo root (no .git directory found above ${startDir ?? process.cwd()})`,
  );
}

/**
 * Resolve all standard platform paths relative to the repo root.
 *
 * `handoffs`, `implementationSteps`, and `taskRuntime` are routed under
 * per-task subdirectories using the required `options.taskId`:
 *   - handoffs           → AgentWorkSpace/tasks/<taskId>/handoffs
 *   - implementationSteps → AgentWorkSpace/tasks/<taskId>/ImplementationSteps
 *   - taskRuntime        → .platform-state/runtime/tasks/<taskId>
 */
export function resolvePaths(options: ResolvePathsOptions): PlatformPaths {
  const root = options.repoRoot ?? findRepoRoot();
  const taskId = options.taskId;
  const agentWorkSpace = path.join(root, 'AgentWorkSpace');
  const taskWorktree = path.join(agentWorkSpace, 'tasks', taskId);

  return {
    repoRoot: root,
    agentWorkSpace,
    dropbox: path.join(agentWorkSpace, 'dropbox'),
    pendingItems: path.join(agentWorkSpace, 'pendingitems'),
    errorItems: path.join(agentWorkSpace, 'error-items'),
    handoffs: path.join(taskWorktree, 'handoffs'),
    templates: path.join(agentWorkSpace, 'templates'),
    implementationSteps: path.join(taskWorktree, 'ImplementationSteps'),
    qmd: path.join(agentWorkSpace, 'qmd'),
    platformState: path.join(root, '.platform-state'),
    guardrails: path.join(root, '.platform-state', 'runtime', 'guardrails'),
    taskRuntime: path.join(root, '.platform-state', 'runtime', 'tasks', taskId),
  };
}

export function logsDir(repoRoot?: string): string {
  return process.env.LOG_DIR ?? path.join(repoRoot ?? findRepoRoot(), '.platform-state', 'logs');
}

export function logFile(
  stack: 'ts' | 'py',
  level: 'info' | 'warn' | 'error',
  date: Date,
  repoRoot?: string,
): string {
  const dateStamp = date.toISOString().slice(0, 10).replaceAll('-', '');
  return path.join(logsDir(repoRoot), level, `backend-${stack}-${dateStamp}.jsonl`);
}

export function taskAgentLogFile(
  taskId: string,
  agentId: string,
  repoRoot?: string,
): string {
  return path.join(logsDir(repoRoot), 'agent', taskId, `${agentId}.jsonl`);
}

export function logFileWithSuffix(basePath: string, suffix: number): string {
  const ext = '.jsonl';
  return basePath.endsWith(ext)
    ? `${basePath.slice(0, -ext.length)}.${suffix}${ext}`
    : `${basePath}.${suffix}${ext}`;
}

/**
 * Convert a potentially relative path to an absolute path,
 * resolving against a pmse directory.
 */
export function resolvePath(pmseDir: string, pathValue: string): string {
  if (path.isAbsolute(pathValue)) {
    return pathValue;
  }
  const cleaned = pathValue.startsWith('./') ? pathValue.slice(2) : pathValue;
  return path.join(pmseDir, cleaned);
}

/** Path implementation override for deterministic cross-platform tests. */
export interface PathBoundaryOptions {
  /** Path implementation to use; defaults to the active platform's `path`. */
  impl?: path.PlatformPath;
}

/** Identity-key options: path implementation plus explicit Windows casing. */
export interface PathIdentityOptions extends PathBoundaryOptions {
  /** Force Windows-style case-folding; defaults to platform/impl detection. */
  windows?: boolean;
}

/**
 * Return true when `candidate` is equal to or nested under `boundary`.
 *
 * Uses `path.relative` so prefix-adjacent siblings (`/root` vs `/rootother`),
 * cross-drive Windows paths (`C:` vs `D:`), and `..` escapes are correctly
 * treated as outside. Windows drive/segment casing and mixed separators are
 * normalized by `path.win32.relative`. Pass `{ impl: path.win32 }` or
 * `{ impl: path.posix }` for deterministic cross-platform tests.
 */
export function isPathInsideOrEqual(
  boundary: string,
  candidate: string,
  options: PathBoundaryOptions = {},
): boolean {
  const impl = options.impl ?? path;
  const relative = impl.relative(impl.resolve(boundary), impl.resolve(candidate));
  if (relative === '') {
    return true;
  }
  if (impl.isAbsolute(relative)) {
    return false;
  }
  return relative !== '..' && !relative.startsWith('..' + impl.sep);
}

/**
 * Return true when `candidate` is equal to or nested under `boundary`.
 * Delegates to {@link isPathInsideOrEqual}; retained as the established public
 * name used by security-sensitive boundary call sites.
 */
export function isPathWithinBoundary(
  boundary: string,
  candidate: string,
): boolean {
  return isPathInsideOrEqual(boundary, candidate);
}

/**
 * Build a comparison key for path identity. Normalizes separators and `.`/`..`
 * segments via `path.resolve`, and case-folds only on Windows so drive/segment
 * casing never produces a false mismatch. The result is a comparison key only —
 * never persist or display it, as it may be lower-cased.
 */
export function pathIdentityKey(value: string, options: PathIdentityOptions = {}): string {
  const impl = options.impl ?? path;
  const windows =
    options.windows ??
    (impl === path.win32 ? true : impl === path.posix ? false : isWindowsPlatform());
  const normalized = impl.resolve(value);
  return windows ? normalized.toLowerCase() : normalized;
}

/** True when two paths refer to the same location (Windows-case-insensitive). */
export function samePathIdentity(
  left: string,
  right: string,
  options: PathIdentityOptions = {},
): boolean {
  return pathIdentityKey(left, options) === pathIdentityKey(right, options);
}

/**
 * Resolve a path to its canonical absolute form, following symlinks. Falls
 * back to {@link path.resolve} when the path does not exist on disk so callers
 * relying on canonical-form comparison still get a stable identity for
 * not-yet-materialized paths. Required so that comparisons against bindings on
 * macOS tmp dirs (where `/tmp` → `/private/tmp`) and similar symlinked roots
 * remain consistent across the boundary-check call sites.
 */
export function canonicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Validate that an output path stays within a given dropbox directory.
 * Throws if the path escapes the dropbox boundary.
 */
export function ensurePathWithinDropbox(
  dropboxDir: string,
  outputPath: string,
  entity = 'drafts',
): void {
  if (!isPathWithinBoundary(dropboxDir, path.dirname(outputPath))) {
    throw new Error(
      `${entity} must be written through dropbox/. Output must stay under ${path.resolve(dropboxDir)}.`,
    );
  }
}
