import { describe, expect, it } from 'vitest';
import {
  isDescendantOrEqual,
  isStrictAncestor,
  normalizeRelativePath,
  normalizePrimaryFocusTargets,
  normalizeSupportTargets,
  validateTestTarget,
} from '../deepFocusNormalization.js';

describe('deepFocusNormalization', () => {
  it('normalizes relative paths consistently', () => {
    expect(normalizeRelativePath('.\\src//services/orders/')).toBe('src/services/orders');
    expect(normalizeRelativePath('./')).toBe('');
  });

  it('validates test targets without blocking overlap', () => {
    expect(validateTestTarget({
      primaryPath: 'src/services',
      primaryKind: 'directory',
      testTarget: { path: 'src/services/orders.test.ts', kind: 'file' },
    })).toEqual({ valid: true });

    expect(validateTestTarget({
      primaryPath: 'src/services',
      primaryKind: 'directory',
      testTarget: { path: '../tests', kind: 'directory' },
    })).toEqual({
      valid: false,
      reason: 'Test target path must not contain ".." traversal segments.',
    });
  });

  it('normalizes support targets deterministically and removes subsumed descendants', () => {
    expect(normalizeSupportTargets({
      primaryPath: 'src/app',
      primaryKind: 'directory',
      testTarget: { path: 'tests/unit', kind: 'directory' },
      rawTargets: [
        { path: 'src', kind: 'directory' },
        { path: 'src/utils', kind: 'directory' },
        { path: 'docs/README.md', kind: 'file' },
        { path: 'tests', kind: 'directory' },
      ],
    })).toEqual([
      { path: 'docs/README.md', kind: 'file', effectiveScope: 'exact-file' },
      { path: 'src', kind: 'directory', effectiveScope: 'directory-minus-primary' },
      { path: 'tests', kind: 'directory', effectiveScope: 'directory-minus-test' },
    ]);
  });

  it('rejects support targets nested inside the primary target', () => {
    expect(() => normalizeSupportTargets({
      primaryPath: 'src/app',
      primaryKind: 'directory',
      rawTargets: [{ path: 'src/app/utils', kind: 'directory' }],
    })).toThrow('cannot be nested inside the primary target');
  });

  it('preserves normalized scoped fields through primary dedupe', () => {
    const normalized = normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: './src/orders/',
          kind: 'directory',
          testTarget: { path: '.\\tests//orders/', kind: 'directory' },
          supportTargets: [
            { path: 'docs/orders', kind: 'directory' },
            { path: './docs/orders/', kind: 'directory' },
          ],
        },
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [{ path: 'docs/shared', kind: 'directory' }],
        },
      ],
    });

    expect(normalized.anchor).toEqual({
      path: 'src/orders',
      kind: 'directory',
      role: 'anchor',
      testTarget: { path: 'tests/orders', kind: 'directory' },
      supportTargets: [
        { path: 'docs/orders', kind: 'directory' },
        { path: 'docs/shared', kind: 'directory' },
      ],
    });
    expect(normalized.targets).toEqual([normalized.anchor]);
  });

  it('keeps same relative primary path in different repos', () => {
    const normalized = normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: 'src',
          kind: 'directory',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          role: 'anchor',
        },
        {
          path: 'src',
          kind: 'directory',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
      ],
    });

    expect(normalized.targets).toEqual([
      {
        path: 'src',
        kind: 'directory',
        repoLocalPath: '/repos/tools',
        repoId: 'tools',
        role: 'anchor',
      },
      {
        path: 'src',
        kind: 'directory',
        repoLocalPath: '/repos/platform',
        repoId: 'platform',
        role: 'primary',
      },
    ]);
  });

  it('rejects same-repo overlaps but accepts same relative path cross-repo', () => {
    expect(() => normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: 'app',
          kind: 'directory',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          role: 'anchor',
          supportTargets: [{ path: 'src', kind: 'directory' }],
        },
        {
          path: 'src',
          kind: 'directory',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
    })).toThrow('selectedFocusTargets[0].supportTargets[0] overlaps primary[1].');

    expect(normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: 'app',
          kind: 'directory',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          role: 'anchor',
          supportTargets: [{ path: 'src', kind: 'directory' }],
        },
        {
          path: 'src',
          kind: 'directory',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
      ],
    }).targets).toHaveLength(2);
  });

  it('rejects Pass A per-primary scoped overlaps first', () => {
    expect(() => normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [{ path: 'src/orders/docs', kind: 'directory' }],
        },
        {
          path: 'src/billing',
          kind: 'directory',
          testTarget: { path: 'src/orders', kind: 'directory' },
        },
      ],
    })).toThrow('selectedFocusTargets[0].supportTargets[0] overlaps primary[0] writable root.');
  });

  it('rejects Pass B cross-primary scoped support overlaps', () => {
    expect(() => normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [{ path: 'src/billing/docs', kind: 'directory' }],
        },
        { path: 'src/billing', kind: 'directory' },
      ],
    })).toThrow('selectedFocusTargets[0].supportTargets[0] overlaps primary[1] writable root.');
  });

  it('rejects repo-root primaries with scoped fields using a dedicated code', () => {
    expect(() => normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests', kind: 'directory' },
        },
      ],
    })).toThrow('scoped-fields-on-repo-root-primary');
  });

  it('allows scoped test equal to the global test so root reasons can be preserved downstream', () => {
    expect(validateTestTarget({
      primaryPath: 'src/orders',
      primaryKind: 'directory',
      testTarget: { path: 'tests/orders', kind: 'directory' },
    })).toEqual({ valid: true });

    expect(normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests/orders', kind: 'directory' },
        },
      ],
    }).anchor?.testTarget).toEqual({ path: 'tests/orders', kind: 'directory' });
  });

  it('preserves the new anchor scoped fields when anchor role changes', () => {
    const normalized = normalizePrimaryFocusTargets({
      rawTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          testTarget: { path: 'tests/orders', kind: 'directory' },
        },
        {
          path: 'src/billing',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests/billing', kind: 'directory' },
          supportTargets: [{ path: 'docs/billing', kind: 'directory' }],
        },
      ],
    });

    expect(normalized.anchor).toEqual({
      path: 'src/billing',
      kind: 'directory',
      role: 'anchor',
      testTarget: { path: 'tests/billing', kind: 'directory' },
      supportTargets: [{ path: 'docs/billing', kind: 'directory' }],
    });
    expect(normalized.targets[0]).toMatchObject({
      path: 'src/orders',
      role: 'primary',
      testTarget: { path: 'tests/orders', kind: 'directory' },
    });
  });

  it('computes ancestry helpers against normalized paths', () => {
    expect(isDescendantOrEqual('src/app/index.ts', 'src/app')).toBe(true);
    expect(isStrictAncestor('src', 'src/app/index.ts')).toBe(true);
    expect(isStrictAncestor('src/app', 'src/app')).toBe(false);
  });
});
