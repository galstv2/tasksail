/**
 * §B1 Worktree CWD injection — unit tests.
 *
 * Validates the FocusedRepoResult and allowedDirs rewriter helpers, plus the
 * .task.json sidecar reader path. The path-prefix substitution must defeat the
 * `/repo/foo` vs `/repo/foobar` false-positive (spec risk 5.6).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildWorktreeBindingMap,
  applyWorktreeInjectionToFocused,
  applyWorktreeInjectionToAllowedDirs,
  rewritePath,
  type WorktreeBindingMap,
} from '../worktreeInjection.js';
import type { FocusedRepoResult } from '../../context-pack/focusedRepo.js';

function makeFocused(overrides: Partial<FocusedRepoResult> = {}): FocusedRepoResult {
  return {
    primaryRepoRoot: '/repos/crud-app',
    visibleRepoRoots: ['/repos/crud-app'],
    declaredRepoRoots: ['/repos/crud-app', '/repos/shared-lib'],
    estateType: 'distributed-platform',
    primaryRepoId: 'crud-app',
    selectedRepoIds: ['crud-app'],
    selectedFocusIds: [],
    authoritySource: 'active-task-sidecar',
    ...overrides,
  };
}

function manualBindingMap(entries: Array<[string, string]>): WorktreeBindingMap {
  return {
    substitutions: new Map(entries),
    applied: entries.length > 0,
  };
}

describe('buildWorktreeBindingMap', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-wt-inject-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns applied:false when taskId is null', async () => {
    const map = await buildWorktreeBindingMap(null, repoRoot);
    expect(map.applied).toBe(false);
    expect(map.substitutions.size).toBe(0);
  });

  it('returns applied:false when sidecar is missing', async () => {
    const map = await buildWorktreeBindingMap('nonexistent-task', repoRoot);
    expect(map.applied).toBe(false);
    expect(map.substitutions.size).toBe(0);
  });

  it('builds substitution map from .task.json repoBindings', async () => {
    const taskId = 'wt-inject-test';
    // Real directories so realpath() resolves; otherwise we'd test the fallback.
    const originalRoot = path.join(repoRoot, 'origin', 'crud-app');
    // Worktrees live under the per-task base (queue/operations.ts); the
    // SEC-TS-01 containment guard in buildWorktreeBindingMap enforces this.
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'crud-app');
    mkdirSync(originalRoot, { recursive: true });
    mkdirSync(worktreeRoot, { recursive: true });

    const sidecarDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(sidecarDir, { recursive: true });
    writeFileSync(
      path.join(sidecarDir, '.task.json'),
      JSON.stringify({
        schema_version: 1,
        taskId,
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [
            {
              originalRoot,
              worktreeRoot,
              worktreeBranch: `task/${taskId}`,
              baseCommitSha: 'deadbeef',
            },
          ],
        },
        materialization: { strategy: 'copy', cloned: [], skipped: [], composeProjectName: 'p' },
        frozenAt: '2026-04-19T00:00:00Z',
        finalizedAt: null,
        state: 'active',
      }),
    );

    const map = await buildWorktreeBindingMap(taskId, repoRoot);
    expect(map.applied).toBe(true);
    expect(map.substitutions.size).toBe(1);
    // The map's keys are realpath-canonical (defeats symlinks + the macOS
    // /var → /private/var resolution). Use the same canonical form when
    // exercising the rewriter so this test is platform-independent.
    const canonicalOriginal = realpathSync(originalRoot);
    const canonicalWorktree = realpathSync(worktreeRoot);
    const rewritten = rewritePath(path.join(canonicalOriginal, 'src', 'app.ts'), map);
    expect(rewritten).toBe(path.join(canonicalWorktree, 'src', 'app.ts'));
  });

  it('builds substitution map from readonlyContextBindings', async () => {
    const taskId = 'wt-inject-readonly-test';
    const originalRoot = path.join(repoRoot, 'origin', 'support-lib');
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'support-lib');
    mkdirSync(originalRoot, { recursive: true });
    mkdirSync(worktreeRoot, { recursive: true });

    const sidecarDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(sidecarDir, { recursive: true });
    writeFileSync(
      path.join(sidecarDir, '.task.json'),
      JSON.stringify({
        schema_version: 2,
        taskId,
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [],
          readonlyContextBindings: [
            {
              originalRoot,
              worktreeRoot,
              baseCommitSha: 'deadbeef',
              repoId: 'support-lib',
              role: 'support',
            },
          ],
        },
        materialization: { strategy: 'copy', cloned: [], skipped: [] },
        frozenAt: '2026-04-19T00:00:00Z',
        finalizedAt: null,
        state: 'active',
      }),
    );

    const map = await buildWorktreeBindingMap(taskId, repoRoot);
    const canonicalOriginal = realpathSync(originalRoot);
    const canonicalWorktree = realpathSync(worktreeRoot);
    expect(map.applied).toBe(true);
    expect(rewritePath(path.join(canonicalOriginal, 'src', 'app.ts'), map))
      .toBe(path.join(canonicalWorktree, 'src', 'app.ts'));
  });

  it('SEC-TS-01: drops a repoBinding whose worktreeRoot escapes the per-task base', async () => {
    const taskId = 'wt-inject-escape';
    const originalRoot = path.join(repoRoot, 'origin', 'crud-app');
    // worktreeRoot points OUTSIDE AgentWorkSpace/tasks/<taskId>/worktrees — a
    // tampered .task.json attempting to redirect the confinement allowedDirs.
    const escapeRoot = path.join(repoRoot, 'evil-target');
    mkdirSync(originalRoot, { recursive: true });
    mkdirSync(escapeRoot, { recursive: true });

    const sidecarDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(sidecarDir, { recursive: true });
    writeFileSync(
      path.join(sidecarDir, '.task.json'),
      JSON.stringify({
        schema_version: 1,
        taskId,
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [
            { originalRoot, worktreeRoot: escapeRoot, worktreeBranch: `task/${taskId}`, baseCommitSha: 'deadbeef' },
          ],
        },
        materialization: { strategy: 'copy', cloned: [], skipped: [] },
        frozenAt: '2026-04-19T00:00:00Z',
        finalizedAt: null,
        state: 'active',
      }),
    );

    const map = await buildWorktreeBindingMap(taskId, repoRoot);
    // Binding dropped: no substitution, so confinement is NOT redirected.
    expect(map.applied).toBe(false);
    expect(map.substitutions.size).toBe(0);
    const canonicalOriginal = realpathSync(originalRoot);
    expect(rewritePath(path.join(canonicalOriginal, 'src', 'app.ts'), map))
      .toBe(path.join(canonicalOriginal, 'src', 'app.ts'));
  });

  it('SEC-TS-01: drops a repoBinding whose worktreeRoot symlinks out of the base', async () => {
    const taskId = 'wt-inject-symlink';
    const originalRoot = path.join(repoRoot, 'origin', 'crud-app');
    const secret = path.join(repoRoot, 'outside-secret');
    mkdirSync(originalRoot, { recursive: true });
    mkdirSync(secret, { recursive: true });

    const base = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees');
    mkdirSync(base, { recursive: true });
    // A symlink planted UNDER the base but resolving outside it must not pass
    // the containment check (the guard tests the realpath'd value).
    const sneaky = path.join(base, 'sneaky');
    symlinkSync(secret, sneaky);

    const sidecarDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    writeFileSync(
      path.join(sidecarDir, '.task.json'),
      JSON.stringify({
        schema_version: 1,
        taskId,
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [
            { originalRoot, worktreeRoot: sneaky, worktreeBranch: `task/${taskId}`, baseCommitSha: 'deadbeef' },
          ],
        },
        materialization: { strategy: 'copy', cloned: [], skipped: [] },
        frozenAt: '2026-04-19T00:00:00Z',
        finalizedAt: null,
        state: 'active',
      }),
    );

    const map = await buildWorktreeBindingMap(taskId, repoRoot);
    expect(map.applied).toBe(false);
    expect(map.substitutions.size).toBe(0);
  });
});

describe('applyWorktreeInjectionToFocused', () => {
  it('rewrites primaryRepoRoot, visibleRepoRoots, declaredRepoRoots, and testTarget.resolvedPath', () => {
    const focused = makeFocused({
      visibleRepoRoots: ['/repos/crud-app', '/repos/shared-lib'],
      declaredRepoRoots: ['/repos/crud-app', '/repos/shared-lib'],
      testTarget: {
        path: 'tests',
        kind: 'directory',
        resolvedPath: '/repos/crud-app/tests',
      },
    });
    const map = manualBindingMap([
      ['/repos/crud-app', '/wt/crud-app'],
      ['/repos/shared-lib', '/wt/shared-lib'],
    ]);

    const out = applyWorktreeInjectionToFocused(focused, map);

    expect(out.primaryRepoRoot).toBe('/wt/crud-app');
    expect(out.visibleRepoRoots).toEqual(['/wt/crud-app', '/wt/shared-lib']);
    expect(out.declaredRepoRoots).toEqual(['/wt/crud-app', '/wt/shared-lib']);
    expect(out.testTarget?.resolvedPath).toBe('/wt/crud-app/tests');
    // Pure: input must be unchanged.
    expect(focused.primaryRepoRoot).toBe('/repos/crud-app');
    expect(focused.visibleRepoRoots).toEqual(['/repos/crud-app', '/repos/shared-lib']);
  });

  it('returns the input reference unchanged when binding map is empty', () => {
    const focused = makeFocused();
    const empty = manualBindingMap([]);
    const out = applyWorktreeInjectionToFocused(focused, empty);
    expect(out).toBe(focused);
  });

  it('rewrites repo-local root metadata while preserving repo-relative entries', () => {
    // Contract (spec §2): worktree injection retargets the *root* — not the
    // repo-relative entries beneath it. Downstream consumers join
    // writableRoots[].path against the rewritten primaryRepoRoot to land
    // under the worktree, so these entries must stay repo-relative.
    const focused = makeFocused({
      writableRoots: [
        {
          repoLocalPath: '/repos/crud-app',
          path: 'src',
          kind: 'directory',
          reason: 'selected-primary',
          sourceTargets: [{ repoLocalPath: '/repos/crud-app', path: 'src', kind: 'directory' }],
        },
        { repoLocalPath: '/repos/crud-app', path: 'tests/handler.test.ts', kind: 'file', reason: 'test-target' },
      ],
      readonlyContextRoots: [
        {
          repoLocalPath: '/repos/crud-app',
          path: 'docs',
          kind: 'directory',
          reason: 'support-target',
          sourceTargets: [{ repoLocalPath: '/repos/crud-app', path: 'docs', kind: 'directory' }],
        },
      ],
    });
    const map = manualBindingMap([['/repos/crud-app', '/wt/crud-app']]);

    const out = applyWorktreeInjectionToFocused(focused, map);

    expect(out.primaryRepoRoot).toBe('/wt/crud-app');
    expect(out.writableRoots).toEqual([
      {
        repoLocalPath: '/wt/crud-app',
        path: 'src',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [{ repoLocalPath: '/wt/crud-app', path: 'src', kind: 'directory' }],
      },
      { repoLocalPath: '/wt/crud-app', path: 'tests/handler.test.ts', kind: 'file', reason: 'test-target' },
    ]);
    expect(out.readonlyContextRoots).toEqual([
      {
        repoLocalPath: '/wt/crud-app',
        path: 'docs',
        kind: 'directory',
        reason: 'support-target',
        sourceTargets: [{ repoLocalPath: '/wt/crud-app', path: 'docs', kind: 'directory' }],
      },
    ]);
    // No entry should have been absolutized into the worktree.
    for (const root of out.writableRoots ?? []) {
      expect(path.isAbsolute(root.path)).toBe(false);
    }
    for (const root of out.readonlyContextRoots ?? []) {
      expect(path.isAbsolute(root.path)).toBe(false);
    }
  });

  it('rewrites scoped primary target repoLocalPath but preserves repo-relative paths', () => {
    const focused = makeFocused({
      primaryFocusTargets: [
        {
          repoLocalPath: '/repos/crud-app',
          path: 'apps/api',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'apps/api/tests', kind: 'directory' },
          supportTargets: [{ path: 'shared/api-types.ts', kind: 'file' }],
        },
      ],
    });
    const map = manualBindingMap([['/repos/crud-app', '/wt/crud-app']]);

    const out = applyWorktreeInjectionToFocused(focused, map);

    expect(out.primaryRepoRoot).toBe('/wt/crud-app');
    expect(out.primaryFocusTargets).toEqual([
      {
        repoLocalPath: '/wt/crud-app',
        path: 'apps/api',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'apps/api/tests', kind: 'directory' },
        supportTargets: [{ path: 'shared/api-types.ts', kind: 'file' }],
      },
    ]);
  });

  it('rewrites incident-shaped selected writable roots without absolutizing root paths', () => {
    const focused = makeFocused({
      writableRoots: [
        {
          repoLocalPath: '/origin/platform',
          path: 'libs/Acme.Models',
          kind: 'directory',
          reason: 'selected-primary',
        },
        {
          repoLocalPath: '/origin/platform',
          path: 'libs/Acme.Models.Tests',
          kind: 'directory',
          reason: 'scoped-test-target',
        },
      ],
    });
    const map = manualBindingMap([['/origin/platform', '/task/worktrees/platform']]);

    const out = applyWorktreeInjectionToFocused(focused, map);

    expect(out.writableRoots?.map((root) => root.repoLocalPath)).toEqual([
      '/task/worktrees/platform',
      '/task/worktrees/platform',
    ]);
    expect(out.writableRoots?.map((root) => root.path)).toEqual([
      'libs/Acme.Models',
      'libs/Acme.Models.Tests',
    ]);
  });

  it('rewrites support-repo readonly root repoLocalPath', () => {
    const focused = makeFocused({
      visibleRepoRoots: ['/repos/crud-app', '/repos/tools'],
      declaredRepoRoots: ['/repos/crud-app', '/repos/tools'],
      readonlyContextRoots: [
        {
          repoLocalPath: '/repos/tools',
          path: '',
          kind: 'directory',
          reason: 'support-repo',
        },
      ],
    });
    const map = manualBindingMap([['/repos/tools', '/repos/.worktrees/task-1/tools']]);

    const out = applyWorktreeInjectionToFocused(focused, map);

    expect(out.readonlyContextRoots).toEqual([
      {
        repoLocalPath: '/repos/.worktrees/task-1/tools',
        path: '',
        kind: 'directory',
        reason: 'support-repo',
      },
    ]);
  });
});

describe('rewritePath', () => {
  it('defeats the /repo/foo vs /repo/foobar false-positive (spec risk 5.6)', () => {
    const map = manualBindingMap([
      ['/repos/foo', '/wt/foo'],
    ]);
    // Exact match → rewritten
    expect(rewritePath('/repos/foo', map)).toBe('/wt/foo');
    // Path prefix match → rewritten
    expect(rewritePath('/repos/foo/src/app.ts', map)).toBe('/wt/foo/src/app.ts');
    // Sibling whose name shares the prefix → MUST NOT be rewritten
    expect(rewritePath('/repos/foobar', map)).toBe('/repos/foobar');
    expect(rewritePath('/repos/foobar/src/app.ts', map)).toBe('/repos/foobar/src/app.ts');
    // Unrelated path → unchanged
    expect(rewritePath('/somewhere/else', map)).toBe('/somewhere/else');
  });
});

describe('applyWorktreeInjectionToAllowedDirs', () => {
  it('returns a fresh array of rewritten dirs (no input mutation)', () => {
    const map = manualBindingMap([['/repos/crud-app', '/wt/crud-app']]);
    const input = ['/repos/crud-app/src', '/platform/AgentWorkSpace'];
    const out = applyWorktreeInjectionToAllowedDirs(input, map);
    expect(out).toEqual(['/wt/crud-app/src', '/platform/AgentWorkSpace']);
    expect(input).toEqual(['/repos/crud-app/src', '/platform/AgentWorkSpace']);
    expect(out).not.toBe(input);
  });

  it('returns a copied array unchanged when binding map is empty', () => {
    const empty = manualBindingMap([]);
    const input = ['/a', '/b'];
    const out = applyWorktreeInjectionToAllowedDirs(input, empty);
    expect(out).toEqual(['/a', '/b']);
    expect(out).not.toBe(input);
  });

  it('preserves platform metadata roots when a monolith binding maps the platform repo root', () => {
    const map = manualBindingMap([['/repo', '/repo/AgentWorkSpace/tasks/t1/worktrees/src']]);
    const input = [
      '/repo/src/backend',
      '/repo/contextpacks/src',
      '/repo/AgentWorkSpace/tasks/t1',
      '/repo/.platform-state/runtime/verification/run-1',
    ];

    const out = applyWorktreeInjectionToAllowedDirs(input, map, {
      preservePrefixes: [
        '/repo/contextpacks/src',
        '/repo/AgentWorkSpace',
        '/repo/.platform-state',
      ],
    });

    expect(out).toEqual([
      '/repo/AgentWorkSpace/tasks/t1/worktrees/src/src/backend',
      '/repo/contextpacks/src',
      '/repo/AgentWorkSpace/tasks/t1',
      '/repo/.platform-state/runtime/verification/run-1',
    ]);
  });
});
