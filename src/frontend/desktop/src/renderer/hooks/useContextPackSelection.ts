import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ContextPackCreateExecutionResult,
  ContextPackCatalogEntry,
  ContextPackDeepFocusState,
  ContextPackFocusTargetKind,
  ContextPackListResponse,
  ContextPackListRepoTreeResponse,
  ContextPackDeepFocusTarget,
  ContextPackPrimaryFocusTarget,
  ContextPackFocusFilter,
  ContextPackFocusFilterSelection,
  ContextPackSidebarPersistedState,
  ContextPackFocusFilterRepositoryType,
} from '../../shared/desktopContract';
import {
  isContextPackCatalogChangedEvent,
  isContextPackListResponse,
  isDeepFocusLoadSelectionsResponse,
  isFocusFiltersCreateResponse,
  isFocusFiltersDeleteResponse,
  isFocusFiltersListResponse,
  isContextPackSidebarStateLoadResponse,
} from '../../shared/desktopContractTypeGuards';
import { hydrateLegacyPrimaries, migrateSupportScopes } from '../components/SidebarDeepFocusUtils';
import type { ContextPackCreationModalProps } from '../contextPackCreationTypes';
import type { ContextPackSidebarProps } from '../components/ContextPackSidebar';
import { selectPreferredContextPackDir } from '../selectors/contextPackSidebarModel';
import {
  EMPTY_CONTEXT_PACK_DEEP_FOCUS_STATE,
  isDeepFocusStateEqual,
  selectLastAppliedDeepFocusState,
  selectPreferredDeepFocusState,
  selectPreferredWorkingRepoIds,
  selectPreferredWorkingFocusIds,
  toggleFocusSelection,
} from '../selectors/contextPackPreferences';
import { desktopShellClient, type DesktopShellClient } from '../services/desktopShellClient';
import { isMonolithEstateMode } from '../contextPackModeUtils';
import { createLogger } from '../log/logger';
import { useContextPackCreation } from './useContextPackCreation';
import { useIpcCall } from './useIpcCall';
import { useContextPackSwitching, type SwitchingStateSnapshot } from './useContextPackSwitching';

type RefreshOptions = {
  preferredContextPackDir?: string;
  preserveFeedback?: boolean;
  preserveNoSelection?: boolean;
};

const log = createLogger('src/renderer/hooks/useContextPackSelection');

type DeepFocusSelectionCommit = {
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
};

function cloneSelectionSnapshot(
  snapshot: ContextPackFocusFilterSelection,
): ContextPackFocusFilterSelection {
  return {
    selectedRepoIds: [...snapshot.selectedRepoIds],
    selectedFocusIds: [...snapshot.selectedFocusIds],
    ...(snapshot.repositoryTypes ? { repositoryTypes: { ...snapshot.repositoryTypes } } : {}),
    deepFocusEnabled: snapshot.deepFocusEnabled,
    deepFocusPrimaryRepoId: snapshot.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: snapshot.deepFocusPrimaryFocusId,
    selectedFocusPath: snapshot.selectedFocusPath,
    selectedFocusTargetKind: snapshot.selectedFocusTargetKind,
    selectedFocusTargets: (snapshot.selectedFocusTargets ?? []).map((target) => ({ ...target })),
    selectedTestTarget: snapshot.selectedTestTarget === undefined
      ? undefined
      : snapshot.selectedTestTarget
        ? { ...snapshot.selectedTestTarget }
        : null,
    selectedSupportTargets: (snapshot.selectedSupportTargets ?? []).map((target) => ({ ...target })),
  };
}

function buildSelectionSnapshot(args: {
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  selectedDeepFocusState: ContextPackDeepFocusState | null;
  selectedPack?: ContextPackCatalogEntry | null;
}): ContextPackFocusFilterSelection {
  const selectedIds = new Set([...args.selectedRepoIds, ...args.selectedFocusIds]);
  const repositoryTypes = Object.fromEntries(
    (args.selectedPack?.focusTargets ?? [])
      .filter((target) => selectedIds.has(target.focusId) && target.repositoryType)
      .map((target) => [target.focusId, target.repositoryType as ContextPackFocusFilterRepositoryType]),
  );
  return {
    selectedRepoIds: [...args.selectedRepoIds],
    selectedFocusIds: [...args.selectedFocusIds],
    ...(Object.keys(repositoryTypes).length ? { repositoryTypes } : {}),
    deepFocusEnabled: args.selectedDeepFocusState?.deepFocusEnabled ?? false,
    deepFocusPrimaryRepoId: args.selectedDeepFocusState?.deepFocusPrimaryRepoId ?? null,
    deepFocusPrimaryFocusId: args.selectedDeepFocusState?.deepFocusPrimaryFocusId ?? null,
    selectedFocusPath: args.selectedDeepFocusState?.selectedFocusPath ?? null,
    selectedFocusTargetKind: args.selectedDeepFocusState?.selectedFocusTargetKind ?? null,
    selectedFocusTargets: (args.selectedDeepFocusState?.selectedFocusTargets ?? []).map((target) => ({ ...target })),
    selectedTestTarget: args.selectedDeepFocusState?.selectedTestTarget === undefined
      ? undefined
      : args.selectedDeepFocusState.selectedTestTarget
        ? { ...args.selectedDeepFocusState.selectedTestTarget }
        : null,
    selectedSupportTargets: (args.selectedDeepFocusState?.selectedSupportTargets ?? []).map((target) => ({ ...target })),
  };
}

function deepFocusStateFromSelection(
  selection: ContextPackFocusFilterSelection,
): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: selection.deepFocusEnabled,
    deepFocusPrimaryRepoId: selection.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: selection.deepFocusPrimaryFocusId,
    selectedFocusPath: selection.selectedFocusPath,
    selectedFocusTargetKind: selection.selectedFocusTargetKind,
    selectedFocusTargets: (selection.selectedFocusTargets ?? []).map((target) => ({ ...target })),
    selectedTestTarget: selection.selectedTestTarget === undefined
      ? undefined
      : selection.selectedTestTarget
        ? { ...selection.selectedTestTarget }
        : null,
    selectedSupportTargets: (selection.selectedSupportTargets ?? []).map((target) => ({ ...target })),
  };
}

export type UseContextPackSelectionResult = {
  contextPackSidebarProps: Omit<ContextPackSidebarProps, 'collapsed' | 'onToggleCollapse' | 'onOpenPlannerModal'>;
  contextPackCreationModalProps: ContextPackCreationModalProps;
  refreshCatalog: () => Promise<void>;
};

function buildSessionCreatedCatalogEntry(
  createdContextPack: ContextPackCreateExecutionResult,
): ContextPackCatalogEntry {
  // 'not-run' is the sentinel set only by the new-flow stub-tree branch in
  // executeContextPackCreateAction; any live seed overwrites it.
  const isBootstrapEmpty = createdContextPack.seedStatus === 'not-run';
  return {
    contextPackId: createdContextPack.contextPackId,
    displayName: createdContextPack.displayName,
    contextPackDir: createdContextPack.contextPackDir,
    manifestPath: createdContextPack.manifestPath,
    bootstrapReady: true,
    source: 'recent-state',
    isActive: false,
    estateType: createdContextPack.estateType,
    defaultScopeMode: createdContextPack.defaultScopeMode,
    repoCount: createdContextPack.repositoryCount,
    primaryWorkingRepoIds:
      isMonolithEstateMode(createdContextPack.estateType)
        ? createdContextPack.primaryFocusAreaIds
        : createdContextPack.primaryWorkingRepoIds,
    focusTargets: [],
    packSeedState: isBootstrapEmpty ? 'bootstrap-empty' : 'seeded',
    packSeedStateInfo: { state: isBootstrapEmpty ? 'bootstrap-empty' : 'seeded' },
    status: 'inactive',
    statusMessage:
      'Created in the current desktop session. Preview or apply to activate it.',
    restoreAvailable: false,
    lastSyncedAt: null,
    lastAppliedScopeMode: null,
    lastAppliedSelectedRepoIds: [],
    lastAppliedSelectedFocusIds: [],
    lastAppliedDeepFocusEnabled: false,
    lastAppliedSelectedFocusPath: null,
    lastAppliedSelectedFocusTargetKind: null,
    lastAppliedSelectedTestTarget: undefined,
    lastAppliedSelectedSupportTargets: [],
    workspaceFolderCount: null,
    workspaceFileCount: null,
  };
}

function mergeCatalogEntries(
  catalogEntries: ContextPackCatalogEntry[],
  sessionCreatedEntries: ContextPackCatalogEntry[],
): ContextPackCatalogEntry[] {
  const merged = new Map<string, ContextPackCatalogEntry>();

  for (const entry of sessionCreatedEntries) {
    merged.set(entry.contextPackDir, entry);
  }
  for (const entry of catalogEntries) {
    merged.set(entry.contextPackDir, entry);
  }

  return [...merged.values()].sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

function applyRepositoryTypesToCatalog(
  response: ContextPackListResponse,
  contextPackDir: string,
  repositoryTypes: Record<string, ContextPackFocusFilterRepositoryType>,
): ContextPackListResponse {
  return {
    ...response,
    contextPacks: response.contextPacks.map((entry) => {
      if (entry.contextPackDir !== contextPackDir) {
        return entry;
      }
      return {
        ...entry,
        focusTargets: entry.focusTargets.map((target) =>
          target.focusId in repositoryTypes
            ? { ...target, repositoryType: repositoryTypes[target.focusId] ?? null }
            : target),
      };
    }),
  };
}

function validateRepositoryTypesForPack(
  selectedPack: ContextPackCatalogEntry,
  repositoryTypes: Record<string, ContextPackFocusFilterRepositoryType>,
): string | null {
  const knownFocusIds = new Set(selectedPack.focusTargets.map((target) => target.focusId));
  for (const [focusId, repositoryType] of Object.entries(repositoryTypes)) {
    if (!knownFocusIds.has(focusId)) {
      return 'This focus filter references repository roles that no longer exist in the selected context pack.';
    }
    if (repositoryType !== 'primary' && repositoryType !== 'support') {
      return 'This focus filter contains an invalid repository role.';
    }
  }
  return null;
}

export function useContextPackSelection(
  client: DesktopShellClient = desktopShellClient,
  repoRoot?: string,
): UseContextPackSelectionResult {
  const [catalogResponse, setCatalogResponse] =
    useState<ContextPackListResponse | null>(null);
  const [sessionCreatedEntries, setSessionCreatedEntries] =
    useState<ContextPackCatalogEntry[]>([]);
  const sessionCreatedEntriesRef = useRef<ContextPackCatalogEntry[]>([]);
  const [selectedContextPackDir, setSelectedContextPackDir] = useState('');
  const selectedContextPackDirRef = useRef('');
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const [selectedFocusIds, setSelectedFocusIds] = useState<string[]>([]);
  const [selectedDeepFocusState, setSelectedDeepFocusState] =
    useState<ContextPackDeepFocusState | null>(null);
  const [focusFilters, setFocusFilters] = useState<ContextPackFocusFilter[]>([]);
  const [focusFilterPending, setFocusFilterPending] = useState(false);
  const [focusFilterError, setFocusFilterError] = useState('');
  const [refreshPending, setRefreshPending] = useState(false);
  const [message, setMessage] = useState('Loading context packs…');
  const [error, setError] = useState('');

  const catalogResponseRef = useRef(catalogResponse);
  const selectedRepoIdsRef = useRef(selectedRepoIds);
  const selectedFocusIdsRef = useRef(selectedFocusIds);
  const selectedDeepFocusStateRef = useRef(selectedDeepFocusState);
  const sidebarSaveTimerRef = useRef<number | null>(null);
  const sidebarStateHydratedRef = useRef(false);
  const focusFilterRequestSeqRef = useRef(0);
  const { call } = useIpcCall(setError);

  useEffect(() => {
    selectedContextPackDirRef.current = selectedContextPackDir;
  }, [selectedContextPackDir]);

  useEffect(() => {
    sessionCreatedEntriesRef.current = sessionCreatedEntries;
  }, [sessionCreatedEntries]);

  useEffect(() => {
    catalogResponseRef.current = catalogResponse;
  }, [catalogResponse]);

  useEffect(() => {
    selectedRepoIdsRef.current = selectedRepoIds;
  }, [selectedRepoIds]);

  useEffect(() => {
    selectedFocusIdsRef.current = selectedFocusIds;
  }, [selectedFocusIds]);

  useEffect(() => {
    selectedDeepFocusStateRef.current = selectedDeepFocusState;
  }, [selectedDeepFocusState]);

  useEffect(() => () => {
    if (sidebarSaveTimerRef.current) {
      window.clearTimeout(sidebarSaveTimerRef.current);
    }
  }, []);

  const getSwitchingState = useCallback((): SwitchingStateSnapshot => {
    const deepFocus = selectedDeepFocusStateRef.current;
    return {
      selectedContextPackDir: selectedContextPackDirRef.current,
      catalogResponse: catalogResponseRef.current,
      scopeMode: 'focused',
      selectedRepoIds: selectedRepoIdsRef.current,
      selectedFocusIds: selectedFocusIdsRef.current,
      deepFocusEnabled: deepFocus?.deepFocusEnabled ?? false,
      deepFocusPrimaryRepoId: deepFocus?.deepFocusPrimaryRepoId ?? null,
      deepFocusPrimaryFocusId: deepFocus?.deepFocusPrimaryFocusId ?? null,
      selectedFocusPath: deepFocus?.selectedFocusPath ?? null,
      selectedFocusTargetKind: deepFocus?.selectedFocusTargetKind ?? null,
      selectedFocusTargets: deepFocus?.selectedFocusTargets ?? [],
      selectedTestTarget: deepFocus?.selectedTestTarget,
      selectedSupportTargets: deepFocus?.selectedSupportTargets ?? [],
    };
  }, []);

  const currentSelectionSnapshot = useCallback((): ContextPackFocusFilterSelection =>
    buildSelectionSnapshot({
      selectedRepoIds: selectedRepoIdsRef.current,
      selectedFocusIds: selectedFocusIdsRef.current,
      selectedDeepFocusState: selectedDeepFocusStateRef.current,
      selectedPack: catalogResponseRef.current?.contextPacks.find(
        (entry) => entry.contextPackDir === selectedContextPackDirRef.current,
      ) ?? null,
    }), []);

  const saveSidebarState = useCallback((
    contextPackDir: string | null,
    selection: ContextPackFocusFilterSelection | null,
  ) => {
    return client.saveContextPackSidebarState(contextPackDir, selection).then((result) => {
      if (!result.ok) {
        log.warn('context-pack-sidebar-state.save.failed', {
          contextPackDir,
          reason: result.error,
        });
      }
    }).catch((err: unknown) => {
      log.warn('context-pack-sidebar-state.save.failed', {
        contextPackDir,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  }, [client]);

  const scheduleSidebarStateSave = useCallback((contextPackDir: string) => {
    if (!contextPackDir) {
      return;
    }
    if (sidebarSaveTimerRef.current) {
      window.clearTimeout(sidebarSaveTimerRef.current);
    }
    // Capture the snapshot at schedule time so a later pack switch cannot
    // race the debounced fire and overwrite this pack's saved snapshot with
    // the new pack's live state.
    const snapshot = currentSelectionSnapshot();
    sidebarSaveTimerRef.current = window.setTimeout(() => {
      sidebarSaveTimerRef.current = null;
      void saveSidebarState(contextPackDir, snapshot);
    }, 250);
  }, [currentSelectionSnapshot, saveSidebarState]);

  const loadFocusFiltersForPack = useCallback((contextPackDir: string) => {
    const requestSeq = ++focusFilterRequestSeqRef.current;
    if (!contextPackDir) {
      setFocusFilters([]);
      setFocusFilterPending(false);
      return;
    }
    setFocusFilterPending(true);
    void client.listFocusFilters(contextPackDir).then((result) => {
      if (
        requestSeq !== focusFilterRequestSeqRef.current ||
        selectedContextPackDirRef.current !== contextPackDir
      ) {
        return;
      }
      if (result.ok && isFocusFiltersListResponse(result.response)) {
        setFocusFilters(result.response.filters);
        setFocusFilterError('');
        return;
      }
      const reason = result.ok ? 'Focus filter list returned an unexpected response.' : result.error;
      setFocusFilterError(reason);
      setError(reason);
    }).catch((err: unknown) => {
      if (
        requestSeq !== focusFilterRequestSeqRef.current ||
        selectedContextPackDirRef.current !== contextPackDir
      ) {
        return;
      }
      const reason = err instanceof Error ? err.message : String(err);
      setFocusFilterError(reason);
      setError(reason);
    }).finally(() => {
      if (
        requestSeq === focusFilterRequestSeqRef.current &&
        selectedContextPackDirRef.current === contextPackDir
      ) {
        setFocusFilterPending(false);
      }
    });
  }, [client]);

  const refreshCatalog = useCallback(
    async ({ preferredContextPackDir, preserveFeedback, preserveNoSelection }: RefreshOptions = {}) => {
      setRefreshPending(true);

      const callResult = await call(
        () => client.listContextPacks(),
        { validate: isContextPackListResponse, label: 'context-pack catalog' },
      );

      if (!callResult.ok) {
        if (!preserveFeedback) {
          setMessage('Context-pack discovery failed.');
        }
        setRefreshPending(false);
        return;
      }

      const response = callResult.response;

      const pendingSessionEntries = sessionCreatedEntriesRef.current.filter(
        (entry) =>
          !response.contextPacks.some(
            (catalogEntry) =>
              catalogEntry.contextPackDir === entry.contextPackDir,
          ),
      );
      const mergedContextPacks = mergeCatalogEntries(
        response.contextPacks,
        pendingSessionEntries,
      );
      let persistedSidebarState: ContextPackSidebarPersistedState | null = null;
      const usePersistedSidebarState = !sidebarStateHydratedRef.current;
      // Spec: persisted sidebar state is read only on initial catalog load.
      // Subsequent refreshes (delete, reseed, catalog-changed) keep the live
      // ref-tracked selection without re-reading disk.
      if (usePersistedSidebarState) {
        const sidebarStateResult = await client.loadContextPackSidebarState();
        if (sidebarStateResult.ok && isContextPackSidebarStateLoadResponse(sidebarStateResult.response)) {
          persistedSidebarState = sidebarStateResult.response.state;
        }
      }
      const persistedContextPackDir = usePersistedSidebarState && persistedSidebarState?.selectedContextPackDir
        && mergedContextPacks.some((entry) => entry.contextPackDir === persistedSidebarState?.selectedContextPackDir)
        ? persistedSidebarState.selectedContextPackDir
        : undefined;

      const nextSelectedContextPackDir = preserveNoSelection
        ? ''
        : selectPreferredContextPackDir(
            mergedContextPacks,
            [
              preferredContextPackDir,
              persistedContextPackDir,
              selectedContextPackDirRef.current,
              response.activeContextPackDir,
            ],
          );
      const nextSelectedPack = mergedContextPacks.find(
        (entry) => entry.contextPackDir === nextSelectedContextPackDir,
      );
      const preserveCurrentDeepFocus =
        selectedContextPackDirRef.current === nextSelectedContextPackDir;

      setCatalogResponse({
        ...response,
        contextPacks: mergedContextPacks,
      });
      setSessionCreatedEntries(pendingSessionEntries);
      selectedContextPackDirRef.current = nextSelectedContextPackDir;
      setSelectedContextPackDir(nextSelectedContextPackDir);
      sidebarStateHydratedRef.current = true;
      const persistedSnapshot = usePersistedSidebarState && nextSelectedContextPackDir
        ? persistedSidebarState?.selectionsByContextPackDir?.[nextSelectedContextPackDir]
        : undefined;
      const persistedRepoIds = persistedSnapshot
        ? selectPreferredWorkingRepoIds(nextSelectedPack, [persistedSnapshot.selectedRepoIds])
        : [];
      const persistedFocusIds = persistedSnapshot
        ? selectPreferredWorkingFocusIds(nextSelectedPack, [persistedSnapshot.selectedFocusIds])
        : [];
      const stalePersistedSnapshot = Boolean(
        persistedSnapshot &&
        (
          (persistedSnapshot.selectedRepoIds.length > 0 && persistedRepoIds.length === 0) ||
          (persistedSnapshot.selectedFocusIds.length > 0 && persistedFocusIds.length === 0)
        ),
      );
      if (stalePersistedSnapshot) {
        log.warn('context-pack-sidebar-state.restore.stale', {
          contextPackDir: nextSelectedContextPackDir,
        });
      }
      setSelectedRepoIds((current) =>
        !stalePersistedSnapshot && persistedSnapshot
          ? persistedRepoIds
          : selectPreferredWorkingRepoIds(nextSelectedPack, [
              current,
              nextSelectedPack?.lastAppliedSelectedRepoIds,
            ]),
      );
      setSelectedFocusIds((current) =>
        !stalePersistedSnapshot && persistedSnapshot
          ? persistedFocusIds
          : selectPreferredWorkingFocusIds(nextSelectedPack, [
              current,
              nextSelectedPack?.lastAppliedSelectedFocusIds,
            ]),
      );
      setError('');
      if (!preserveFeedback) {
        setMessage(response.message);
      }
      const applyCatalogDefaultDeepFocusState = () => {
        setSelectedDeepFocusState((current) => {
          const next = !stalePersistedSnapshot && persistedSnapshot
            ? deepFocusStateFromSelection(persistedSnapshot)
            : selectPreferredDeepFocusState(nextSelectedPack, [null]);
          return isDeepFocusStateEqual(current, next) ? current : next;
        });
      };

      // Try restoring deep focus selections from disk for the initial load.
      if (!persistedSnapshot && !preserveCurrentDeepFocus && nextSelectedContextPackDir) {
        void client.loadDeepFocusSelections(nextSelectedContextPackDir).then((result) => {
          const loaded = result.ok && isDeepFocusLoadSelectionsResponse(result.response)
            ? result.response.selections
            : null;
          const hydrated = loaded
            ? migrateSupportScopes(
                hydrateLegacyPrimaries({ state: loaded, catalogEntry: nextSelectedPack }),
              )
            : null;
          if (hydrated) {
            setSelectedDeepFocusState((current) =>
              isDeepFocusStateEqual(current, hydrated) ? current : hydrated,
            );
            return;
          }
          applyCatalogDefaultDeepFocusState();
        }).catch((err: unknown) => {
          log.warn('deep-focus.selections.load.failed', {
            contextPackDir: nextSelectedContextPackDir,
            reason: err instanceof Error ? err.message : String(err),
          });
          applyCatalogDefaultDeepFocusState();
        }).finally(() => setRefreshPending(false));
      } else {
        setSelectedDeepFocusState((current) => {
          const next = !stalePersistedSnapshot && persistedSnapshot
            ? deepFocusStateFromSelection(persistedSnapshot)
            : selectPreferredDeepFocusState(
                nextSelectedPack,
                [preserveCurrentDeepFocus ? current : null],
              );
          return isDeepFocusStateEqual(current, next) ? current : next;
        });
        setRefreshPending(false);
      }
      loadFocusFiltersForPack(nextSelectedContextPackDir);
    },
    [client, call, loadFocusFiltersForPack],
  );

  const {
    actionPending,
    lastResult,
    lastReseedResult,
    showMultiPrimaryWarning,
    bootstrapEmptyConfirmPending,
    setLastResult,
    setLastReseedResult,
    dismissMultiPrimaryWarning,
    confirmActivateAnyway,
    confirmPopulateAndSeed,
    runAction,
    runReseedAction,
  } = useContextPackSwitching(client, getSwitchingState, setError, setMessage, refreshCatalog);

  const defaultContextPackParentDir = repoRoot ? `${repoRoot}/contextpacks` : undefined;

  const { contextPackCreationModalProps } = useContextPackCreation(client, {
    defaultContextPackParentDir,
    onCreated: async (createdContextPack, creationMessage) => {
      const createdEntry = buildSessionCreatedCatalogEntry(createdContextPack);
      const nextSessionCreatedEntries = mergeCatalogEntries(
        sessionCreatedEntriesRef.current,
        [createdEntry],
      );
      sessionCreatedEntriesRef.current = nextSessionCreatedEntries;
      setSessionCreatedEntries(nextSessionCreatedEntries);
      await refreshCatalog({
        preferredContextPackDir: createdContextPack.contextPackDir,
        preserveFeedback: true,
      });
      setError('');
      setMessage(creationMessage);
      setLastResult(null);
      setLastReseedResult(null);
    },
  });

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => client.subscribeContextPackCatalogChanged((event) => {
    if (!isContextPackCatalogChangedEvent(event)) {
      log.warn('context-pack.catalog-event.malformed', { event });
      return;
    }
    void refreshCatalog({ preserveFeedback: true });
  }), [client, refreshCatalog]);

  const handleSelectContextPack = useCallback(
    (contextPackDir: string) => {
      selectedContextPackDirRef.current = contextPackDir;
      setSelectedContextPackDir(contextPackDir);
      void saveSidebarState(contextPackDir, null);
      loadFocusFiltersForPack(contextPackDir);
      const selectedPack = catalogResponse?.contextPacks.find(
        (entry) => entry.contextPackDir === contextPackDir,
      );
      const nextRepoIds = selectPreferredWorkingRepoIds(selectedPack, [
        selectedPack?.lastAppliedSelectedRepoIds,
      ]);
      const nextFocusIds = selectPreferredWorkingFocusIds(selectedPack, [
        selectedPack?.lastAppliedSelectedFocusIds,
      ]);
      setSelectedRepoIds(nextRepoIds);
      setSelectedFocusIds(nextFocusIds);
      // Try to restore persisted deep focus selections; fall back to last-applied state.
      void client.loadDeepFocusSelections(contextPackDir).then((result) => {
        const loaded = result.ok && isDeepFocusLoadSelectionsResponse(result.response)
          ? result.response.selections
          : null;
        const next = loaded
          ? migrateSupportScopes(
              hydrateLegacyPrimaries({ state: loaded, catalogEntry: selectedPack }),
            )
          : selectLastAppliedDeepFocusState(selectedPack);
        setSelectedDeepFocusState((current) =>
          isDeepFocusStateEqual(current, next) ? current : next,
        );
        void saveSidebarState(contextPackDir, buildSelectionSnapshot({
          selectedRepoIds: nextRepoIds,
          selectedFocusIds: nextFocusIds,
          selectedDeepFocusState: next,
          selectedPack,
        }));
      }).catch((err: unknown) => {
        log.warn('deep-focus.selections.load.failed', {
          contextPackDir,
          reason: err instanceof Error ? err.message : String(err),
        });
        const next = selectLastAppliedDeepFocusState(selectedPack);
        setSelectedDeepFocusState((current) =>
          isDeepFocusStateEqual(current, next) ? current : next,
        );
        void saveSidebarState(contextPackDir, buildSelectionSnapshot({
          selectedRepoIds: nextRepoIds,
          selectedFocusIds: nextFocusIds,
          selectedDeepFocusState: next,
          selectedPack,
        }));
      });
    },
    [catalogResponse, client, loadFocusFiltersForPack, saveSidebarState],
  );

  const handleSelectWorkingFocus = useCallback(
    (focusId: string) => {
      const selectedPack = catalogResponse?.contextPacks.find(
        (entry) => entry.contextPackDir === selectedContextPackDirRef.current,
      );
      const packDir = selectedContextPackDirRef.current;
      if (selectedPack?.estateType === 'distributed-platform') {
        setSelectedRepoIds((current) => toggleFocusSelection(selectedPack, current, focusId));
      } else {
        setSelectedFocusIds((current) => toggleFocusSelection(selectedPack, current, focusId));
      }
      // Schedule the save outside the updater — a setState updater must be pure
      // (it re-runs under StrictMode/concurrent and would double-schedule).
      if (packDir) {
        window.setTimeout(() => scheduleSidebarStateSave(packDir), 0);
      }
    },
    [catalogResponse, scheduleSidebarStateSave],
  );

  const handleCommitDeepFocusSelection = useCallback(
    (selection: DeepFocusSelectionCommit) => {
      const nextState: ContextPackDeepFocusState = {
        deepFocusEnabled: selection.deepFocusEnabled,
        deepFocusPrimaryRepoId: selection.deepFocusPrimaryRepoId,
        deepFocusPrimaryFocusId: selection.deepFocusPrimaryFocusId,
        selectedFocusPath: selection.selectedFocusPath,
        selectedFocusTargetKind: selection.selectedFocusTargetKind,
        selectedFocusTargets: (selection.selectedFocusTargets ?? []).map((target) => ({
          ...target,
          testTarget: target.testTarget ? { ...target.testTarget } : target.testTarget,
          supportTargets: (target.supportTargets ?? []).map((supportTarget) => ({ ...supportTarget })),
        })),
        selectedTestTarget:
          selection.selectedTestTarget === undefined
            ? undefined
            : selection.selectedTestTarget
              ? { ...selection.selectedTestTarget }
              : null,
        selectedSupportTargets: selection.selectedSupportTargets.map((target) => ({ ...target })),
      };
      setSelectedDeepFocusState(nextState);
      const packDir = selectedContextPackDirRef.current;
      if (packDir) {
        void saveSidebarState(packDir, buildSelectionSnapshot({
          selectedRepoIds: selectedRepoIdsRef.current,
          selectedFocusIds: selectedFocusIdsRef.current,
          selectedDeepFocusState: nextState,
          selectedPack: catalogResponseRef.current?.contextPacks.find(
            (entry) => entry.contextPackDir === packDir,
          ) ?? null,
        }));
        void client.saveDeepFocusSelections(packDir, nextState)
          .then((result) => {
            if (!result.ok) {
              log.warn('deep-focus.selections.save.failed', {
                contextPackDir: packDir,
                reason: result.error,
              });
              setError(result.error);
            }
          })
          .catch((err: unknown) => {
            const reason = err instanceof Error ? err.message : String(err);
            log.warn('deep-focus.selections.save.failed', {
              contextPackDir: packDir,
              reason,
            });
            setError(reason);
          });
      }
    },
    [client, saveSidebarState],
  );

  const handleListRepoTree = useCallback(
    async (
      repoLocalPath: string,
      relativePath?: string,
    ): Promise<ContextPackListRepoTreeResponse | null> => {
      const result = await client.listRepoTree(repoLocalPath, relativePath);
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      const response = result.response;
      if (
        typeof response !== 'object'
        || response === null
        || !('action' in response)
        || response.action !== 'contextPack.listRepoTree'
      ) {
        setError('Context-pack repo tree listing returned an unexpected response.');
        return null;
      }
      setError('');
      return response as ContextPackListRepoTreeResponse;
    },
    [client],
  );

  const handleCreateFocusFilter = useCallback(async (name: string): Promise<boolean> => {
    const contextPackDir = selectedContextPackDirRef.current;
    if (!contextPackDir) return false;
    const requestSeq = ++focusFilterRequestSeqRef.current;
    setFocusFilterPending(true);
    const result = await client.createFocusFilter(contextPackDir, name, currentSelectionSnapshot());
    if (
      requestSeq !== focusFilterRequestSeqRef.current ||
      selectedContextPackDirRef.current !== contextPackDir
    ) {
      return false;
    }
    if (!result.ok) {
      setFocusFilterError(result.error);
      setError(result.error);
      setFocusFilterPending(false);
      return false;
    }
    if (isFocusFiltersCreateResponse(result.response)) {
      setFocusFilters(result.response.filters);
      setFocusFilterError('');
      setError('');
      setFocusFilterPending(false);
      return true;
    }
    setFocusFilterPending(false);
    return false;
  }, [client, currentSelectionSnapshot]);

  const handleDeleteFocusFilter = useCallback(async (filterId: string) => {
    const contextPackDir = selectedContextPackDirRef.current;
    if (!contextPackDir) return;
    const requestSeq = ++focusFilterRequestSeqRef.current;
    setFocusFilterPending(true);
    const result = await client.deleteFocusFilter(contextPackDir, filterId);
    if (
      requestSeq !== focusFilterRequestSeqRef.current ||
      selectedContextPackDirRef.current !== contextPackDir
    ) {
      return;
    }
    if (!result.ok) {
      setFocusFilterError(result.error);
      setError(result.error);
      setFocusFilterPending(false);
      return;
    }
    if (isFocusFiltersDeleteResponse(result.response)) {
      setFocusFilters(result.response.filters);
      setFocusFilterError('');
      setError('');
    }
    setFocusFilterPending(false);
  }, [client]);

  const handleApplyFocusFilter = useCallback(async (filterId: string): Promise<boolean> => {
    const selectedPack = catalogResponseRef.current?.contextPacks.find(
      (entry) => entry.contextPackDir === selectedContextPackDirRef.current,
    );
    const filter = focusFilters.find((entry) => entry.id === filterId);
    if (!selectedPack || !filter || filter.contextPackDir !== selectedPack.contextPackDir) {
      return false;
    }
    const filteredRepoIds = selectPreferredWorkingRepoIds(selectedPack, [filter.selection.selectedRepoIds]);
    const filteredFocusIds = selectPreferredWorkingFocusIds(selectedPack, [filter.selection.selectedFocusIds]);
    const hasStaleTopLevelIds =
      (filter.selection.selectedRepoIds.length > 0 && filteredRepoIds.length === 0) ||
      (filter.selection.selectedFocusIds.length > 0 && filteredFocusIds.length === 0);
    if (hasStaleTopLevelIds) {
      const reason = 'This focus filter references repositories or folders that no longer exist in the selected context pack.';
      setFocusFilterError(reason);
      setError(reason);
      return false;
    }
    if (filter.selection.deepFocusPrimaryRepoId || filter.selection.deepFocusPrimaryFocusId) {
      const knownRepoIds = new Set(
        selectedPack.focusTargets
          .map((target) => target.repoId)
          .filter((repoId): repoId is string => typeof repoId === 'string' && repoId.length > 0),
      );
      const knownFocusIds = new Set(selectedPack.focusTargets.map((target) => target.focusId));
      if (
        filter.selection.deepFocusPrimaryRepoId &&
        !knownRepoIds.has(filter.selection.deepFocusPrimaryRepoId)
      ) {
        const reason = 'This Deep Focus filter references a primary repository that no longer exists.';
        setFocusFilterError(reason);
        setError(reason);
        return false;
      }
      if (
        filter.selection.deepFocusPrimaryFocusId &&
        !knownFocusIds.has(filter.selection.deepFocusPrimaryFocusId)
      ) {
        const reason = 'This Deep Focus filter references a primary folder that no longer exists.';
        setFocusFilterError(reason);
        setError(reason);
        return false;
      }
    }

    const snapshot = cloneSelectionSnapshot(filter.selection);
    const nextDeepFocusState = deepFocusStateFromSelection(snapshot);
    const repositoryTypes = snapshot.repositoryTypes ?? {};
    const repositoryTypeError = validateRepositoryTypesForPack(selectedPack, repositoryTypes);
    if (repositoryTypeError) {
      setFocusFilterError(repositoryTypeError);
      setError(repositoryTypeError);
      return false;
    }
    if (Object.keys(repositoryTypes).length > 0 && catalogResponseRef.current) {
      const nextCatalogResponse = applyRepositoryTypesToCatalog(
        catalogResponseRef.current,
        filter.contextPackDir,
        repositoryTypes,
      );
      catalogResponseRef.current = nextCatalogResponse;
      setCatalogResponse(nextCatalogResponse);
    }
    setSelectedRepoIds(filteredRepoIds);
    setSelectedFocusIds(filteredFocusIds);
    setSelectedDeepFocusState(nextDeepFocusState);
    // Sync refs synchronously so the chained runAction('apply') below sees the
    // just-applied selection. The matching useEffect-based ref sync only fires
    // after the next render, which is too late for the same-task chain.
    selectedRepoIdsRef.current = filteredRepoIds;
    selectedFocusIdsRef.current = filteredFocusIds;
    selectedDeepFocusStateRef.current = nextDeepFocusState;
    void saveSidebarState(filter.contextPackDir, snapshot);
    const currentRepositoryTypes = new Map(
      selectedPack.focusTargets.map((target) => [target.focusId, target.repositoryType]),
    );
    for (const [repoId, repositoryType] of Object.entries(repositoryTypes)) {
      if (currentRepositoryTypes.get(repoId) === repositoryType) {
        continue;
      }
      void client.setRepositoryType(filter.contextPackDir, repoId, repositoryType)
        .then((result) => {
          if (!result.ok) {
            log.warn('context-pack.repository-type.save.failed', {
              contextPackDir: filter.contextPackDir,
              repoId,
              repositoryType,
              reason: result.error,
            });
            setError(result.error);
          }
        })
        .catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          log.warn('context-pack.repository-type.save.failed', {
            contextPackDir: filter.contextPackDir,
            repoId,
            repositoryType,
            reason,
          });
          setError(reason);
        });
    }
    void client.saveDeepFocusSelections(filter.contextPackDir, nextDeepFocusState).then((result) => {
      if (!result.ok) {
        log.warn('deep-focus.selections.save.failed', {
          contextPackDir: filter.contextPackDir,
          reason: result.error,
        });
      }
    }).catch((err: unknown) => {
      log.warn('deep-focus.selections.save.failed', {
        contextPackDir: filter.contextPackDir,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
    setFocusFilterError('');
    setError('');
    return true;
  }, [client, focusFilters, saveSidebarState]);

  const handleDeleteContextPack = useCallback(async (contextPackDir: string): Promise<boolean> => {
    const result = await client.deleteContextPack(contextPackDir);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    focusFilterRequestSeqRef.current += 1;
    setFocusFilters([]);
    setFocusFilterPending(false);
    setFocusFilterError('');
    selectedContextPackDirRef.current = '';
    setSelectedContextPackDir('');
    setSelectedRepoIds([]);
    setSelectedFocusIds([]);
    setSelectedDeepFocusState(null);
    await saveSidebarState(null, null);
    await refreshCatalog({ preserveFeedback: true, preserveNoSelection: true });
    return true;
  }, [client, refreshCatalog, saveSidebarState]);

  // Reactive equivalent of currentSelectionSnapshot() for Focus Filters display.
  // Reads selected (draft) state, not active-pack scope; planner display uses a
  // separate active-pack helper.
  const currentWorkspaceSelection = useMemo(
    () =>
      buildSelectionSnapshot({
        selectedRepoIds,
        selectedFocusIds,
        selectedDeepFocusState,
        selectedPack:
          catalogResponse?.contextPacks.find(
            (entry) => entry.contextPackDir === selectedContextPackDir,
          ) ?? null,
      }),
    [
      selectedRepoIds,
      selectedFocusIds,
      selectedDeepFocusState,
      catalogResponse,
      selectedContextPackDir,
    ],
  );

  return {
    refreshCatalog,
    contextPackSidebarProps: {
      contextPacks: catalogResponse?.contextPacks ?? [],
      activeContextPackDir: catalogResponse?.activeContextPackDir ?? null,
      selectedContextPackDir,
      currentWorkspaceSelection,
      repoRoot,
      selectedRepoIds,
      selectedFocusIds,
      deepFocusEnabled: selectedDeepFocusState?.deepFocusEnabled ?? false,
      deepFocusPrimaryRepoId: selectedDeepFocusState?.deepFocusPrimaryRepoId ?? null,
      deepFocusPrimaryFocusId: selectedDeepFocusState?.deepFocusPrimaryFocusId ?? null,
      selectedFocusPath: selectedDeepFocusState?.selectedFocusPath ?? null,
      selectedFocusTargetKind: selectedDeepFocusState?.selectedFocusTargetKind ?? null,
      selectedFocusTargets:
        selectedDeepFocusState?.selectedFocusTargets
        ?? EMPTY_CONTEXT_PACK_DEEP_FOCUS_STATE.selectedFocusTargets,
      selectedTestTarget: selectedDeepFocusState?.selectedTestTarget,
      selectedSupportTargets:
        selectedDeepFocusState?.selectedSupportTargets
        ?? EMPTY_CONTEXT_PACK_DEEP_FOCUS_STATE.selectedSupportTargets,
      focusFilters,
      focusFilterPending,
      focusFilterError,
      actionPending: refreshPending ? 'refresh' : actionPending,
      message,
      error,
      lastResult,
      lastReseedResult,
      onSelectContextPack: handleSelectContextPack,
      onSelectWorkingFocus: handleSelectWorkingFocus,
      onCommitDeepFocusSelection: handleCommitDeepFocusSelection,
      onCreateFocusFilter: handleCreateFocusFilter,
      onApplyFocusFilter: handleApplyFocusFilter,
      onDeleteFocusFilter: handleDeleteFocusFilter,
      onDeleteContextPack: handleDeleteContextPack,
      onListRepoTree: handleListRepoTree,
      onOpenCreateModal: contextPackCreationModalProps.onOpen,
      onReseedContextPack: () => runReseedAction(),
      onPreviewSwitch: () => runAction('preview'),
      onApplySwitch: () => runAction('apply'),
      onClearActive: () => runAction('clear'),
      showMultiPrimaryWarning,
      onDismissMultiPrimaryWarning: dismissMultiPrimaryWarning,
      bootstrapEmptyConfirmPending,
      onConfirmActivateAnyway: confirmActivateAnyway,
      onConfirmPopulateAndSeed: confirmPopulateAndSeed,
      onToggleRepositoryType: (repoId: string, currentType: 'primary' | 'support') => {
        const packDir = selectedContextPackDirRef.current;
        if (!packDir) return;
        const newType = currentType === 'primary' ? 'support' : 'primary';
        void client.setRepositoryType(packDir, repoId, newType).then((result) => {
          if (result.ok) {
            void refreshCatalog({ preserveFeedback: true });
          } else {
            log.warn('context-pack.repository-type.save.failed', {
              contextPackDir: packDir,
              repoId,
              repositoryType: newType,
              reason: result.error,
            });
            setError(result.error);
          }
        }).catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          log.warn('context-pack.repository-type.save.failed', {
            contextPackDir: packDir,
            repoId,
            repositoryType: newType,
            reason,
          });
          setError(reason);
        });
      },
    },
    contextPackCreationModalProps,
  };
}
