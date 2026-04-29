export type ContextPackFocusTargetKind = 'directory' | 'file';

export type ContextPackDeepFocusTarget = {
  path: string;
  kind: ContextPackFocusTargetKind;
};

export type ContextPackDeepFocusDerivedRoot = ContextPackDeepFocusTarget & {
  reason: 'selected-primary' | 'primary-focus-parent' | 'test-target' | 'support-target';
};

export type ContextPackSwitchDeepFocusSelection = {
  deepFocusEnabled?: boolean;
  deepFocusPrimaryRepoId?: string | null;
  deepFocusPrimaryFocusId?: string | null;
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: ContextPackFocusTargetKind | null;
  selectedTestTarget?: ContextPackDeepFocusTarget | null;
  selectedSupportTargets?: ContextPackDeepFocusTarget[];
};

export type ContextPackDeepFocusState = {
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
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
