import type { ContextPackDiscoveryMode, ContextPackRepositoryType, WorkspaceScopeMode } from '../shared/desktopContract';

export type RepositoryEntryDraft = {
  key: string;
  repoRoot: string;
  repoName: string;
  repoId: string;
  owner: string;
  systemLayer:
    | 'backend'
    | 'frontend'
    | 'infrastructure'
    | 'database'
    | 'documents'
    | 'shared';
  languages: string;
  artifactRoots: string;
  documentPaths: string;
  boundedContext: string;
  serviceName: string;
  repoRole: string;
  workspaceActivationGroup: string;
  defaultFocusable: boolean;
  activationPriority: number;
  primary: boolean;
  repositoryType: ContextPackRepositoryType;
};

export type FocusAreaEntryDraft = {
  key: string;
  focusId: string;
  focusName: string;
  relativePath: string;
  path: string;
  focusType: string;
  group: string;
  defaultFocusable: boolean;
  activationPriority: number;
  primary: boolean;
  repositoryType: ContextPackRepositoryType;
};

export type ContextPackCreationDraft = {
  contextPackDir: string;
  discoveryRoot: string;
  mode: Exclude<ContextPackDiscoveryMode, 'auto'>;
  contextPackId: string;
  estateName: string;
  defaultScopeMode: WorkspaceScopeMode;
  repositories: RepositoryEntryDraft[];
  focusAreas: FocusAreaEntryDraft[];
};

export type ContextPackCreationModalStep = 'setup' | 'shape' | 'review';

export type ContextPackCreationModalProps = {
  isOpen: boolean;
  busy: boolean;
  step: ContextPackCreationModalStep;
  draft: ContextPackCreationDraft;
  discoveryStatus: 'idle' | 'loading' | 'ready' | 'error';
  discoverySummary: string;
  error: string;
  message: string;
  canGoBack: boolean;
  canGoNext: boolean;
  onOpen: () => void;
  onClose: () => void;
  onBrowseContextPackDir: () => void | Promise<void>;
  onBrowseDiscoveryRoot: () => void | Promise<void>;
  onChangeMode: (mode: Exclude<ContextPackDiscoveryMode, 'auto'>) => void;
  onDraftFieldChange: <K extends keyof ContextPackCreationDraft>(
    field: K,
    value: ContextPackCreationDraft[K],
  ) => void;
  onDiscoverPrefill: () => void | Promise<void>;
  onAddRepository: () => void;
  onRemoveRepository: (key: string) => void;
  onRepositoryFieldChange: (
    key: string,
    field: keyof RepositoryEntryDraft,
    value: string | boolean | number,
  ) => void;
  onSetPrimaryRepository: (key: string) => void;
  onAddFocusArea: () => void;
  onRemoveFocusArea: (key: string) => void;
  onFocusAreaFieldChange: (
    key: string,
    field: keyof FocusAreaEntryDraft,
    value: string | boolean | number,
  ) => void;
  onSetPrimaryFocusArea: (key: string) => void;
  onBack: () => void;
  onNext: () => void;
  onCreate: () => void | Promise<void>;
};
