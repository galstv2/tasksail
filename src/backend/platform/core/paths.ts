import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PlatformPaths } from './types.js';

/** Options accepted by {@link resolvePaths}. */
export interface ResolvePathsOptions {
  /** Override the repository root; defaults to {@link findRepoRoot}. */
  repoRoot?: string;
  /** When set, routes handoffs, implementationSteps, and taskRuntime under per-task subdirectories. */
  taskId?: string;
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
 * When `options.taskId` is provided, `handoffs`, `implementationSteps`, and
 * `taskRuntime` are routed under per-task subdirectories:
 *   - handoffs           → AgentWorkSpace/tasks/<taskId>/handoffs
 *   - implementationSteps → AgentWorkSpace/tasks/<taskId>/ImplementationSteps
 *   - taskRuntime        → .platform-state/runtime/tasks/<taskId>
 *
 * When `taskId` is omitted the behavior is identical to the pre-refactor
 * singleton paths (full back-compat).
 */
export function resolvePaths(options: ResolvePathsOptions = {}): PlatformPaths {
  const root = options.repoRoot ?? findRepoRoot();
  const taskId = options.taskId;
  const agentWorkSpace = path.join(root, 'AgentWorkSpace');
  const taskWorktree = taskId
    ? path.join(agentWorkSpace, 'tasks', taskId)
    : null;

  return {
    repoRoot: root,
    agentWorkSpace,
    dropbox: path.join(agentWorkSpace, 'dropbox'),
    pendingItems: path.join(agentWorkSpace, 'pendingitems'),
    errorItems: path.join(agentWorkSpace, 'erroritems'),
    handoffs: taskWorktree
      ? path.join(taskWorktree, 'handoffs')
      : path.join(agentWorkSpace, 'handoffs'),
    templates: path.join(agentWorkSpace, 'templates'),
    implementationSteps: taskWorktree
      ? path.join(taskWorktree, 'ImplementationSteps')
      : path.join(agentWorkSpace, 'ImplementationSteps'),
    qmd: path.join(agentWorkSpace, 'qmd'),
    platformState: path.join(root, '.platform-state'),
    guardrails: path.join(root, '.platform-state', 'runtime', 'guardrails'),
    taskRuntime: taskId
      ? path.join(root, '.platform-state', 'runtime', 'tasks', taskId)
      : path.join(root, '.platform-state', 'runtime'),
  };
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

/**
 * Return true when `candidate` is equal to or nested under `boundary`.
 * Both paths are resolved before comparison.
 */
export function isPathWithinBoundary(
  boundary: string,
  candidate: string,
): boolean {
  const resolvedBoundary = path.resolve(boundary);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedBoundary ||
    resolvedCandidate.startsWith(resolvedBoundary + path.sep)
  );
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
