import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { logEmit } = vi.hoisted(() => {
  const logEmit = vi.fn(() => Promise.resolve({ ok: true }));
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      getBootstrapInfo: vi.fn().mockResolvedValue({
        appName: 'TaskSail',
        platform: 'test',
        logLevel: 'info',
        rendererForwardLevel: 'info',
        versions: { chrome: undefined, electron: undefined, node: 'test' },
      }),
      log: { emit: logEmit },
    },
  });
  return { logEmit };
});

import type {
  ContextPackDeepFocusState,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import { primaryIdentityKey, migrateSupportScopes } from './SidebarDeepFocusUtils';

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
  beforeEach(() => {
    logEmit.mockImplementation(() => Promise.resolve({ ok: true }));
    window.desktopShell.log.emit = logEmit;
    logEmit.mockClear();
  });

  afterEach(() => {
    logEmit.mockClear();
  });

  it('returns the same reference when there is nothing to migrate', () => {
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
    expect(logEmit).not.toHaveBeenCalled();
  });

  it('returns the same reference when there are no primaries (no per-primary bucket to conflict with)', () => {
    const state = makeState({
      selectedFocusTargets: [],
      selectedSupportTargets: [{ path: 'src/lib/log.ts', kind: 'file' }],
    });

    const next = migrateSupportScopes(state);

    expect(next).toBe(state);
    expect(logEmit).not.toHaveBeenCalled();
  });

  it('drops per-primary support that also lives globally, preserving deterministic global-support precedence', () => {
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
      duplicated,
      { path: 'src/lib/log.ts', kind: 'file' },
    ]);
    expect(next.selectedFocusTargets?.[0]?.supportTargets).toEqual([]);
    expect(logEmit).toHaveBeenCalledTimes(1);
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'deep-focus.selections.duplicate-assignments.removed',
      extra: { removedCount: 1 },
    }));
  });

  it('repairs cross-primary duplicate support by preserving the first primary-support assignment', () => {
    const shared = { path: 'src/lib/format.ts', kind: 'file' as const };
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', { supportTargets: [shared] }),
        makePrimary('src/api/orders.ts', { supportTargets: [shared] }),
      ],
      selectedSupportTargets: [],
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedFocusTargets?.[0]?.supportTargets).toEqual([shared]);
    expect(next.selectedFocusTargets?.[1]?.supportTargets).toEqual([]);
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'deep-focus.selections.duplicate-assignments.removed',
      extra: { removedCount: 1 },
    }));
  });

  it('preserves global support and removes later per-primary support duplicates', () => {
    const shared = { path: 'src/lib/format.ts', kind: 'file' as const };
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', { supportTargets: [shared] }),
        makePrimary('src/api/orders.ts', { supportTargets: [shared] }),
      ],
      selectedSupportTargets: [shared],
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedSupportTargets).toEqual([shared]);
    expect(next.selectedFocusTargets?.[0]?.supportTargets).toEqual([]);
    expect(next.selectedFocusTargets?.[1]?.supportTargets).toEqual([]);
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'deep-focus.selections.duplicate-assignments.removed',
      extra: { removedCount: 2 },
    }));
  });

  it('reports a pluralized count when multiple paths are migrated', () => {
    const a = { path: 'src/lib/format.ts', kind: 'file' as const };
    const b = { path: 'src/lib/log.ts', kind: 'file' as const };
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', { supportTargets: [a, b] }),
      ],
      selectedSupportTargets: [a, b],
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedSupportTargets).toEqual([a, b]);
    expect(next.selectedFocusTargets?.[0]?.supportTargets).toEqual([]);
    expect(logEmit).toHaveBeenCalledTimes(1);
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'deep-focus.selections.duplicate-assignments.removed',
      extra: { removedCount: 2 },
    }));
  });

  it('treats kind mismatches as distinct paths (file vs directory at same path is not a duplicate)', () => {
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
    expect(logEmit).not.toHaveBeenCalled();
  });

  it('repairs duplicate primary records and normalizes the remaining primary role', () => {
    const duplicate = makePrimary('src/api/users.ts', { role: 'primary' });
    const state = makeState({
      selectedFocusTargets: [
        makePrimary('src/api/users.ts', { role: 'primary' }),
        duplicate,
      ],
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedFocusTargets).toHaveLength(1);
    expect(next.selectedFocusTargets?.[0]?.role).toBe('anchor');
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'deep-focus.selections.duplicate-assignments.removed',
      extra: { removedCount: 1 },
    }));
  });

  it('repairs primary plus global test duplicates by preserving the primary assignment', () => {
    const duplicate = makePrimary('src/api/users.ts');
    const state = makeState({
      selectedFocusTargets: [duplicate],
      selectedTestTarget: { path: duplicate.path, kind: duplicate.kind, repoId: duplicate.repoId, repoLocalPath: duplicate.repoLocalPath },
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedFocusTargets).toEqual([duplicate]);
    expect(next.selectedTestTarget).toBeUndefined();
  });

  it('repairs global test plus per-primary test duplicates by preserving the global test', () => {
    const testTarget = { path: 'src/tests', kind: 'directory' as const };
    const state = makeState({
      selectedFocusTargets: [makePrimary('src/api/users.ts', { testTarget })],
      selectedTestTarget: testTarget,
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedTestTarget).toEqual(testTarget);
    expect(next.selectedFocusTargets?.[0]?.testTarget).toBeUndefined();
  });

  it('repairs support plus test duplicates according to slot precedence', () => {
    const duplicate = { path: 'src/tests', kind: 'directory' as const };
    const state = makeState({
      selectedFocusTargets: [makePrimary('src/api/users.ts')],
      selectedTestTarget: duplicate,
      selectedSupportTargets: [duplicate],
    });

    const next = migrateSupportScopes(state);

    expect(next.selectedTestTarget).toEqual(duplicate);
    expect(next.selectedSupportTargets).toEqual([]);
  });

  it('preserves same path in different identity scopes and exposes the canonical key', () => {
    const repoOne = { path: 'src/api', kind: 'directory' as const, repoLocalPath: '/tmp/repo-1', repoId: 'repo-1' };
    const repoTwo = { path: 'src/api', kind: 'directory' as const, repoLocalPath: '/tmp/repo-2', repoId: 'repo-2' };
    const state = makeState({
      selectedSupportTargets: [repoOne, repoTwo],
    });

    const next = migrateSupportScopes(state);

    expect(next).toBe(state);
    expect(primaryIdentityKey(repoOne)).not.toBe(primaryIdentityKey(repoTwo));
  });
});
