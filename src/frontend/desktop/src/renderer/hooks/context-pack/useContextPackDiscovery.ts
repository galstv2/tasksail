import { useCallback } from 'react';

import type {
  ContextPackDiscoverPrefillResponse,
  ContextPackDiscoveredFocusArea,
  ContextPackDiscoveredRepo,
  ContextPackRepositoryType,
} from '../../../shared/desktopContract';
import {
  isPickDirectoryResponse,
  isDiscoverPrefillResponse as isDiscoverResponse,
} from '../../../shared/desktopContractTypeGuards';
import type { ContextPackCreationState } from './useContextPackCreation';
import type {
  ContextPackCreationDraft,
  FocusAreaEntryDraft,
  RepositoryEntryDraft,
} from '../../contextPack/contextPackCreationTypes';
import { desktopShellClient, type DesktopShellClient } from '../../services/desktopShellClient';
import { formatIpcError, normalizeIpcThrownError, withIpcTimeout, DEFAULT_IPC_TIMEOUT_MS } from '../../services/ipcErrorHelpers';
import {
  createRepositoryEntry,
  createFocusAreaEntry,
  slugifyValue,
  titleizeValue,
  directoryName,
  normalizeDraftForMode,
} from './useContextPackDraft';
import { isDistributedEstateMode, isMonolithEstateMode } from '../../contextPack/contextPackModeUtils';

export type DiscoveryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; response: ContextPackDiscoverPrefillResponse }
  | { status: 'error'; error: string };

function resolveSystemLayer(
  repo: ContextPackDiscoveredRepo,
): RepositoryEntryDraft['systemLayer'] {
  if (
    repo.suggestedSystemLayer
    && repo.suggestedSystemLayer !== 'test'
  ) {
    return repo.suggestedSystemLayer;
  }

  const lowerName = repo.repoName.toLowerCase();
  return lowerName.includes('web')
    ? 'frontend'
    : lowerName.includes('infra')
      ? 'infrastructure'
      : 'backend';
}

function mapDiscoveredRepoToDraft(
  repo: ContextPackDiscoveredRepo,
  index: number,
  repositoryType: ContextPackRepositoryType,
): RepositoryEntryDraft {
  const isPrimary = repositoryType === 'primary';
  return createRepositoryEntry({
    repoRoot: repo.path,
    repoName: repo.repoName,
    repoId: repo.repoId,
    systemLayer: resolveSystemLayer(repo),
    repositoryType,
    repoCategory: repo.repoCategory ?? 'unknown',
    repoCategoryAuthored: false,
    repoCategoryConfidence: repo.repoCategoryConfidence,
    artifactRoots: repo.highSignalPaths.join(', '),
    defaultFocusable: isPrimary,
    primary: isPrimary,
    activationPriority: Math.max(0, 100 - index * 10),
  });
}

function hasCategoryAwareDiscovery(
  repos: ContextPackDiscoveredRepo[],
): boolean {
  return repos.some((repo) =>
    repo.repoCategory !== undefined || repo.repoCategoryConfidence !== undefined,
  );
}

function isInitialPrimaryCategory(repo: ContextPackDiscoveredRepo): boolean {
  return repo.repoCategory === 'service'
    || repo.repoCategory === 'application'
    || repo.repoCategory === 'frontend';
}

function selectInitialPrimaryRepoIndex(
  repos: ContextPackDiscoveredRepo[],
): number {
  const categoryPreferredIndex = repos.findIndex(isInitialPrimaryCategory);
  return categoryPreferredIndex >= 0 ? categoryPreferredIndex : 0;
}

function deriveOwnedContextPackDir(contextPackParentDir: string | undefined, contextPackId: string): string {
  const trimmedParent = contextPackParentDir?.trim().replace(/[\\/]+$/, '') ?? '';
  if (!trimmedParent) {
    return '';
  }
  const separator = trimmedParent.includes('\\') && !trimmedParent.includes('/') ? '\\' : '/';
  return `${trimmedParent}${separator}${contextPackId}`;
}

function mapDiscoveredFocusAreaToDraft(
  focusArea: ContextPackDiscoveredFocusArea,
  index: number,
): FocusAreaEntryDraft {
  // The initial working folder is a deterministic, position-based default
  // (operator-overridable), not a classification derived from the focus area's
  // kind. repositoryType is kept in sync with primary only for draft hydration;
  // it is no longer emitted in the creation payload.
  const isInitialPrimary = index === 0;
  return createFocusAreaEntry({
    focusId: focusArea.focusId,
    focusName: focusArea.focusName,
    relativePath: focusArea.relativePath,
    path: focusArea.path,
    focusType: focusArea.focusType,
    focusCategory: focusArea.focusCategory ?? 'unknown',
    group: focusArea.group ?? '',
    defaultFocusable: isInitialPrimary,
    primary: isInitialPrimary,
    repositoryType: isInitialPrimary ? 'primary' : 'support',
    activationPriority: Math.max(0, 100 - index * 10),
  });
}

export function buildDraftFromDiscovery(
  draft: ContextPackCreationDraft,
  response: ContextPackDiscoverPrefillResponse,
  contextPackParentDir?: string,
): ContextPackCreationDraft {
  const nextDraft: ContextPackCreationDraft = {
    ...draft,
    discoveryRoot: response.rootPath,
    mode: response.estateType,
    contextPackId: response.suggestedContextPackId,
    estateName: response.suggestedDisplayName,
  };

  const resolveContextPackDir = (): string => {
    const currentDir = nextDraft.contextPackDir.trim();
    if (currentDir.length === 0) {
      return deriveOwnedContextPackDir(contextPackParentDir, response.suggestedContextPackId);
    }
    if (!currentDir.endsWith(`/${response.suggestedContextPackId}`)) {
      return `${currentDir}/${response.suggestedContextPackId}`;
    }
    return currentDir;
  };

  const hasZeroCandidates =
    (isDistributedEstateMode(response.estateType) && response.candidateRepos.length === 0)
    || (isMonolithEstateMode(response.estateType) && response.candidateFocusAreas.length === 0);

  if (hasZeroCandidates) {
    nextDraft.contextPackDir = resolveContextPackDir();
    return nextDraft;
  }

  if (isDistributedEstateMode(response.estateType)) {
    const categoryAware = hasCategoryAwareDiscovery(response.candidateRepos);
    const initialPrimaryIndex = categoryAware
      ? selectInitialPrimaryRepoIndex(response.candidateRepos)
      : -1;
    nextDraft.repositories = response.candidateRepos.map((repo, index) => {
      const repositoryType = categoryAware
        ? index === initialPrimaryIndex ? 'primary' : 'support'
        : repo.repositoryType === 'primary' ? 'primary' : 'support';
      return mapDiscoveredRepoToDraft(repo, index, repositoryType);
    });
    nextDraft.focusAreas = [];
    nextDraft.contextPackDir = resolveContextPackDir();
    return normalizeDraftForMode(nextDraft);
  }

  nextDraft.repositories = [
    createRepositoryEntry({
      repoRoot: response.rootPath,
      repoName: titleizeValue(directoryName(response.rootPath)),
      repoId: slugifyValue(directoryName(response.rootPath)),
      systemLayer: 'shared',
      repositoryType: 'primary',
      repoCategory: response.rootRepoCategory ?? 'unknown',
      defaultFocusable: true,
      primary: true,
      activationPriority: 100,
    }),
  ];
  nextDraft.focusAreas = response.candidateFocusAreas.map(mapDiscoveredFocusAreaToDraft);
  nextDraft.contextPackDir = resolveContextPackDir();
  return normalizeDraftForMode(nextDraft);
}

export type ModalStateUpdater = (
  updater: (current: {
    kind: string;
    draft: ContextPackCreationDraft;
    discovery: DiscoveryState;
    error: string;
    message: string;
    step?: string;
  }) => {
    kind: string;
    draft: ContextPackCreationDraft;
    discovery: DiscoveryState;
    error: string;
    message: string;
    step?: string;
  },
) => void;

export type UseContextPackDiscoveryResult = {
  browsePath: (purpose: 'discovery-root' | 'context-pack-destination') => Promise<void>;
  discoverPrefill: () => Promise<void>;
};

export function useContextPackDiscovery(
  client: DesktopShellClient = desktopShellClient,
  getState: () => ContextPackCreationState,
  updateDraft: (updater: (draft: ContextPackCreationDraft) => ContextPackCreationDraft) => void,
  setState: (updater: (current: ContextPackCreationState) => ContextPackCreationState) => void,
  contextPackParentDir?: string,
): UseContextPackDiscoveryResult {
  const browsePath = useCallback(
    async (purpose: 'discovery-root' | 'context-pack-destination') => {
      const current = getState();
      if (current.kind === 'closed') {
        return;
      }
      const defaultPath =
        purpose === 'discovery-root'
          ? current.draft.discoveryRoot || undefined
          : current.draft.contextPackDir || undefined;
      try {
        const result = await client.pickContextPackDirectory(purpose, defaultPath);
        if (!result.ok || !isPickDirectoryResponse(result.response)) {
          const errorMsg = result.ok
            ? 'Directory selection returned an unexpected response.'
            : formatIpcError(result);
          setState((s) => {
            const state = s;
            return state.kind === 'closed'
              ? state
              : { ...state, error: errorMsg };
          });
          return;
        }
        const selectedPath = result.response.selectedPath;
        if (!selectedPath) {
          return;
        }
        updateDraft((draft) => ({
          ...draft,
          discoveryRoot: purpose === 'discovery-root' ? selectedPath : draft.discoveryRoot,
          contextPackDir: purpose === 'context-pack-destination' ? selectedPath : draft.contextPackDir,
        }));
      } catch (error: unknown) {
        const errorMsg = normalizeIpcThrownError(error, 'Directory selection failed unexpectedly.');
        setState((s) => {
          const state = s;
          return state.kind === 'closed' ? state : { ...state, error: errorMsg };
        });
      }
    },
    [client, getState, updateDraft, setState],
  );

  const discoverPrefill = useCallback(async () => {
    const current = getState();
    if (current.kind === 'closed') {
      return;
    }
    const rootPath = current.draft.discoveryRoot.trim();
    if (!rootPath) {
      setState((s) => {
        const state = s;
        return state.kind === 'closed'
          ? state
          : { ...state, error: 'Choose a discovery root before scanning for suggestions.' };
      });
      return;
    }

    setState((s) => {
      const state = s;
      return state.kind === 'closed'
        ? state
        : {
            ...state,
            discovery: { status: 'loading' },
            error: '',
            message: 'Scanning the selected root for context-pack suggestions…',
          };
    });

    try {
      const result = await withIpcTimeout(
        client.discoverContextPackPrefill(rootPath, current.draft.mode),
        DEFAULT_IPC_TIMEOUT_MS,
        'context-pack discovery',
      );
      if (!result.ok || !isDiscoverResponse(result.response)) {
        const errorMsg = result.ok
          ? 'Discovery returned an unexpected response.'
          : formatIpcError(result);
        setState((s) => {
          const state = s;
          return state.kind === 'closed'
            ? state
            : {
                ...state,
                discovery: { status: 'error', error: errorMsg },
                error: errorMsg,
                message: 'Discovery failed. Review the root path or continue manually.',
              };
        });
        return;
      }
      const response = result.response;
      const hasZeroCandidates =
        (isDistributedEstateMode(response.estateType) && response.candidateRepos.length === 0)
        || (isMonolithEstateMode(response.estateType) && response.candidateFocusAreas.length === 0);

      setState((s) => {
        const state = s;
        if (state.kind !== 'open') {
          return state;
        }
        const nextDraft = buildDraftFromDiscovery(state.draft, response, contextPackParentDir);
        return {
          ...state,
          step: hasZeroCandidates ? state.step : 'shape',
          draft: nextDraft,
          discovery: { status: 'ready', response },
          error: '',
          message: hasZeroCandidates
            ? "No repositories found. Try a different directory or switch to 'New project' mode."
            : response.message,
        };
      });
    } catch (error: unknown) {
      const errorMsg = normalizeIpcThrownError(error, 'Discovery failed unexpectedly.');
      setState((s) => {
        const state = s;
        return state.kind === 'closed'
          ? state
          : {
              ...state,
              discovery: { status: 'error', error: errorMsg },
              error: errorMsg,
              message: 'Discovery failed. Review the root path or continue manually.',
            };
      });
    }
  }, [client, contextPackParentDir, getState, setState]);

  return { browsePath, discoverPrefill };
}
