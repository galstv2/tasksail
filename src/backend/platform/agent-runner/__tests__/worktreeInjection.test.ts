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
    const worktreeRoot = path.join(repoRoot, 'worktrees', 'crud-app');
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
});
