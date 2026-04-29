import { describe, expect, it } from 'vitest';

import type { ContextPackCatalogEntry, ContextPackFocusTarget } from '../../shared/desktopContract';
import {
  EMPTY_CONTEXT_PACK_DEEP_FOCUS_STATE,
  orderKnownFocusIds,
  selectLastAppliedDeepFocusState,
  selectPreferredDeepFocusState,
  selectPreferredScopeMode,
  selectPreferredWorkingFocusIds,
  selectPreferredWorkingRepoIds,
  toggleFocusSelection,
} from './contextPackPreferences';

function makeFocusTarget(overrides: Partial<ContextPackFocusTarget> = {}): ContextPackFocusTarget {
  return {
    focusId: 'orders-api',
    displayName: 'Orders API',
    kind: 'repository',
    repoId: 'orders-api',
    serviceName: null,
    systemLayer: null,
    repoRole: null,
    repositoryType: null,
    relativePath: null,
    focusType: null,
    group: null,
    defaultFocusable: true,
    activationPriority: 10,
    adjacentRepoIds: [],
    adjacentFocusIds: [],
    ...overrides,
  };
}

function makePack(overrides: Partial<ContextPackCatalogEntry> = {}): ContextPackCatalogEntry {
  return {
    contextPackId: 'test-pack',
    displayName: 'Test Pack',
    contextPackDir: '/tmp/test-pack',
    manifestPath: null,
    bootstrapReady: true,
    source: 'active-env',
    isActive: true,
    estateType: 'distributed-platform',
    defaultScopeMode: 'focused',
    repoCount: 2,
    primaryWorkingRepoIds: ['orders-api'],
    focusTargets: [
      makeFocusTarget({ focusId: 'orders-api', repoId: 'orders-api' }),
      makeFocusTarget({ focusId: 'billing-api', repoId: 'billing-api', displayName: 'Billing API' }),
    ],
    ...overrides,
  };
}

describe('selectPreferredScopeMode', () => {
  it('always returns focused', () => {
    expect(selectPreferredScopeMode()).toBe('focused');
  });
});

describe('deep focus selectors', () => {
  it('restores last-applied deep focus metadata', () => {
    const pack = makePack({
      lastAppliedDeepFocusEnabled: true,
      lastAppliedSelectedFocusPath: 'src/orders',
      lastAppliedSelectedFocusTargetKind: 'directory',
      lastAppliedSelectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      lastAppliedSelectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    });

    expect(selectLastAppliedDeepFocusState(pack)).toEqual({
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      derivedWritableRoots: [],
      derivedReadonlyContextRoots: [],
    });
  });

  it('restores non-null deep focus primary IDs from the catalog entry', () => {
    const pack = makePack({
      lastAppliedDeepFocusEnabled: true,
      lastAppliedDeepFocusPrimaryRepoId: 'backend',
      lastAppliedDeepFocusPrimaryFocusId: null,
      lastAppliedSelectedFocusPath: 'src/orders',
      lastAppliedSelectedFocusTargetKind: 'directory',
    });

    const state = selectLastAppliedDeepFocusState(pack);
    expect(state.deepFocusPrimaryRepoId).toBe('backend');
    expect(state.deepFocusPrimaryFocusId).toBeNull();
  });

  it('falls back to an empty state when no deep focus restore exists', () => {
    expect(selectLastAppliedDeepFocusState(undefined)).toEqual(
      EMPTY_CONTEXT_PACK_DEEP_FOCUS_STATE,
    );
  });

  it('prefers the current deep focus selection over restored metadata', () => {
    const pack = makePack({
      lastAppliedDeepFocusEnabled: true,
      lastAppliedSelectedFocusPath: 'src/orders',
      lastAppliedSelectedFocusTargetKind: 'directory',
    });

    expect(
      selectPreferredDeepFocusState(pack, [
        {
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: 'src/live',
          selectedFocusTargetKind: 'directory',
          selectedTestTarget: null,
          selectedSupportTargets: [],
          derivedWritableRoots: [],
          derivedReadonlyContextRoots: [],
        },
      ]),
    ).toEqual({
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'src/live',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: null,
      selectedSupportTargets: [],
      derivedWritableRoots: [],
      derivedReadonlyContextRoots: [],
    });
  });
});

describe('selectPreferredWorkingRepoIds', () => {
  it('returns matching candidate repo IDs from focus targets', () => {
    const pack = makePack();
    expect(selectPreferredWorkingRepoIds(pack, [['billing-api', 'orders-api']])).toEqual([
      'billing-api',
      'orders-api',
    ]);
  });

  it('falls back to primaryWorkingRepoIds when no candidate matches', () => {
    const pack = makePack();
    expect(selectPreferredWorkingRepoIds(pack, [['unknown-repo']])).toEqual(['orders-api']);
  });

  it('falls back to first focus target repoId when primaryWorkingRepoIds has no match', () => {
    const pack = makePack({ primaryWorkingRepoIds: ['missing'] });
    expect(selectPreferredWorkingRepoIds(pack, [null])).toEqual(['orders-api']);
  });

  it('returns empty array for non-distributed packs', () => {
    const pack = makePack({ estateType: 'monolith' });
    expect(selectPreferredWorkingRepoIds(pack, [['orders-api']])).toEqual([]);
  });

  it('returns empty array when pack is undefined', () => {
    expect(selectPreferredWorkingRepoIds(undefined, [['orders-api']])).toEqual([]);
  });

  it('returns empty array when focus targets are empty', () => {
    const pack = makePack({ focusTargets: [] });
    expect(selectPreferredWorkingRepoIds(pack, [null])).toEqual([]);
  });
});

describe('selectPreferredWorkingFocusIds', () => {
  const monolithPack = makePack({
    estateType: 'monolith',
    focusTargets: [
      makeFocusTarget({ focusId: 'core', kind: 'focus-area', repoId: null }),
      makeFocusTarget({ focusId: 'utils', kind: 'focus-area', repoId: null, displayName: 'Utils' }),
    ],
  });

  it('returns matching candidate focus IDs', () => {
    expect(selectPreferredWorkingFocusIds(monolithPack, [['utils']])).toEqual(['utils']);
  });

  it('returns empty array for distributed-platform packs', () => {
    expect(selectPreferredWorkingFocusIds(makePack(), [['orders-api']])).toEqual([]);
  });

  it('falls back to all default-focusable focus targets', () => {
    expect(selectPreferredWorkingFocusIds(monolithPack, [null])).toEqual(['core', 'utils']);
  });

  it('falls back to first focus target when none are default-focusable', () => {
    const pack = makePack({
      estateType: 'monolith',
      focusTargets: [
        makeFocusTarget({ focusId: 'core', kind: 'focus-area', repoId: null, defaultFocusable: false }),
        makeFocusTarget({ focusId: 'utils', kind: 'focus-area', repoId: null, defaultFocusable: false }),
      ],
    });
    expect(selectPreferredWorkingFocusIds(pack, [null])).toEqual(['core']);
  });
});

describe('orderKnownFocusIds', () => {
  it('orders IDs by focus target declaration order', () => {
    const pack = makePack();
    expect(orderKnownFocusIds(pack, ['billing-api', 'orders-api'])).toEqual([
      'orders-api',
      'billing-api',
    ]);
  });

  it('filters out unknown focus IDs', () => {
    const pack = makePack();
    expect(orderKnownFocusIds(pack, ['unknown', 'orders-api'])).toEqual(['orders-api']);
  });

  it('returns a copy when pack is undefined', () => {
    const ids = ['a', 'b'];
    const result = orderKnownFocusIds(undefined, ids);
    expect(result).toEqual(['a', 'b']);
    expect(result).not.toBe(ids);
  });
});

describe('toggleFocusSelection', () => {
  it('adds a focus ID when not currently selected', () => {
    const pack = makePack();
    expect(toggleFocusSelection(pack, ['orders-api'], 'billing-api')).toEqual([
      'orders-api',
      'billing-api',
    ]);
  });

  it('removes a focus ID when already selected', () => {
    const pack = makePack();
    expect(toggleFocusSelection(pack, ['orders-api', 'billing-api'], 'orders-api')).toEqual([
      'billing-api',
    ]);
  });
});
