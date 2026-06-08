import type {
  ContextPackClassificationConfidence,
  ContextPackDiscoveryMode,
  ContextPackRepoCategory,
  ContextPackRepositoryType,
  ContextPackSkippedRepoMissingGit,
  WorkspaceScopeMode,
} from '../../shared/desktopContract';
import { isRecord } from '../../shared/desktopContractValidators';

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
  repoCategory: ContextPackRepoCategory;
  repoCategoryAuthored: boolean;
  repoCategoryConfidence?: ContextPackClassificationConfidence;
};

export type FocusAreaEntryDraft = {
  key: string;
  focusId: string;
  focusName: string;
  relativePath: string;
  path: string;
  focusType: string;
  focusCategory: ContextPackRepoCategory;
  focusCategoryAuthored: boolean;
  group: string;
  defaultFocusable: boolean;
  activationPriority: number;
  primary: boolean;
  repositoryType: ContextPackRepositoryType;
};

export type BuildWizardStep = 'project-type' | 'location' | 'project-name' | 'build-parts';

export type PartDraft = {
  key: string;
  name: string;
  role: RepositoryEntryDraft['systemLayer'] | '';
  language: string;
  languageIsOther: boolean;
  location: string;
  primary: boolean;
  editing: boolean;
};

export type ContextPackCreationDraft = {
  contextPackDir: string;
  discoveryRoot: string;
  mode: Exclude<ContextPackDiscoveryMode, 'auto'>;
  contextPackId: string;
  estateName: string;
  defaultScopeMode: WorkspaceScopeMode;
  creationOrigin: 'existing' | 'new';
  repositories: RepositoryEntryDraft[];
  focusAreas: FocusAreaEntryDraft[];
};

export type ContextPackCreationModalStep = 'setup' | 'shape' | 'review';

export type OpenModalIntent =
  | { kind: 'fresh' }
  | { kind: 'prefill-from-repo'; repoRoot: string };

export type OpenContextPackCreationModal = (intent?: OpenModalIntent) => void;

export type PersistedContextPackCreation = {
  version: 1;
  savedAt: string;
  draft: ContextPackCreationDraft;
  modalStep: ContextPackCreationModalStep;
  wizardStep: BuildWizardStep | null;
  wizardParts: PartDraft[];
  creationOrigin: 'existing' | 'new';
};

function isRepositoryEntryDraft(value: unknown): value is RepositoryEntryDraft {
  return isRecord(value)
    && typeof value.key === 'string'
    && typeof value.repoRoot === 'string'
    && typeof value.repoName === 'string'
    && typeof value.repoId === 'string'
    && typeof value.owner === 'string'
    && typeof value.systemLayer === 'string'
    && typeof value.languages === 'string'
    && typeof value.artifactRoots === 'string'
    && typeof value.documentPaths === 'string'
    && typeof value.boundedContext === 'string'
    && typeof value.serviceName === 'string'
    && typeof value.repoRole === 'string'
    && typeof value.workspaceActivationGroup === 'string'
    && typeof value.defaultFocusable === 'boolean'
    && typeof value.activationPriority === 'number'
    && typeof value.primary === 'boolean'
    && typeof value.repositoryType === 'string'
    && (
      value.repoCategory === undefined
      || value.repoCategory === 'service'
      || value.repoCategory === 'application'
      || value.repoCategory === 'frontend'
      || value.repoCategory === 'library'
      || value.repoCategory === 'infrastructure'
      || value.repoCategory === 'data'
      || value.repoCategory === 'documentation'
      || value.repoCategory === 'tool'
      || value.repoCategory === 'unknown'
    )
    && (
      value.repoCategoryAuthored === undefined
      || typeof value.repoCategoryAuthored === 'boolean'
    )
    && (
      value.repoCategoryConfidence === undefined
      || value.repoCategoryConfidence === 'high'
      || value.repoCategoryConfidence === 'medium'
      || value.repoCategoryConfidence === 'low'
    );
}

function isFocusAreaEntryDraft(value: unknown): value is FocusAreaEntryDraft {
  return isRecord(value)
    && typeof value.key === 'string'
    && typeof value.focusId === 'string'
    && typeof value.focusName === 'string'
    && typeof value.relativePath === 'string'
    && typeof value.path === 'string'
    && typeof value.focusType === 'string'
    && typeof value.group === 'string'
    && typeof value.defaultFocusable === 'boolean'
    && typeof value.activationPriority === 'number'
    && typeof value.primary === 'boolean'
    && typeof value.repositoryType === 'string';
}

function isPartDraft(value: unknown): value is PartDraft {
  return isRecord(value)
    && typeof value.key === 'string'
    && typeof value.name === 'string'
    && typeof value.role === 'string'
    && typeof value.language === 'string'
    && typeof value.languageIsOther === 'boolean'
    && typeof value.location === 'string'
    && typeof value.primary === 'boolean'
    && typeof value.editing === 'boolean';
}

function isContextPackCreationDraft(value: unknown): value is ContextPackCreationDraft {
  return isRecord(value)
    && typeof value.contextPackDir === 'string'
    && typeof value.discoveryRoot === 'string'
    && typeof value.mode === 'string'
    && typeof value.contextPackId === 'string'
    && typeof value.estateName === 'string'
    && typeof value.defaultScopeMode === 'string'
    && (value.creationOrigin === 'existing' || value.creationOrigin === 'new')
    && Array.isArray(value.repositories)
    && value.repositories.every(isRepositoryEntryDraft)
    && Array.isArray(value.focusAreas)
    && value.focusAreas.every(isFocusAreaEntryDraft);
}

export function isPersistedContextPackCreation(
  value: unknown,
): value is PersistedContextPackCreation {
  return isRecord(value)
    && value.version === 1
    && typeof value.savedAt === 'string'
    && isContextPackCreationDraft(value.draft)
    && (value.modalStep === 'setup' || value.modalStep === 'shape' || value.modalStep === 'review')
    && (
      value.wizardStep === null
      || value.wizardStep === 'project-type'
      || value.wizardStep === 'location'
      || value.wizardStep === 'project-name'
      || value.wizardStep === 'build-parts'
    )
    && Array.isArray(value.wizardParts)
    && value.wizardParts.every(isPartDraft)
    && (value.creationOrigin === 'existing' || value.creationOrigin === 'new');
}

function hydrateRepositoryEntryDraft(
  repository: RepositoryEntryDraft,
): RepositoryEntryDraft {
  return {
    ...repository,
    repoCategory: repository.repoCategory ?? 'unknown',
    repoCategoryAuthored: repository.repoCategoryAuthored ?? false,
    repoCategoryConfidence: repository.repoCategoryConfidence,
  };
}

function hydrateFocusAreaEntryDraft(
  focusArea: FocusAreaEntryDraft,
): FocusAreaEntryDraft {
  return {
    ...focusArea,
    focusCategory: focusArea.focusCategory ?? 'unknown',
    focusCategoryAuthored: focusArea.focusCategoryAuthored ?? false,
  };
}

export function hydratePersistedContextPackCreation(
  persisted: PersistedContextPackCreation,
): PersistedContextPackCreation {
  return {
    ...persisted,
    draft: {
      ...persisted.draft,
      repositories: persisted.draft.repositories.map(hydrateRepositoryEntryDraft),
      focusAreas: persisted.draft.focusAreas.map(hydrateFocusAreaEntryDraft),
    },
  };
}

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
  canGoNextReason?: string;
  gitRepositoryWarnings?: ContextPackSkippedRepoMissingGit[];
  onOpen: OpenContextPackCreationModal;
  onClose: () => void;
  onDiscardDraft: () => void;
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
  wizardStep?: BuildWizardStep;
  wizardParts?: PartDraft[];
  onWizardStepChange?: (step: BuildWizardStep) => void;
  onWizardAddPart?: () => void;
  onWizardUpdatePart?: (key: string, field: keyof PartDraft, value: string | boolean) => void;
  onWizardRemovePart?: (key: string) => void;
  onBack: () => void;
  onNext: () => void;
  onCreate: () => void | Promise<void>;
};
