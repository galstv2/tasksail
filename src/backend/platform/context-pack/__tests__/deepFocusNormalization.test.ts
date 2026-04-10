import { describe, expect, it } from 'vitest';
import {
  isDescendantOrEqual,
  isStrictAncestor,
  normalizeRelativePath,
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

  it('computes ancestry helpers against normalized paths', () => {
    expect(isDescendantOrEqual('src/app/index.ts', 'src/app')).toBe(true);
    expect(isStrictAncestor('src', 'src/app/index.ts')).toBe(true);
    expect(isStrictAncestor('src/app', 'src/app')).toBe(false);
  });
});
