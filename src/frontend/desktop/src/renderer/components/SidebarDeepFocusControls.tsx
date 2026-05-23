import { useEffect, useMemo, useRef, useState } from 'react';

import { DeepFocusEditor } from './DeepFocusEditor';
import { DeepFocusInfoTip } from './DeepFocusInfoTip';
import { FocusFiltersIcon } from './FocusFiltersIcon';
import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackListRepoTreeResponse,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';
import type { BreadcrumbItem } from './DeepFocusBreadcrumb';
import { DeepFocusSummary } from './DeepFocusSummary';
import type { VisibleTreeRow } from './DeepFocusTreeCanvas';
import type { TreeRowData } from './DeepFocusTreeRow';
import {
  basename,
  deepFocusTargetForRow,
  formatRelativeTime,
  getAnchorTarget,
  normalizeRelativePath,
  parentPath,
  pathContains,
  primaryIdentityKey,
  validateNestedScopeForUi,
  type EditScopeCursor,
  type ScopedRoleAction,
} from './SidebarDeepFocusUtils';
import { deepFocusStrings } from './SidebarDeepFocusStrings';
import {
  PRIMARY_REMOVE_COMMIT_MS,
  type DeepFocusCommit,
  type DeepFocusDraft,
  type DeepFocusMode,
  type TopLevelTarget,
  type TreeDirectoryListing,
  type UndoEntry,
} from './SidebarDeepFocusControls.types';
import {
  applyRestoreUndo,
  applyScopedRoleAction,
  buildCommit,
  derivePrimaryIds,
  deriveWorkingFocusIdsFromTargets,
  initialScopeCursor,
  normalizePrimaryTargetRoles,
} from './sidebarDeepFocusReducers';
import {
  buildTopLevelTargets,
  buildTreeRows,
  treeExpansionKey,
} from './sidebarDeepFocusSelectors';
import {
  isPrimaryForTopLevel,
  useDeepFocusEditorModel,
  type DeepFocusParentSupportGhostState,
  type DeepFocusSelectedTreeRow,
} from './useDeepFocusEditorModel';
import { useDeepFocusKeyboard } from './useDeepFocusKeyboard';

export type { DeepFocusCommit } from './SidebarDeepFocusControls.types';

type SidebarDeepFocusControlsProps = {
  selectedPack: ContextPackCatalogEntry;
  selectedWorkingFocusIds: string[];
  deepFocusPrimaryId: string | null;
  deepFocusEnabled: boolean;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  onCommitDeepFocusSelection: (selection: DeepFocusCommit) => void;
  onListRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<ContextPackListRepoTreeResponse | null>;
  onManageFocusFilters?: () => void;
  onDeepFocusEditorToggle?: (expanded: boolean) => void;
  editorOpen?: boolean;
  showFocusFilterButton?: boolean;
};

function areTargetsEqual(
  left: ContextPackDeepFocusTarget | null | undefined,
  right: ContextPackDeepFocusTarget | null | undefined,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.path === right.path && left.kind === right.kind;
}

function areTargetListsEqual(
  left: ContextPackDeepFocusTarget[] | undefined,
  right: ContextPackDeepFocusTarget[] | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  return a.every((target, index) => areTargetsEqual(target, b[index]));
}

function arePrimaryTargetsEqual(
  left: ContextPackPrimaryFocusTarget,
  right: ContextPackPrimaryFocusTarget,
): boolean {
  return left.path === right.path
    && left.kind === right.kind
    && (left.repoLocalPath ?? null) === (right.repoLocalPath ?? null)
    && (left.repoId ?? null) === (right.repoId ?? null)
    && (left.focusId ?? null) === (right.focusId ?? null)
    && (left.role ?? null) === (right.role ?? null)
    && areTargetsEqual(left.testTarget, right.testTarget)
    && areTargetListsEqual(left.supportTargets, right.supportTargets);
}

function arePrimaryListsEqual(
  left: ContextPackPrimaryFocusTarget[] | undefined,
  right: ContextPackPrimaryFocusTarget[] | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  return a.every((primary, index) => arePrimaryTargetsEqual(primary, b[index]));
}

function areDeepFocusCommitsEqual(left: DeepFocusCommit, right: DeepFocusCommit): boolean {
  return left.deepFocusEnabled === right.deepFocusEnabled
    && left.deepFocusPrimaryRepoId === right.deepFocusPrimaryRepoId
    && left.deepFocusPrimaryFocusId === right.deepFocusPrimaryFocusId
    && left.selectedFocusPath === right.selectedFocusPath
    && left.selectedFocusTargetKind === right.selectedFocusTargetKind
    && areTargetsEqual(left.selectedTestTarget, right.selectedTestTarget)
    && areTargetListsEqual(left.selectedSupportTargets, right.selectedSupportTargets)
    && arePrimaryListsEqual(left.selectedFocusTargets, right.selectedFocusTargets);
}

const EXPAND_ALL_MAX_DIRECTORIES = 1000;

function SidebarDeepFocusControls({
  selectedPack,
  selectedWorkingFocusIds,
  deepFocusPrimaryId,
  deepFocusEnabled,
  selectedFocusPath,
  selectedFocusTargetKind,
  selectedFocusTargets,
  selectedTestTarget,
  selectedSupportTargets,
  onCommitDeepFocusSelection,
  onListRepoTree,
  onManageFocusFilters,
  onDeepFocusEditorToggle,
  editorOpen = false,
  showFocusFilterButton = true,
}: SidebarDeepFocusControlsProps): JSX.Element {
  const deepFocusMode: DeepFocusMode =
    selectedPack.estateType === 'distributed-platform' ? 'distributed' : 'monolith';
  const topLevelLabel = deepFocusMode === 'distributed' ? 'Repositories' : 'Focus Areas';
  const topLevelTargets = useMemo<TopLevelTarget[]>(
    () => buildTopLevelTargets(selectedPack, deepFocusMode),
    [deepFocusMode, selectedPack.focusTargets],
  );
  const [draft, setDraft] = useState<DeepFocusDraft>({
    selectedWorkingFocusIds: [],
    state: {
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    },
    scopeCursor: { kind: 'global' },
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [directoryListings, setDirectoryListings] = useState<Record<string, TreeDirectoryListing>>({});
  const [expandAllInFlight, setExpandAllInFlight] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [showTreeLoading, setShowTreeLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selectedTreeRow, setSelectedTreeRow] = useState<DeepFocusSelectedTreeRow | null>(null);
  const [parentSupportGhostState, setParentSupportGhostState] = useState<DeepFocusParentSupportGhostState | null>(null);
  const [pendingStripFocusCursor, setPendingStripFocusCursor] = useState<EditScopeCursor | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [exitingPrimaryKey, setExitingPrimaryKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const topLevelKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const expandAllRunIdRef = useRef(0);
  const removalUndoTimerRef = useRef<number | null>(null);
  const removalCommitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (removalUndoTimerRef.current !== null) {
        window.clearTimeout(removalUndoTimerRef.current);
      }
      if (removalCommitTimerRef.current !== null) {
        window.clearTimeout(removalCommitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (removalUndoTimerRef.current !== null) {
      window.clearTimeout(removalUndoTimerRef.current);
      removalUndoTimerRef.current = null;
    }
    if (undoStack.length === 0) {
      return undefined;
    }
    removalUndoTimerRef.current = window.setTimeout(() => {
      setUndoStack([]);
      removalUndoTimerRef.current = null;
    }, 6000);
    return () => {
      if (removalUndoTimerRef.current !== null) {
        window.clearTimeout(removalUndoTimerRef.current);
        removalUndoTimerRef.current = null;
      }
    };
  }, [undoStack.length]);

  useEffect(() => {
    onDeepFocusEditorToggle?.(false);
    expandAllRunIdRef.current += 1;
    setExpandAllInFlight(false);
    setExpanded(new Set());
    setDirectoryListings({});
    setTreeLoading(false);
    setShowTreeLoading(false);
    setFocusedIndex(0);
    setFocusedKey(null);
    setSelectedTreeRow(null);
    setParentSupportGhostState(null);
    setPendingStripFocusCursor(null);
    setSearchQuery('');
    setUndoStack([]);
  }, [selectedPack.contextPackDir]);

  const committedPrimaries = useMemo(
    () => normalizePrimaryTargetRoles(selectedFocusTargets ?? []),
    [selectedFocusTargets],
  );
  const hasCommittedPrimaryScope = selectedFocusPath !== null
    || selectedFocusTargetKind !== null
    || deepFocusPrimaryId !== null
    || committedPrimaries.length > 0;
  const committedPrimaryTopLevelId = deriveWorkingFocusIdsFromTargets(committedPrimaries, deepFocusMode)[0]
    ?? (hasCommittedPrimaryScope ? selectedWorkingFocusIds[0] ?? null : null);
  const committedTopLevel = committedPrimaryTopLevelId
    ? topLevelTargets.find((target) => target.id === committedPrimaryTopLevelId) ?? null
    : null;
  const draftTopLevel = topLevelTargets.find(
    (target) => target.id === (draft.selectedWorkingFocusIds[0] ?? ''),
  ) ?? null;
  const closeEditor = () => {
    onDeepFocusEditorToggle?.(false);
    expandAllRunIdRef.current += 1;
    setExpandAllInFlight(false);
    setExpanded(new Set());
    setDirectoryListings({});
    setTreeLoading(false);
    setShowTreeLoading(false);
    setFocusedIndex(0);
    setFocusedKey(null);
    setSelectedTreeRow(null);
    setParentSupportGhostState(null);
    setPendingStripFocusCursor(null);
    setApplyError(null);
    setSearchQuery('');
    setUndoStack([]);
  };

  const initializeDraft = (): DeepFocusDraft => {
    const hasCommittedPrimaryScope = selectedFocusPath !== null
      || selectedFocusTargetKind !== null
      || deepFocusPrimaryId !== null
      || (selectedFocusTargets ?? []).length > 0;
    const committedTargets = normalizePrimaryTargetRoles(selectedFocusTargets ?? []);
    const nextTopLevelId = deriveWorkingFocusIdsFromTargets(committedTargets, deepFocusMode)[0]
      ?? (hasCommittedPrimaryScope ? selectedWorkingFocusIds[0] ?? null : null);
    const nextTopLevel = topLevelTargets.find((target) => target.id === nextTopLevelId) ?? null;
    const nextPath = selectedFocusPath
      ?? (committedTargets.length > 0 && deepFocusMode === 'monolith' ? nextTopLevel?.rootPath ?? null : null);
    const nextTargets = committedTargets.length > 0
      ? committedTargets.map((target) => ({
        ...target,
        ...(target.repoLocalPath || !nextTopLevel?.repoLocalPath ? {} : { repoLocalPath: nextTopLevel.repoLocalPath }),
        ...(target.repoId || deepFocusMode !== 'distributed' || !nextTopLevel ? {} : { repoId: nextTopLevel.id }),
        ...(target.focusId || deepFocusMode !== 'monolith' || !nextTopLevel ? {} : { focusId: nextTopLevel.id }),
        supportTargets: (target.supportTargets ?? []).map((supportTarget) => ({ ...supportTarget })),
        testTarget: target.testTarget ? { ...target.testTarget } : target.testTarget,
      }))
      : nextPath
        ? [{
          path: nextPath,
          kind: selectedFocusTargetKind ?? 'directory',
          role: 'anchor' as const,
          // Stamp identity + repoLocalPath on the synthetic primary so every
          // primary carries its repoLocalPath and matching manifest identifier.
          ...(nextTopLevel?.repoLocalPath ? { repoLocalPath: nextTopLevel.repoLocalPath } : {}),
          ...(nextTopLevel && deepFocusMode === 'distributed'
            ? { repoId: nextTopLevel.id }
            : {}),
          ...(nextTopLevel && deepFocusMode === 'monolith'
            ? { focusId: nextTopLevel.id }
            : {}),
        }]
        : [];
    return {
      selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(nextTargets, deepFocusMode),
      state: {
        deepFocusEnabled: true,
        ...derivePrimaryIds(nextTargets, deepFocusMode),
        selectedFocusPath: nextPath,
        selectedFocusTargetKind: nextPath
          ? (selectedFocusTargetKind ?? 'directory')
          : null,
        selectedFocusTargets: nextTargets,
        selectedTestTarget:
          selectedTestTarget === undefined
            ? undefined
            : selectedTestTarget
              ? { ...selectedTestTarget }
              : null,
        selectedSupportTargets: selectedSupportTargets.map((target) => ({ ...target })),
      },
      scopeCursor: initialScopeCursor(nextTargets),
    };
  };

  const fetchDirectoryListing = async (
    target: TopLevelTarget,
    nextPath = target.rootPath,
  ): Promise<TreeDirectoryListing | null> => {
    const listingKey = treeExpansionKey(target.id, nextPath);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setTreeLoading(true);
    setShowTreeLoading(false);
    const loadingTimer = window.setTimeout(() => {
      if (requestIdRef.current === requestId) {
        setShowTreeLoading(true);
      }
    }, 80);

    const response = await onListRepoTree(target.repoLocalPath, nextPath || undefined);
    window.clearTimeout(loadingTimer);
    if (requestIdRef.current !== requestId) {
      return null;
    }
    if (!response) {
      setTreeLoading(false);
      setShowTreeLoading(false);
      return null;
    }

    const nextListing: TreeDirectoryListing = {
      topLevelId: target.id,
      topLevelLabel: target.label,
      topLevelPath: target.rootPath,
      repoLocalPath: target.repoLocalPath,
      currentPath: response.currentPath,
      entries: response.entries,
      truncated: response.truncated,
    };
    setDirectoryListings((current) => ({
      ...current,
      [listingKey]: nextListing,
    }));
    setTreeLoading(false);
    setShowTreeLoading(false);
    return nextListing;
  };

  const openEditor = async (preferredCursor?: EditScopeCursor) => {
    deepFocusKeyboard.captureEditEntry();
    const nextDraft = initializeDraft();
    setDraft({
      ...nextDraft,
      scopeCursor: preferredCursor ?? nextDraft.scopeCursor,
    });
    setApplyError(null);
    onDeepFocusEditorToggle?.(true);
    setExpanded(new Set());
    setDirectoryListings({});
    setFocusedIndex(0);
    // `focusedKey` matches against `row.id` (top-level row id, e.g. `tools`),
    // which is the same as the manifest ID stored in `selectedWorkingFocusIds`.
    const focusTopLevel = topLevelTargets.find(
      (target) => target.id === nextDraft.selectedWorkingFocusIds[0],
    );
    setFocusedKey(focusTopLevel?.id ?? topLevelTargets[0]?.id ?? null);
    setSelectedTreeRow(null);
    setParentSupportGhostState(null);
    setPendingStripFocusCursor(null);
  };

  const applyDraft = (): boolean => {
    const draftHasPrimaryScope = draft.state.selectedFocusPath !== null
      || draft.state.selectedFocusTargetKind !== null
      || (draft.state.selectedFocusTargets ?? []).length > 0;
    if (!draftTopLevel && draftHasPrimaryScope) {
      setApplyError('Select a Primary target before applying.');
      return false;
    }
    if (validateNestedScopeForUi(draft.state).length > 0) {
      setApplyError(null);
      return false;
    }
    setApplyError(null);
    setSelectedTreeRow(null);
    setParentSupportGhostState(null);
    setPendingStripFocusCursor(null);
    onCommitDeepFocusSelection(
      buildCommit(true, draft.state, deepFocusMode),
    );
    setUndoStack([]);
    closeEditor();
    return true;
  };

  const handleToggleDeepFocus = () => {
    const committedSnapshot = {
      selectedFocusPath,
      selectedFocusTargetKind,
      selectedFocusTargets: selectedFocusTargets ?? [],
      selectedTestTarget,
      selectedSupportTargets,
    };
    if (deepFocusEnabled) {
      closeEditor();
      // Preserve selections — only flip the enabled flag
      onCommitDeepFocusSelection(buildCommit(false, committedSnapshot, deepFocusMode));
      return;
    }
    onCommitDeepFocusSelection(
      buildCommit(true, committedSnapshot, deepFocusMode),
    );
  };

  const handleToggleExpansion = async () => {
    if (expandAllInFlight) return;
    if (expanded.size > 0) {
      expandAllRunIdRef.current += 1;
      setExpanded(new Set());
      setSelectedTreeRow(null);
      return;
    }
    const runId = expandAllRunIdRef.current + 1;
    expandAllRunIdRef.current = runId;
    setExpandAllInFlight(true);
    try {
      const localListings: Record<string, TreeDirectoryListing> = {};
      const accumulatedKeys = new Set<string>();
      let directoriesProcessed = 0;

      const walk = async (target: TopLevelTarget, path: string): Promise<void> => {
        if (expandAllRunIdRef.current !== runId) return;
        if (directoriesProcessed >= EXPAND_ALL_MAX_DIRECTORIES) return;
        const key = treeExpansionKey(target.id, path);
        if (accumulatedKeys.has(key)) return;
        accumulatedKeys.add(key);
        let listing = directoryListings[key] ?? localListings[key] ?? null;
        if (!listing) {
          const fetched = await fetchDirectoryListing(target, path);
          if (expandAllRunIdRef.current !== runId) return;
          if (!fetched) return;
          listing = fetched;
          localListings[key] = fetched;
          directoriesProcessed += 1;
        }
        for (const entry of listing.entries) {
          if (expandAllRunIdRef.current !== runId) return;
          if (entry.kind === 'directory' && entry.hasChildren) {
            await walk(target, entry.relativePath);
          }
        }
      };

      for (const target of topLevelTargets) {
        if (expandAllRunIdRef.current !== runId) break;
        if (directoriesProcessed >= EXPAND_ALL_MAX_DIRECTORIES) break;
        await walk(target, target.rootPath);
      }
      if (expandAllRunIdRef.current === runId) {
        setExpanded(accumulatedKeys);
      }
    } finally {
      setExpandAllInFlight(false);
    }
  };

  const handleClearAll = () => {
    setApplyError(null);
    setSelectedTreeRow(null);
    setParentSupportGhostState(null);
    setUndoStack([]);
    const clearedState: ContextPackDeepFocusState = {
      ...draft.state,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined as ContextPackDeepFocusTarget | null | undefined,
      selectedSupportTargets: [] as ContextPackDeepFocusTarget[],
    };
    setDraft({
      selectedWorkingFocusIds: [],
      state: clearedState,
      scopeCursor: { kind: 'global' },
    });
    onCommitDeepFocusSelection(buildCommit(draft.state.deepFocusEnabled, clearedState, deepFocusMode));
  };

  const removePrimaryTarget = (target: ContextPackPrimaryFocusTarget) => {
    if (exitingPrimaryKey) {
      return;
    }
    const currentTargets = normalizePrimaryTargetRoles(draft.state.selectedFocusTargets ?? []);
    const targetKey = primaryIdentityKey(target);
    const removeIndex = currentTargets.findIndex((candidate) => primaryIdentityKey(candidate) === targetKey);
    if (removeIndex < 0) {
      return;
    }
    const removedTarget = currentTargets[removeIndex]!;
    setParentSupportGhostState(null);
    const nextTargets = normalizePrimaryTargetRoles(
      currentTargets.filter((_, index) => index !== removeIndex),
    );
    const nextFocusCursor: EditScopeCursor = nextTargets.length > 0
      ? { kind: 'primary', index: Math.min(removeIndex, nextTargets.length - 1) }
      : { kind: 'global' };
    const nextAnchor = getAnchorTarget(nextTargets);
    setApplyError(null);
    setUndoStack((current) => [
      ...current,
      {
        kind: 'primary',
        target: removedTarget,
        index: removeIndex,
        cursor: draft.scopeCursor,
        label: deepFocusStrings.toast.primaryRemoved(basename(removedTarget.path)),
      },
    ]);
    setExitingPrimaryKey(primaryIdentityKey(removedTarget));
    if (removalCommitTimerRef.current !== null) {
      window.clearTimeout(removalCommitTimerRef.current);
    }
    removalCommitTimerRef.current = window.setTimeout(() => {
      setDraft((current) => ({
        ...current,
        // Phase 2: recompute selectedWorkingFocusIds after removal so any repo
        // that lost its last primary is pruned from the working focus list.
        selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(nextTargets, deepFocusMode),
        state: {
          ...current.state,
          selectedFocusPath: nextAnchor ? normalizeRelativePath(nextAnchor.path) || null : null,
          selectedFocusTargetKind: nextAnchor?.kind ?? null,
          selectedFocusTargets: nextTargets,
        },
        scopeCursor: nextFocusCursor,
      }));
      setPendingStripFocusCursor(nextFocusCursor);
      setExitingPrimaryKey(null);
      removalCommitTimerRef.current = null;
    }, PRIMARY_REMOVE_COMMIT_MS);
    setFocusedIndex(0);
    setFocusedKey(nextAnchor ? `${nextAnchor.kind}:${nextAnchor.path}` : null);
  };

  const selectActiveScopeCursor = (cursor: EditScopeCursor) => {
    setParentSupportGhostState(null);
    setDraft((current) => {
      if (cursor.kind === 'primary' && !current.state.selectedFocusTargets?.[cursor.index]) {
        return { ...current, scopeCursor: { kind: 'global' } };
      }
      return { ...current, scopeCursor: cursor };
    });
  };

  const restoreLastUndo = () => {
    const undoEntry = undoStack[undoStack.length - 1];
    if (!undoEntry) return;
    const isPrimaryRemovalInFlight = removalCommitTimerRef.current !== null;
    if (isPrimaryRemovalInFlight) {
      window.clearTimeout(removalCommitTimerRef.current!);
      removalCommitTimerRef.current = null;
      setExitingPrimaryKey(null);
    }
    setDraft((current) => {
      const result = applyRestoreUndo(current, undoEntry, isPrimaryRemovalInFlight, deepFocusMode);
      return result.kind === 'apply' ? result.next : current;
    });
    setUndoStack((current) => current.slice(0, -1));
  };

  const expandPath = async (topLevelId: string, targetPath: string) => {
    const topLevelTarget = topLevelTargets.find((entry) => entry.id === topLevelId);
    if (!topLevelTarget) return;
    const expansionKey = treeExpansionKey(topLevelId, targetPath);
    setExpanded((current) => {
      if (current.has(expansionKey)) return current;
      const next = new Set(current);
      next.add(expansionKey);
      return next;
    });
    if (!directoryListings[expansionKey]) {
      await fetchDirectoryListing(topLevelTarget, targetPath);
    }
  };

  const isParentSupportAction = (
    action: ScopedRoleAction,
    target: ContextPackDeepFocusTarget,
  ): boolean => {
    if (action.type !== 'add-primary-support') return false;
    const primary = draft.state.selectedFocusTargets?.[action.index];
    return primary !== undefined && normalizeRelativePath(target.path) === parentPath(primary.path);
  };

  const handleScopedRoleAction = async (
    action: ScopedRoleAction,
    topLevelId: string,
    target: ContextPackDeepFocusTarget,
  ) => {
    setApplyError(null);
    const nextGhostState = action.type === 'add-primary-support'
      && isParentSupportAction(action, target)
      && target.path.length > 0
      ? { primaryIndex: action.index, parentPath: normalizeRelativePath(target.path) }
      : null;
    const result = applyScopedRoleAction(draft, action, {
      topLevelId,
      target,
      topLevelTargets,
      deepFocusMode,
    });
    setDraft(result.next);
    if (action.type === 'promote-anchor') {
      setPendingStripFocusCursor({ kind: 'primary', index: action.index });
    }
    if (nextGhostState) {
      setParentSupportGhostState(nextGhostState);
      await expandPath(topLevelId, nextGhostState.parentPath);
    } else if (action.type === 'make-primary' || action.type === 'remove-primary') {
      setParentSupportGhostState(null);
    }
    if (result.removePrimaryTarget) {
      const toRemove = result.removePrimaryTarget;
      window.setTimeout(() => removePrimaryTarget(toRemove), 0);
    }
  };

  const currentRows: TreeRowData[] = useMemo(
    () => buildTreeRows(topLevelTargets, expanded, directoryListings),
    [topLevelTargets, expanded, directoryListings],
  );

  const treeTruncated = useMemo(
    () => Object.values(directoryListings).some((listing) => listing.truncated),
    [directoryListings],
  );

  const editorModel = useDeepFocusEditorModel({
    draftState: draft.state,
    scopeCursor: draft.scopeCursor,
    draftTopLevel,
    currentRows,
    expanded,
    selectedRow: selectedTreeRow,
    parentSupportGhostState,
    searchQuery,
    treeLoading,
    showTreeLoading,
    treeTruncated,
    activeTopLevelId: draft.selectedWorkingFocusIds[0] ?? null,
    deepFocusMode,
  });

  const displayRows = editorModel.tree.visibleRows;
  // A row that ends up with no actionable commands has no card to render —
  // clear the selection so we don't leave it visually highlighted with an
  // empty popover. The model recomputes commandList from the current
  // selection, so this fires immediately after a click that yields nothing.
  const selectedCommandCount = editorModel.selectedRow.commandList.length;
  useEffect(() => {
    if (selectedTreeRow && selectedCommandCount === 0) {
      setSelectedTreeRow(null);
    }
  }, [selectedTreeRow, selectedCommandCount]);
  const hasUnappliedChanges = useMemo(() => {
    const draftCommit = buildCommit(true, draft.state, deepFocusMode);
    const committedCommit = buildCommit(
      true,
      {
        selectedFocusPath,
        selectedFocusTargetKind,
        selectedFocusTargets: selectedFocusTargets ?? [],
        selectedTestTarget,
        selectedSupportTargets,
      },
      deepFocusMode,
    );
    return undoStack.length > 0
      || exitingPrimaryKey !== null
      || !areDeepFocusCommitsEqual(draftCommit, committedCommit);
  }, [
    deepFocusMode,
    draft.state,
    exitingPrimaryKey,
    selectedFocusPath,
    selectedFocusTargetKind,
    selectedFocusTargets,
    selectedSupportTargets,
    selectedTestTarget,
    undoStack.length,
  ]);

  const activeExpandedTopLevel = (
    selectedTreeRow
      ? topLevelTargets.find((target) => target.id === selectedTreeRow.row.topLevelId)
      : null
  ) ?? topLevelTargets.find((target) => expanded.has(treeExpansionKey(target.id, target.rootPath))) ?? null;
  const breadcrumbs: BreadcrumbItem[] = activeExpandedTopLevel
    ? [
      { key: 'roots', label: topLevelLabel, action: null },
      { key: `root:${activeExpandedTopLevel.id}`, label: activeExpandedTopLevel.label, action: null },
    ]
    : [{ key: 'roots', label: topLevelLabel, action: null }];
  const hiddenBreadcrumbs = breadcrumbs.length > 4
    ? breadcrumbs.slice(1, -3)
    : [];
  const visibleBreadcrumbs = breadcrumbs.length > 4
    ? [breadcrumbs[0], ...breadcrumbs.slice(-3)]
    : breadcrumbs;

  const collapseHiddenSelection = (collapsedRow: TreeRowData) => {
    setSelectedTreeRow((current) => {
      if (!current || current.row.topLevelId !== collapsedRow.topLevelId) return current;
      const currentPath = normalizeRelativePath(current.row.targetPath);
      const collapsedPath = normalizeRelativePath(collapsedRow.targetPath);
      return pathContains(collapsedPath, currentPath) && current.row.id !== collapsedRow.id
        ? null
        : current;
    });
  };

  const toggleExpansion = async (row: TreeRowData) => {
    if (row.kind !== 'directory' || !row.hasChildren) return;
    const target = topLevelTargets.find((entry) => entry.id === row.topLevelId);
    if (!target) return;
    const expansionKey = treeExpansionKey(row.topLevelId, row.targetPath);
    const wasExpanded = expanded.has(expansionKey);
    setExpanded((current) => {
      const next = new Set(current);
      if (wasExpanded) {
        next.delete(expansionKey);
      } else {
        next.add(expansionKey);
      }
      return next;
    });
    if (wasExpanded) {
      collapseHiddenSelection(row);
      if (parentSupportGhostState?.parentPath === normalizeRelativePath(row.targetPath)) {
        setParentSupportGhostState(null);
      }
      return;
    }
    if (!directoryListings[expansionKey]) {
      await fetchDirectoryListing(target, row.targetPath);
    }
  };

  const toggleExpansionByRowId = async (rowId: string) => {
    const row = currentRows.find((candidate) => candidate.id === rowId);
    if (row) {
      await toggleExpansion(row);
    }
  };

  const activateGhostSupportCandidate = async (visibleRow: VisibleTreeRow) => {
    if (!visibleRow.ghostSupportCandidate) return;
    await handleScopedRoleAction(
      { type: 'add-primary-support', index: visibleRow.ghostSupportCandidate.primaryIndex },
      visibleRow.row.topLevelId,
      {
        path: visibleRow.row.targetPath,
        kind: visibleRow.row.kind,
      },
    );
    setSelectedTreeRow(null);
  };

  const handleRowActivate = async (rowIndex: number) => {
    const visibleRow = displayRows[rowIndex];
    if (!visibleRow) return;
    if (visibleRow.ghostSupportCandidate) {
      await activateGhostSupportCandidate(visibleRow);
      return;
    }
    const { row } = visibleRow;
    setFocusedIndex(rowIndex);
    setFocusedKey(row.id);
    if (row.isTopLevel) {
      topLevelKeyRef.current = row.topLevelId;
    }
    await toggleExpansion(row);
  };

  const handleRowSelect = (row: TreeRowData, rowIndex: number) => {
    setFocusedIndex(rowIndex);
    setFocusedKey(row.id);
    setSelectedTreeRow((current) =>
      current?.row.id === row.id && current.index === rowIndex
        ? null
        : { row, index: rowIndex },
    );
  };

  const getPrimaryTargetForRow = (focusedRow: TreeRowData | null): ContextPackPrimaryFocusTarget | null => {
    if (!focusedRow) {
      return null;
    }
    const rowTarget = deepFocusTargetForRow({
      targetPath: focusedRow.targetPath,
      kind: focusedRow.kind,
      repoLocalPath: focusedRow.repoLocalPath,
      topLevelId: focusedRow.topLevelId,
      deepFocusMode,
    });
    return (draft.state.selectedFocusTargets ?? []).find((target) =>
      isPrimaryForTopLevel(target, rowTarget, focusedRow.topLevelId, deepFocusMode),
    ) ?? null;
  };

  const deepFocusKeyboard = useDeepFocusKeyboard({
    editorOpen,
    rows: displayRows,
    focusedIndex,
    setFocusedIndex,
    setFocusedKey,
    selectedRowId: selectedTreeRow?.row.id ?? null,
    scopeCursor: draft.scopeCursor,
    undoStackLength: undoStack.length,
    searchInputRef,
    onActivateRow: (index) => { void handleRowActivate(index); },
    onApply: applyDraft,
    onCancel: closeEditor,
    onRestoreLastUndo: restoreLastUndo,
    onClearGhostCandidate: () => setParentSupportGhostState(null),
    onClearSelectedRow: () => setSelectedTreeRow(null),
    onResetScopeCursor: () => setDraft((current) => ({ ...current, scopeCursor: { kind: 'global' } })),
    onRemovePrimaryTarget: removePrimaryTarget,
    getPrimaryTargetForRow,
    onRequestScopeFocus: setPendingStripFocusCursor,
  });

  return (
    <>
      <div className="sidebar-section">
        <div
          className={classNames(
            'scope-card',
            'deep-focus-shell',
          )}
          data-testid={editorOpen ? 'deep-focus-editor' : 'deep-focus-summary'}
        >
          <div className="scope-card__header">
            <div className="scope-card__header-top">
              <span className="scope-card__title">Workspace Selection</span>
              {!editorOpen && showFocusFilterButton && onManageFocusFilters ? (
                <button
                  type="button"
                  className="sidebar-icon-btn"
                  aria-label="Manage focus filters"
                  title="Manage focus filters"
                  onClick={onManageFocusFilters}
                >
                  <FocusFiltersIcon />
                </button>
              ) : null}
            </div>
            {editorOpen ? (
              <button
                type="button"
                className="deep-focus-shell__dismiss"
                onClick={deepFocusKeyboard.cancelEditMode}
                aria-label={hasUnappliedChanges ? 'Cancel unapplied changes' : 'Close editor'}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path
                    d="M3 3l6 6M9 3l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ) : (
              <div className="deep-focus-toggle-row">
                <span className="deep-focus-toggle-row__label">Deep Focus Mode</span>
                <DeepFocusInfoTip />
                <button
                  type="button"
                  ref={deepFocusKeyboard.toggleButtonRef}
                  className={classNames('deep-focus-toggle', deepFocusEnabled && 'deep-focus-toggle--active')}
                  aria-label="Toggle Deep Focus"
                  aria-pressed={deepFocusEnabled}
                  onClick={handleToggleDeepFocus}
                >
                  <span className="deep-focus-toggle__knob" />
                </button>
              </div>
            )}
          </div>

          {!editorOpen ? (
            <DeepFocusSummary
              committedTopLevel={committedTopLevel}
              topLevelTargets={topLevelTargets}
              committedPrimaries={committedPrimaries}
              selectedFocusPath={selectedFocusPath}
              selectedFocusTargetKind={selectedFocusTargetKind}
              selectedTestTarget={selectedTestTarget}
              selectedSupportTargets={selectedSupportTargets}
              actionRef={deepFocusKeyboard.summaryActionRef}
              onOpenEditor={(cursor) => { void openEditor(cursor); }}
            />
          ) : (
            <DeepFocusEditor
              model={editorModel}
              breadcrumbs={{ visibleBreadcrumbs, hiddenBreadcrumbs }}
              nav={{
                onClearAll: handleClearAll,
                onExit: deepFocusKeyboard.cancelEditMode,
                onApply: () => {
                  if (applyDraft()) {
                    deepFocusKeyboard.focusAfterApply();
                  }
                },
                hasUnappliedChanges,
                applyDisabled:
                  !draftTopLevel
                  && (
                    draft.state.selectedFocusPath !== null
                    || draft.state.selectedFocusTargetKind !== null
                    || editorModel.primaryTargetCount > 0
                  ),
              }}
              selectedRowActions={{
                onAction: (action) => {
                  if (!selectedTreeRow) return;
                  const commandRowId = selectedTreeRow.row.id;
                  void handleScopedRoleAction(action, selectedTreeRow.row.topLevelId, {
                    path: selectedTreeRow.row.targetPath,
                    kind: selectedTreeRow.row.kind,
                  }).then(() => {
                    deepFocusKeyboard.focusAfterCommand(
                      commandRowId,
                      action.type === 'promote-anchor' ? { kind: 'primary', index: action.index } : undefined,
                    );
                    // Dismiss the inline command card after a successful action.
                    // The user can re-open it by clicking the row again. Keeping
                    // it open after a click is disorienting because the row's
                    // available actions usually change once the action lands
                    // (e.g. "Add as Support" disappears, "Remove" appears).
                    setSelectedTreeRow(null);
                  });
                },
              }}
              search={{
                inputRef: searchInputRef,
                onQueryChange: setSearchQuery,
                onClear: () => { setSearchQuery(''); searchInputRef.current?.focus(); },
              }}
              onToggleExpansion={() => { void handleToggleExpansion(); }}
              expansionMode={expanded.size > 0 ? 'collapse' : 'expand'}
              expansionBusy={expandAllInFlight}
              scopeStrip={{
                primaries: draft.state.selectedFocusTargets ?? [],
                cursor: draft.scopeCursor,
                draftTopLevel,
                exitingPrimaryKey,
                focusRequest: pendingStripFocusCursor,
                onSelectCursor: selectActiveScopeCursor,
                onFocusRequestHandled: () => setPendingStripFocusCursor(null),
              }}
              tree={{
                focusedIndex,
                focusedKey,
                rowRef: deepFocusKeyboard.rowRef,
                onRowFocus: deepFocusKeyboard.focusRow,
                onRowSelect: (selectedRow, index, ghostSupportCandidate) => {
                  deepFocusKeyboard.focusRow(index, selectedRow.id);
                  if (ghostSupportCandidate) {
                    void activateGhostSupportCandidate({ row: selectedRow, originalIndex: index, ghostSupportCandidate });
                    return;
                  }
                  handleRowSelect(selectedRow, index);
                },
                onToggleExpand: (rowId) => { void toggleExpansionByRowId(rowId); },
              }}
              footer={{
                undoStack,
                applyError,
                onRestoreLastUndo: restoreLastUndo,
              }}
              promotion={(() => {
                const resolvePromotionTopLevelId = () =>
                  draftTopLevel?.id
                  ?? draft.state.selectedFocusTargets?.[0]?.repoId
                  ?? draft.state.selectedFocusTargets?.[0]?.focusId
                  ?? '';
                return {
                  onPromoteTest: () => {
                    const target = editorModel.promotion.testTarget;
                    if (!target) return;
                    void handleScopedRoleAction(
                      { type: 'promote-test-to-global' },
                      resolvePromotionTopLevelId(),
                      target,
                    );
                  },
                  onPromoteSupport: (path) => {
                    const target = editorModel.promotion.supportTargets.find(
                      (entry) => entry.path === path,
                    );
                    if (!target) return;
                    void handleScopedRoleAction(
                      { type: 'promote-support-to-global' },
                      resolvePromotionTopLevelId(),
                      target,
                    );
                  },
                };
              })()}
              onEditorKeyDown={deepFocusKeyboard.onEditorKeyDown}
            />
          )}
        </div>
      </div>

      {!editorOpen && selectedPack.lastSyncedAt ? (
        <p
          className="deep-focus-synced-caption"
          title={selectedPack.lastSyncedAt}
          data-testid="context-pack-selection-summary"
        >
          Synced {formatRelativeTime(selectedPack.lastSyncedAt)}
        </p>
      ) : null}
    </>
  );
}

export default SidebarDeepFocusControls;
