import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  WorkspaceScopeMode,
} from '../../shared/desktopContract';

export const EMPTY_CONTEXT_PACK_DEEP_FOCUS_STATE: ContextPackDeepFocusState = {
  deepFocusEnabled: false,
  deepFocusPrimaryRepoId: null,
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedTestTarget: undefined,
  selectedSupportTargets: [],
};

export function selectPreferredScopeMode(): WorkspaceScopeMode {
  return 'focused';
}

function isTargetEqual(
  left: ContextPackDeepFocusTarget | null | undefined,
  right: ContextPackDeepFocusTarget | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.path === right.path && left.kind === right.kind;
}

function areTargetListsEqual(
  left: readonly ContextPackDeepFocusTarget[],
  right: readonly ContextPackDeepFocusTarget[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((target, index) => isTargetEqual(target, right[index]));
}

export function isDeepFocusStateEqual(
  left: ContextPackDeepFocusState | null | undefined,
  right: ContextPackDeepFocusState | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.deepFocusEnabled === right.deepFocusEnabled
    && left.deepFocusPrimaryRepoId === right.deepFocusPrimaryRepoId
    && left.deepFocusPrimaryFocusId === right.deepFocusPrimaryFocusId
    && left.selectedFocusPath === right.selectedFocusPath
    && left.selectedFocusTargetKind === right.selectedFocusTargetKind
    && isTargetEqual(left.selectedTestTarget, right.selectedTestTarget)
    && areTargetListsEqual(left.selectedSupportTargets, right.selectedSupportTargets)
  );
}

function cloneDeepFocusTarget(
  target: ContextPackDeepFocusTarget | null | undefined,
): ContextPackDeepFocusTarget | null | undefined {
  if (target === undefined) {
    return undefined;
  }
  return target ? { ...target } : null;
}

function cloneDeepFocusState(
  state: ContextPackDeepFocusState,
): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: state.deepFocusEnabled,
    deepFocusPrimaryRepoId: state.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: state.deepFocusPrimaryFocusId,
    selectedFocusPath: state.selectedFocusPath,
    selectedFocusTargetKind: state.selectedFocusTargetKind,
    selectedTestTarget: cloneDeepFocusTarget(state.selectedTestTarget),
    selectedSupportTargets: state.selectedSupportTargets.map((target) => ({ ...target })),
  };
}

export function selectLastAppliedDeepFocusState(
  contextPack: ContextPackCatalogEntry | undefined,
): ContextPackDeepFocusState {
  if (!contextPack) {
    return cloneDeepFocusState(EMPTY_CONTEXT_PACK_DEEP_FOCUS_STATE);
  }

  // Always restore selections regardless of whether deep focus is currently
  // enabled — the operator may have toggled it off temporarily and expects
  // selections to survive across sessions.
  const hasSelections =
    contextPack.lastAppliedSelectedFocusPath != null
    || contextPack.lastAppliedSelectedTestTarget != null
    || (contextPack.lastAppliedSelectedSupportTargets ?? []).length > 0
    || contextPack.lastAppliedDeepFocusPrimaryRepoId != null
    || contextPack.lastAppliedDeepFocusPrimaryFocusId != null;

  if (!hasSelections && contextPack.lastAppliedDeepFocusEnabled !== true) {
    return cloneDeepFocusState(EMPTY_CONTEXT_PACK_DEEP_FOCUS_STATE);
  }

  return {
    deepFocusEnabled: contextPack.lastAppliedDeepFocusEnabled === true,
    deepFocusPrimaryRepoId: contextPack.lastAppliedDeepFocusPrimaryRepoId ?? null,
    deepFocusPrimaryFocusId: contextPack.lastAppliedDeepFocusPrimaryFocusId ?? null,
    selectedFocusPath: contextPack.lastAppliedSelectedFocusPath ?? null,
    selectedFocusTargetKind: contextPack.lastAppliedSelectedFocusTargetKind ?? null,
    selectedTestTarget: cloneDeepFocusTarget(
      Object.prototype.hasOwnProperty.call(contextPack, 'lastAppliedSelectedTestTarget')
        ? contextPack.lastAppliedSelectedTestTarget
        : undefined,
    ),
    selectedSupportTargets: (contextPack.lastAppliedSelectedSupportTargets ?? []).map((target) => ({ ...target })),
  };
}

export function selectPreferredDeepFocusState(
  contextPack: ContextPackCatalogEntry | undefined,
  candidates: Array<ContextPackDeepFocusState | null | undefined>,
): ContextPackDeepFocusState {
  for (const candidate of candidates) {
    if (candidate) {
      return cloneDeepFocusState(candidate);
    }
  }
  return selectLastAppliedDeepFocusState(contextPack);
}

export function selectPreferredWorkingRepoIds(
  contextPack: ContextPackCatalogEntry | undefined,
  candidates: Array<readonly string[] | null | undefined>,
): string[] {
  if (
    !contextPack ||
    contextPack.estateType !== 'distributed-platform' ||
    contextPack.focusTargets.length === 0
  ) {
    return [];
  }

  const knownRepoIds = new Set(
    contextPack.focusTargets
      .map((target) => target.repoId)
      .filter((repoId): repoId is string => repoId !== null),
  );
  for (const candidate of candidates) {
    const nextRepoIds = (candidate ?? []).filter(
      (repoId): repoId is string => knownRepoIds.has(repoId),
    );
    if (nextRepoIds.length > 0) {
      return nextRepoIds;
    }
  }

  for (const repoId of contextPack.primaryWorkingRepoIds) {
    if (knownRepoIds.has(repoId)) {
      return [repoId];
    }
  }

  return contextPack.focusTargets[0]
    && contextPack.focusTargets[0].repoId
    ? [contextPack.focusTargets[0].repoId]
    : [];
}

export function selectPreferredWorkingFocusIds(
  contextPack: ContextPackCatalogEntry | undefined,
  candidates: Array<readonly string[] | null | undefined>,
): string[] {
  if (
    !contextPack ||
    contextPack.estateType === 'distributed-platform' ||
    contextPack.focusTargets.length === 0
  ) {
    return [];
  }

  const knownFocusIds = new Set(
    contextPack.focusTargets.map((target) => target.focusId),
  );
  for (const candidate of candidates) {
    const nextFocusIds = (candidate ?? []).filter(
      (focusId): focusId is string => knownFocusIds.has(focusId),
    );
    if (nextFocusIds.length > 0) {
      return nextFocusIds;
    }
  }

  const defaultFocusable = contextPack.focusTargets.filter(
    (target) => target.defaultFocusable,
  );
  if (defaultFocusable.length > 0) {
    return defaultFocusable.map((target) => target.focusId);
  }

  return contextPack.focusTargets[0]
    ? [contextPack.focusTargets[0].focusId]
    : [];
}

export function orderKnownFocusIds(
  contextPack: ContextPackCatalogEntry | undefined,
  nextIds: readonly string[],
): string[] {
  if (!contextPack) {
    return [...nextIds];
  }

  const knownFocusOrder = new Map(
    contextPack.focusTargets.map((target, index) => [target.focusId, index] as const),
  );
  return [...nextIds]
    .filter((focusId) => knownFocusOrder.has(focusId))
    .sort((left, right) => {
      return (knownFocusOrder.get(left) ?? 0) - (knownFocusOrder.get(right) ?? 0);
    });
}

export function toggleFocusSelection(
  contextPack: ContextPackCatalogEntry | undefined,
  currentIds: readonly string[],
  focusId: string,
): string[] {
  const nextIds = currentIds.includes(focusId)
    ? currentIds.filter((item) => item !== focusId)
    : [...currentIds, focusId];
  return orderKnownFocusIds(contextPack, nextIds);
}
