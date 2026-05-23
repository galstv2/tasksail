import { describe, expect, it } from 'vitest';

import type { ContextPackDeepFocusState, ContextPackPrimaryFocusTarget } from '../../shared/desktopContract';
import { deriveDeepFocusEditorModel, type DeepFocusEditorModelInput } from './useDeepFocusEditorModel';

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

function modelInput(draftState: ContextPackDeepFocusState): DeepFocusEditorModelInput {
  return {
    draftState,
    scopeCursor: { kind: 'global' },
    draftTopLevel: { id: 'repo-a', label: 'Repo A', rootPath: '', repoLocalPath: '/repos/repo-a', ancillaryAllowed: false, systemLayer: null },
    currentRows: [],
    expanded: new Set(),
    selectedRow: null,
    parentSupportGhostState: null,
    searchQuery: '',
    treeLoading: false,
    showTreeLoading: false,
    treeTruncated: false,
    activeTopLevelId: 'repo-a',
    deepFocusMode: 'distributed',
  };
}

describe('deriveDeepFocusEditorModel selectionBuilder', () => {
  it('derives selectionBuilder from live draft primary, support, and test records', () => {
    const model = deriveDeepFocusEditorModel(modelInput(state({
      selectedFocusTargets: [primary({
        supportTargets: [{ path: 'src/app/fixtures', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' }],
        testTarget: { path: 'src/app/app.test.ts', kind: 'file', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' },
      })],
      selectedSupportTargets: [{ path: 'docs', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' }],
      selectedTestTarget: { path: 'tests', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' },
    })));

    expect(model.selectionBuilder.counts).toEqual({ primary: 1, support: 2, test: 2 });
    expect(model.selectionBuilder.supportItems.map((item) => item.scopeLabel)).toEqual(['All primaries', 'app']);
    expect(model.selectionBuilder.testItems.map((item) => item.scopeLabel)).toEqual(['All primaries', 'app']);
  });

  it('updates when support and test records are removed from the draft', () => {
    const withScopedRecords = deriveDeepFocusEditorModel(modelInput(state({
      selectedFocusTargets: [primary({
        supportTargets: [{ path: 'src/app/fixtures', kind: 'directory' }],
        testTarget: { path: 'src/app/app.test.ts', kind: 'file' },
      })],
      selectedSupportTargets: [{ path: 'docs', kind: 'directory' }],
      selectedTestTarget: { path: 'tests', kind: 'directory' },
    })));
    const removed = deriveDeepFocusEditorModel(modelInput(state({
      selectedFocusTargets: [primary()],
      selectedSupportTargets: [],
      selectedTestTarget: null,
    })));

    expect(withScopedRecords.selectionBuilder.counts).toEqual({ primary: 1, support: 2, test: 2 });
    expect(removed.selectionBuilder.counts).toEqual({ primary: 1, support: 0, test: 0 });
  });
});
