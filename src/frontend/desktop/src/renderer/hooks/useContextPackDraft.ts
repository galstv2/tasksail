import { useCallback } from 'react';

import type { ContextPackDiscoveryMode } from '../../shared/desktopContract';
import type {
  PartDraft,
  ContextPackCreationDraft,
  FocusAreaEntryDraft,
  RepositoryEntryDraft,
} from '../contextPackCreationTypes';

export const INITIAL_DRAFT: ContextPackCreationDraft = {
  contextPackDir: '',
  discoveryRoot: '',
  mode: 'distributed',
  contextPackId: '',
  estateName: '',
  defaultScopeMode: 'focused',
  creationOrigin: 'existing',
  repositories: [],
  focusAreas: [],
};

export function slugifyValue(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'context-pack';
}

function stableNumericSuffix(value: string): string {
  const input = value.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 9000;
  }
  return String(hash + 1000).padStart(4, '0');
}

export function generateContextPackId(displayName: string): string {
  const slug = slugifyValue(displayName);
  return `${slug}-${stableNumericSuffix(displayName)}`;
}

export function titleizeValue(value: string): string {
  const cleaned = value.trim().replace(/[-_]+/g, ' ');
  return cleaned
    ? cleaned.replace(/\b\w/g, (segment) => segment.toUpperCase())
    : 'Context Pack';
}

export function directoryName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'context-pack';
}

export function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function ensureUniqueId(baseId: string, seen: Set<string>): string {
  let id = baseId;
  let counter = 2;
  while (seen.has(id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }
  seen.add(id);
  return id;
}

const ROLE_TO_FOCUS_TYPE: Record<RepositoryEntryDraft['systemLayer'], string> = {
  backend: 'backend',
  frontend: 'frontend',
  infrastructure: 'infrastructure',
  database: 'source',
  documents: 'docs',
  shared: 'shared',
};

export function createRepositoryEntry(
  seed?: Partial<RepositoryEntryDraft>,
): RepositoryEntryDraft {
  return {
    key: seed?.key ?? crypto.randomUUID(),
    repoRoot: seed?.repoRoot ?? '',
    repoName: seed?.repoName ?? '',
    repoId: seed?.repoId ?? '',
    owner: seed?.owner ?? '',
    systemLayer: seed?.systemLayer ?? 'backend',
    languages: seed?.languages ?? '',
    artifactRoots: seed?.artifactRoots ?? '',
    documentPaths: seed?.documentPaths ?? '',
    boundedContext: seed?.boundedContext ?? '',
    serviceName: seed?.serviceName ?? '',
    repoRole: seed?.repoRole ?? '',
    workspaceActivationGroup: seed?.workspaceActivationGroup ?? '',
    defaultFocusable: seed?.defaultFocusable ?? false,
    activationPriority: seed?.activationPriority ?? 0,
    primary: seed?.primary ?? false,
    repositoryType: seed?.repositoryType ?? 'support',
  };
}

export function createFocusAreaEntry(
  seed?: Partial<FocusAreaEntryDraft>,
): FocusAreaEntryDraft {
  return {
    key: seed?.key ?? crypto.randomUUID(),
    focusId: seed?.focusId ?? '',
    focusName: seed?.focusName ?? '',
    relativePath: seed?.relativePath ?? '',
    path: seed?.path ?? '',
    focusType: seed?.focusType ?? 'general',
    group: seed?.group ?? '',
    defaultFocusable: seed?.defaultFocusable ?? false,
    activationPriority: seed?.activationPriority ?? 0,
    primary: seed?.primary ?? false,
    repositoryType: seed?.repositoryType ?? 'support',
  };
}

export function createInitialDistributedRepositories(): RepositoryEntryDraft[] {
  return [
    createRepositoryEntry({
      primary: true,
      repositoryType: 'primary',
      defaultFocusable: true,
      activationPriority: 100,
      systemLayer: 'backend',
    }),
  ];
}

export function createInitialMonolithRepositories(): RepositoryEntryDraft[] {
  return [
    createRepositoryEntry({
      primary: true,
      repositoryType: 'primary',
      defaultFocusable: true,
      activationPriority: 100,
      systemLayer: 'shared',
    }),
  ];
}

function ensurePrimaryRepository(
  repositories: RepositoryEntryDraft[],
): RepositoryEntryDraft[] {
  if (repositories.length === 0 || repositories.some((r) => r.primary)) {
    return repositories;
  }
  return repositories.map((r, i) =>
    i === 0 ? { ...r, primary: true, defaultFocusable: true } : r,
  );
}

function ensurePrimaryFocusArea(
  focusAreas: FocusAreaEntryDraft[],
): FocusAreaEntryDraft[] {
  if (focusAreas.length === 0 || focusAreas.some((f) => f.primary)) {
    return focusAreas;
  }
  return focusAreas.map((f, i) =>
    i === 0
      ? { ...f, primary: true, repositoryType: 'primary', defaultFocusable: true }
      : f,
  );
}

export function normalizeDraftForMode(
  draft: ContextPackCreationDraft,
): ContextPackCreationDraft {
  if (draft.mode === 'distributed') {
    return { ...draft, repositories: ensurePrimaryRepository(draft.repositories) };
  }
  return {
    ...draft,
    repositories: ensurePrimaryRepository(draft.repositories),
    focusAreas: ensurePrimaryFocusArea(draft.focusAreas),
  };
}

function resolveMonolithFocusAreaPath(discoveryRoot: string, location: string): string {
  const trimmedRoot = discoveryRoot.replace(/\/+$/, '');
  const trimmedLocation = location.trim();
  if (!trimmedLocation || trimmedLocation === '.') {
    return trimmedRoot;
  }
  return `${trimmedRoot}/${trimmedLocation.replace(/^\.?\/*/, '')}`;
}

export function buildDraftFromWizardParts(
  draft: ContextPackCreationDraft,
  parts: PartDraft[],
): ContextPackCreationDraft {
  if (draft.mode === 'distributed') {
    const seenRepoIds = new Set<string>();
    const repositories = parts.map((part, index) =>
      createRepositoryEntry({
        repoRoot: part.location,
        repoName: part.name,
        repoId: ensureUniqueId(slugifyValue(part.name), seenRepoIds),
        systemLayer: part.role || 'backend',
        languages: part.language,
        primary: part.primary,
        repositoryType: part.primary ? 'primary' : 'support',
        defaultFocusable: part.primary,
        activationPriority: Math.max(0, 100 - index * 10),
      }),
    );
    return {
      ...draft,
      repositories,
      focusAreas: [],
    };
  }

  const seenFocusIds = new Set<string>();
  const monoRepo = createRepositoryEntry({
    repoRoot: draft.discoveryRoot,
    repoName: titleizeValue(directoryName(draft.discoveryRoot)),
    repoId: slugifyValue(directoryName(draft.discoveryRoot)),
    systemLayer: 'shared',
    languages: parts.map((part) => part.language).filter(Boolean).join(', '),
    primary: true,
    repositoryType: 'primary',
    defaultFocusable: true,
    activationPriority: 100,
  });
  const focusAreas = parts.map((part, index) =>
    createFocusAreaEntry({
      focusId: ensureUniqueId(slugifyValue(part.name), seenFocusIds),
      focusName: part.name,
      relativePath: part.location,
      path: resolveMonolithFocusAreaPath(draft.discoveryRoot, part.location),
      focusType: ROLE_TO_FOCUS_TYPE[part.role || 'shared'] ?? 'general',
      primary: part.primary,
      repositoryType: part.primary ? 'primary' : 'support',
      defaultFocusable: part.primary,
      activationPriority: Math.max(0, 100 - index * 10),
    }),
  );
  return {
    ...draft,
    repositories: [monoRepo],
    focusAreas,
  };
}

export function buildValidationErrors(
  draft: ContextPackCreationDraft,
): string[] {
  const errors: string[] = [];
  if (!draft.contextPackDir.trim()) {
    errors.push('Choose a context-pack destination before creating the pack.');
  }
  if (!draft.discoveryRoot.trim()) {
    errors.push(
      draft.creationOrigin === 'new'
        ? 'Choose a project location before continuing.'
        : 'Choose a discovery root before continuing.',
    );
  }
  if (!draft.contextPackId.trim()) {
    errors.push('Context-pack ID is required.');
  }
  if (!draft.estateName.trim()) {
    errors.push('Display name is required.');
  }
  if (draft.repositories.length === 0) {
    errors.push('Add at least one repository to the estate definition.');
  }
  draft.repositories.forEach((repository, index) => {
    if (!repository.repoRoot.trim()) {
      errors.push(`Repository ${index + 1} requires a local root path.`);
    }
    if (!repository.repoName.trim()) {
      errors.push(`Repository ${index + 1} requires a display name.`);
    }
  });
  if (draft.repositories.length > 0 && !draft.repositories.some((r) => r.primary)) {
    errors.push('At least one repository must be marked as primary (service/app).');
  }
  if (draft.mode === 'monolith' && draft.focusAreas.length === 0) {
    errors.push('Monolith creation requires at least one focus area.');
  }
  return errors;
}

export type UseContextPackDraftResult = {
  updateDraft: (updater: (draft: ContextPackCreationDraft) => ContextPackCreationDraft) => void;
  setDraftField: <K extends keyof ContextPackCreationDraft>(field: K, value: ContextPackCreationDraft[K]) => void;
  setMode: (mode: Exclude<ContextPackDiscoveryMode, 'auto'>) => void;
  addRepository: () => void;
  removeRepository: (key: string) => void;
  updateRepository: (key: string, field: keyof RepositoryEntryDraft, value: string | boolean | number) => void;
  updateRepositoryPrimary: (key: string) => void;
  addFocusArea: () => void;
  removeFocusArea: (key: string) => void;
  updateFocusArea: (key: string, field: keyof FocusAreaEntryDraft, value: string | boolean | number) => void;
  updateFocusAreaPrimary: (key: string) => void;
};

export function useContextPackDraft(
  onUpdateDraft: (updater: (draft: ContextPackCreationDraft) => ContextPackCreationDraft) => void,
): UseContextPackDraftResult {
  const updateDraft = useCallback(
    (updater: (draft: ContextPackCreationDraft) => ContextPackCreationDraft) => {
      onUpdateDraft((draft) => normalizeDraftForMode(updater(draft)));
    },
    [onUpdateDraft],
  );

  const setDraftField = useCallback(
    <K extends keyof ContextPackCreationDraft>(field: K, value: ContextPackCreationDraft[K]) => {
      updateDraft((draft) => {
        const next = { ...draft, [field]: value };
        if (field === 'estateName' && typeof value === 'string') {
          next.contextPackId = generateContextPackId(value);
        }
        return next;
      });
    },
    [updateDraft],
  );

  const setMode = useCallback((mode: Exclude<ContextPackDiscoveryMode, 'auto'>) => {
    updateDraft((draft) => ({
      ...draft,
      mode,
      repositories:
        mode === 'distributed'
          ? draft.repositories.length > 0
            ? draft.repositories
            : createInitialDistributedRepositories()
          : draft.repositories.length > 0
            ? draft.repositories
            : createInitialMonolithRepositories(),
      focusAreas: mode === 'distributed' ? [] : draft.focusAreas,
    }));
  }, [updateDraft]);

  const updateRepository = useCallback(
    (key: string, field: keyof RepositoryEntryDraft, value: string | boolean | number) => {
      updateDraft((draft) => ({
        ...draft,
        repositories: draft.repositories.map((r) =>
          r.key === key ? { ...r, [field]: value } : r,
        ),
      }));
    },
    [updateDraft],
  );

  const updateRepositoryPrimary = useCallback(
    (key: string) => {
      updateDraft((draft) => ({
        ...draft,
        repositories: draft.repositories.map((r) => {
          if (r.key !== key) return r;
          const toggled = !r.primary;
          return {
            ...r,
            primary: toggled,
            repositoryType: toggled ? 'primary' : 'support',
            defaultFocusable: toggled ? true : r.defaultFocusable,
          };
        }),
      }));
    },
    [updateDraft],
  );

  const addRepository = useCallback(() => {
    updateDraft((draft) => ({
      ...draft,
      repositories: [
        ...draft.repositories,
        createRepositoryEntry({
          systemLayer: draft.mode === 'monolith' ? 'database' : 'backend',
          activationPriority: Math.max(0, 100 - draft.repositories.length * 10),
        }),
      ],
    }));
  }, [updateDraft]);

  const removeRepository = useCallback(
    (key: string) => {
      updateDraft((draft) => ({
        ...draft,
        repositories: draft.repositories.filter((r) => r.key !== key),
      }));
    },
    [updateDraft],
  );

  const updateFocusArea = useCallback(
    (key: string, field: keyof FocusAreaEntryDraft, value: string | boolean | number) => {
      updateDraft((draft) => ({
        ...draft,
        focusAreas: draft.focusAreas.map((f) =>
          f.key === key ? { ...f, [field]: value } : f,
        ),
      }));
    },
    [updateDraft],
  );

  const updateFocusAreaPrimary = useCallback(
    (key: string) => {
      updateDraft((draft) => ({
        ...draft,
        focusAreas: draft.focusAreas.map((f) => {
          if (f.key !== key) return f;
          const toggled = !f.primary;
          return {
            ...f,
            primary: toggled,
            repositoryType: toggled ? 'primary' : 'support',
            defaultFocusable: toggled ? true : f.defaultFocusable,
          };
        }),
      }));
    },
    [updateDraft],
  );

  const addFocusArea = useCallback(() => {
    updateDraft((draft) => ({
      ...draft,
      focusAreas: [
        ...draft.focusAreas,
        createFocusAreaEntry({
          activationPriority: Math.max(0, 100 - draft.focusAreas.length * 10),
        }),
      ],
    }));
  }, [updateDraft]);

  const removeFocusArea = useCallback(
    (key: string) => {
      updateDraft((draft) => ({
        ...draft,
        focusAreas: draft.focusAreas.filter((f) => f.key !== key),
      }));
    },
    [updateDraft],
  );

  return {
    updateDraft,
    setDraftField,
    setMode,
    addRepository,
    removeRepository,
    updateRepository,
    updateRepositoryPrimary,
    addFocusArea,
    removeFocusArea,
    updateFocusArea,
    updateFocusAreaPrimary,
  };
}
