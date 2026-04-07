/**
 * Shared types and utility functions used by both the context pack catalog
 * (main.contextPackCatalog.ts) and the context pack actions (main.contextPackActions.ts).
 */
import { join, relative, resolve } from 'node:path';
import { REPO_ROOT } from './paths';
import { stringOrNull } from './utils';

export const CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH = join(
  REPO_ROOT,
  'src/backend/scripts/python/bootstrap-context-pack.py',
);
export const CONTEXT_ESTATE_DISCOVERY_SCRIPT_PATH = join(
  REPO_ROOT,
  'src/backend/scripts/python/discover-context-estate.py',
);
export const QMD_SEED_PLAN_SCRIPT_PATH = join(
  REPO_ROOT,
  'src/backend/scripts/python/plan-qmd-seeding.py',
);
export const REPO_CONTEXT_APP_PATH = join(
  REPO_ROOT,
  'src/backend/scripts/python/repo-context-app.py',
);
export const REPO_CONTEXT_PYTHON_BIN =
  process.env.DESKTOP_REPO_CONTEXT_PYTHON_BIN ??
  (process.platform === 'win32' ? 'python' : 'python3');

export type ScriptResult = {
  stdout: string;
  stderr: string;
};

export type ContextPackWorkspaceScriptRunner = (
  args: string[],
) => Promise<ScriptResult>;

export type ContextPackReseedRunner = (
  args: string[],
) => Promise<ScriptResult>;

export type PythonScriptRunner = (
  args: string[],
) => Promise<ScriptResult>;

export type ApprovedContextPackDirReader = () => Promise<Set<string>>;

export function toRepoRelativePath(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).replace(/\\/g, '/');
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

export function slugifyValue(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'context-pack';
}

export function titleizeValue(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (segment) => segment.toUpperCase()) || 'Context Pack';
}

export function portablePathBasename(filePath: string): string {
  const trimmedPath = filePath.trim().replace(/[\\/]+$/, '');
  if (!trimmedPath) {
    return '';
  }

  const segments = trimmedPath.split(/[\\/]+/).filter(Boolean);
  const candidate = segments.at(-1) ?? '';
  return /^[A-Za-z]:$/.test(candidate) ? '' : candidate;
}

export { stringOrNull, resolve };
