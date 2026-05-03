import type { DeepFocusEditorModel } from './useDeepFocusEditorModel';

export function makeDeepFocusEditorModel(
  overrides: Partial<DeepFocusEditorModel> = {},
): DeepFocusEditorModel {
  return {
    scopeMode: 'global',
    activeScopeLabel: 'Active scope: Global',
    primaryTargetCount: 0,
    supportFileCount: 0,
    testFolderStatusLabel: 'Test Folder: none',
    tree: {
      visibleRows: [],
      currentRowsLength: 0,
      loading: false,
      showLoadingRows: false,
      empty: true,
      emptyStateLabel: 'No items',
      truncated: false,
    },
    selectedRow: { row: null, id: null, label: null, commandList: [] },
    search: { query: '', active: false },
    validation: { errors: [], hasFeedback: false },
    promotion: { testTarget: null, supportTargets: [] },
    ...overrides,
  };
}
