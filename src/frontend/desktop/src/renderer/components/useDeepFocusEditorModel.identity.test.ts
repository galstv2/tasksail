import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import type { TreeRowData } from './DeepFocusTreeRow';
import {
  computePopoverActions,
  computeRowBadges,
  deepFocusTargetForRow,
  validateNestedScopeForUi,
} from './SidebarDeepFocusUtils';
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

function support(
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

function row(
  topLevelId: string,
  repoLocalPath: string,
  path: string,
  overrides: Partial<TreeRowData> = {},
): TreeRowData {
  const label = path.split('/').filter(Boolean).at(-1) ?? (topLevelId === 'platform' ? 'Platform' : 'Tools');
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
    depth: path === '' ? 0 : 1,
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

describe('Deep Focus identity-aware editor model', () => {
  it('places Platform primary plus Tools support badge on Tools only', () => {
    const platformRow = row('platform', PLATFORM_REPO, '');
    const toolsRow = row('tools', TOOLS_REPO, '');
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, '')],
      selectedSupportTargets: [support('tools', TOOLS_REPO, '')],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [platformRow, toolsRow],
    }));

    expect(model.tree.visibleRows[0]?.badges?.map((badge) => badge.label)).toEqual(['P']);
    expect(model.tree.visibleRows[1]?.badges?.map((badge) => badge.label)).toEqual(['S']);
  });

  it('does not route Tools support to Platform in global or primary cursor mode', () => {
    const platformRow = row('platform', PLATFORM_REPO, '');
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, '')],
      selectedSupportTargets: [support('tools', TOOLS_REPO, '')],
    });

    expect(computeRowBadges(
      { ...platformRow, deepFocusMode: 'distributed' },
      draftState,
      { kind: 'global' },
    ).map((badge) => badge.label)).toEqual(['P']);
    expect(computeRowBadges(
      { ...platformRow, deepFocusMode: 'distributed' },
      draftState,
      { kind: 'primary', index: 0 },
    ).map((badge) => badge.label)).toEqual(['P']);
  });

  it('does not offer support actions for the exact identity-aware primary target', () => {
    const platformRow = row('platform', PLATFORM_REPO, '');
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, '')],
    });

    expect(actionTypes(computePopoverActions(
      { ...platformRow, deepFocusMode: 'distributed' },
      draftState,
      { kind: 'global' },
    ))).not.toContain('add-global-support');
    expect(actionTypes(computePopoverActions(
      { ...platformRow, deepFocusMode: 'distributed' },
      draftState,
      { kind: 'primary', index: 0 },
    ))).not.toContain('add-primary-support');
  });

  it('keeps same relative paths in different repos distinct for badges, actions, and validation', () => {
    const platformSrc = row('platform', PLATFORM_REPO, 'src');
    const toolsSrc = row('tools', TOOLS_REPO, 'src');
    const draftState = state({
      selectedFocusTargets: [primary('platform', PLATFORM_REPO, 'src')],
      selectedSupportTargets: [support('tools', TOOLS_REPO, 'src')],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [platformSrc, toolsSrc],
      selectedRow: { row: toolsSrc, index: 1 },
    }));

    expect(model.tree.visibleRows[0]?.badges?.map((badge) => badge.label)).toEqual(['P']);
    expect(model.tree.visibleRows[1]?.badges?.map((badge) => badge.label)).toEqual(['S']);
    expect(model.selectedRow.commandList.map((entry) => entry.action.type)).toContain('remove-global');
    expect(model.selectedRow.commandList.map((entry) => entry.action.type)).not.toContain('remove-primary');
    expect(validateNestedScopeForUi(draftState)).toEqual([]);
  });

  it('keeps same relative paths in different monolith focus areas distinct', () => {
    const monolithRepo = '/repo/monolith';
    const focusA = row('focus-a', monolithRepo, 'src', { topLevelLabel: 'Platform' });
    const focusB = row('focus-b', monolithRepo, 'src', { topLevelLabel: 'Tools' });
    const draftState = state({
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: 'focus-a',
      selectedFocusTargets: [{
        path: 'src',
        kind: 'directory',
        role: 'anchor',
        repoLocalPath: monolithRepo,
        focusId: 'focus-a',
      }],
      selectedSupportTargets: [{
        path: 'src',
        kind: 'directory',
        repoLocalPath: monolithRepo,
        focusId: 'focus-b',
      }],
    });

    const model = deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [focusA, focusB],
      deepFocusMode: 'monolith',
      activeTopLevelId: 'focus-a',
    }));

    expect(model.tree.visibleRows[0]?.badges?.map((badge) => badge.label)).toEqual(['P']);
    expect(model.tree.visibleRows[1]?.badges?.map((badge) => badge.label)).toEqual(['S']);
  });

  it('preserves legacy target fallback behavior when persisted targets have no identity', () => {
    const platformRow = row('platform', PLATFORM_REPO, '');
    const toolsRow = row('tools', TOOLS_REPO, '');
    const draftState = state({
      selectedSupportTargets: [{ path: '', kind: 'directory' }],
    });

    expect(() => deriveDeepFocusEditorModel(modelInput({
      draftState,
      currentRows: [platformRow, toolsRow],
    }))).not.toThrow();
    expect(computeRowBadges(
      { ...toolsRow, deepFocusMode: 'distributed' },
      draftState,
      { kind: 'global' },
    ).map((badge) => badge.label)).toEqual(['S']);
  });

  it('builds row targets with mode-specific top-level identity', () => {
    expect(deepFocusTargetForRow({
      targetPath: 'src',
      kind: 'directory',
      repoLocalPath: PLATFORM_REPO,
      topLevelId: 'platform',
      deepFocusMode: 'distributed',
    })).toEqual({
      path: 'src',
      kind: 'directory',
      repoLocalPath: PLATFORM_REPO,
      repoId: 'platform',
    });
    expect(deepFocusTargetForRow({
      targetPath: 'src',
      kind: 'directory',
      repoLocalPath: '/mono/platform',
      topLevelId: 'focus-a',
      deepFocusMode: 'monolith',
    })).toEqual({
      path: 'src',
      kind: 'directory',
      repoLocalPath: '/mono/platform',
      focusId: 'focus-a',
    });
  });

  it('keeps the Lily child scope panel a controlled DeepFocusSelector consumer', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/renderer/components/planner/ChildScopeOverridePanel.tsx'),
      'utf8',
    );

    expect(panelSource).toContain('DeepFocusSelector');
    expect(panelSource).toContain('showFocusFilterButton={false}');
    expect(panelSource).not.toMatch(/computePopoverActions|computeRowBadges|applyScopedRoleAction|validateNestedScopeForUi/);
  });
});
