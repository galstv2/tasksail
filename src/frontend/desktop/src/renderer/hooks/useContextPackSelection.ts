import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ContextPackCreateExecutionResult,
  ContextPackCatalogEntry,
  ContextPackDeepFocusState,
  ContextPackFocusTargetKind,
  ContextPackListResponse,
  ContextPackListRepoTreeResponse,
  ContextPackDeepFocusTarget,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import { isContextPackListResponse, isDeepFocusLoadSelectionsResponse } from '../../shared/desktopContractTypeGuards';
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
import { useContextPackCreation } from './useContextPackCreation';
import { useIpcCall } from './useIpcCall';
import { useContextPackSwitching, type SwitchingStateSnapshot } from './useContextPackSwitching';

type RefreshOptions = {
  preferredContextPackDir?: string;
  preserveFeedback?: boolean;
};

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

export type UseContextPackSelectionResult = {
  contextPackSidebarProps: Omit<ContextPackSidebarProps, 'collapsed' | 'onToggleCollapse' | 'onOpenPlannerModal'>;
  contextPackCreationModalProps: ContextPackCreationModalProps;
};

function buildSessionCreatedCatalogEntry(
  createdContextPack: ContextPackCreateExecutionResult,
): ContextPackCatalogEntry {
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
      createdContextPack.estateType === 'monolith'
        ? createdContextPack.primaryFocusAreaIds
        : createdContextPack.primaryWorkingRepoIds,
    focusTargets: [],
    status: 'inactive',
    statusMessage:
      'Created in the current desktop session. Preview or apply to activate it.',
    driftDetected: false,
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
  const [refreshPending, setRefreshPending] = useState(false);
  const [message, setMessage] = useState('Loading context packs…');
  const [error, setError] = useState('');

  const catalogResponseRef = useRef(catalogResponse);
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

  const getSwitchingState = useCallback((): SwitchingStateSnapshot => ({
    selectedContextPackDir: selectedContextPackDirRef.current,
    catalogResponse: catalogResponseRef.current,
    scopeMode: 'focused',
    selectedRepoIds,
    selectedFocusIds,
    deepFocusEnabled: selectedDeepFocusState?.deepFocusEnabled ?? false,
    deepFocusPrimaryRepoId: selectedDeepFocusState?.deepFocusPrimaryRepoId ?? null,
    deepFocusPrimaryFocusId: selectedDeepFocusState?.deepFocusPrimaryFocusId ?? null,
    selectedFocusPath: selectedDeepFocusState?.selectedFocusPath ?? null,
    selectedFocusTargetKind: selectedDeepFocusState?.selectedFocusTargetKind ?? null,
    selectedFocusTargets: selectedDeepFocusState?.selectedFocusTargets ?? [],
    selectedTestTarget: selectedDeepFocusState?.selectedTestTarget,
    selectedSupportTargets: selectedDeepFocusState?.selectedSupportTargets ?? [],
  }), [selectedDeepFocusState, selectedRepoIds, selectedFocusIds]);

  const refreshCatalog = useCallback(
    async ({ preferredContextPackDir, preserveFeedback }: RefreshOptions = {}) => {
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

      const nextSelectedContextPackDir = selectPreferredContextPackDir(
        mergedContextPacks,
        [
          preferredContextPackDir,
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
      setSelectedContextPackDir(nextSelectedContextPackDir);
      setSelectedRepoIds((current) =>
        selectPreferredWorkingRepoIds(nextSelectedPack, [
          current,
          nextSelectedPack?.lastAppliedSelectedRepoIds,
        ]),
      );
      setSelectedFocusIds((current) =>
        selectPreferredWorkingFocusIds(nextSelectedPack, [
          current,
          nextSelectedPack?.lastAppliedSelectedFocusIds,
        ]),
      );
      setError('');
      if (!preserveFeedback) {
        setMessage(response.message);
      }
      // Try restoring deep focus selections from disk for the initial load.
      if (!preserveCurrentDeepFocus && nextSelectedContextPackDir) {
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
          setSelectedDeepFocusState((current) => {
            const next = selectPreferredDeepFocusState(nextSelectedPack, [null]);
            return isDeepFocusStateEqual(current, next) ? current : next;
          });
        }).finally(() => setRefreshPending(false));
      } else {
        setSelectedDeepFocusState((current) => {
          const next = selectPreferredDeepFocusState(
            nextSelectedPack,
            [preserveCurrentDeepFocus ? current : null],
          );
          return isDeepFocusStateEqual(current, next) ? current : next;
        });
        setRefreshPending(false);
      }
    },
    [client, call],
  );

  const {
    actionPending,
    lastResult,
    lastReseedResult,
    showMultiPrimaryWarning,
    setLastResult,
    setLastReseedResult,
    dismissMultiPrimaryWarning,
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

  const handleSelectContextPack = useCallback(
    (contextPackDir: string) => {
      setSelectedContextPackDir(contextPackDir);
      const selectedPack = catalogResponse?.contextPacks.find(
        (entry) => entry.contextPackDir === contextPackDir,
      );
      setSelectedRepoIds(
        selectPreferredWorkingRepoIds(selectedPack, [
          selectedPack?.lastAppliedSelectedRepoIds,
        ]),
      );
      setSelectedFocusIds(
        selectPreferredWorkingFocusIds(selectedPack, [
          selectedPack?.lastAppliedSelectedFocusIds,
        ]),
      );
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
      });
    },
    [catalogResponse, client],
  );

  const handleSelectWorkingFocus = useCallback(
    (focusId: string) => {
      const selectedPack = catalogResponse?.contextPacks.find(
        (entry) => entry.contextPackDir === selectedContextPackDirRef.current,
      );
      if (selectedPack?.estateType === 'distributed-platform') {
        setSelectedRepoIds((current) =>
          toggleFocusSelection(selectedPack, current, focusId),
        );
        return;
      }

      setSelectedFocusIds((current) =>
        toggleFocusSelection(selectedPack, current, focusId),
      );
    },
    [catalogResponse],
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
        void client.saveDeepFocusSelections(packDir, nextState);
      }
    },
    [client],
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

  return {
    contextPackSidebarProps: {
      contextPacks: catalogResponse?.contextPacks ?? [],
      activeContextPackDir: catalogResponse?.activeContextPackDir ?? null,
      selectedContextPackDir,
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
      actionPending: refreshPending ? 'refresh' : actionPending,
      message,
      error,
      lastResult,
      lastReseedResult,
      onSelectContextPack: handleSelectContextPack,
      onSelectWorkingFocus: handleSelectWorkingFocus,
      onCommitDeepFocusSelection: handleCommitDeepFocusSelection,
      onListRepoTree: handleListRepoTree,
      onRefreshCatalog: () => refreshCatalog(),
      onOpenCreateModal: contextPackCreationModalProps.onOpen,
      onReseedContextPack: () => runReseedAction(),
      onPreviewSwitch: () => runAction('preview'),
      onApplySwitch: () => runAction('apply'),
      onClearActive: () => runAction('clear'),
      showMultiPrimaryWarning,
      onDismissMultiPrimaryWarning: dismissMultiPrimaryWarning,
      onToggleRepositoryType: (repoId: string, currentType: 'primary' | 'support') => {
        const packDir = selectedContextPackDirRef.current;
        if (!packDir) return;
        const newType = currentType === 'primary' ? 'support' : 'primary';
        void client.setRepositoryType(packDir, repoId, newType).then((result) => {
          if (result.ok) {
            void refreshCatalog({ preserveFeedback: true });
          } else {
            setError(result.error);
          }
        });
      },
    },
    contextPackCreationModalProps,
  };
}
