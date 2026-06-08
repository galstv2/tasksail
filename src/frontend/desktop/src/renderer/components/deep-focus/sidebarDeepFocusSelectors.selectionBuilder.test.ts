import { describe, expect, it } from 'vitest';

import type { ContextPackDeepFocusState, ContextPackPrimaryFocusTarget } from '../../../shared/desktopContract';
import type { DeepFocusDraft, TopLevelTarget } from './SidebarDeepFocusControls.types';
import { applyScopedRoleAction } from './sidebarDeepFocusReducers';
import { buildDeepFocusSelectionBuilderViewModel } from './sidebarDeepFocusSelectors';

function state(overrides: Partial<ContextPackDeepFocusState> = {}): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: true,
    deepFocusPrimaryRepoId: 'repo-a',
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
    ...overrides,
  };
}

function primary(overrides: Partial<ContextPackPrimaryFocusTarget> = {}): ContextPackPrimaryFocusTarget {
  return {
    path: 'src/app',
    kind: 'directory',
    role: 'anchor',
    repoId: 'repo-a',
    repoLocalPath: '/repos/repo-a',
    ...overrides,
  };
}

const REPO_A_TOP_LEVEL: TopLevelTarget = {
  id: 'repo-a',
  label: 'Repo A',
  rootPath: '',
  repoLocalPath: '/repos/repo-a',
  ancillaryAllowed: false,
  systemLayer: null,
};

function draft(draftState: ContextPackDeepFocusState): DeepFocusDraft {
  return {
    selectedWorkingFocusIds: ['repo-a'],
    state: draftState,
    scopeCursor: { kind: 'primary', index: 0 },
  };
}

function apply(
  current: DeepFocusDraft,
  action: Parameters<typeof applyScopedRoleAction>[1],
  path: string,
): DeepFocusDraft {
  return applyScopedRoleAction(current, action, {
    topLevelId: 'repo-a',
    target: { path, kind: 'directory' },
    topLevelTargets: [REPO_A_TOP_LEVEL],
    deepFocusMode: 'distributed',
  }).next;
}

describe('buildDeepFocusSelectionBuilderViewModel', () => {
  it('renders an empty model for empty draft selections', () => {
    expect(buildDeepFocusSelectionBuilderViewModel({ draftState: state(), draftTopLevel: null })).toMatchObject({
      empty: true,
      counts: { primary: 0, support: 0, test: 0 },
      primaryItems: [],
      supportItems: [],
      testItems: [],
    });
  });

  it('categorizes primaries, global scoped targets, and per-primary scoped targets in draft order', () => {
    const draftPrimary = primary({
      supportTargets: [{ path: 'src/app/fixtures', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' }],
      testTarget: { path: 'src/app/app.test.ts', kind: 'file', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' },
    });
    const model = buildDeepFocusSelectionBuilderViewModel({
      draftTopLevel: { id: 'repo-a', label: 'Repo A', rootPath: '', repoLocalPath: '/repos/repo-a', ancillaryAllowed: false, systemLayer: null },
      draftState: state({
        selectedFocusTargets: [draftPrimary],
        selectedSupportTargets: [{ path: 'docs', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' }],
        selectedTestTarget: { path: 'tests', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' },
      }),
    });

    expect(model.empty).toBe(false);
    expect(model.counts).toEqual({ primary: 1, support: 2, test: 2 });
    expect(model.primaryItems).toMatchObject([{ label: 'app', title: 'src/app' }]);
    expect(model.supportItems.map((item) => [item.label, item.scopeLabel, item.scopeKind])).toEqual([
      ['docs', 'All primaries', 'global'],
      ['fixtures', 'app', 'primary'],
    ]);
    expect(model.testItems.map((item) => [item.label, item.scopeLabel, item.scopeKind])).toEqual([
      ['tests', 'All primaries', 'global'],
      ['app.test.ts', 'app', 'primary'],
    ]);
  });

  it('uses identity-aware keys and tolerates legacy missing identity fields without mutating input', () => {
    const original = state({
      selectedFocusTargets: [primary({ repoId: undefined, focusId: undefined, repoLocalPath: undefined })],
      selectedSupportTargets: [{ path: '', kind: 'directory' }],
    });
    const before = JSON.stringify(original);
    const model = buildDeepFocusSelectionBuilderViewModel({ draftState: original, draftTopLevel: null });

    expect(model.primaryItems[0]?.key).toContain('src/app');
    expect(model.supportItems[0]).toMatchObject({
      key: 'global|global|directory||||',
      label: '/',
      title: '/',
      primaryKey: null,
    });
    expect(JSON.stringify(original)).toBe(before);
  });

  it('labels distributed multi-repo primaries with repo prefixes and whole-repo fallbacks', () => {
    const model = buildDeepFocusSelectionBuilderViewModel({
      draftTopLevel: null,
      draftState: state({
        selectedFocusTargets: [
          primary({ path: 'src', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' }),
          primary({ path: 'src', role: 'primary', repoId: 'repo-b', repoLocalPath: '/repos/repo-b' }),
          primary({ path: '', role: 'primary', repoId: 'repo-c', repoLocalPath: '/repos/repo-c' }),
        ],
      }),
    });

    expect(model.primaryItems.map((item) => item.label)).toEqual(['repo-a/src', 'repo-b/src', 'repo-c']);
  });

  it('does not hide corrupt duplicate state handed directly to the builder', () => {
    const duplicate = { path: 'Acme.Cli.Tests', kind: 'directory' as const, repoId: 'repo-a', repoLocalPath: '/repos/repo-a' };
    const model = buildDeepFocusSelectionBuilderViewModel({
      draftTopLevel: REPO_A_TOP_LEVEL,
      draftState: state({
        selectedFocusTargets: [primary({ path: 'src/platform', testTarget: duplicate })],
        selectedTestTarget: duplicate,
      }),
    });

    expect(model.counts).toEqual({ primary: 1, support: 0, test: 2 });
    expect(model.testItems.map((item) => [item.label, item.scopeLabel])).toEqual([
      ['Acme.Cli.Tests', 'All primaries'],
      ['Acme.Cli.Tests', 'platform'],
    ]);
  });

  it('reducer-driven global test flow cannot also produce a per-primary builder row', () => {
    const current = draft(state({
      selectedFocusTargets: [primary({ path: 'src/platform' })],
    }));
    const withGlobalTest = apply(current, { type: 'set-global-test' }, 'Acme.Cli.Tests');
    const blockedPerPrimary = apply(withGlobalTest, { type: 'set-primary-test', index: 0 }, 'Acme.Cli.Tests');
    const model = buildDeepFocusSelectionBuilderViewModel({
      draftTopLevel: REPO_A_TOP_LEVEL,
      draftState: blockedPerPrimary.state,
    });

    expect(blockedPerPrimary).toBe(withGlobalTest);
    expect(model.testItems.map((item) => [item.label, item.scopeLabel])).toEqual([
      ['Acme.Cli.Tests', 'All primaries'],
    ]);
  });

  it('reducer-driven per-primary test flow cannot also produce a global builder row', () => {
    const current = draft(state({
      selectedFocusTargets: [primary({ path: 'src/platform' })],
    }));
    const withPrimaryTest = apply(current, { type: 'set-primary-test', index: 0 }, 'Acme.Cli.Tests');
    const blockedGlobal = apply(withPrimaryTest, { type: 'set-global-test' }, 'Acme.Cli.Tests');
    const model = buildDeepFocusSelectionBuilderViewModel({
      draftTopLevel: REPO_A_TOP_LEVEL,
      draftState: blockedGlobal.state,
    });

    expect(blockedGlobal).toBe(withPrimaryTest);
    expect(model.testItems.map((item) => [item.label, item.scopeLabel])).toEqual([
      ['Acme.Cli.Tests', 'platform'],
    ]);
  });
});
