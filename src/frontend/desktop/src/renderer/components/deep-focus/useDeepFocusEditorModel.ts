import { useMemo } from 'react';

import type {
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackPrimaryFocusTarget,
} from '../../../shared/desktopContract';
import type { VisibleTreeRow } from './DeepFocusTreeCanvas';
import type { TreeRowData } from './DeepFocusTreeRow';
import {
  actionKey,
  basename,
  computePopoverActions,
  computeRowBadges,
  countSupportFiles,
  deepFocusTargetForRow,
  detectPromotableScope,
  findDeepFocusTargetAssignment,
  findPrimaryContainingRow,
  isSameTarget,
  normalizeRelativePath,
  parentPath,
  type EditScopeCursor,
  type PopoverAction,
  type PromotableScope,
  type ScopedRoleAction,
  type ScopedValidationError,
  validateNestedScopeForUi,
} from './SidebarDeepFocusUtils';
import type { DeepFocusMode, TopLevelTarget } from './SidebarDeepFocusControls.types';
import {
  buildDeepFocusSelectionBuilderViewModel,
  selectSiblingSupportCandidates,
  treeExpansionKey,
  type DeepFocusSelectionBuilderViewModel,
} from './sidebarDeepFocusSelectors';

export type DeepFocusParentSupportGhostState = {
  primaryIndex: number;
  parentPath: string;
};

export type DeepFocusSelectedTreeRow = {
  row: TreeRowData;
  index: number;
};

export type DeepFocusEditorScopeMode = 'global' | 'primary';

export type DeepFocusEditorModelInput = {
  draftState: ContextPackDeepFocusState;
  scopeCursor: EditScopeCursor;
  draftTopLevel: TopLevelTarget | null;
  currentRows: TreeRowData[];
  expanded: Set<string>;
  selectedRow: DeepFocusSelectedTreeRow | null;
  parentSupportGhostState: DeepFocusParentSupportGhostState | null;
  searchQuery: string;
  treeLoading: boolean;
  showTreeLoading: boolean;
  treeTruncated: boolean;
  activeTopLevelId: string | null;
  deepFocusMode: DeepFocusMode;
};

export type DeepFocusEditorModel = {
  scopeMode: DeepFocusEditorScopeMode;
  activeScopeLabel: string;
  primaryTargetCount: number;
  supportFileCount: number;
  testFolderStatusLabel: string;
  tree: {
    visibleRows: VisibleTreeRow[];
    currentRowsLength: number;
    loading: boolean;
    showLoadingRows: boolean;
    empty: boolean;
    emptyStateLabel: string;
    truncated: boolean;
  };
  selectedRow: {
    row: TreeRowData | null;
    id: string | null;
    label: string | null;
    commandList: PopoverAction[];
  };
  search: {
    query: string;
    active: boolean;
  };
  validation: {
    errors: ScopedValidationError[];
    hasFeedback: boolean;
  };
  promotion: PromotableScope;
  selectionBuilder: DeepFocusSelectionBuilderViewModel;
};

function primaryActionLabel(primary: ContextPackPrimaryFocusTarget): string {
  if (primary.path === '' && primary.kind === 'directory' && primary.repoLocalPath) {
    return basename(primary.repoLocalPath);
  }
  return basename(normalizeRelativePath(primary.path));
}

function selectedRowTarget(row: TreeRowData, deepFocusMode: DeepFocusMode): ContextPackDeepFocusTarget {
  return deepFocusTargetForRow(selectedRowBadgeInput(row, deepFocusMode));
}

export function isPrimaryForTopLevel(
  primary: ContextPackPrimaryFocusTarget,
  target: ContextPackDeepFocusTarget,
  topLevelId: string,
  deepFocusMode: DeepFocusMode,
): boolean {
  if (!isSameTarget(primary, target)) return false;
  if (!primary.repoLocalPath && !primary.repoId && !primary.focusId) {
    return true;
  }
  return deepFocusMode === 'distributed'
    ? primary.repoId === topLevelId
    : primary.focusId === topLevelId;
}

function selectedRowBadgeInput(row: TreeRowData, deepFocusMode: DeepFocusMode) {
  return {
    targetPath: row.targetPath,
    kind: row.kind,
    repoLocalPath: row.repoLocalPath,
    systemLayer: row.systemLayer,
    label: row.label,
    isTest: row.isTest,
    artifactType: row.artifactType,
    pathKind: row.pathKind,
    topLevelId: row.topLevelId,
    isTopLevel: row.isTopLevel,
    deepFocusMode,
  };
}

function appendAction(
  targetActions: PopoverAction[],
  seen: Set<string>,
  action: ScopedRoleAction,
  label: string,
  shortLabel?: string,
  options?: { dedupeKey?: string; disabled?: boolean },
): void {
  const key = options?.dedupeKey ?? actionKey(action);
  if (seen.has(key)) return;
  // Label-based dedupe within this bucket — opt-out via explicit dedupeKey
  // so support-scope-choice buttons (which share the "Add as Support" label
  // prefix) remain distinct.
  if (!options?.dedupeKey && targetActions.some((entry) => entry.label === label)) return;
  seen.add(key);
  targetActions.push({ action, label, shortLabel, disabled: options?.disabled });
}

function buildCommandStripActions(
  row: TreeRowData,
  draftState: ContextPackDeepFocusState,
  scopeCursor: EditScopeCursor,
  deepFocusMode: DeepFocusMode,
): PopoverAction[] {
  const primaries = draftState.selectedFocusTargets ?? [];
  const canChoosePerPrimaryScopedRole = primaries.length >= 2;
  const rowInput = selectedRowBadgeInput(row, deepFocusMode);
  const rowTarget = selectedRowTarget(row, deepFocusMode);
  const activePrimaryIndex = scopeCursor.kind === 'primary'
    && primaries[scopeCursor.index]
    ? scopeCursor.index
    : null;
  // The cursor at the top of the editor is the source of truth for which
  // scope's actions appear. Per-primary cursor → only that primary's options.
  // Global cursor → only "all primaries" options.
  const allSourceActions = computePopoverActions(rowInput, draftState, scopeCursor);
  const assignedTarget = findDeepFocusTargetAssignment(draftState, rowTarget);
  const seen = new Set<string>();
  const parentActions: PopoverAction[] = [];
  const primaryActions: PopoverAction[] = [];
  const scopedActions: PopoverAction[] = [];
  const globalActions: PopoverAction[] = [];
  const destructiveActions: PopoverAction[] = [];
  const rowPath = normalizeRelativePath(row.targetPath);

  if (assignedTarget) {
    const destructiveActions: PopoverAction[] = [];
    allSourceActions.forEach(({ action }) => {
      if (action.type === 'remove-primary') {
        const targetPrimary = primaries[action.index];
        const primaryName = targetPrimary ? primaryActionLabel(targetPrimary) : null;
        const visibleLabel = primaryName ? `Remove ${primaryName} as Primary` : 'Remove as Primary';
        appendAction(destructiveActions, seen, action, visibleLabel, visibleLabel);
        return;
      }
      if (action.type === 'remove-primary-member') {
        appendAction(destructiveActions, seen, action, 'Remove from Primary', 'Remove');
        return;
      }
      if (action.type === 'remove-global') {
        appendAction(destructiveActions, seen, action, 'Remove');
      }
    });
    return destructiveActions;
  }

  // Where does the row currently sit in the support buckets? Drives "Add as
  // Support · …" vs "Move to …" labels and lets us hide the button for the
  // scope the row already belongs to.
  const isCurrentlyGlobalSupport = draftState.selectedSupportTargets.some(
    (target) => isSameTarget(target, rowTarget),
  );
  const primariesContainingAsSupport = new Set(
    primaries
      .map((primary, index) =>
        (primary.supportTargets ?? []).some((supportTarget) =>
          isSameTarget(supportTarget, rowTarget),
        )
          ? index
          : -1,
      )
      .filter((index) => index >= 0),
  );

  // A row that is itself a primary cannot be a support target of any primary
  // (it would either be a self-loop or nested primaries), so suppress the
  // parent-shortcut even if the row's path happens to be the parent of the
  // cursor's primary — that combination already implies an invalid state.
  const rowIsItselfPrimary = primaries.some((primary) => isSameTarget(primary, rowTarget));
  const parentPrimaryIndex = activePrimaryIndex !== null
    && rowPath.length > 0
    && !rowIsItselfPrimary
    && parentPath(primaries[activePrimaryIndex]!.path) === rowPath
    ? activePrimaryIndex
    : -1;
  if (parentPrimaryIndex >= 0 && canChoosePerPrimaryScopedRole) {
    const parentPrimaryName = primaryActionLabel(primaries[parentPrimaryIndex]!);
    const movingFromGlobal = isCurrentlyGlobalSupport;
    appendAction(
      parentActions,
      seen,
      { type: 'add-primary-support', index: parentPrimaryIndex },
      movingFromGlobal
        ? `Move to ${parentPrimaryName}`
        : `Add as Support · Just for ${parentPrimaryName}`,
      movingFromGlobal ? `Move to ${parentPrimaryName}` : `Support · Just for ${parentPrimaryName}`,
      { dedupeKey: `support-primary-${parentPrimaryIndex}` },
    );
  }

  allSourceActions.forEach(({ action }) => {
    if (action.type === 'make-primary') {
      appendAction(primaryActions, seen, action, 'Add Primary Target', 'Primary');
    }
  });

  allSourceActions.forEach(({ action }) => {
    if (action.type === 'set-primary-test') {
      if (!canChoosePerPrimaryScopedRole) return;
      const primary = primaries[action.index];
      if (primary) {
        const primaryName = primaryActionLabel(primary);
        appendAction(
          scopedActions,
          seen,
          action,
          `Use as Test for ${primaryName}`,
          `Test for ${primaryName}`,
        );
      }
      return;
    }
    if (action.type === 'add-primary-support') {
      if (!canChoosePerPrimaryScopedRole) return;
      const primary = primaries[action.index];
      if (!primary) return;
      // Hide the button for the scope the row already belongs to.
      if (primariesContainingAsSupport.has(action.index)) return;
      const primaryName = primaryActionLabel(primary);
      const movingFromGlobal = isCurrentlyGlobalSupport;
      appendAction(
        scopedActions,
        seen,
        action,
        movingFromGlobal
          ? `Move to ${primaryName}`
          : `Add as Support · Just for ${primaryName}`,
        movingFromGlobal ? `Move to ${primaryName}` : `Support · Just for ${primaryName}`,
        { dedupeKey: `support-primary-${action.index}` },
      );
    }
  });

  let globalSupportEmitted = false;
  allSourceActions.forEach(({ action }) => {
    if (action.type === 'set-global-test') {
      appendAction(
        globalActions,
        seen,
        action,
        'Use as Test for all primaries',
        'Test for all primaries',
      );
      return;
    }
    if (action.type === 'add-global-support') {
      if (isCurrentlyGlobalSupport) return;
      const movingFromPerPrimary = primariesContainingAsSupport.size > 0;
      appendAction(
        globalActions,
        seen,
        action,
        movingFromPerPrimary
          ? 'Move to all primaries'
          : 'Add as Support · For all primaries',
        movingFromPerPrimary ? 'Move to all primaries' : 'Support · For all primaries',
        { dedupeKey: 'support-global' },
      );
      globalSupportEmitted = true;
    }
  });

  // Synthesize a disabled "For all primaries" button when the row sits inside
  // a primary's writable area: `computePopoverActions` filters out
  // `add-global-support` in that case, but the cluster stays visible with an
  // explanatory tooltip so the scope choice remains discoverable.
  // Only relevant when the cursor is on the global scope — under a primary
  // cursor the global cluster is intentionally hidden.
  if (
    scopeCursor.kind === 'global'
    && !globalSupportEmitted
    && !isCurrentlyGlobalSupport
    && primariesContainingAsSupport.size === 0
  ) {
    const containingPrimaryIndex = findPrimaryContainingRow(draftState, {
      ...row,
      deepFocusMode,
    });
    if (containingPrimaryIndex >= 0) {
      const containingPrimaryName = primaryActionLabel(primaries[containingPrimaryIndex]!);
      appendAction(
        globalActions,
        seen,
        { type: 'add-global-support' },
        `Already inside ${containingPrimaryName}`,
        'Support · For all primaries',
        { dedupeKey: 'support-global', disabled: true },
      );
    }
  }

  allSourceActions.forEach(({ action }) => {
    if (action.type === 'remove-primary') {
      // Surface the primary's name in the visible pill text — without it the
      // user can't tell *which* primary clicking the pill clears. That is the
      // whole point of the action (e.g. "clear the parent so a child can take
      // its place"), so the visible label and aria-label both name it.
      const targetPrimary = primaries[action.index];
      const primaryName = targetPrimary ? primaryActionLabel(targetPrimary) : null;
      const visibleLabel = primaryName ? `Remove ${primaryName} as Primary` : 'Remove as Primary';
      appendAction(destructiveActions, seen, action, visibleLabel, visibleLabel);
      return;
    }
    if (action.type === 'remove-primary-member') {
      appendAction(destructiveActions, seen, action, 'Remove from Primary', 'Remove');
      return;
    }
    if (action.type === 'remove-global') {
      appendAction(destructiveActions, seen, action, 'Remove');
    }
  });

  const orderedActions = [
    ...parentActions,
    ...primaryActions,
    ...scopedActions,
    ...globalActions,
    ...destructiveActions,
  ];
  // Safety-net dedupe: scope-specific labels make collisions unlikely, but
  // collapse any duplicates that slip through bucket emission.
  const seenLabels = new Set<string>();
  return orderedActions.filter((entry) => {
    if (seenLabels.has(entry.label)) return false;
    seenLabels.add(entry.label);
    return true;
  });
}

function supportContextPrimaryLabel(
  row: TreeRowData,
  draftState: ContextPackDeepFocusState,
  deepFocusMode: DeepFocusMode,
): string | null {
  const rowTarget = selectedRowTarget(row, deepFocusMode);
  const primary = draftState.selectedFocusTargets?.find((candidate) =>
    (candidate.supportTargets ?? []).some((supportTarget) =>
      isSameTarget(supportTarget, rowTarget)));
  if (primary) return primaryActionLabel(primary);
  const isGlobalSupport = draftState.selectedSupportTargets.some((supportTarget) =>
    isSameTarget(supportTarget, rowTarget));
  return isGlobalSupport ? 'all primaries' : null;
}

function buildVisibleRows(input: DeepFocusEditorModelInput): VisibleTreeRow[] {
  const query = input.searchQuery.trim().toLowerCase();
  const baseRows = query
    ? input.currentRows.reduce<VisibleTreeRow[]>((acc, row, index) => {
      if (row.label.toLowerCase().includes(query) || row.displayPath.toLowerCase().includes(query)) {
        acc.push({ row, originalIndex: index });
      }
      return acc;
    }, [])
    : input.currentRows.map((row, index) => ({ row, originalIndex: index }));

  const rowsWithGhosts = addGhostSupportRows(baseRows, input);

  return rowsWithGhosts.map((entry) => {
    if (entry.ghostSupportCandidate) {
      return {
        ...entry,
        badges: [],
        expanded: false,
        isSupportContextParent: false,
      };
    }

    const supportPrimaryLabel = supportContextPrimaryLabel(entry.row, input.draftState, input.deepFocusMode);
    return {
      ...entry,
      badges: computeRowBadges(
        selectedRowBadgeInput(entry.row, input.deepFocusMode),
        input.draftState,
        input.scopeCursor,
      ),
      expanded: input.expanded.has(treeExpansionKey(entry.row.topLevelId, entry.row.targetPath)),
      isSupportContextParent: supportPrimaryLabel !== null,
      ...(supportPrimaryLabel ? { supportContextPrimaryLabel: supportPrimaryLabel } : {}),
    };
  });
}

function addGhostSupportRows(
  rows: VisibleTreeRow[],
  input: DeepFocusEditorModelInput,
): VisibleTreeRow[] {
  if (input.searchQuery.trim()) return rows;
  if (!input.parentSupportGhostState) return rows;

  const primary = input.draftState.selectedFocusTargets?.[input.parentSupportGhostState.primaryIndex];
  if (!primary) return rows;
  const expectedParentTarget: ContextPackDeepFocusTarget = {
    path: input.parentSupportGhostState.parentPath,
    kind: 'directory',
    ...(primary.repoLocalPath ? { repoLocalPath: primary.repoLocalPath } : {}),
    ...(primary.repoId ? { repoId: primary.repoId } : {}),
    ...(primary.focusId ? { focusId: primary.focusId } : {}),
  };

  const parentIndex = rows.findIndex(({ row }) =>
    normalizeRelativePath(row.targetPath) === input.parentSupportGhostState?.parentPath
    && isSameTarget(
      deepFocusTargetForRow(selectedRowBadgeInput(row, input.deepFocusMode)),
      expectedParentTarget,
    ));
  if (parentIndex < 0) return rows;

  const parentRow = rows[parentIndex]!.row;
  const siblingCandidates = selectSiblingSupportCandidates(
    input.draftState,
    parentRow,
    input.deepFocusMode,
    input.currentRows,
  );
  const ghostRows = siblingCandidates.map<VisibleTreeRow>((candidate, index) => ({
    row: {
      ...candidate,
      id: `ghost:${input.parentSupportGhostState!.primaryIndex}:${candidate.id}`,
      hasChildren: false,
      depth: parentRow.depth + 1,
    },
    originalIndex: input.currentRows.length + index,
    ghostSupportCandidate: {
      primaryIndex: input.parentSupportGhostState!.primaryIndex,
      candidateLabel: candidate.label,
      primaryLabel: primaryActionLabel(primary),
    },
  }));

  return [
    ...rows.slice(0, parentIndex + 1),
    ...ghostRows,
    ...rows.slice(parentIndex + 1),
  ];
}

function supportFileCount(state: ContextPackDeepFocusState): number {
  return countSupportFiles(
    state.selectedFocusTargets ?? [],
    state.selectedSupportTargets ?? [],
  );
}

function testFolderStatusLabel(state: ContextPackDeepFocusState): string {
  const scopedTestCount = (state.selectedFocusTargets ?? []).filter((primary) => primary.testTarget).length;
  if (state.selectedTestTarget) {
    return `Test Target: ${basename(state.selectedTestTarget.path)}`;
  }
  if (scopedTestCount === 1) {
    return 'Test Target: 1 scoped';
  }
  if (scopedTestCount > 1) {
    return `Test Target: ${scopedTestCount} scoped`;
  }
  return 'Test Target: none';
}

function activeScopeLabel(
  scopeCursor: EditScopeCursor,
  primaries: ContextPackPrimaryFocusTarget[],
): string {
  if (scopeCursor.kind === 'global') return 'Active scope: Global';
  const primary = primaries[scopeCursor.index];
  return `Active scope: ${primary ? primaryActionLabel(primary) : 'Primary'}`;
}

export function deriveDeepFocusEditorModel(input: DeepFocusEditorModelInput): DeepFocusEditorModel {
  const primaries = input.draftState.selectedFocusTargets ?? [];
  const visibleRows = buildVisibleRows(input);
  const validationErrors = validateNestedScopeForUi(input.draftState);
  const commandList = input.selectedRow
    ? buildCommandStripActions(
      input.selectedRow.row,
      input.draftState,
      input.scopeCursor,
      input.deepFocusMode,
    )
    : [];

  return {
    scopeMode: input.scopeCursor.kind === 'primary' && primaries[input.scopeCursor.index]
      ? 'primary'
      : 'global',
    activeScopeLabel: activeScopeLabel(input.scopeCursor, primaries),
    primaryTargetCount: primaries.length,
    supportFileCount: supportFileCount(input.draftState),
    testFolderStatusLabel: testFolderStatusLabel(input.draftState),
    tree: {
      visibleRows,
      currentRowsLength: input.currentRows.length,
      loading: input.treeLoading,
      showLoadingRows: input.showTreeLoading,
      empty: visibleRows.length === 0,
      emptyStateLabel: input.searchQuery ? 'No matching files or folders' : 'No items',
      truncated: input.treeTruncated,
    },
    selectedRow: {
      row: input.selectedRow?.row ?? null,
      id: input.selectedRow?.row.id ?? null,
      label: input.selectedRow?.row.label ?? null,
      commandList,
    },
    search: {
      query: input.searchQuery,
      active: input.searchQuery.length > 0,
    },
    validation: {
      errors: validationErrors,
      hasFeedback: validationErrors.length > 0,
    },
    promotion: detectPromotableScope(input.draftState),
    selectionBuilder: buildDeepFocusSelectionBuilderViewModel({
      draftState: input.draftState,
      draftTopLevel: input.draftTopLevel,
    }),
  };
}

export function useDeepFocusEditorModel(input: DeepFocusEditorModelInput): DeepFocusEditorModel {
  return useMemo(
    () => deriveDeepFocusEditorModel(input),
    [
      input.activeTopLevelId,
      input.currentRows,
      input.deepFocusMode,
      input.draftState,
      input.draftTopLevel,
      input.expanded,
      input.parentSupportGhostState,
      input.scopeCursor,
      input.searchQuery,
      input.selectedRow,
      input.showTreeLoading,
      input.treeLoading,
      input.treeTruncated,
    ],
  );
}
