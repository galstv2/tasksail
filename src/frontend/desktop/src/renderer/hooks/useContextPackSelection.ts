import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ContextPackCreateExecutionResult,
  ContextPackCatalogEntry,
  ContextPackListResponse,
} from '../../shared/desktopContract';
import { isContextPackListResponse } from '../../shared/desktopContractTypeGuards';
import type { ContextPackCreationModalProps } from '../contextPackCreationTypes';
import type { ContextPackSidebarProps } from '../components/ContextPackSidebar';
import { selectPreferredContextPackDir } from '../selectors/contextPackSidebarModel';
import {
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
  }), [selectedRepoIds, selectedFocusIds]);

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
      setRefreshPending(false);
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
    },
    [catalogResponse],
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

  return {
    contextPackSidebarProps: {
      contextPacks: catalogResponse?.contextPacks ?? [],
      activeContextPackDir: catalogResponse?.activeContextPackDir ?? null,
      selectedContextPackDir,
      selectedRepoIds,
      selectedFocusIds,
      actionPending: refreshPending ? 'refresh' : actionPending,
      message,
      error,
      lastResult,
      lastReseedResult,
      onSelectContextPack: handleSelectContextPack,
      onSelectWorkingFocus: handleSelectWorkingFocus,
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
