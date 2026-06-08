import { describe, expect, it } from 'vitest';

import type { ContextPackDeepFocusState } from '../../../shared/desktopContract';
import type { TreeRowData } from './DeepFocusTreeRow';
import {
  computePopoverActions,
  computeRowBadges,
  detectPromotableScope,
  isTestClassifiedRow,
  validateNestedScopeForUi,
} from './SidebarDeepFocusUtils';
import {
  selectParentOfPrimaryRows,
  selectSiblingSupportCandidates,
} from './sidebarDeepFocusSelectors';
import { applyScopedRoleAction } from './sidebarDeepFocusReducers';
import {
  deriveDeepFocusEditorModel,
  type DeepFocusEditorModelInput,
} from './useDeepFocusEditorModel';

function makeDeepFocusState(
  overrides: Partial<ContextPackDeepFocusState> = {},
): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: true,
    deepFocusPrimaryRepoId: 'repo-1',
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: 'src/api/users.ts',
    selectedFocusTargetKind: 'file',
    selectedFocusTargets: [
      { path: 'src/api/users.ts', kind: 'file', role: 'anchor' },
    ],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
    ...overrides,
  };
}

function makeTreeRow(path: string, overrides: Partial<TreeRowData> = {}): TreeRowData {
  const label = path.split('/').filter(Boolean).at(-1) ?? 'Repo root';
  return {
    id: `tree:${path || 'root'}`,
    label,
    displayPath: path,
    targetPath: path,
    kind: 'file',
    hasChildren: false,
    topLevelId: 'repo-1',
    topLevelLabel: 'Frontend',
    topLevelPath: '',
    repoLocalPath: '/tmp/repo-1',
    isTopLevel: false,
    ancillaryAllowed: true,
    systemLayer: null,
    depth: 0,
    ...overrides,
  };
}

function makeEditorModelInput(
  overrides: Partial<DeepFocusEditorModelInput> = {},
): DeepFocusEditorModelInput {
  const state = makeDeepFocusState();
  return {
    draftState: state,
    scopeCursor: { kind: 'global' },
    draftTopLevel: null,
    currentRows: [],
    expanded: new Set(),
    selectedRow: null,
    parentSupportGhostState: null,
    searchQuery: '',
    treeLoading: false,
    showTreeLoading: false,
    treeTruncated: false,
    activeTopLevelId: 'repo-1',
    deepFocusMode: 'distributed',
    ...overrides,
  };
}

describe('Deep Focus scope utilities', () => {
  it('shows only the cursor-scoped role badges, not cross-scope hints', () => {
    // The row is the test target of the cursor's primary AND of another
    // primary AND of the global scope. Pre-cleanup we surfaced cross-scope
    // hints (T·2, Tg) which read as cryptic line-noise — see the user-facing
    // confusion that drove the removal. Now only the cursor-scoped role
    // ('T' for the row's role under cursor's primary 0) is shown.
    const badges = computeRowBadges(
      { targetPath: 'tests/app', kind: 'directory' },
      makeDeepFocusState({
        selectedFocusPath: 'src/app',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [
          {
            path: 'src/app',
            kind: 'directory',
            role: 'anchor',
            testTarget: { path: 'tests/app', kind: 'directory' },
            supportTargets: [{ path: 'docs/app', kind: 'directory' }],
          },
          {
            path: 'src/admin',
            kind: 'directory',
            role: 'primary',
            testTarget: { path: 'tests/app', kind: 'directory' },
          },
        ],
        selectedTestTarget: { path: 'tests/app', kind: 'directory' },
      }),
      { kind: 'primary', index: 0 },
    );

    expect(badges.map((badge) => badge.label)).toEqual(['T']);
  });

  it('computes cursor-relative popover actions and repo-root restrictions', () => {
    const state = makeDeepFocusState({
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { path: '', kind: 'directory', role: 'anchor' },
        { path: 'src/admin', kind: 'directory', role: 'primary' },
      ],
    });

    // `tests/admin` is covered by the implicit repo-root anchor at ''.
    // Children of any primary are no longer offered as support (the primary
    // already covers them as writable, so a readonly support entry would be
    // redundant). Only the remove-primary affordance remains so the user
    // can dissolve coverage and promote a narrower primary.
    expect(computePopoverActions(
      { targetPath: 'tests/admin', kind: 'directory', label: 'admin' },
      state,
      { kind: 'global' },
    ).map((action) => action.label)).toEqual([
      'Remove Primary Target',
    ]);
    expect(computePopoverActions(
      { targetPath: 'tests', kind: 'directory', label: 'tests' },
      state,
      { kind: 'global' },
    ).map((action) => action.label)).toContain('Use as test for all');
    // Cursor sits on the repo-root anchor (index 0). The row label is missing
    // so `isTestClassifiedRow` returns false → no `set-primary-test`. The
    // row is covered by the cursor primary, so `add-primary-support` is also
    // suppressed (no carve-outs inside own writable area). Only the
    // remove-containing affordance remains.
    expect(computePopoverActions(
      { targetPath: 'tests/admin', kind: 'directory' },
      state,
      { kind: 'primary', index: 0 },
    ).map((action) => action.label)).toEqual([
      'Remove Primary Target',
    ]);
  });

  it('exposes only remove-primary on covered children of a path-"" primary (monolith Tools case)', () => {
    // Real user-reported scenario: in monolith mode, picking Tools as primary
    // lands it at path '' (Tools IS the focus root). Clicking a child like
    // Tools/lib used to short-circuit the popover to [] because an early
    // return fired before any affordance was pushed. The user then saw "no
    // card at all" because the empty-popover guard auto-dismissed.
    //
    // Spec correction (user feedback): children of any primary are NOT valid
    // support carve-outs — the primary already covers them as writable.
    // Test selection still goes through the name-based heuristic — `lib` is
    // not a test-classified label, so `set-primary-test` is absent. Only
    // the remove-primary affordance is exposed.
    const state = makeDeepFocusState({
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoId: 'tools',
          repoLocalPath: '/tmp/tools',
        },
      ],
    });
    const actions = computePopoverActions(
      {
        targetPath: 'Tools/lib',
        kind: 'directory',
        label: 'lib',
        topLevelId: 'tools',
      },
      state,
      { kind: 'primary', index: 0 },
    );
    const types = actions.map((a) => a.action.type);
    expect(types).not.toContain('set-primary-test');
    expect(types).not.toContain('add-primary-support');
    expect(types).toContain('remove-primary');
    const remove = actions.find((a) => a.action.type === 'remove-primary');
    expect(remove?.action).toEqual({ type: 'remove-primary', index: 0 });
  });

  it('still offers set-primary-test on a test-classified child of the path-"" primary', () => {
    // Counterpart to the monolith Tools regression: a child folder named
    // `tests` (or matching the heuristic) under Tools at path '' must
    // remain a valid test candidate. The earlier `isRepoRootPrimary` early
    // return blocked this; removing it without re-introducing the broad
    // `rowInsideCursorPrimary` permissive branch lands on the right
    // semantics — the heuristic does the gating.
    const state = makeDeepFocusState({
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoId: 'tools',
          repoLocalPath: '/tmp/tools',
        },
      ],
    });
    const types = computePopoverActions(
      {
        targetPath: 'Tools/tests',
        kind: 'directory',
        label: 'tests',
        topLevelId: 'tools',
      },
      state,
      { kind: 'primary', index: 0 },
    ).map((a) => a.action.type);
    expect(types).toContain('set-primary-test');
  });

  it('does not offer add-primary-support on a file inside the cursor primary', () => {
    // User requirement (clarified): a file under a primary is already covered
    // by the primary as writable. Adding it again as a readonly support is
    // redundant and confusing, so the popover does not surface "Add as
    // support" for any descendant of any primary. The validator enforces the
    // same rule via `scoped-support-inside-own-primary-writable`.
    const state = makeDeepFocusState({
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoId: 'tools',
          repoLocalPath: '/tmp/tools',
        },
      ],
    });
    const labels = computePopoverActions(
      {
        targetPath: 'Tools/lib/secret.ts',
        kind: 'file',
        label: 'secret.ts',
        topLevelId: 'tools',
      },
      state,
      { kind: 'primary', index: 0 },
    ).map((action) => action.label);
    expect(labels).not.toContain('Add as support for repo root');
    expect(validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [
        {
          path: 'Tools',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [{ path: 'Tools/lib', kind: 'directory' }],
        },
      ],
    }))).toEqual([
      expect.objectContaining({
        scope: { kind: 'primary', index: 0 },
        field: 'supportTargets',
        index: 0,
        reason: 'scoped-support-inside-own-primary-writable',
      }),
    ]);
  });

  it('does not offer per-primary test on a non-test-named child of the cursor primary', () => {
    // Spec correction (user feedback): the per-primary test option should
    // appear only on test-classified folders, regardless of whether the row
    // sits inside the cursor's primary writable area. A folder named `lib`
    // inside Tools is not a test candidate just because Tools is primary.
    const state = makeDeepFocusState({
      selectedFocusPath: 'Tools',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { path: 'Tools', kind: 'directory', role: 'anchor' },
      ],
    });
    const labels = computePopoverActions(
      { targetPath: 'Tools/lib', kind: 'directory', label: 'lib' },
      state,
      { kind: 'primary', index: 0 },
    ).map((action) => action.label);
    expect(labels).not.toEqual(expect.arrayContaining([expect.stringMatching(/^Use as test for /)]));
  });

  it('does not offer per-primary test on unrelated non-test-named directories', () => {
    // Counterpart to the above: rows OUTSIDE any primary's writable area
    // still go through the heuristic so we don't pollute every folder's
    // popover with "Use as Test" buttons.
    const state = makeDeepFocusState({
      selectedFocusPath: 'Tools',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { path: 'Tools', kind: 'directory', role: 'anchor' },
      ],
    });
    const labels = computePopoverActions(
      { targetPath: 'unrelated/lib', kind: 'directory', label: 'lib' },
      state,
      { kind: 'primary', index: 0 },
    ).map((action) => action.label);
    expect(labels).not.toEqual(expect.arrayContaining([expect.stringMatching(/^Use as test for /)]));
  });

  it('offers make-primary and cross-repo support on a sibling-repo row when cursor is on a repo-root primary', () => {
    // Regression for the cross-repo blocking bug: selecting Tools (a repo-root
    // primary in distributed mode) must not suppress `make-primary` on rows
    // belonging to a sibling repo (Platform). Previously the repo-root branch
    // short-circuited to `[remove-primary]` for any row, trapping the user.
    //
    // Cross-repo support is also valid: with no Platform primary, the user
    // can pin Platform as read-only context for Tools (no overlap risk).
    // The per-primary support is exposed because no primary covers the
    // sibling repo. The global cluster (`add-global-support`) is also
    // surfaced — when the cursor is on a primary the user still sees the
    // "for all primaries" affordance alongside the scoped one.
    const state = makeDeepFocusState({
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoId: 'tools',
          repoLocalPath: '/tmp/tools',
        },
      ],
    });
    const labels = computePopoverActions(
      {
        targetPath: '',
        kind: 'directory',
        label: 'platform',
        topLevelId: 'platform',
        isTopLevel: true,
      },
      state,
      { kind: 'primary', index: 0 },
    ).map((action) => action.label);
    expect(labels).toEqual([
      'Add Primary Target',
      'Add as support for repo root',
      'Add as support for all',
    ]);
  });

  it('allows Tools folder support when Platform is a repo-root primary', () => {
    const state = makeDeepFocusState({
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoId: 'platform',
          repoLocalPath: '/repos/platform',
        },
      ],
    });
    const toolsRow = {
      targetPath: 'Acme.Cli',
      kind: 'directory' as const,
      label: 'Acme.Cli',
      topLevelId: 'tools',
    };

    expect(computePopoverActions(toolsRow, state, { kind: 'primary', index: 0 }).map((action) => action.label))
      .toEqual(expect.arrayContaining(['Add as support for repo root', 'Add as support for all']));

    const scoped = applyScopedRoleAction(
      { selectedWorkingFocusIds: ['platform'], state, scopeCursor: { kind: 'primary', index: 0 } },
      { type: 'add-primary-support', index: 0 },
      {
        topLevelId: 'tools',
        target: { path: 'Acme.Cli', kind: 'directory', repoLocalPath: '/repos/tools' },
        topLevelTargets: [
          {
            id: 'platform',
            label: 'Platform',
            rootPath: '',
            repoLocalPath: '/repos/platform',
            ancillaryAllowed: true,
            systemLayer: 'backend',
          },
          {
            id: 'tools',
            label: 'Tools',
            rootPath: '',
            repoLocalPath: '/repos/tools',
            ancillaryAllowed: true,
            systemLayer: 'backend',
          },
        ],
        deepFocusMode: 'distributed',
      },
    ).next.state;

    expect(scoped.selectedFocusTargets?.[0]?.supportTargets).toEqual([{
      path: 'Acme.Cli',
      kind: 'directory',
      repoLocalPath: '/repos/tools',
      repoId: 'tools',
    }]);
    expect(validateNestedScopeForUi(scoped)).toEqual([]);
  });

  it('targets the deepest containing primary when nested coverage exists', () => {
    // Real scenario: implicit root anchor at '' coexists with an explicit
    // `Tools` primary the user selected. Clicking `Tools/lib` should treat
    // Tools (the narrowest containing primary) as the parent for the
    // remove-primary affordance. Bug: `findIndex` returned the anchor
    // (index 0) because it appears first, so the popover removed the
    // anchor instead of Tools.
    const state = makeDeepFocusState({
      selectedFocusPath: 'Tools',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { path: '', kind: 'directory', role: 'anchor' },
        { path: 'Tools', kind: 'directory', role: 'primary' },
      ],
    });
    const actions = computePopoverActions(
      { targetPath: 'Tools/lib', kind: 'directory', label: 'lib' },
      state,
      { kind: 'primary', index: 1 },
    );
    const remove = actions.find((a) => a.action.type === 'remove-primary');
    expect(remove?.action).toEqual({ type: 'remove-primary', index: 1 });
  });

  it('does not expose scoped support from the global cursor for rows inside a primary', () => {
    // User clarification: a child of a primary cannot be a support target,
    // regardless of cursor. The global cursor used to expose a carve-out
    // shortcut to `add-primary-support` for the deepest containing primary;
    // that shortcut was removed because it violates the new rule.
    const state = makeDeepFocusState({
      selectedFocusPath: 'Tools',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { path: 'Tools', kind: 'directory', role: 'anchor' },
      ],
    });
    const types = computePopoverActions(
      { targetPath: 'Tools/lib/secret.ts', kind: 'file', label: 'secret.ts' },
      state,
      { kind: 'global' },
    ).map((a) => a.action.type);
    expect(types).not.toContain('add-primary-support');
    expect(types).not.toContain('add-global-support');
  });

  it('hides add-primary-support on a row that already sits under an existing scoped support (Bug C)', () => {
    // Setup: Tools is primary; `shared` is already a scoped support sitting
    // OUTSIDE the primary writable area. Clicking `shared/utils` must NOT
    // offer "Add as support" — the existing support fully covers it, so a
    // second entry would be redundant nesting. Validator reports the
    // redundancy if state is mutated by other paths.
    const state = makeDeepFocusState({
      selectedFocusPath: 'Tools',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: 'Tools',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [{ path: 'shared', kind: 'directory' }],
        },
      ],
    });
    const types = computePopoverActions(
      { targetPath: 'shared/utils', kind: 'directory', label: 'utils' },
      state,
      { kind: 'primary', index: 0 },
    ).map((a) => a.action.type);
    expect(types).not.toContain('add-primary-support');

    const redundantState = makeDeepFocusState({
      selectedFocusTargets: [
        {
          path: 'Tools',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [
            { path: 'shared', kind: 'directory' },
            { path: 'shared/utils', kind: 'directory' },
          ],
        },
      ],
    });
    expect(validateNestedScopeForUi(redundantState)).toEqual([
      expect.objectContaining({
        scope: { kind: 'primary', index: 0 },
        field: 'supportTargets',
        index: 1,
        reason: 'scoped-support-redundant-under-support',
      }),
    ]);
  });

  it('hides add-primary-support on a row that sits under the cursor primary test target (Bug D)', () => {
    // Setup: Tools is primary with `tests` as its test target (outside the
    // primary writable area, so the test/support redundancy rule is the one
    // under examination — not the writable-area rule). Clicking
    // `tests/admin` must NOT offer "Add as support" — the test target
    // already shadows that subtree as read context. Validator reports the
    // redundancy.
    const state = makeDeepFocusState({
      selectedFocusPath: 'Tools',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: 'Tools',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests', kind: 'directory' },
        },
      ],
    });
    const types = computePopoverActions(
      { targetPath: 'tests/admin', kind: 'directory', label: 'admin' },
      state,
      { kind: 'primary', index: 0 },
    ).map((a) => a.action.type);
    expect(types).not.toContain('add-primary-support');

    const redundantState = makeDeepFocusState({
      selectedFocusTargets: [
        {
          path: 'Tools',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests', kind: 'directory' },
          supportTargets: [{ path: 'tests/admin', kind: 'directory' }],
        },
      ],
    });
    expect(validateNestedScopeForUi(redundantState)).toEqual([
      expect.objectContaining({
        scope: { kind: 'primary', index: 0 },
        field: 'supportTargets',
        index: 0,
        reason: 'scoped-support-redundant-under-test',
      }),
    ]);
  });

  it('hides add-global-support and validates redundancy under existing global test/support (Bugs C+D global mirror)', () => {
    // Symmetric gating for the global bucket: a row inside the global test
    // target or an existing global support entry must not offer
    // `add-global-support`, and the validator flags redundant entries.
    const stateUnderTest = makeDeepFocusState({
      selectedFocusTargets: [
        { path: 'Tools', kind: 'directory', role: 'anchor' },
      ],
      selectedTestTarget: { path: 'tests', kind: 'directory' },
    });
    const typesUnderTest = computePopoverActions(
      { targetPath: 'tests/admin', kind: 'directory', label: 'admin' },
      stateUnderTest,
      { kind: 'global' },
    ).map((a) => a.action.type);
    expect(typesUnderTest).not.toContain('add-global-support');

    const stateUnderSupport = makeDeepFocusState({
      selectedFocusTargets: [
        { path: 'Tools', kind: 'directory', role: 'anchor' },
      ],
      selectedSupportTargets: [{ path: 'shared', kind: 'directory' }],
    });
    const typesUnderSupport = computePopoverActions(
      { targetPath: 'shared/utils', kind: 'directory', label: 'utils' },
      stateUnderSupport,
      { kind: 'global' },
    ).map((a) => a.action.type);
    expect(typesUnderSupport).not.toContain('add-global-support');

    expect(validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [
        { path: 'Tools', kind: 'directory', role: 'anchor' },
      ],
      selectedTestTarget: { path: 'tests', kind: 'directory' },
      selectedSupportTargets: [{ path: 'tests/admin', kind: 'directory' }],
    }))).toEqual([
      expect.objectContaining({
        scope: { kind: 'global' },
        field: 'supportTargets',
        index: 0,
        reason: 'global-support-redundant-under-global-test',
      }),
    ]);

    expect(validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [
        { path: 'Tools', kind: 'directory', role: 'anchor' },
      ],
      selectedSupportTargets: [
        { path: 'shared', kind: 'directory' },
        { path: 'shared/utils', kind: 'directory' },
      ],
    }))).toEqual([
      expect.objectContaining({
        scope: { kind: 'global' },
        field: 'supportTargets',
        index: 1,
        reason: 'global-support-redundant-under-global-support',
      }),
    ]);
  });

  it('offers remove-containing-primary on a child row whose parent is primary', () => {
    // Regression for the "stuck inside a primary" bug: clicking a child row
    // covered by an existing primary used to render an empty popover. Users
    // need a way to dissolve the parent so the child can become its own
    // primary. The action should target the containing primary's index, not
    // the cursor.
    const state = makeDeepFocusState({
      selectedFocusPath: 'Tools',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        { path: 'Tools', kind: 'directory', role: 'anchor' },
      ],
    });
    const fromPrimary = computePopoverActions(
      { targetPath: 'Tools/lib', kind: 'directory', label: 'lib' },
      state,
      { kind: 'primary', index: 0 },
    );
    const fromGlobal = computePopoverActions(
      { targetPath: 'Tools/lib', kind: 'directory', label: 'lib' },
      state,
      { kind: 'global' },
    );
    expect(fromPrimary.map((action) => action.label)).toContain('Remove Primary Target');
    expect(fromGlobal.map((action) => action.label)).toContain('Remove Primary Target');
    const removeFromGlobal = fromGlobal.find((a) => a.label === 'Remove Primary Target');
    expect(removeFromGlobal?.action).toEqual({ type: 'remove-primary', index: 0 });
  });

  it('hides global test and support actions when no primary is selected', () => {
    // Without a primary, global test/support targets have no consumer — the
    // mutation succeeds but produces no visible effect. The popover should
    // only offer `make-primary` so the user sees an action that actually
    // does something.
    const emptyState = makeDeepFocusState({
      selectedFocusPath: '',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [],
    });
    expect(computePopoverActions(
      { targetPath: 'tests', kind: 'directory', label: 'tests' },
      emptyState,
      { kind: 'global' },
    ).map((action) => action.label)).toEqual(['Add Primary Target']);
    expect(computePopoverActions(
      { targetPath: 'src/lib', kind: 'directory', label: 'lib' },
      emptyState,
      { kind: 'global' },
    ).map((action) => action.label)).toEqual(['Add Primary Target']);
  });

  it('hides per-primary test action when row is already the global test target', () => {
    // The global bucket already covers every primary, so emitting
    // `set-primary-test` would create a no-op redundant assignment. The
    // converse (per-primary already assigned, then offering global) is allowed
    // because per-primary slots are independent and a user may want to
    // promote a per-primary test to a global one.
    const state = makeDeepFocusState({
      selectedFocusTargets: [
        { path: 'src/libs', kind: 'directory', role: 'anchor' },
        { path: 'src/admin', kind: 'directory', role: 'primary' },
      ],
      selectedTestTarget: { path: 'tests', kind: 'directory' },
    });
    const labels = computePopoverActions(
      { targetPath: 'tests', kind: 'directory', label: 'tests' },
      state,
      { kind: 'primary', index: 0 },
    ).map((action) => action.label);
    expect(labels).not.toEqual(expect.arrayContaining([expect.stringMatching(/^Use as test for /)]));
  });

  it('still offers per-primary test when the row is a different test target', () => {
    // Per-primary tests are single-slot per primary, but multiple primaries
    // can share the same row as their test target. As long as the row is not
    // already the global test, the per-primary action stays available.
    const state = makeDeepFocusState({
      selectedFocusTargets: [
        { path: 'src/libs', kind: 'directory', role: 'anchor' },
        { path: 'src/admin', kind: 'directory', role: 'primary' },
      ],
      selectedTestTarget: { path: 'tests/other', kind: 'directory' },
    });
    const labels = computePopoverActions(
      { targetPath: 'tests', kind: 'directory', label: 'tests' },
      state,
      { kind: 'primary', index: 0 },
    ).map((action) => action.label);
    expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/^Use as test for /)]));
  });

  describe('detectPromotableScope', () => {
    it('keeps automatic promotion affordances disabled', () => {
      // Automatic promotion affordances are disabled by design under total selection exclusivity.
      const shared = { path: 'tests/all', kind: 'directory' as const };
      const state = makeDeepFocusState({
        selectedFocusTargets: [
          { path: 'src/api', kind: 'directory', role: 'anchor', testTarget: shared },
          { path: 'src/web', kind: 'directory', role: 'primary', testTarget: shared },
        ],
      });
      expect(detectPromotableScope(state)).toEqual({ testTarget: null, supportTargets: [] });
    });
  });

  it('routes nested Deep Focus validation errors to offending slots', () => {
    // A primary listing itself as a support is `scoped-support-equals-self`,
    // which routes to the primary scope's supportTargets[0] slot. Used here
    // as a stable, low-bleed scenario that exercises the routing pipeline
    // (scope + field + index) for a primary-scoped support error.
    expect(validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusPath: 'src/app',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: 'src/app',
          kind: 'directory',
          role: 'anchor',
          supportTargets: [{ path: 'src/app', kind: 'directory' }],
        },
      ],
    }))).toEqual([
      expect.objectContaining({
        scope: { kind: 'primary', index: 0 },
        field: 'supportTargets',
        index: 0,
        reason: 'scoped-support-equals-self',
      }),
    ]);
  });

  it('classifies explicit test metadata on file rows only when metadata says so', () => {
    expect(isTestClassifiedRow({
      kind: 'file',
      label: 'externalMcpHandlers.test.ts',
      isTest: true,
    })).toBe(true);
    expect(isTestClassifiedRow({
      kind: 'file',
      label: 'externalMcpHandlers.test.ts',
      artifactType: 'test-code',
    })).toBe(true);
    expect(isTestClassifiedRow({
      kind: 'file',
      label: 'externalMcpHandlers.ts',
      isTest: false,
    })).toBe(false);
  });

  it('offers global and scoped test actions for classified test files', () => {
    const testFile = {
      targetPath: 'src/frontend/desktop/electron/externalMcpHandlers.test.ts',
      kind: 'file' as const,
      label: 'externalMcpHandlers.test.ts',
      isTest: true,
    };

    expect(computePopoverActions(
      testFile,
      makeDeepFocusState(),
      { kind: 'global' },
    ).map((action) => action.label)).toContain('Use as test for all');

    expect(computePopoverActions(
      testFile,
      makeDeepFocusState(),
      { kind: 'primary', index: 0 },
    ).map((action) => action.label)).toContain('Use as test for users.ts');
  });

  it('rejects child primary targets and support under an existing folder primary target', () => {
    const state = makeDeepFocusState({
      selectedFocusTargets: [
        { path: 'src', kind: 'directory', role: 'anchor', repoId: 'repo-1' },
        { path: 'src/app', kind: 'directory', role: 'primary', repoId: 'repo-1' },
      ],
      selectedSupportTargets: [{ path: 'src/docs', kind: 'directory' }],
    });

    expect(validateNestedScopeForUi(state)).toEqual([
      expect.objectContaining({ scope: { kind: 'primary', index: 1 }, reason: 'primary-target-inside-primary-writable' }),
      expect.objectContaining({ scope: { kind: 'global' }, field: 'supportTargets', index: 0, reason: 'global-support-inside-primary-writable' }),
    ]);

    const row = { targetPath: 'src/app', kind: 'directory' as const, label: 'app', topLevelId: 'repo-1' };
    expect(computePopoverActions(row, state, { kind: 'global' }).map((action) => action.label))
      .not.toEqual(expect.arrayContaining(['Add Primary Target', 'Add as support for all']));
    expect(computePopoverActions(row, state, { kind: 'primary', index: 0 }).map((action) => action.label))
      .not.toEqual(expect.arrayContaining(['Add Primary Target', 'Add as support for src']));
    expect(validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [
        { path: 'src', kind: 'directory', role: 'anchor', repoId: 'tools', repoLocalPath: '/repos/tools' },
        { path: 'src/app', kind: 'directory', role: 'primary', repoId: 'platform', repoLocalPath: '/repos/platform' },
      ],
    })).map((error) => error.reason)).not.toContain('primary-target-inside-primary-writable');
  });

  it('allows parent and deeper writable-folder support (carve-out semantics)', () => {
    // Parent support widens the read-only context surrounding the primary.
    expect(validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [{
        path: 'src/api/users.ts',
        kind: 'file',
        role: 'anchor',
        supportTargets: [{ path: 'src/api', kind: 'directory' }],
      }],
    }))).toEqual([]);
    // Support deeper than the primary is also valid: it carves a read-only
    // zone INSIDE the primary's writable area. Previously rejected by
    // `scoped-support-inside-primary-writable`; the rule was dropped to
    // enable the carve-out workflow.
    expect(validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [{
        path: 'src/api/users.ts',
        kind: 'file',
        role: 'anchor',
        supportTargets: [{ path: 'src/api/auth/v1.ts', kind: 'file' }],
      }],
    }))).toEqual([]);
  });

  it('allows parent support for a child folder primary target', () => {
    expect(validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [{
        path: 'src/app',
        kind: 'directory',
        role: 'anchor',
        repoId: 'repo-1',
        supportTargets: [{ path: 'src', kind: 'directory' }],
      }],
    }))).toEqual([]);
    expect(computePopoverActions(
      { targetPath: 'src', kind: 'directory', label: 'src', topLevelId: 'repo-1' },
      makeDeepFocusState({
        selectedFocusTargets: [{ path: 'src/app', kind: 'directory', role: 'anchor', repoId: 'repo-1' }],
      }),
      { kind: 'primary', index: 0 },
    ).map((action) => action.label)).toEqual(expect.arrayContaining(['Add Primary Target', 'Add as support for app']));
  });

  it('preserves cross-primary support overlap validation after the writable-folder carve-out', () => {
    const errors = validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [
        {
          path: 'src/api/users.ts',
          kind: 'file',
          role: 'anchor',
          supportTargets: [{ path: 'src/db', kind: 'directory' }],
        },
        { path: 'src/db/schema.ts', kind: 'file', role: 'primary' },
      ],
    }));

    // `scoped-support-inside-primary-writable` no longer exists (carve-outs
    // are now valid). What still must fire is the cross-primary overlap:
    // primary 0's support sits inside primary 1's writable area, so the
    // support would shadow the other primary's writable surface. That's a
    // genuine conflict, not a carve-out.
    expect(errors).toEqual([
      expect.objectContaining({
        scope: { kind: 'primary', index: 0 },
        field: 'supportTargets',
        index: 0,
        reason: 'cross-primary-support-overlaps-writable',
      }),
    ]);
  });

  it('flags a support that lives on both a primary and the global bucket as duplicated-across-scopes', () => {
    const duplicated = { path: 'src/lib/format.ts', kind: 'file' as const };
    const errors = validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [
        {
          path: 'src/api/users.ts',
          kind: 'file',
          role: 'anchor',
          supportTargets: [duplicated],
        },
      ],
      selectedSupportTargets: [duplicated],
    }));

    expect(errors).toEqual([
      expect.objectContaining({
        scope: { kind: 'global' },
        field: 'supportTargets',
        index: 0,
        reason: 'support-duplicated-across-scopes',
        conflictsWith: { scope: { kind: 'primary', index: 0 }, field: 'supportTargets' },
      }),
    ]);
  });

  it('does not flag cross-primary sharing as duplicated-across-scopes (same path on two primaries is intentional)', () => {
    const shared = { path: 'src/lib/format.ts', kind: 'file' as const };
    const errors = validateNestedScopeForUi(makeDeepFocusState({
      selectedFocusTargets: [
        {
          path: 'src/api/users.ts',
          kind: 'file',
          role: 'anchor',
          supportTargets: [shared],
        },
        {
          path: 'src/api/orders.ts',
          kind: 'file',
          role: 'primary',
          supportTargets: [shared],
        },
      ],
      selectedSupportTargets: [],
    }));

    expect(errors.map((error) => error.reason)).not.toContain('support-duplicated-across-scopes');
  });

  it('selects parent rows and available sibling support candidates', () => {
    const parentRows = [
      makeTreeRow('src', { kind: 'directory', hasChildren: true }),
      makeTreeRow('src/api', { kind: 'directory', hasChildren: true }),
      makeTreeRow('src/api/users.ts'),
    ];
    expect(selectParentOfPrimaryRows(makeDeepFocusState(), parentRows)).toEqual(new Set(['tree:src/api']));

    const siblingRows = [
      makeTreeRow('src/api/users.ts'),
      makeTreeRow('src/api/auth.ts'),
      makeTreeRow('src/api/profile.ts'),
      makeTreeRow('src/db/schema.ts'),
    ];
    expect(selectSiblingSupportCandidates(
      makeDeepFocusState(),
      makeTreeRow('src/api', { kind: 'directory', hasChildren: true }),
      'distributed',
      siblingRows,
    ).map((row) => row.targetPath))
      .toEqual(['src/api/auth.ts', 'src/api/profile.ts']);
  });

  it('excludes sibling support candidates already assigned any role', () => {
    const treeFlat = [
      makeTreeRow('src/api/users.ts'),
      makeTreeRow('src/api/auth.ts'),
      makeTreeRow('src/api/profile.ts'),
    ];
    expect(selectSiblingSupportCandidates(
      makeDeepFocusState({
        selectedFocusTargets: [
          { path: 'src/api/users.ts', kind: 'file', role: 'anchor' },
          {
            path: 'src/db/schema.ts',
            kind: 'file',
            role: 'primary',
            supportTargets: [{ path: 'src/api/auth.ts', kind: 'file' }],
          },
        ],
      }),
      makeTreeRow('src/api', { kind: 'directory', hasChildren: true }),
      'distributed',
      treeFlat,
    ).map((row) => row.targetPath)).toEqual(['src/api/profile.ts']);
  });

  it('derives the editor model empty state', () => {
    const model = deriveDeepFocusEditorModel(makeEditorModelInput({
      draftState: makeDeepFocusState({
        selectedFocusTargets: [],
        selectedSupportTargets: [],
      }),
      currentRows: [],
    }));

    expect(model.tree.empty).toBe(true);
    expect(model.tree.emptyStateLabel).toBe('No items');
    expect(model.primaryTargetCount).toBe(0);
    expect(model.supportFileCount).toBe(0);
    expect(model.testFolderStatusLabel).toBe('Test Target: none');
  });

  it('derives a selected row with command actions', () => {
    const row = makeTreeRow('src/api/users.test.ts');
    const model = deriveDeepFocusEditorModel(makeEditorModelInput({
      draftState: makeDeepFocusState(),
      currentRows: [row],
      selectedRow: { row, index: 0 },
    }));

    expect(model.selectedRow.id).toBe(row.id);
    expect(model.selectedRow.label).toBe(row.label);
    expect(model.selectedRow.commandList.map((action) => action.label)).toContain('Add Primary Target');
  });

  it('threads live tree test metadata into selected-row commands', () => {
    const row = makeTreeRow('src/frontend/desktop/electron/externalMcpHandlers.test.ts', {
      isTest: true,
      artifactType: 'test-code',
      pathKind: 'tests',
    });
    const model = deriveDeepFocusEditorModel(makeEditorModelInput({
      draftState: makeDeepFocusState(),
      currentRows: [row],
      selectedRow: { row, index: 0 },
    }));

    expect(model.selectedRow.commandList.map((action) => action.label)).toContain('Use as Test for all primaries');
  });

  it('derives active search state and filtered rows', () => {
    const matchingRow = makeTreeRow('src/api/users.ts');
    const hiddenRow = makeTreeRow('docs/readme.md');
    const model = deriveDeepFocusEditorModel(makeEditorModelInput({
      currentRows: [matchingRow, hiddenRow],
      searchQuery: 'users',
    }));

    expect(model.search.active).toBe(true);
    expect(model.tree.visibleRows.map(({ row }) => row.id)).toEqual([matchingRow.id]);
  });

  it('derives Primary Target scope state', () => {
    const model = deriveDeepFocusEditorModel(makeEditorModelInput({
      draftState: makeDeepFocusState({
        selectedFocusTargets: [
          { path: 'src/api/users.ts', kind: 'file', role: 'anchor' },
          { path: 'src/admin', kind: 'directory', role: 'primary' },
        ],
      }),
      scopeCursor: { kind: 'primary', index: 1 },
    }));

    expect(model.scopeMode).toBe('primary');
    expect(model.activeScopeLabel).toBe('Active scope: admin');
    expect(model.primaryTargetCount).toBe(2);
  });

  it('derives validation feedback state', () => {
    // Scenario: anchor at `src` with a self-referencing support target —
    // a primary cannot also be its own support. Stable example for
    // exercising the feedback derivation pipeline.
    const model = deriveDeepFocusEditorModel(makeEditorModelInput({
      draftState: makeDeepFocusState({
        selectedFocusTargets: [
          {
            path: 'src',
            kind: 'directory',
            role: 'anchor',
            supportTargets: [{ path: 'src', kind: 'directory' }],
          },
        ],
      }),
    }));

    expect(model.validation.hasFeedback).toBe(true);
    expect(model.validation.errors).toEqual([
      expect.objectContaining({ reason: 'scoped-support-equals-self' }),
    ]);
  });
});
