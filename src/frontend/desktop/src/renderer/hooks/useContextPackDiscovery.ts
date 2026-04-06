import { useCallback } from 'react';

import type {
  ContextPackDiscoverPrefillResponse,
  ContextPackDiscoveredFocusArea,
  ContextPackDiscoveredRepo,
} from '../../shared/desktopContract';
import {
  isPickDirectoryResponse,
  isDiscoverPrefillResponse as isDiscoverResponse,
} from '../../shared/desktopContractTypeGuards';
import type {
  ContextPackCreationDraft,
  FocusAreaEntryDraft,
  RepositoryEntryDraft,
} from '../contextPackCreationTypes';
import { desktopShellClient, type DesktopShellClient } from '../services/desktopShellClient';
import { formatIpcError, normalizeIpcThrownError, withIpcTimeout, DEFAULT_IPC_TIMEOUT_MS } from '../services/ipcErrorHelpers';
import {
  createRepositoryEntry,
  createFocusAreaEntry,
  slugifyValue,
  titleizeValue,
  directoryName,
  normalizeDraftForMode,
} from './useContextPackDraft';

export type DiscoveryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; response: ContextPackDiscoverPrefillResponse }
  | { status: 'error'; error: string };

function mapDiscoveredRepoToDraft(
  repo: ContextPackDiscoveredRepo,
  index: number,
): RepositoryEntryDraft {
  const isPrimary = repo.repositoryType === 'primary';
  const lowerName = repo.repoName.toLowerCase();
  const systemLayer: RepositoryEntryDraft['systemLayer'] = lowerName.includes('web')
    ? 'frontend'
    : lowerName.includes('infra')
      ? 'infrastructure'
      : 'backend';
  return createRepositoryEntry({
    repoRoot: repo.path,
    repoName: repo.repoName,
    repoId: repo.repoId,
    systemLayer,
    repositoryType: isPrimary ? 'primary' : 'support',
    artifactRoots: repo.highSignalPaths.join(', '),
    defaultFocusable: isPrimary,
    primary: isPrimary,
    activationPriority: Math.max(0, 100 - index * 10),
  });
}

function mapDiscoveredFocusAreaToDraft(
  focusArea: ContextPackDiscoveredFocusArea,
  index: number,
): FocusAreaEntryDraft {
  const repositoryType = focusArea.repositoryType ?? 'support';
  return createFocusAreaEntry({
    focusId: focusArea.focusId,
    focusName: focusArea.focusName,
    relativePath: focusArea.relativePath,
    path: focusArea.path,
    focusType: focusArea.focusType,
    group: focusArea.group ?? '',
    defaultFocusable: repositoryType === 'primary',
    primary: repositoryType === 'primary',
    repositoryType,
    activationPriority: Math.max(0, 100 - index * 10),
  });
}

export function buildDraftFromDiscovery(
  draft: ContextPackCreationDraft,
  response: ContextPackDiscoverPrefillResponse,
): ContextPackCreationDraft {
  const nextDraft: ContextPackCreationDraft = {
    ...draft,
    discoveryRoot: response.rootPath,
    mode: response.estateType === 'distributed' ? 'distributed' : 'monolith',
    contextPackId: response.suggestedContextPackId,
    estateName: response.suggestedDisplayName,
  };

  const resolveContextPackDir = (): string => {
    const currentDir = nextDraft.contextPackDir.trim();
    if (currentDir.length === 0) {
      return `${response.rootPath}/${response.suggestedContextPackId}`;
    }
    if (!currentDir.endsWith(`/${response.suggestedContextPackId}`)) {
      return `${currentDir}/${response.suggestedContextPackId}`;
    }
    return currentDir;
  };

  const hasZeroCandidates =
    (response.estateType === 'distributed' && response.candidateRepos.length === 0)
    || (response.estateType === 'monolith' && response.candidateFocusAreas.length === 0);

  if (hasZeroCandidates) {
    nextDraft.contextPackDir = resolveContextPackDir();
    return nextDraft;
  }

  if (response.estateType === 'distributed') {
    nextDraft.repositories = response.candidateRepos.map(mapDiscoveredRepoToDraft);
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
  getState: () => { kind: string; draft: ContextPackCreationDraft; mode?: string },
  updateDraft: (updater: (draft: ContextPackCreationDraft) => ContextPackCreationDraft) => void,
  setState: (updater: (current: unknown) => unknown) => void,
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
          setState((s: unknown) => {
            const state = s as { kind: string };
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
        setState((s: unknown) => {
          const state = s as { kind: string };
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
      setState((s: unknown) => {
        const state = s as { kind: string };
        return state.kind === 'closed'
          ? state
          : { ...state, error: 'Choose a discovery root before scanning for suggestions.' };
      });
      return;
    }

    setState((s: unknown) => {
      const state = s as { kind: string };
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
        setState((s: unknown) => {
          const state = s as { kind: string };
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
        (response.estateType === 'distributed' && response.candidateRepos.length === 0)
        || (response.estateType === 'monolith' && response.candidateFocusAreas.length === 0);

      setState((s: unknown) => {
        const state = s as { kind: string; draft: ContextPackCreationDraft; step?: string };
        if (state.kind !== 'open') {
          return state;
        }
        const nextDraft = buildDraftFromDiscovery(state.draft, response);
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
      setState((s: unknown) => {
        const state = s as { kind: string };
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
  }, [client, getState, setState]);

  return { browsePath, discoverPrefill };
}
