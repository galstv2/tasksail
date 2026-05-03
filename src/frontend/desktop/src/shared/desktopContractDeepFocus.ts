export type ContextPackFocusTargetKind = 'directory' | 'file';

export type ContextPackDeepFocusTarget = {
  path: string;
  kind: ContextPackFocusTargetKind;
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
    | 'scoped-support-target';
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

export type ContextPackListRepoTreePayload = {
  repoLocalPath: string;
  relativePath?: string;
};

export type ContextPackRepoTreeEntry = {
  name: string;
  relativePath: string;
  kind: 'directory' | 'file';
  hasChildren: boolean;
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
