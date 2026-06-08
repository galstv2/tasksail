import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackPrimaryFocusTarget,
} from '../../../shared/desktopContract';
import type { TreeRowData } from './DeepFocusTreeRow';
import {
  computePopoverActions,
  targetHasAnySupportOrTestRole,
  validateNestedScopeForUi,
} from './SidebarDeepFocusUtils';
import { selectSiblingSupportCandidates } from './sidebarDeepFocusSelectors';
import { deriveDeepFocusEditorModel, type DeepFocusEditorModelInput } from './useDeepFocusEditorModel';

const PLATFORM_REPO = '/repos/platform';
const TOOLS_REPO = '/repos/tools';

function primary(
  topLevelId: string,
  repoLocalPath: string,
  path: string,
  overrides: Partial<ContextPackPrimaryFocusTarget> = {},
): ContextPackPrimaryFocusTarget {
  return {
    path,
    kind: 'directory',
    role: 'anchor',
    repoLocalPath,
    repoId: topLevelId,
    ...overrides,
  };
}

function target(
  topLevelId: string,
  repoLocalPath: string,
  path: string,
): ContextPackDeepFocusTarget {
  return {
    path,
    kind: 'directory',
    repoLocalPath,
    repoId: topLevelId,
  };
}

function monolithTarget(
  focusId: string,
  path: string,
): ContextPackDeepFocusTarget {
  return {
    path,
    kind: 'directory',
    repoLocalPath: '/repo/monolith',
    focusId,
  };
}

function row(
  topLevelId: string,
  repoLocalPath: string,
  path: string,
  overrides: Partial<TreeRowData> = {},
): TreeRowData {
  const label = path.split('/').filter(Boolean).at(-1) ?? topLevelId;
  return {
    id: `${topLevelId}:${path || 'root'}`,
    label,
    displayPath: path,
    targetPath: path,
    kind: 'directory',
    hasChildren: true,
    topLevelId,
    topLevelLabel: topLevelId,
    topLevelPath: '',
    repoLocalPath,
    isTopLevel: path === '',
    ancillaryAllowed: true,
    systemLayer: null,
    depth: path === '' ? 0 : path.split('/').length,
    ...overrides,
  };
}

function state(
  overrides: Partial<ContextPackDeepFocusState> = {},
): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: true,
    deepFocusPrimaryRepoId: 'platform',
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: '',
    selectedFocusTargetKind: 'directory',
    selectedFocusTargets: [],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
    ...overrides,
  };
}

function modelInput(
  overrides: Partial<DeepFocusEditorModelInput> = {},
): DeepFocusEditorModelInput {
  return {
    draftState: state(),
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
    activeTopLevelId: 'platform',
    deepFocusMode: 'distributed',
    ...overrides,
  };
}

function actionTypes(actions: ReturnType<typeof computePopoverActions>): string[] {
  return actions.map((entry) => entry.action.type);
}

describe('Deep Focus role mutual exclusion model', () => {
  it('hides support and test actions for an exact primary in global and primary cursor modes', () => {
    const platformRow = row('platform', PLATFORM_REPO, '', { isTest: true });
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, '')],
    });

    const globalActions = actionTypes(computePopoverActions(
      { ...platformRow, deepFocusMode: 'distributed' },
      draftState,
      { kind: 'global' },
    ));
    const primaryActions = actionTypes(computePopoverActions(
      { ...platformRow, deepFocusMode: 'distributed' },
      draftState,
      { kind: 'primary', index: 0 },
    ));

    expect(globalActions).not.toContain('add-global-support');
    expect(globalActions).not.toContain('set-global-test');
    expect(primaryActions).not.toContain('add-primary-support');
    expect(primaryActions).not.toContain('set-primary-test');
  });

  it('keeps command-strip support and test actions hidden for an exact primary row', () => {
    const platformRow = row('platform', PLATFORM_REPO, '', { isTest: true });
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, '')],
    });

    const globalModel = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [platformRow],
      selectedRow: { row: platformRow, index: 0 },
      scopeCursor: { kind: 'global' },
    }));
    const primaryModel = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [platformRow],
      selectedRow: { row: platformRow, index: 0 },
      scopeCursor: { kind: 'primary', index: 0 },
    }));

    expect(globalModel.selectedRow.commandList.map((entry) => entry.action.type))
      .not.toEqual(expect.arrayContaining(['add-global-support', 'set-global-test']));
    expect(primaryModel.selectedRow.commandList.map((entry) => entry.action.type))
      .not.toEqual(expect.arrayContaining(['add-primary-support', 'set-primary-test']));
  });

  it('does not offer Acme.Cli.Tests as both global and Platform-scoped test', () => {
    const testsRow = row('platform', PLATFORM_REPO, 'Acme.Cli.Tests', { isTest: true });
    const testsTarget = target('platform', PLATFORM_REPO, 'Acme.Cli.Tests');
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, 'src/platform')],
      selectedTestTarget: testsTarget,
    });

    const globalModel = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [testsRow],
      selectedRow: { row: testsRow, index: 0 },
      scopeCursor: { kind: 'global' },
    }));
    const platformModel = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [testsRow],
      selectedRow: { row: testsRow, index: 0 },
      scopeCursor: { kind: 'primary', index: 0 },
    }));

    expect(globalModel.selectedRow.commandList.map((entry) => entry.label)).toEqual(['Remove']);
    expect(platformModel.selectedRow.commandList.map((entry) => entry.action.type)).not.toContain('set-primary-test');
    expect(platformModel.selectedRow.commandList.map((entry) => entry.label)).toEqual(['Remove']);
  });

  it('does not offer an all-primaries test action for a per-primary test target', () => {
    const testsRow = row('platform', PLATFORM_REPO, 'Acme.Cli.Tests', { isTest: true });
    const testsTarget = target('platform', PLATFORM_REPO, 'Acme.Cli.Tests');
    const draftState = state({
      selectedFocusTargets: [
        primary('platform', PLATFORM_REPO, 'src/platform', { testTarget: testsTarget }),
      ],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [testsRow],
      selectedRow: { row: testsRow, index: 0 },
      scopeCursor: { kind: 'global' },
    }));

    expect(model.selectedRow.commandList.map((entry) => entry.action.type)).not.toContain('set-global-test');
    expect(model.selectedRow.commandList.map((entry) => entry.label)).toEqual(['Remove from Primary']);
  });

  it('does not show support or test actions after a target is selected globally', () => {
    const docsRow = row('platform', PLATFORM_REPO, 'docs', { isTest: true });
    const docsTarget = target('platform', PLATFORM_REPO, 'docs');
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, 'src/platform')],
      selectedSupportTargets: [docsTarget],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [docsRow],
      selectedRow: { row: docsRow, index: 0 },
      scopeCursor: { kind: 'primary', index: 0 },
    }));

    expect(model.selectedRow.commandList.map((entry) => entry.action.type)).toEqual(['remove-global']);
  });

  it('hides just-for-primary support actions when there is only one primary target', () => {
    const docsRow = row('platform', PLATFORM_REPO, 'docs');
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, 'src/platform')],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [docsRow],
      selectedRow: { row: docsRow, index: 0 },
      scopeCursor: { kind: 'primary', index: 0 },
    }));

    expect(model.selectedRow.commandList.map((entry) => entry.label))
      .not.toContain('Add as Support · Just for platform');
    expect(model.selectedRow.commandList.map((entry) => entry.label))
      .toContain('Add as Support · For all primaries');
  });

  it('shows just-for-primary support actions after a second primary target is selected', () => {
    const docsRow = row('platform', PLATFORM_REPO, 'docs');
    const draftState = state({
      selectedFocusTargets: [
        primary('platform', PLATFORM_REPO, 'src/platform'),
        primary('tools', TOOLS_REPO, ''),
      ],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [docsRow],
      selectedRow: { row: docsRow, index: 0 },
      scopeCursor: { kind: 'primary', index: 0 },
    }));

    expect(model.selectedRow.commandList.map((entry) => entry.label))
      .toContain('Add as Support · Just for platform');
    expect(model.selectedRow.commandList.map((entry) => entry.label))
      .toContain('Add as Support · For all primaries');
  });

  it('hides just-for-primary test actions when there is only one primary target', () => {
    const testsRow = row('platform', PLATFORM_REPO, 'tests/platform.test.ts', { isTest: true });
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, 'src/platform')],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [testsRow],
      selectedRow: { row: testsRow, index: 0 },
      scopeCursor: { kind: 'primary', index: 0 },
    }));

    expect(model.selectedRow.commandList.map((entry) => entry.label))
      .not.toContain('Use as Test for platform');
    expect(model.selectedRow.commandList.map((entry) => entry.label))
      .toContain('Use as Test for all primaries');
  });

  it('shows just-for-primary test actions after a second primary target is selected', () => {
    const testsRow = row('platform', PLATFORM_REPO, 'tests/platform.test.ts', { isTest: true });
    const draftState = state({
      selectedFocusTargets: [
        primary('platform', PLATFORM_REPO, 'src/platform'),
        primary('tools', TOOLS_REPO, ''),
      ],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [testsRow],
      selectedRow: { row: testsRow, index: 0 },
      scopeCursor: { kind: 'primary', index: 0 },
    }));

    expect(model.selectedRow.commandList.map((entry) => entry.label))
      .toContain('Use as Test for platform');
    expect(model.selectedRow.commandList.map((entry) => entry.label))
      .toContain('Use as Test for all primaries');
  });

  it('does not show global actions after a target is selected for a primary', () => {
    const docsRow = row('platform', PLATFORM_REPO, 'docs', { isTest: true });
    const docsTarget = target('platform', PLATFORM_REPO, 'docs');
    const draftState = state({
      selectedFocusTargets: [
        primary('platform', PLATFORM_REPO, 'src/platform', { supportTargets: [docsTarget] }),
      ],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [docsRow],
      selectedRow: { row: docsRow, index: 0 },
      scopeCursor: { kind: 'global' },
    }));

    expect(model.selectedRow.commandList.map((entry) => entry.action.type)).toEqual(['remove-primary-member']);
  });

  it('keeps Platform primary plus Tools support valid and badged on Tools only', () => {
    const platformRow = row('platform', PLATFORM_REPO, '');
    const toolsRow = row('tools', TOOLS_REPO, '');
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, '')],
      selectedSupportTargets: [target('tools', TOOLS_REPO, '')],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [platformRow, toolsRow],
    }));

    expect(model.tree.visibleRows[0]?.badges?.map((badge) => badge.label)).toEqual(['P']);
    expect(model.tree.visibleRows[1]?.badges?.map((badge) => badge.label)).toEqual(['S']);
    expect(model.tree.visibleRows[1]?.supportContextPrimaryLabel).toBe('all primaries');
    expect(validateNestedScopeForUi(draftState)).toEqual([]);
  });

  it('keeps same relative paths in distributed repos distinct for candidate filtering and actions', () => {
    const toolsParent = row('tools', TOOLS_REPO, 'src', { hasChildren: true });
    const platformChild = row('platform', PLATFORM_REPO, 'src/api');
    const toolsChild = row('tools', TOOLS_REPO, 'src/api');
    const draftState = state({
      selectedFocusTargets: [
        primary('platform', PLATFORM_REPO, 'src/app'),
        primary('tools', TOOLS_REPO, 'src/cli', { role: 'primary' }),
      ],
      selectedSupportTargets: [target('platform', PLATFORM_REPO, 'src/api')],
    });

    expect(selectSiblingSupportCandidates(
      draftState,
      toolsParent,
      'distributed',
      [platformChild, toolsChild],
    ).map((candidate) => candidate.id)).toEqual(['tools:src/api']);
    expect(actionTypes(computePopoverActions(
      { ...toolsChild, deepFocusMode: 'distributed' },
      draftState,
      { kind: 'global' },
    ))).toContain('add-global-support');
  });

  it('keeps same relative paths in monolith focus areas distinct for candidate filtering and actions', () => {
    const focusBParent = row('focus-b', '/repo/monolith', 'src', { hasChildren: true });
    const focusAChild = row('focus-a', '/repo/monolith', 'src/api');
    const focusBChild = row('focus-b', '/repo/monolith', 'src/api');
    const draftState = state({
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: 'focus-a',
      selectedFocusTargets: [
        { ...monolithTarget('focus-a', 'src/app'), role: 'anchor' },
        { ...monolithTarget('focus-b', 'src/cli'), role: 'primary' },
      ],
      selectedSupportTargets: [monolithTarget('focus-a', 'src/api')],
    });

    expect(selectSiblingSupportCandidates(
      draftState,
      focusBParent,
      'monolith',
      [focusAChild, focusBChild],
    ).map((candidate) => candidate.id)).toEqual(['focus-b:src/api']);
    expect(actionTypes(computePopoverActions(
      { ...focusBChild, deepFocusMode: 'monolith' },
      draftState,
      { kind: 'global' },
    ))).toContain('add-global-support');
  });

  it('inserts ghost support rows under the intended identity-matching parent', () => {
    const platformParent = row('platform', PLATFORM_REPO, 'src', { hasChildren: true });
    const toolsParent = row('tools', TOOLS_REPO, 'src', { hasChildren: true });
    const platformCandidate = row('platform', PLATFORM_REPO, 'src/api');
    const toolsCandidate = row('tools', TOOLS_REPO, 'src/api');
    const draftState = state({
      selectedFocusTargets: [primary('tools', TOOLS_REPO, 'src/app')],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [platformParent, toolsParent, platformCandidate, toolsCandidate],
      parentSupportGhostState: { primaryIndex: 0, parentPath: 'src' },
    }));

    expect(model.tree.visibleRows.map((entry) => entry.row.id)).toEqual([
      'platform:src',
      'tools:src',
      'ghost:0:tools:src/api',
      'platform:src/api',
      'tools:src/api',
    ]);
  });

  it('exposes the exact support/test role helper for shared model guards', () => {
    const supportTarget = target('tools', TOOLS_REPO, 'src/api');
    expect(targetHasAnySupportOrTestRole(state({
      selectedSupportTargets: [supportTarget],
    }), supportTarget)).toBe(true);
  });

  it('keeps ChildScopeOverridePanel a controlled DeepFocusSelector consumer', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/renderer/components/planner/ChildScopeOverridePanel.tsx'),
      'utf8',
    );

    expect(panelSource).toContain('DeepFocusSelector');
    expect(panelSource).toContain('showFocusFilterButton={false}');
    expect(panelSource).not.toMatch(
      /applyScopedRoleAction|computePopoverActions|computeRowBadges|selectSiblingSupportCandidates|validateNestedScopeForUi/,
    );
  });
});
