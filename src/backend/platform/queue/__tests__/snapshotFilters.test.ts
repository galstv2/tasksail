import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  DEFAULT_SNAPSHOT_NOISE_DENY,
  buildAddPathspec,
  listNoiseSkippedPaths,
  resolveSnapshotFilterConfig,
} from '../snapshotFilters.js';
import { commitTaskSnapshot } from '../errorItems.js';
import type { TaskJson } from '../taskJson.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function baseTaskJson(contextPackPath: string | null): TaskJson {
  return {
    schema_version: 1,
    taskId: 'task-a',
    contextPackBinding: {
      contextPackPath,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: [],
    },
    materialization: { strategy: 'copy', cloned: [], skipped: [] },
    frozenAt: new Date().toISOString(),
    finalizedAt: null,
    state: 'active',
  };
}

interface SetupResult {
  taskId: string;
  worktreeRoot: string;
  branch: string;
  baseSha: string;
  contextPackPath: string | null;
}

interface ContextPackFilters {
  additional_deny_globs?: string[];
  allow_overrides?: string[];
}

/**
 * Create a real `git worktree add -b task/<id>` plus the matching `.task.json`
 * sidecar so `commitTaskSnapshot(repoRoot, taskId, ...)` can resolve bindings
 * and run `git add -A` inside the worktree.
 */
function setupTaskWorktree(
  repoRoot: string,
  taskId: string,
  filters?: ContextPackFilters,
): SetupResult {
  const branch = `task/${taskId}`;
  const worktreeRoot = path.join(repoRoot, '.task-worktrees', taskId);
  mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  git(repoRoot, ['worktree', 'add', '-b', branch, worktreeRoot]);
  const baseSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();

  let contextPackPath: string | null = null;
  if (filters) {
    contextPackPath = path.join(repoRoot, `pack-${taskId}.json`);
    writeFileSync(contextPackPath, JSON.stringify({ snapshot_filters: filters }));
  }

  const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(taskDir, { recursive: true });
  const sidecar: TaskJson = {
    schema_version: 2,
    taskId,
    contextPackBinding: {
      contextPackPath,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: [
        {
          originalRoot: repoRoot,
          worktreeRoot,
          worktreeBranch: branch,
          baseCommitSha: baseSha,
        },
      ],
    },
    materialization: { strategy: 'copy', cloned: [], skipped: [] },
    frozenAt: new Date().toISOString(),
    finalizedAt: null,
    state: 'active',
  };
  writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify(sidecar));

  return { taskId, worktreeRoot, branch, baseSha, contextPackPath };
}

function commitsSinceBase(repoRoot: string, branch: string, baseSha: string): number {
  const out = git(repoRoot, ['rev-list', '--count', `${baseSha}..${branch}`]).trim();
  return Number.parseInt(out, 10);
}

function tipFiles(repoRoot: string, branch: string): string[] {
  // Files touched by the tip commit on the branch (vs. its parent).
  const out = git(repoRoot, ['show', '--name-only', '--pretty=format:', branch]);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

describe('snapshotFilters', () => {
  let repoRoot: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-snapshot-filters-'));
    git(repoRoot, ['init']);
    git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
    git(repoRoot, ['config', 'user.name', 'Test User']);
    writeFileSync(path.join(repoRoot, 'README.md'), '# test\n');
    git(repoRoot, ['add', 'README.md']);
    git(repoRoot, ['commit', '-m', 'init']);
    // commitTaskSnapshot logs a noise-skipped warning; silence it across the suite.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('builds default deny pathspecs for git add', () => {
    const pathspec = buildAddPathspec({ denyGlobs: DEFAULT_SNAPSHOT_NOISE_DENY, allowOverrides: [] });

    expect(pathspec[0]).toBe('.');
    expect(pathspec).toContain(':(exclude,glob)**/bin/**');
    expect(pathspec).toContain(':(exclude,glob)**/node_modules/**');
    expect(pathspec).toContain(':(exclude,glob)**/__pycache__/**');
  });

  it('lists untracked denylist noise not covered by .gitignore', async () => {
    mkdirSync(path.join(repoRoot, 'bin', 'Debug'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'bin', 'Debug', 'Acme.dll'), 'dll');
    writeFileSync(path.join(repoRoot, 'Routes.cs'), 'source');

    const skipped = await listNoiseSkippedPaths(repoRoot, {
      denyGlobs: DEFAULT_SNAPSHOT_NOISE_DENY,
      allowOverrides: [],
    });

    expect(skipped).toContain('bin/Debug/Acme.dll');
    expect(skipped).not.toContain('Routes.cs');
  });

  it('does not warn for gitignored noise', async () => {
    writeFileSync(path.join(repoRoot, '.gitignore'), 'bin/\n');
    mkdirSync(path.join(repoRoot, 'bin', 'Debug'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'bin', 'Debug', 'Acme.dll'), 'dll');

    const skipped = await listNoiseSkippedPaths(repoRoot, {
      denyGlobs: DEFAULT_SNAPSHOT_NOISE_DENY,
      allowOverrides: [],
    });

    expect(skipped).not.toContain('bin/Debug/Acme.dll');
  });

  it('loads context-pack additional deny globs and allow overrides', async () => {
    const packDir = path.join(repoRoot, 'pack');
    mkdirSync(packDir, { recursive: true });
    const contextPackPath = path.join(packDir, 'context-pack.json');
    writeFileSync(contextPackPath, JSON.stringify({
      snapshot_filters: {
        additional_deny_globs: ['**/vendor-cache/**'],
        allow_overrides: ['dist/published-package/**'],
      },
    }));

    const cfg = await resolveSnapshotFilterConfig(repoRoot, baseTaskJson(contextPackPath));

    expect(cfg.denyGlobs).toContain('**/vendor-cache/**');
    expect(cfg.allowOverrides).toEqual(['dist/published-package/**']);
  });

  // ---------------------------------------------------------------------------
  // Spec §6.6 — commitTaskSnapshot end-to-end against a real worktree
  // ---------------------------------------------------------------------------

  it('default denylist excludes bin/Debug/net8.0/Acme.dll from the snapshot commit', async () => {
    const { taskId, worktreeRoot, branch, baseSha } = setupTaskWorktree(repoRoot, 'task-bin');
    mkdirSync(path.join(worktreeRoot, 'bin', 'Debug', 'net8.0'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'bin', 'Debug', 'net8.0', 'Acme.dll'), 'dll-bytes');
    writeFileSync(path.join(worktreeRoot, 'Routes.cs'), 'public class Routes {}\n');

    const ok = await commitTaskSnapshot(repoRoot, taskId, 'completed');
    expect(ok).toBe(true);

    expect(commitsSinceBase(repoRoot, branch, baseSha)).toBe(1);
    const files = tipFiles(repoRoot, branch);
    expect(files).toContain('Routes.cs');
    expect(files.some((f) => f.startsWith('bin/'))).toBe(false);

    const binLog = git(repoRoot, ['log', branch, '--oneline', '--', 'bin/']).trim();
    expect(binLog).toBe('');
  });

  it.each([
    ['node_modules/foo/index.js', 'node_modules/foo'],
    ['__pycache__/x.cpython-313.pyc', '__pycache__'],
    ['.venv/lib/python/site.py', '.venv/lib/python'],
    ['target/release/app', 'target/release'],
  ])('default denylist excludes %s', async (noisePath, dirToCreate) => {
    const taskId = `task-matrix-${noisePath.replace(/[^a-z0-9]+/gi, '-')}`;
    const { worktreeRoot, branch, baseSha } = setupTaskWorktree(repoRoot, taskId);
    mkdirSync(path.join(worktreeRoot, dirToCreate), { recursive: true });
    writeFileSync(path.join(worktreeRoot, noisePath), 'noise');
    writeFileSync(path.join(worktreeRoot, 'control.txt'), 'real edit\n');

    const ok = await commitTaskSnapshot(repoRoot, taskId, 'completed');
    expect(ok).toBe(true);

    expect(commitsSinceBase(repoRoot, branch, baseSha)).toBe(1);
    const files = tipFiles(repoRoot, branch);
    expect(files).toContain('control.txt');
    expect(files).not.toContain(noisePath);
  });

  it('allow_overrides re-includes a denylist-matching path', async () => {
    const { taskId, worktreeRoot, branch, baseSha } = setupTaskWorktree(repoRoot, 'task-allow', {
      allow_overrides: ['dist/published-package/**'],
    });
    mkdirSync(path.join(worktreeRoot, 'dist', 'published-package'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'dist', 'published-package', 'index.js'), 'export {}\n');
    writeFileSync(path.join(worktreeRoot, 'dist', 'junk.js'), 'noise\n');

    const ok = await commitTaskSnapshot(repoRoot, taskId, 'completed');
    expect(ok).toBe(true);

    expect(commitsSinceBase(repoRoot, branch, baseSha)).toBe(1);
    const files = tipFiles(repoRoot, branch);
    expect(files).toContain('dist/published-package/index.js');
    expect(files).not.toContain('dist/junk.js');
  });

  it('empty staged tree after filtering still no-ops cleanly', async () => {
    const { taskId, worktreeRoot, branch, baseSha } = setupTaskWorktree(repoRoot, 'task-empty');
    // Only noise — no real edits.
    mkdirSync(path.join(worktreeRoot, 'bin', 'Debug'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'bin', 'Debug', 'Acme.dll'), 'dll');

    const ok = await commitTaskSnapshot(repoRoot, taskId, 'completed');
    expect(ok).toBe(true);

    expect(commitsSinceBase(repoRoot, branch, baseSha)).toBe(0);
    expect(git(repoRoot, ['rev-parse', branch]).trim()).toBe(baseSha);
  });

  it('allow_overrides on a path also matched by .gitignore is still excluded', async () => {
    // .gitignore lives in the SOURCE repo at the baseline commit so the worktree
    // inherits it. allow_overrides operates on the platform denylist, not on
    // .gitignore — so a gitignored path stays out of the snapshot.
    writeFileSync(path.join(repoRoot, '.gitignore'), 'dist/\n');
    git(repoRoot, ['add', '.gitignore']);
    git(repoRoot, ['commit', '-m', 'add gitignore']);

    const { taskId, worktreeRoot, branch, baseSha } = setupTaskWorktree(repoRoot, 'task-gitignore-allow', {
      allow_overrides: ['dist/**'],
    });
    mkdirSync(path.join(worktreeRoot, 'dist'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'dist', 'gitignored.js'), 'gitignored\n');
    writeFileSync(path.join(worktreeRoot, 'src.js'), 'real edit\n');

    const ok = await commitTaskSnapshot(repoRoot, taskId, 'completed');
    expect(ok).toBe(true);

    // Real edit lands; gitignored file does not, even though allow_overrides matches.
    expect(commitsSinceBase(repoRoot, branch, baseSha)).toBe(1);
    const files = tipFiles(repoRoot, branch);
    expect(files).toContain('src.js');
    expect(files).not.toContain('dist/gitignored.js');
  });
});
