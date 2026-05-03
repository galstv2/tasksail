import { describe, expect, it } from 'vitest';

import type {
  ContextPackDeepFocusState,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import type { TreeRowData } from './DeepFocusTreeRow';
import type { PopoverAction } from './SidebarDeepFocusUtils';
import {
  deriveDeepFocusEditorModel,
  type DeepFocusEditorModelInput,
} from './useDeepFocusEditorModel';

function makePrimary(
  path: string,
  overrides: Partial<ContextPackPrimaryFocusTarget> = {},
): ContextPackPrimaryFocusTarget {
  return {
    path,
    kind: 'directory',
    role: 'anchor',
    repoLocalPath: '/tmp/repo-1',
    repoId: 'repo-1',
    testTarget: undefined,
    supportTargets: [],
    ...overrides,
  };
}

function makeRow(path: string, overrides: Partial<TreeRowData> = {}): TreeRowData {
  const label = path.split('/').filter(Boolean).at(-1) ?? 'Repo root';
  return {
    id: `tree:${path || 'root'}`,
    label,
    displayPath: path,
    targetPath: path,
    kind: 'directory',
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

function makeState(
  overrides: Partial<ContextPackDeepFocusState> = {},
): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: true,
    deepFocusPrimaryRepoId: 'repo-1',
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: '',
    selectedFocusTargetKind: 'directory',
    selectedFocusTargets: [],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
    ...overrides,
  };
}

function makeModelInput(
  row: TreeRowData,
  state: ContextPackDeepFocusState,
  overrides: Partial<DeepFocusEditorModelInput> = {},
): DeepFocusEditorModelInput {
  return {
    draftState: state,
    scopeCursor: { kind: 'global' },
    draftTopLevel: null,
    currentRows: [row],
    expanded: new Set(),
    selectedRow: { row, index: 0 },
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

function commandList(input: DeepFocusEditorModelInput): PopoverAction[] {
  return deriveDeepFocusEditorModel(input).selectedRow.commandList;
}

describe('DeepFocusInlineCommands command-strip — scope-choice cluster (spec §6.1)', () => {
  it('exposes both scoped and global support buttons when the cursor is on a primary', () => {
    // Per-primary cursor → the "Just for <primary>" option appears alongside
    // the "For all primaries" escape hatch. Showing both lets the user widen
    // scope without re-clicking the cursor; the global cursor stays
    // global-only (asserted in the next test).
    const state = makeState({
      selectedFocusTargets: [makePrimary('src/api')],
    });
    const row = makeRow('src/lib');

    const actions = commandList(
      makeModelInput(row, state, { scopeCursor: { kind: 'primary', index: 0 } }),
    );
    const supportButtons = actions.filter((entry) =>
      entry.action.type === 'add-primary-support'
      || entry.action.type === 'add-global-support',
    );

    expect(supportButtons).toHaveLength(2);
    const labels = supportButtons.map((entry) => entry.label);
    expect(labels).toContain('Add as Support · Just for api');
    expect(labels).toContain('Add as Support · For all primaries');
    expect(supportButtons.every((entry) => !entry.disabled)).toBe(true);
  });

  it('exposes only the global support button when the cursor is on All Primaries', () => {
    const state = makeState({
      selectedFocusTargets: [makePrimary('src/api')],
    });
    const row = makeRow('src/lib');

    const actions = commandList(
      makeModelInput(row, state, { scopeCursor: { kind: 'global' } }),
    );
    const supportButtons = actions.filter((entry) =>
      entry.action.type === 'add-primary-support'
      || entry.action.type === 'add-global-support',
    );

    expect(supportButtons).toHaveLength(1);
    expect(supportButtons[0]?.label).toBe('Add as Support · For all primaries');
    expect(supportButtons[0]?.disabled).toBeFalsy();
  });

  it('labels the per-primary button as "Move to …" when the row currently lives in the global bucket', () => {
    const sharedSupport = { path: 'src/lib', kind: 'directory' as const };
    const stateGlobal = makeState({
      selectedFocusTargets: [makePrimary('src/api')],
      selectedSupportTargets: [sharedSupport],
    });
    const row = makeRow('src/lib');

    const actionsFromGlobal = commandList(
      makeModelInput(row, stateGlobal, {
        scopeCursor: { kind: 'primary', index: 0 },
      }),
    );
    const labelsFromGlobal = actionsFromGlobal.map((entry) => entry.label);
    expect(labelsFromGlobal).toContain('Move to api');
    // The global support button is hidden because the row already lives there
    // (and the cursor is on a primary anyway, so the global cluster is hidden).
    expect(labelsFromGlobal).not.toContain('Add as Support · For all primaries');
    expect(labelsFromGlobal).not.toContain('Add as Support · Just for api');
  });

  it('labels the global button as "Move to all primaries" when the row currently lives on a primary and the cursor is global', () => {
    const sharedSupport = { path: 'src/lib', kind: 'directory' as const };
    const stateScoped = makeState({
      selectedFocusTargets: [
        makePrimary('src/api', { supportTargets: [sharedSupport] }),
      ],
      selectedSupportTargets: [],
    });
    const row = makeRow('src/lib');

    const actionsFromScoped = commandList(
      makeModelInput(row, stateScoped, {
        scopeCursor: { kind: 'global' },
      }),
    );
    const labelsFromScoped = actionsFromScoped.map((entry) => entry.label);
    expect(labelsFromScoped).toContain('Move to all primaries');
    // Per-primary buttons are hidden because the cursor is global.
    expect(labelsFromScoped).not.toContain('Add as Support · Just for api');
    expect(labelsFromScoped).not.toContain('Add as Support · For all primaries');
  });

  it('disables the global button when the row is inside a primary writable area', () => {
    // Primary is `src/api` (a directory). A row at `src/api/users.ts` sits
    // inside that primary's writable area, so `add-global-support` is
    // unavailable — the cluster still shows a disabled "For all primaries"
    // button with an explanatory accessible name.
    const state = makeState({
      selectedFocusTargets: [makePrimary('src/api')],
    });
    const row = makeRow('src/api/users.ts', { kind: 'file' });

    const actions = commandList(
      makeModelInput(row, state, { scopeCursor: { kind: 'global' } }),
    );
    const globalSupportButton = actions.find(
      (entry) => entry.action.type === 'add-global-support',
    );

    expect(globalSupportButton).toBeDefined();
    expect(globalSupportButton?.disabled).toBe(true);
    expect(globalSupportButton?.label).toBe('Already inside api');
    expect(globalSupportButton?.shortLabel).toBe('Support · For all primaries');
  });

  it('suppresses Support buttons when the row is itself a primary', () => {
    // A primary cannot also be the support target of itself or another
    // primary (validator: scoped-support-equals-self,
    // scoped-support-equals-other-primary). When the row IS a primary, the
    // only meaningful action is "Remove …" — Support buttons must not appear.
    const state = makeState({
      selectedFocusTargets: [makePrimary('src/lib'), makePrimary('src/api')],
    });
    const row = makeRow('src/lib');

    const fromPrimaryCursor = commandList(
      makeModelInput(row, state, { scopeCursor: { kind: 'primary', index: 1 } }),
    );
    expect(
      fromPrimaryCursor.some((entry) =>
        entry.action.type === 'add-primary-support'
        || entry.action.type === 'add-global-support'),
    ).toBe(false);
    expect(fromPrimaryCursor.map((entry) => entry.action.type)).toContain('remove-primary');

    const fromGlobalCursor = commandList(
      makeModelInput(row, state, { scopeCursor: { kind: 'global' } }),
    );
    expect(
      fromGlobalCursor.some((entry) =>
        entry.action.type === 'add-primary-support'
        || entry.action.type === 'add-global-support'),
    ).toBe(false);
    expect(fromGlobalCursor.map((entry) => entry.action.type)).toContain('remove-primary');
  });
});
