import { describe, it, expect } from 'vitest';
import {
  deriveWritableRootsFromFocusedSelection,
  getEffectiveScopeForPrimary,
} from '../focusedRepo.js';

describe('deriveWritableRootsFromFocusedSelection', () => {
  it('derives parent-directory writable roots and read-only support roots for file focus', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
      primaryFocusTargetKind: 'file',
      testTarget: { path: 'services/Acme.Api.Tests', kind: 'directory' },
      supportTargets: [
        { path: 'libs/Acme.Events', kind: 'directory', effectiveScope: 'full-directory' },
        { path: 'libs/Acme.Models', kind: 'directory', effectiveScope: 'full-directory' },
      ],
    })).toEqual({
      writableRoots: [
        { path: 'services/Acme.Api', kind: 'directory', reason: 'primary-focus-parent' },
        { path: 'services/Acme.Api.Tests', kind: 'directory', reason: 'test-target' },
      ],
      readonlyContextRoots: [
        { path: 'libs/Acme.Events', kind: 'directory', reason: 'support-target' },
        { path: 'libs/Acme.Models', kind: 'directory', reason: 'support-target' },
      ],
    });
  });

  it('derives repo-root sentinel writable root for repo-root focus', () => {
    expect(deriveWritableRootsFromFocusedSelection({})).toEqual({
      writableRoots: [
        { path: '', kind: 'directory', reason: 'selected-primary' },
      ],
      readonlyContextRoots: [],
    });
  });

  it('derives writable roots for each primary target, using the parent folder for files', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        { path: 'src/routes/UserRoute.ts', kind: 'file', role: 'anchor' },
        { path: 'src/services', kind: 'directory', role: 'primary' },
      ],
    })).toEqual({
      writableRoots: [
        {
          path: 'src/routes',
          kind: 'directory',
          reason: 'primary-focus-parent',
          sourceTargets: [
            { path: 'src/routes/UserRoute.ts', kind: 'file', role: 'anchor' },
          ],
        },
        {
          path: 'src/services',
          kind: 'directory',
          reason: 'selected-primary',
          sourceTargets: [
            { path: 'src/services', kind: 'directory', role: 'primary' },
          ],
        },
      ],
      readonlyContextRoots: [],
    });
  });

  it('adds scoped test writable roots with reason and sourceTargets', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
      }],
    }).writableRoots).toContainEqual({
      path: 'tests/orders',
      kind: 'directory',
      reason: 'scoped-test-target',
      sourceTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
      }],
    });
  });

  it('adds scoped support readonly roots with reason and sourceTargets', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }],
    }).readonlyContextRoots).toEqual([{
      path: 'docs/orders.md',
      kind: 'file',
      reason: 'scoped-support-target',
      sourceTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }],
    }]);
  });

  it('keeps a child folder primary writable while its parent folder is read-only support', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [{
        path: 'src/app',
        kind: 'directory',
        role: 'anchor',
        supportTargets: [{ path: 'src', kind: 'directory' }],
      }],
    })).toEqual({
      writableRoots: [{
        path: 'src/app',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [{
          path: 'src/app',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [{ path: 'src', kind: 'directory' }],
        }],
      }],
      readonlyContextRoots: [{
        path: 'src',
        kind: 'directory',
        reason: 'scoped-support-target',
        sourceTargets: [{
          path: 'src/app',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [{ path: 'src', kind: 'directory' }],
        }],
      }],
    });
  });

  it('preserves global and scoped same-path root reasons', () => {
    const roots = deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
        supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }],
      testTarget: { path: 'tests/orders', kind: 'directory' },
      supportTargets: [{ path: 'docs/orders.md', kind: 'file', effectiveScope: 'exact-file' }],
    });

    expect(roots.writableRoots.filter((root) => root.path === 'tests/orders')).toEqual([
      {
        path: 'tests/orders',
        kind: 'directory',
        reason: 'scoped-test-target',
        sourceTargets: [{
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests/orders', kind: 'directory' },
          supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
        }],
      },
      { path: 'tests/orders', kind: 'directory', reason: 'test-target' },
    ]);
    expect(new Set(roots.writableRoots.map((root) => root.path)).has('tests/orders')).toBe(true);
    expect(roots.readonlyContextRoots.filter((root) => root.path === 'docs/orders.md')).toHaveLength(2);
  });

  it('aggregates same-reason scoped sourceTargets deterministically', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests/shared', kind: 'directory' },
        },
        {
          path: 'src/payments',
          kind: 'directory',
          role: 'primary',
          testTarget: { path: 'tests/shared/unit', kind: 'directory' },
        },
      ],
    }).writableRoots).toContainEqual({
      path: 'tests/shared',
      kind: 'directory',
      reason: 'scoped-test-target',
      sourceTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests/shared', kind: 'directory' },
        },
        {
          path: 'src/payments',
          kind: 'directory',
          role: 'primary',
          testTarget: { path: 'tests/shared/unit', kind: 'directory' },
        },
      ],
    });
  });

  it('keeps same relative writable roots separate across repos', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
        {
          path: 'src',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
    }).writableRoots).toEqual([
      {
        repoLocalPath: '/repos/platform',
        path: 'src',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [
          {
            path: 'src',
            kind: 'directory',
            role: 'anchor',
            repoLocalPath: '/repos/platform',
            repoId: 'platform',
          },
        ],
      },
      {
        repoLocalPath: '/repos/tools',
        path: 'src',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [
          {
            path: 'src',
            kind: 'directory',
            role: 'primary',
            repoLocalPath: '/repos/tools',
            repoId: 'tools',
          },
        ],
      },
    ]);
  });

  it('dedupes same relative writable roots in the same repo', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
        {
          path: 'src',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
      ],
    }).writableRoots).toEqual([
      {
        repoLocalPath: '/repos/platform',
        path: 'src',
        kind: 'directory',
        reason: 'selected-primary',
        sourceTargets: [
          {
            path: 'src',
            kind: 'directory',
            role: 'anchor',
            repoLocalPath: '/repos/platform',
            repoId: 'platform',
          },
        ],
      },
    ]);
  });

  it('does not merge source targets from different repos', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
          focusId: 'orders',
          testTarget: { path: 'tests/shared', kind: 'directory' },
        },
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          focusId: 'orders',
          testTarget: { path: 'tests/shared', kind: 'directory' },
        },
      ],
    }).writableRoots.filter((root) => root.path === 'tests/shared')).toEqual([
      {
        repoLocalPath: '/repos/platform',
        path: 'tests/shared',
        kind: 'directory',
        reason: 'scoped-test-target',
        sourceTargets: [
          {
            path: 'src/orders',
            kind: 'directory',
            role: 'anchor',
            repoLocalPath: '/repos/platform',
            repoId: 'platform',
            focusId: 'orders',
            testTarget: { path: 'tests/shared', kind: 'directory' },
          },
        ],
      },
      {
        repoLocalPath: '/repos/tools',
        path: 'tests/shared',
        kind: 'directory',
        reason: 'scoped-test-target',
        sourceTargets: [
          {
            path: 'src/orders',
            kind: 'directory',
            role: 'primary',
            repoLocalPath: '/repos/tools',
            repoId: 'tools',
            focusId: 'orders',
            testTarget: { path: 'tests/shared', kind: 'directory' },
          },
        ],
      },
    ]);
  });

  it('anchors global test and support roots to the anchor repo', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        {
          path: 'src/platform',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
        {
          path: 'src/tools',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
      testTarget: { path: 'tests/shared', kind: 'directory' },
      supportTargets: [{ path: 'docs/shared.md', kind: 'file', effectiveScope: 'exact-file' }],
    })).toMatchObject({
      writableRoots: expect.arrayContaining([
        {
          repoLocalPath: '/repos/platform',
          path: 'tests/shared',
          kind: 'directory',
          reason: 'test-target',
        },
      ]),
      readonlyContextRoots: [
        {
          repoLocalPath: '/repos/platform',
          path: 'docs/shared.md',
          kind: 'file',
          reason: 'support-target',
        },
      ],
    });
  });

  it('uses explicit support target repoLocalPath for cross-repo support roots', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
      ],
      supportTargets: [{
        path: 'Acme.Cli',
        kind: 'directory',
        effectiveScope: 'full-directory',
        repoLocalPath: '/repos/tools',
        repoId: 'tools',
      }],
    }).readonlyContextRoots).toEqual([
      {
        repoLocalPath: '/repos/tools',
        path: 'Acme.Cli',
        kind: 'directory',
        reason: 'support-target',
      },
    ]);
  });

  it('uses explicit test target repoLocalPath for cross-repo test roots', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
      ],
      testTarget: {
        path: 'Acme.Cli.Tests',
        kind: 'directory',
        repoLocalPath: '/repos/tools',
      },
    }).writableRoots).toContainEqual({
      repoLocalPath: '/repos/tools',
      path: 'Acme.Cli.Tests',
      kind: 'directory',
      reason: 'test-target',
    });
  });

  it('uses explicit scoped test target repoLocalPath for cross-repo scoped test roots', () => {
    expect(deriveWritableRootsFromFocusedSelection({
      primaryFocusTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
          testTarget: {
            path: 'Acme.Cli.Tests',
            kind: 'directory',
            repoLocalPath: '/repos/tools',
          },
        },
      ],
    }).writableRoots).toContainEqual({
      repoLocalPath: '/repos/tools',
      path: 'Acme.Cli.Tests',
      kind: 'directory',
      reason: 'scoped-test-target',
      sourceTargets: [
        expect.objectContaining({
          path: '',
          kind: 'directory',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        }),
      ],
    });
  });

  it('returns global effective scope when scoped fields are empty', () => {
    expect(getEffectiveScopeForPrimary(
      { path: 'src/orders', kind: 'directory', role: 'anchor' },
      {
        testTarget: { path: 'tests/shared', kind: 'directory' },
        supportTargets: [
          { path: 'docs/shared.md', kind: 'file' },
          { path: 'docs/shared.md', kind: 'file' },
        ],
      },
    )).toEqual({
      testTarget: { path: 'tests/shared', kind: 'directory' },
      supportTargets: [{ path: 'docs/shared.md', kind: 'file' }],
    });
  });

  it('returns no testTarget when primary.testTarget is null and globals has one', () => {
    // `null` is the explicit opt-out sentinel for the per-primary slot. Prior
    // implementation used `??`, which silently fell back to the global target.
    const primary = {
      path: 'src/api',
      kind: 'directory' as const,
      role: 'anchor' as const,
      testTarget: null,
    };
    const result = getEffectiveScopeForPrimary(primary, {
      testTarget: { path: 'tests', kind: 'directory' },
      supportTargets: [],
    });
    expect(result.testTarget).toBeUndefined();
  });

  it('falls back to global testTarget when primary.testTarget is undefined', () => {
    // Inheritance still works for the unset case (undefined, not null).
    const primary = {
      path: 'src/api',
      kind: 'directory' as const,
      role: 'anchor' as const,
    };
    const result = getEffectiveScopeForPrimary(primary, {
      testTarget: { path: 'tests', kind: 'directory' },
      supportTargets: [],
    });
    expect(result.testTarget).toEqual({ path: 'tests', kind: 'directory' });
  });
});
