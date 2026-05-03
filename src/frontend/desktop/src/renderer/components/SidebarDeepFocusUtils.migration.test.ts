import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ContextPackDeepFocusState,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import { migrateSupportScopes } from './SidebarDeepFocusUtils';

function makeState(
  overrides: Partial<ContextPackDeepFocusState> = {},
): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: true,
    deepFocusPrimaryRepoId: 'repo-1',
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: 'src/api/users.ts',
    selectedFocusTargetKind: 'file',
    selectedFocusTargets: [],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
    ...overrides,
  };
}

function makePrimary(
  path: string,
  overrides: Partial<ContextPackPrimaryFocusTarget> = {},
): ContextPackPrimaryFocusTarget {
  return {
    path,
    kind: 'file',
    role: 'anchor',
    repoLocalPath: '/tmp/repo-1',
    repoId: 'repo-1',
    testTarget: undefined,
    supportTargets: [],
    ...overrides,
  };
}

describe('migrateSupportScopes (spec §5.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the same reference when there is nothing to migrate', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', {
          supportTargets: [{ path: 'src/lib/format.ts', kind: 'file' }],
        }),
      ],
      selectedSupportTargets: [{ path: 'src/lib/log.ts', kind: 'file' }],
    });

    const next = migrateSupportScopes(state);

    expect(next).toBe(state);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns the same reference when there are no primaries (no per-primary bucket to conflict with)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = makeState({
      selectedFocusTargets: [],
      selectedSupportTargets: [{ path: 'src/lib/log.ts', kind: 'file' }],
    });

    const next = migrateSupportScopes(state);

    expect(next).toBe(state);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('drops a globally-listed support that also lives on a primary, preferring the per-primary placement', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const duplicated = { path: 'src/lib/format.ts', kind: 'file' as const };
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', { supportTargets: [duplicated] }),
      ],
      selectedSupportTargets: [
        duplicated,
        { path: 'src/lib/log.ts', kind: 'file' },
      ],
    });

    const next = migrateSupportScopes(state);

    expect(next).not.toBe(state);
    expect(next.selectedSupportTargets).toEqual([
      { path: 'src/lib/log.ts', kind: 'file' },
    ]);
    expect(next.selectedFocusTargets?.[0]?.supportTargets).toEqual([duplicated]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/removed 1 .*support path .*per-primary scope/);
  });

  it('preserves cross-primary sharing (same path on two primaries is intentional, not a duplicate)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shared = { path: 'src/lib/format.ts', kind: 'file' as const };
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', { supportTargets: [shared] }),
        makePrimary('src/api/orders.ts', { supportTargets: [shared] }),
      ],
      selectedSupportTargets: [],
    });

    const next = migrateSupportScopes(state);

    expect(next).toBe(state);
    expect(next.selectedFocusTargets?.[0]?.supportTargets).toEqual([shared]);
    expect(next.selectedFocusTargets?.[1]?.supportTargets).toEqual([shared]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('drops globals when path lives on N≥1 primaries (combined rule §5.3-3)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shared = { path: 'src/lib/format.ts', kind: 'file' as const };
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', { supportTargets: [shared] }),
        makePrimary('src/api/orders.ts', { supportTargets: [shared] }),
      ],
      selectedSupportTargets: [shared],
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedSupportTargets).toEqual([]);
    expect(next.selectedFocusTargets?.[0]?.supportTargets).toEqual([shared]);
    expect(next.selectedFocusTargets?.[1]?.supportTargets).toEqual([shared]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a pluralized count when multiple paths are migrated', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = { path: 'src/lib/format.ts', kind: 'file' as const };
    const b = { path: 'src/lib/log.ts', kind: 'file' as const };
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', { supportTargets: [a, b] }),
      ],
      selectedSupportTargets: [a, b],
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedSupportTargets).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/removed 2 .*support paths .*per-primary scope/);
  });

  it('treats kind mismatches as distinct paths (file vs directory at same path is not a duplicate)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', {
          supportTargets: [{ path: 'src/lib', kind: 'directory' }],
        }),
      ],
      selectedSupportTargets: [{ path: 'src/lib', kind: 'file' }],
    });

    const next = migrateSupportScopes(state);

    expect(next).toBe(state);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
