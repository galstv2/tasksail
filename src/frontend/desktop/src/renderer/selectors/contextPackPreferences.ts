import type {
  ContextPackCatalogEntry,
  WorkspaceScopeMode,
} from '../../shared/desktopContract';

export function selectPreferredScopeMode(): WorkspaceScopeMode {
  return 'focused';
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
