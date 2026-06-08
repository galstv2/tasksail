import { describe, expect, it } from 'vitest';

import type {
  ContextPackDeepFocusTarget,
  ContextPackPrimaryFocusTarget,
} from '../../../shared/desktopContract';
import type { DeepFocusDraft, TopLevelTarget } from './SidebarDeepFocusControls.types';
import { applyScopedRoleAction } from './sidebarDeepFocusReducers';

const PLATFORM: TopLevelTarget = {
  id: 'platform',
  label: 'Platform',
  rootPath: '',
  repoLocalPath: '/repos/platform',
  ancillaryAllowed: false,
  systemLayer: null,
};

const TOOLS: TopLevelTarget = {
  id: 'tools',
  label: 'Tools',
  rootPath: '',
  repoLocalPath: '/repos/tools',
  ancillaryAllowed: false,
  systemLayer: null,
};

function exactTarget(path = 'src'): ContextPackDeepFocusTarget {
  return {
    path,
    kind: 'directory',
    repoLocalPath: PLATFORM.repoLocalPath,
    repoId: PLATFORM.id,
  };
}

function primary(
  path = 'src',
  overrides: Partial<ContextPackPrimaryFocusTarget> = {},
): ContextPackPrimaryFocusTarget {
  return {
    ...exactTarget(path),
    role: 'anchor',
    ...overrides,
  };
}

function draft(
  selectedFocusTargets: ContextPackPrimaryFocusTarget[] = [primary()],
): DeepFocusDraft {
  return {
    selectedWorkingFocusIds: ['platform'],
    state: {
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'src',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets,
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
    },
    scopeCursor: { kind: 'primary', index: 0 },
  };
}

function apply(
  current: DeepFocusDraft,
  action: Parameters<typeof applyScopedRoleAction>[1],
  target: ContextPackDeepFocusTarget = { path: 'src', kind: 'directory' },
): DeepFocusDraft {
  return applyScopedRoleAction(current, action, {
    topLevelId: 'platform',
    target,
    topLevelTargets: [PLATFORM, TOOLS],
    deepFocusMode: 'distributed',
  }).next;
}

describe('applyScopedRoleAction role mutual exclusion', () => {
  it('no-ops stale add-global-support for the exact primary target', () => {
    const current = draft();

    const next = apply(current, { type: 'add-global-support' });

    expect(next).toBe(current);
    expect(next.state.selectedSupportTargets).toEqual([]);
  });

  it('no-ops stale add-primary-support for the exact primary target', () => {
    const current = draft();

    const next = apply(current, { type: 'add-primary-support', index: 0 });

    expect(next).toBe(current);
    expect(next.state.selectedFocusTargets?.[0]?.supportTargets).toBeUndefined();
  });

  it('no-ops stale set-global-test for the exact primary target', () => {
    const current = draft();

    const next = apply(current, { type: 'set-global-test' });

    expect(next).toBe(current);
    expect(next.state.selectedTestTarget).toBeUndefined();
  });

  it('no-ops stale set-primary-test for the exact primary target', () => {
    const current = draft();

    const next = apply(current, { type: 'set-primary-test', index: 0 });

    expect(next).toBe(current);
    expect(next.state.selectedFocusTargets?.[0]?.testTarget).toBeUndefined();
  });

  it('make-primary no-ops when the exact target is already support or test', () => {
    const conflictingTarget = exactTarget('src/api');
    const siblingPrimary: ContextPackPrimaryFocusTarget = {
      ...exactTarget('src/platform'),
      role: 'anchor',
      testTarget: conflictingTarget,
      supportTargets: [conflictingTarget],
    };
    const current = {
      ...draft([siblingPrimary]),
      state: {
        ...draft([siblingPrimary]).state,
        selectedTestTarget: conflictingTarget,
        selectedSupportTargets: [conflictingTarget],
      },
    };

    const next = apply(current, { type: 'make-primary' }, { path: 'src/api', kind: 'directory' });

    expect(next).toBe(current);
    expect(next.state.selectedTestTarget).toEqual(conflictingTarget);
    expect(next.state.selectedSupportTargets).toEqual([conflictingTarget]);
    expect(next.state.selectedFocusTargets?.[0]?.testTarget).toEqual(conflictingTarget);
    expect(next.state.selectedFocusTargets?.[0]?.supportTargets).toEqual([conflictingTarget]);
  });

  it('no-ops stale direct actions that would move a global test into primary scope', () => {
    const testTarget = exactTarget('src/tests');
    const current = {
      ...draft(),
      state: {
        ...draft().state,
        selectedTestTarget: testTarget,
      },
    };

    const next = apply(current, { type: 'set-primary-test', index: 0 }, { path: 'src/tests', kind: 'directory' });

    expect(next).toBe(current);
    expect(next.state.selectedTestTarget).toEqual(testTarget);
    expect(next.state.selectedFocusTargets?.[0]?.testTarget).toBeUndefined();
  });

  it('no-ops stale direct actions that would move per-primary test into global scope', () => {
    const testTarget = exactTarget('src/tests');
    const current = draft([
      primary('src', { testTarget }),
    ]);

    const next = apply(current, { type: 'set-global-test' }, { path: 'src/tests', kind: 'directory' });

    expect(next).toBe(current);
    expect(next.state.selectedTestTarget).toBeUndefined();
    expect(next.state.selectedFocusTargets?.[0]?.testTarget).toEqual(testTarget);
  });

  it('no-ops stale promote actions instead of transferring assignments', () => {
    const scopedTarget = exactTarget('src/tests');
    const current = draft([
      primary('src', {
        testTarget: scopedTarget,
        supportTargets: [scopedTarget],
      }),
    ]);

    expect(apply(current, { type: 'promote-test-to-global' }, { path: 'src/tests', kind: 'directory' })).toBe(current);
    expect(apply(current, { type: 'promote-support-to-global' }, { path: 'src/tests', kind: 'directory' })).toBe(current);
  });

  it('does not block valid same-path support in a different repo', () => {
    const current = draft();

    const next = applyScopedRoleAction(current, { type: 'add-global-support' }, {
      topLevelId: 'tools',
      target: { path: 'src', kind: 'directory' },
      topLevelTargets: [PLATFORM, TOOLS],
      deepFocusMode: 'distributed',
    }).next;

    expect(next.state.selectedSupportTargets).toEqual([
      expect.objectContaining({ path: 'src', repoId: 'tools', repoLocalPath: '/repos/tools' }),
    ]);
  });
});
