export type ContextPackFocusTargetKind = 'directory' | 'file';
export type ContextPackFocusFilterRepositoryType = 'primary' | 'support';

export const CONTEXT_PACK_TEST_ARTIFACT_TYPE = 'test-code';
export const CONTEXT_PACK_TEST_PATH_KIND = 'tests';

export type ContextPackDeepFocusTarget = {
  path: string;
  kind: ContextPackFocusTargetKind;
  repoLocalPath?: string;
  repoId?: string;
  focusId?: string;
};

export type ContextPackPrimaryFocusTarget = ContextPackDeepFocusTarget & {
  /**
   * Repo-local path of the top-level repo this primary belongs to.
   * Required for new commits. Optional in the type to allow legacy state to
   * deserialize and be migrated by the hydration shim. New state must always
   * set it.
   */
  repoLocalPath?: string;
  /**
   * Manifest repo identifier (distributed-mode anchor scalar source).
   * Optional for legacy compatibility; new commits in distributed mode set it.
   */
  repoId?: string;
  /**
   * Manifest focus identifier (monolith-mode anchor scalar source).
   * Optional for legacy compatibility; new commits in monolith mode set it.
   */
  focusId?: string;
  role?: 'anchor' | 'primary';
  testTarget?: ContextPackDeepFocusTarget | null;
  supportTargets?: ContextPackDeepFocusTarget[];
};

export type ContextPackDeepFocusDerivedRoot = ContextPackDeepFocusTarget & {
  reason:
    | 'selected-primary'
    | 'primary-focus-parent'
    | 'test-target'
    | 'support-target'
    | 'scoped-test-target'
    | 'scoped-support-target'
    | 'support-repo';
  sourceTargets?: ContextPackPrimaryFocusTarget[];
};

export type ContextPackSwitchDeepFocusSelection = {
  deepFocusEnabled?: boolean;
  deepFocusPrimaryRepoId?: string | null;
  deepFocusPrimaryFocusId?: string | null;
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  selectedTestTarget?: ContextPackDeepFocusTarget | null;
  selectedSupportTargets?: ContextPackDeepFocusTarget[];
};

export type ContextPackDeepFocusState = {
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  derivedWritableRoots?: ContextPackDeepFocusDerivedRoot[];
  derivedReadonlyContextRoots?: ContextPackDeepFocusDerivedRoot[];
};

export type ContextPackFocusFilterSelection = {
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  repositoryTypes?: Record<string, ContextPackFocusFilterRepositoryType>;
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
};

export type ContextPackFocusFilter = {
  id: string;
  name: string;
  contextPackDir: string;
  createdAt: string;
  updatedAt: string;
  selection: ContextPackFocusFilterSelection;
};

export type ContextPackSidebarPersistedState = {
  selectedContextPackDir: string | null;
  updatedAt: string;
  selectionsByContextPackDir: Record<string, ContextPackFocusFilterSelection>;
};

export type ContextPackListRepoTreePayload = {
  repoLocalPath: string;
  relativePath?: string;
};

export type ContextPackRepoTreeEntry = {
  name: string;
  relativePath: string;
  kind: 'directory' | 'file';
  hasChildren: boolean;
  isTest?: boolean;
  artifactType?: string;
  pathKind?: string;
};

export type ContextPackListRepoTreeRequest = {
  action: 'contextPack.listRepoTree';
  payload: ContextPackListRepoTreePayload;
};

export type ContextPackListRepoTreeResponse = {
  action: 'contextPack.listRepoTree';
  mode: 'read-only';
  message: string;
  entries: ContextPackRepoTreeEntry[];
  currentPath: string;
  repoLocalPath: string;
  truncated: boolean;
};

export type DeepFocusSaveSelectionsRequest = {
  action: 'deepFocus.saveSelections';
  payload: {
    contextPackDir: string;
    selections: ContextPackDeepFocusState;
  };
};

export type DeepFocusLoadSelectionsRequest = {
  action: 'deepFocus.loadSelections';
  payload: {
    contextPackDir: string;
  };
};

export type DeepFocusClearSelectionsRequest = {
  action: 'deepFocus.clearSelections';
  payload: {
    contextPackDir: string;
  };
};

export type DeepFocusSaveSelectionsResponse = {
  action: 'deepFocus.saveSelections';
  mode: 'saved';
  message: string;
};

export type DeepFocusLoadSelectionsResponse = {
  action: 'deepFocus.loadSelections';
  mode: 'read-only';
  message: string;
  selections: ContextPackDeepFocusState | null;
};

export type DeepFocusClearSelectionsResponse = {
  action: 'deepFocus.clearSelections';
  mode: 'cleared';
  message: string;
};

export type FocusFiltersListRequest = {
  action: 'focusFilters.list';
  payload: { contextPackDir: string };
};

export type FocusFiltersCreateRequest = {
  action: 'focusFilters.create';
  payload: {
    contextPackDir: string;
    name: string;
    selection: ContextPackFocusFilterSelection;
  };
};

export type FocusFiltersDeleteRequest = {
  action: 'focusFilters.delete';
  payload: {
    contextPackDir: string;
    filterId: string;
  };
};

export type FocusFiltersListResponse = {
  action: 'focusFilters.list';
  mode: 'read-only';
  filters: ContextPackFocusFilter[];
  message: string;
};

export type FocusFiltersCreateResponse = {
  action: 'focusFilters.create';
  mode: 'created';
  filter: ContextPackFocusFilter;
  filters: ContextPackFocusFilter[];
  message: string;
};

export type FocusFiltersDeleteResponse = {
  action: 'focusFilters.delete';
  mode: 'deleted';
  filters: ContextPackFocusFilter[];
  message: string;
};

export type ContextPackSidebarStateLoadRequest = {
  action: 'contextPackSidebarState.load';
  payload?: undefined;
};

export type ContextPackSidebarStateSaveRequest = {
  action: 'contextPackSidebarState.save';
  payload: {
    selectedContextPackDir: string | null;
    selection: ContextPackFocusFilterSelection | null;
  };
};

export type ContextPackSidebarStateLoadResponse = {
  action: 'contextPackSidebarState.load';
  mode: 'read-only';
  state: ContextPackSidebarPersistedState | null;
  message: string;
};

export type ContextPackSidebarStateSaveResponse = {
  action: 'contextPackSidebarState.save';
  mode: 'saved';
  message: string;
};
