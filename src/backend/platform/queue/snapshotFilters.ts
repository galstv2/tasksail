import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import type { TaskJson } from './taskJson.js';

export const DEFAULT_SNAPSHOT_NOISE_DENY = [
  '**/bin/**',
  '**/obj/**',
  '**/target/**',
  '**/build/**',
  '**/dist/**',
  '**/out/**',
  '**/node_modules/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.parcel-cache/**',
  '**/.turbo/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/.venv/**',
  '**/venv/**',
  '**/.tox/**',
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  '**/.ruff_cache/**',
  '**/.gradle/**',
  '**/.mvn/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/htmlcov/**',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/.cache/**',
];

export interface SnapshotFilterConfig {
  denyGlobs: string[];
  allowOverrides: string[];
}

interface ContextPackSnapshotFilters {
  additional_deny_globs?: unknown;
  allow_overrides?: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export async function resolveSnapshotFilterConfig(
  _repoRoot: string,
  taskJson: TaskJson,
): Promise<SnapshotFilterConfig> {
  const contextPackPath = taskJson.contextPackBinding.contextPackPath;
  let filters: ContextPackSnapshotFilters = {};
  if (contextPackPath) {
    try {
      const parsed = JSON.parse(await readFile(contextPackPath, 'utf-8')) as {
        snapshot_filters?: ContextPackSnapshotFilters;
      };
      filters = parsed.snapshot_filters ?? {};
    } catch {
      filters = {};
    }
  }
  return {
    denyGlobs: [...DEFAULT_SNAPSHOT_NOISE_DENY, ...stringArray(filters.additional_deny_globs)],
    allowOverrides: stringArray(filters.allow_overrides),
  };
}

/**
 * Build the deny pathspec for the snapshot's primary `git add -A` pass.
 *
 * NOTE: this intentionally does NOT include `allow_overrides`. Git pathspec
 * semantics evaluate excludes AFTER the positive set is computed, so appending
 * `:(glob)X` next to `:(exclude,glob)X` does not re-include X. Re-inclusion
 * MUST be done as a separate `git add -- <buildAllowOverridesPathspec()>`
 * invocation by the caller (see `commitTaskSnapshot`). The override pass does
 * not pass `-f`, so files matched by `.gitignore` remain excluded — the
 * override mechanism only re-includes files filtered by the platform denylist.
 */
export function buildAddPathspec(cfg: SnapshotFilterConfig): string[] {
  return [
    '.',
    ...cfg.denyGlobs.map((glob) => `:(exclude,glob)${glob}`),
  ];
}

/**
 * Build the pathspec for the override pass. Returns an empty array when the
 * config has no overrides — callers MUST skip the second `git add` in that
 * case (git refuses an empty pathspec).
 */
export function buildAllowOverridesPathspec(cfg: SnapshotFilterConfig): string[] {
  return cfg.allowOverrides.map((glob) => `:(glob)${glob}`);
}

function runGit(repoRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `git exited ${code}`));
    });
  });
}

export async function listNoiseSkippedPaths(
  worktreeRoot: string,
  cfg: SnapshotFilterConfig,
): Promise<string[]> {
  if (cfg.denyGlobs.length === 0) return [];
  const stdout = await runGit(worktreeRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    ...cfg.denyGlobs.map((glob) => `:(glob)${glob}`),
  ]);
  const allow = cfg.allowOverrides.map((glob) => glob.replace(/\*\*$/, '').replace(/\*$/, ''));
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !allow.some((prefix) => prefix && file.startsWith(prefix)))
    .sort((a, b) => a.localeCompare(b));
}

export function formatSkippedNoiseWarning(
  worktreeRoot: string,
  originalRoot: string,
  skipped: string[],
): string {
  return `[snapshot] ${worktreeRoot}: noise denylist skipped ` +
    `${skipped.length} file(s) not covered by .gitignore: ` +
    `${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ` (+${skipped.length - 5} more)` : ''}\n` +
    `Consider adding these to ${path.join(originalRoot, '.gitignore')}.`;
}
