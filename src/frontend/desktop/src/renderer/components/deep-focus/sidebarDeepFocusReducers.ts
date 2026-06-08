import type {
  ContextPackDeepFocusTarget,
  ContextPackPrimaryFocusTarget,
} from '../../../shared/desktopContract';
import {
  basename,
  findDeepFocusTargetAssignment,
  getAnchorTarget,
  isDirectoryAncestorTarget,
  isSameTarget,
  normalizeRelativePath,
  primaryIdentityKey,
  type EditScopeCursor,
  type ScopedRoleAction,
  type SlotField,
} from './SidebarDeepFocusUtils';
import { deepFocusStrings } from './SidebarDeepFocusStrings';
import type {
  ContextPackDeepFocusState,
} from '../../../shared/desktopContract';
import type {
  DeepFocusCommit,
  DeepFocusDraft,
  DeepFocusMode,
  TopLevelTarget,
  UndoEntry,
} from './SidebarDeepFocusControls.types';

export function initialScopeCursor(targets: ContextPackPrimaryFocusTarget[]): EditScopeCursor {
  if (targets.length === 0) {
    return { kind: 'global' };
  }
  const anchorIndex = targets.findIndex((target) => target.role === 'anchor');
  return { kind: 'primary', index: anchorIndex >= 0 ? anchorIndex : 0 };
}

/**
 * Derive `selectedWorkingFocusIds` from a list of primary focus targets.
 *
 * Returns the unique set of manifest identifiers present on the targets, with
 * the persisted source primary first, then other identifiers in insertion
 * order. The identifier source depends on `deepFocusMode`:
 *   - distributed: `target.repoId`
 *   - monolith: `target.focusId`
 *
 * Targets missing the relevant identifier (legacy state, not yet hydrated) are
 * skipped — the hydration shim is responsible for stamping them before this
 * helper runs against persisted state.
 *
 * `selectedWorkingFocusIds` holds manifest IDs (e.g. `tools`), not
 * `repoLocalPath` strings. Callsites that look up a `TopLevelTarget` from
 * `selectedWorkingFocusIds[0]` must compare against `target.id`.
 */
export function deriveWorkingFocusIdsFromTargets(
  targets: ContextPackPrimaryFocusTarget[],
  deepFocusMode: DeepFocusMode,
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const idOf = (target: ContextPackPrimaryFocusTarget): string | undefined =>
    deepFocusMode === 'distributed' ? target.repoId : target.focusId;
  const anchor = targets.find((t) => t.role === 'anchor');
  const anchorId = anchor ? idOf(anchor) : undefined;
  if (anchorId) {
    ordered.push(anchorId);
    seen.add(anchorId);
  }
  for (const target of targets) {
    const id = idOf(target);
    if (!id || seen.has(id)) continue;
    ordered.push(id);
    seen.add(id);
  }
  return ordered;
}

export function normalizePrimaryTargetRoles(
  targets: ContextPackPrimaryFocusTarget[],
): ContextPackPrimaryFocusTarget[] {
  if (targets.length === 0) {
    return [];
  }
  const explicitAnchorIndex = targets.findIndex((target) => target.role === 'anchor');
  const anchorIndex = explicitAnchorIndex >= 0 ? explicitAnchorIndex : 0;
  return targets.map((target, index) => ({
    ...target,
    role: index === anchorIndex ? 'anchor' : 'primary',
  }));
}

function isSamePrimaryIdentity(
  left: Pick<ContextPackPrimaryFocusTarget, 'path' | 'kind' | 'repoLocalPath' | 'repoId' | 'focusId'>,
  right: Pick<ContextPackPrimaryFocusTarget, 'path' | 'kind' | 'repoLocalPath' | 'repoId' | 'focusId'>,
): boolean {
  return primaryIdentityKey(left) === primaryIdentityKey(right);
}

function lacksPrimaryIdentity(target: ContextPackPrimaryFocusTarget): boolean {
  return !target.repoLocalPath && !target.repoId && !target.focusId;
}

function isMakePrimaryMatch(
  candidate: ContextPackPrimaryFocusTarget,
  target: ContextPackDeepFocusTarget,
  topLevelTarget: TopLevelTarget | undefined,
  baseTargets: ContextPackPrimaryFocusTarget[],
  deepFocusMode: DeepFocusMode,
): boolean {
  if (!isSameTarget(candidate, target)) return false;
  const legacyFallback = baseTargets.length <= 1 && lacksPrimaryIdentity(candidate);
  if (deepFocusMode === 'distributed') {
    return (topLevelTarget !== undefined && candidate.repoId === topLevelTarget.id) || legacyFallback;
  }
  if (deepFocusMode === 'monolith') {
    return (topLevelTarget !== undefined && candidate.focusId === topLevelTarget.id) || legacyFallback;
  }
  return legacyFallback;
}

function primaryBelongsToTopLevel(
  primary: ContextPackPrimaryFocusTarget,
  topLevelTarget: TopLevelTarget | undefined,
  deepFocusMode: DeepFocusMode,
): boolean {
  if (!primary.repoLocalPath && !primary.repoId && !primary.focusId) {
    return true;
  }
  if (!topLevelTarget) {
    return false;
  }
  return deepFocusMode === 'distributed'
    ? primary.repoId === topLevelTarget.id
    : primary.focusId === topLevelTarget.id;
}

function primaryContainsTarget(
  primary: ContextPackPrimaryFocusTarget,
  target: ContextPackDeepFocusTarget,
  topLevelTarget: TopLevelTarget | undefined,
  deepFocusMode: DeepFocusMode,
): boolean {
  return primaryBelongsToTopLevel(primary, topLevelTarget, deepFocusMode)
    && isDirectoryAncestorTarget(primary, target);
}

function attachTopLevelIdentity(
  target: ContextPackDeepFocusTarget,
  topLevelTarget: TopLevelTarget | undefined,
  deepFocusMode: DeepFocusMode,
): ContextPackDeepFocusTarget {
  return {
    ...target,
    path: normalizeRelativePath(target.path),
    ...(topLevelTarget?.repoLocalPath ? { repoLocalPath: topLevelTarget.repoLocalPath } : {}),
    ...(deepFocusMode === 'distributed' && topLevelTarget ? { repoId: topLevelTarget.id } : {}),
    ...(deepFocusMode === 'monolith' && topLevelTarget ? { focusId: topLevelTarget.id } : {}),
  };
}

export type ScopedRoleActionContext = {
  topLevelId: string;
  target: ContextPackDeepFocusTarget;
  topLevelTargets: TopLevelTarget[];
  deepFocusMode: DeepFocusMode;
};

export type ScopedRoleActionResult = {
  next: DeepFocusDraft;
  /**
   * Side effect intent. The `remove-primary` action does not mutate the draft
   * directly (the in-flight removal animation owns that); it asks the caller
   * to invoke the component-level `removePrimaryTarget` callback. Caller is
   * responsible for scheduling the side effect.
   */
  removePrimaryTarget?: ContextPackPrimaryFocusTarget;
};

export function applyScopedRoleAction(
  current: DeepFocusDraft,
  action: ScopedRoleAction,
  ctx: ScopedRoleActionContext,
): ScopedRoleActionResult {
  const { topLevelId, target: rawTarget, topLevelTargets, deepFocusMode } = ctx;
  const topLevelTarget = topLevelTargets.find((candidate) => candidate.id === topLevelId);
  const target = attachTopLevelIdentity(rawTarget, topLevelTarget, deepFocusMode);

  if (action.type === 'make-primary') {
    const normalizedTarget = {
      ...target,
      path: normalizeRelativePath(target.path),
    };
    const existingAssignment = findDeepFocusTargetAssignment(current.state, normalizedTarget);
    if (existingAssignment && existingAssignment.slot !== 'primary') {
      return { next: current };
    }
    // Multi-repo accumulation: never wipe existing primaries when the
    // user makes a primary in a different top-level. Cross-repo selection is
    // additive; the validator handles overlap rules per-repo.
    const currentTargets = normalizePrimaryTargetRoles(
      current.state.selectedFocusTargets ?? [],
    );
    const currentAnchor = currentTargets.find((candidate) => candidate.role === 'anchor');
    const currentAnchorPath = currentAnchor ? normalizeRelativePath(currentAnchor.path) : null;
    const isImplicitMonolithRootAnchor = deepFocusMode === 'monolith'
      && currentTargets.length === 1
      && currentAnchor !== undefined
      && currentAnchorPath === normalizeRelativePath(topLevelTarget?.rootPath ?? '')
      && currentAnchorPath === normalizeRelativePath(current.state.selectedFocusPath ?? '');
    const baseTargets = isImplicitMonolithRootAnchor ? [] : currentTargets;
    const containingPrimaryIndex = baseTargets.findIndex((candidate) =>
      primaryContainsTarget(candidate, normalizedTarget, topLevelTarget, deepFocusMode));
    if (containingPrimaryIndex >= 0) {
      return {
        next: {
          ...current,
          scopeCursor: { kind: 'primary', index: containingPrimaryIndex },
        },
      };
    }
    const existingIndex = baseTargets.findIndex((candidate) =>
      isMakePrimaryMatch(candidate, normalizedTarget, topLevelTarget, baseTargets, deepFocusMode));
    const pruneCoveredByNewDirectory = (candidates: ContextPackPrimaryFocusTarget[]) =>
      normalizedTarget.kind === 'directory'
        ? candidates
          .filter((candidate) =>
            !primaryBelongsToTopLevel(candidate, topLevelTarget, deepFocusMode)
            || !isDirectoryAncestorTarget(normalizedTarget, candidate))
          .map((candidate) => primaryBelongsToTopLevel(candidate, topLevelTarget, deepFocusMode)
            ? {
              ...candidate,
              supportTargets: (candidate.supportTargets ?? []).filter(
                (supportTarget) => !isDirectoryAncestorTarget(normalizedTarget, supportTarget),
              ),
            }
            : candidate)
        : candidates;
    const prunedBaseTargets = pruneCoveredByNewDirectory(baseTargets);
    const nextFocusTargets = existingIndex >= 0
      ? prunedBaseTargets.map((candidate, index) => ({
        ...candidate,
        role: index === prunedBaseTargets.findIndex((pruned) =>
          isMakePrimaryMatch(pruned, normalizedTarget, topLevelTarget, prunedBaseTargets, deepFocusMode))
          ? 'anchor' as const
          : 'primary' as const,
      }))
      : normalizePrimaryTargetRoles([
        ...prunedBaseTargets,
        {
          ...normalizedTarget,
          role: baseTargets.length > 0 ? 'primary' as const : 'anchor' as const,
          // Stamp both `repoLocalPath` (for filesystem-bound
          // consumers like resolver/confinement) AND the matching identity
          // field (for scalar derivation and cross-mount stability).
          // `TopLevelTarget.id` is the manifest ID — `repoId` in distributed
          // mode, `focusId` in monolith mode.
          repoLocalPath: topLevelTarget?.repoLocalPath,
          ...(deepFocusMode === 'distributed' && topLevelTarget
            ? { repoId: topLevelTarget.id }
            : {}),
          ...(deepFocusMode === 'monolith' && topLevelTarget
            ? { focusId: topLevelTarget.id }
           : {}),
         },
       ]);
    const anchor = nextFocusTargets.find((candidate) => candidate.role === 'anchor') ?? nextFocusTargets[0]!;
    const cursorIndex = existingIndex >= 0
      ? existingIndex
      : nextFocusTargets.findIndex((candidate) => isMakePrimaryMatch(
        candidate,
        normalizedTarget,
        topLevelTarget,
        nextFocusTargets,
        deepFocusMode,
      ));
    return {
      next: {
        selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(nextFocusTargets, deepFocusMode),
        state: {
          ...current.state,
          deepFocusEnabled: true,
          selectedFocusPath: normalizeRelativePath(anchor.path) || null,
          selectedFocusTargetKind: anchor.kind,
          selectedFocusTargets: nextFocusTargets,
          selectedTestTarget: current.state.selectedTestTarget,
          selectedSupportTargets: normalizedTarget.kind === 'directory'
            ? current.state.selectedSupportTargets.filter(
              (supportTarget) => !isDirectoryAncestorTarget(normalizedTarget, supportTarget),
            )
            : current.state.selectedSupportTargets,
        },
        scopeCursor: { kind: 'primary', index: Math.max(0, cursorIndex) },
      },
    };
  }

  if (action.type === 'promote-anchor') {
    const nextFocusTargets = normalizePrimaryTargetRoles(
      (current.state.selectedFocusTargets ?? []).map((candidate, index) => ({
        ...candidate,
        role: index === action.index ? 'anchor' as const : 'primary' as const,
      })),
    );
    const anchor = getAnchorTarget(nextFocusTargets);
    return {
      next: {
        ...current,
        selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(nextFocusTargets, deepFocusMode),
        state: {
          ...current.state,
          selectedFocusPath: anchor ? normalizeRelativePath(anchor.path) || null : null,
          selectedFocusTargetKind: anchor?.kind ?? null,
          selectedFocusTargets: nextFocusTargets,
        },
        scopeCursor: { kind: 'primary', index: action.index },
      },
    };
  }

  if (action.type === 'remove-primary') {
    const targetToRemove = (current.state.selectedFocusTargets ?? [])[action.index];
    return {
      next: current,
      removePrimaryTarget: targetToRemove,
    };
  }

  if (action.type === 'set-global-test') {
    if (findDeepFocusTargetAssignment(current.state, target)) {
      return { next: current };
    }
    return {
      next: {
        ...current,
        state: {
          ...current.state,
          selectedTestTarget: target,
          selectedSupportTargets: current.state.selectedSupportTargets.filter(
            (candidate) => !isSameTarget(candidate, target),
          ),
        },
        scopeCursor: { kind: 'global' },
      },
    };
  }

  if (action.type === 'add-global-support') {
    if (findDeepFocusTargetAssignment(current.state, target)) {
      return { next: current };
    }
    const supportCoveredByPrimary = (current.state.selectedFocusTargets ?? []).some((primary) =>
      primaryContainsTarget(primary, target, topLevelTarget, deepFocusMode));
    if (supportCoveredByPrimary) {
      return { next: current };
    }
    return {
      next: {
        ...current,
        state: {
          ...current.state,
          selectedSupportTargets: [...current.state.selectedSupportTargets, target],
        },
        scopeCursor: { kind: 'global' },
      },
    };
  }

  if (action.type === 'remove-global') {
    return {
      next: {
        ...current,
        state: {
          ...current.state,
          selectedTestTarget: isSameTarget(current.state.selectedTestTarget, target)
            ? undefined
            : current.state.selectedTestTarget,
          selectedSupportTargets: current.state.selectedSupportTargets.filter(
            (candidate) => !isSameTarget(candidate, target),
          ),
        },
        scopeCursor: { kind: 'global' },
      },
    };
  }

  if (action.type === 'set-primary-test') {
    if (findDeepFocusTargetAssignment(current.state, target)) {
      return { next: current };
    }
    return patchPrimaryAt(current, action.index, deepFocusMode, (candidate) => ({
      ...candidate,
      testTarget: target,
      supportTargets: (candidate.supportTargets ?? []).filter(
        (supportTarget) => !isSameTarget(supportTarget, target),
      ),
    }));
  }

  if (action.type === 'add-primary-support') {
    if (findDeepFocusTargetAssignment(current.state, target)) {
      return { next: current };
    }
    const supportCoveredByPrimary = (current.state.selectedFocusTargets ?? []).some((primary) =>
      primaryContainsTarget(primary, target, topLevelTarget, deepFocusMode));
    if (supportCoveredByPrimary) {
      return { next: current };
    }
    return patchPrimaryAt(current, action.index, deepFocusMode, (candidate) => {
      const supports = candidate.supportTargets ?? [];
      // "Newest narrower wins": if any existing support strictly contains the
      // new target, drop it so the narrower carve-out replaces the broader
      // one. This is the ghost-flow semantic: clicking a sibling after
      // adding the parent narrows support to just that sibling. Keeps state
      // valid against the `scoped-support-redundant-under-support` rule
      // without forcing the user to manually clear the parent first.
      const filteredSupports = supports.filter((existing) =>
        !isDirectoryAncestorTarget(existing, target));
      return {
        ...candidate,
        testTarget: isSameTarget(candidate.testTarget, target) ? undefined : candidate.testTarget,
        supportTargets: filteredSupports.some((supportTarget) => isSameTarget(supportTarget, target))
          ? filteredSupports
          : [...filteredSupports, target],
      };
    });
  }

  if (action.type === 'remove-primary-member') {
    return patchPrimaryAt(current, action.index, deepFocusMode, (candidate) => ({
      ...candidate,
      testTarget: isSameTarget(candidate.testTarget, target) ? undefined : candidate.testTarget,
      supportTargets: (candidate.supportTargets ?? []).filter(
        (supportTarget) => !isSameTarget(supportTarget, target),
      ),
    }));
  }

  if (action.type === 'promote-test-to-global') {
    return { next: current };
  }

  if (action.type === 'promote-support-to-global') {
    return { next: current };
  }

  return { next: current };
}

function patchPrimaryAt(
  current: DeepFocusDraft,
  index: number,
  deepFocusMode: DeepFocusMode,
  patch: (candidate: ContextPackPrimaryFocusTarget) => ContextPackPrimaryFocusTarget,
): ScopedRoleActionResult {
  const nextFocusTargets = (current.state.selectedFocusTargets ?? []).map(
    (candidate, i) => (i === index ? patch(candidate) : candidate),
  );
  return {
    next: {
      ...current,
      selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(nextFocusTargets, deepFocusMode),
      state: { ...current.state, selectedFocusTargets: nextFocusTargets },
      scopeCursor: { kind: 'primary', index },
    },
  };
}

export type RemoveSlotInput = {
  current: DeepFocusDraft;
  cursor: EditScopeCursor;
  field: SlotField;
  supportIndex?: number;
};

export type RemoveSlotResult = {
  next: DeepFocusDraft;
  /**
   * Only populated when removing a primary-scoped slot. Global removals are
   * not tracked in the undo stack (matches existing behavior).
   */
  undoEntry?: UndoEntry;
};

export function applyRemoveSlot(input: RemoveSlotInput): RemoveSlotResult {
  const { current, cursor, field, supportIndex } = input;

  if (cursor.kind === 'global') {
    if (field === 'testTarget') {
      const removedTarget = current.state.selectedTestTarget ?? null;
      if (!removedTarget) return { next: current };
      return {
        next: {
          ...current,
          state: { ...current.state, selectedTestTarget: undefined },
          scopeCursor: cursor,
        },
      };
    }
    const removedTarget = current.state.selectedSupportTargets[supportIndex ?? -1] ?? null;
    if (!removedTarget) return { next: current };
    return {
      next: {
        ...current,
        state: {
          ...current.state,
          selectedSupportTargets: current.state.selectedSupportTargets.filter(
            (_, index) => index !== supportIndex,
          ),
        },
        scopeCursor: cursor,
      },
    };
  }

  const primary = current.state.selectedFocusTargets?.[cursor.index];
  if (!primary) return { next: current };
  const removedTarget: ContextPackDeepFocusTarget | null = field === 'testTarget'
    ? primary.testTarget ?? null
    : primary.supportTargets?.[supportIndex ?? -1] ?? null;
  if (!removedTarget) return { next: current };

  const label = field === 'testTarget'
    ? deepFocusStrings.toast.testRemoved(basename(removedTarget.path))
    : deepFocusStrings.toast.supportRemoved(basename(removedTarget.path));
  const nextTargets = (current.state.selectedFocusTargets ?? []).map((candidate, index) => {
    if (index !== cursor.index) return candidate;
    return {
      ...candidate,
      testTarget: field === 'testTarget' ? undefined : candidate.testTarget,
      supportTargets: field === 'supportTargets'
        ? (candidate.supportTargets ?? []).filter((_, idx) => idx !== supportIndex)
        : candidate.supportTargets,
    };
  });
  return {
    next: {
      ...current,
      state: { ...current.state, selectedFocusTargets: nextTargets },
      scopeCursor: cursor,
    },
    undoEntry: { kind: 'slot', cursor, field, supportIndex, target: removedTarget, label },
  };
}

/**
 * Derive scalar `deepFocusPrimaryRepoId` / `deepFocusPrimaryFocusId` from the
 * persisted source primary of a multi-repo primary set. Additional primaries
 * are surfaced through `selectedFocusTargets`.
 */
export function derivePrimaryIds(
  targets: ContextPackPrimaryFocusTarget[],
  deepFocusMode: DeepFocusMode,
): { deepFocusPrimaryRepoId: string | null; deepFocusPrimaryFocusId: string | null } {
  // Scalars hold manifest IDs (repoId/focusId), NOT repoLocalPath.
  // This is what enables hydration to resolve scalars through the manifest after
  // a workspace remount where filesystem paths may have changed.
  const anchor = targets.find((t) => t.role === 'anchor');
  return {
    deepFocusPrimaryRepoId:
      deepFocusMode === 'distributed' ? anchor?.repoId ?? null : null,
    deepFocusPrimaryFocusId:
      deepFocusMode === 'monolith' ? anchor?.focusId ?? null : null,
  };
}

export function buildCommit(
  enabled: boolean,
  state: Pick<
    ContextPackDeepFocusState,
    'selectedFocusPath'
    | 'selectedFocusTargetKind'
    | 'selectedFocusTargets'
    | 'selectedTestTarget'
    | 'selectedSupportTargets'
  >,
  deepFocusMode: DeepFocusMode,
): DeepFocusCommit {
  const normalizedTargets = normalizePrimaryTargetRoles(state.selectedFocusTargets ?? []);
  const hasPrimaryScope = normalizedTargets.length > 0
    || state.selectedFocusPath !== null
    || state.selectedFocusTargetKind !== null;
  const anchor = getAnchorTarget(normalizedTargets);
  const singlePrimary = normalizedTargets.length === 1 ? normalizedTargets[0] : null;
  return {
    deepFocusEnabled: enabled,
    ...derivePrimaryIds(hasPrimaryScope ? normalizedTargets : [], deepFocusMode),
    selectedFocusPath: anchor
      ? normalizeRelativePath(anchor.path) || null
      : hasPrimaryScope ? state.selectedFocusPath : null,
    selectedFocusTargetKind: anchor?.kind ?? (hasPrimaryScope ? state.selectedFocusTargetKind : null),
    selectedFocusTargets: normalizedTargets.map((target) => ({
      ...target,
      testTarget: target.testTarget ? { ...target.testTarget } : target.testTarget,
      supportTargets: (target.supportTargets ?? []).map((supportTarget) => ({ ...supportTarget })),
    })),
    selectedTestTarget: singlePrimary?.testTarget ?? state.selectedTestTarget,
    selectedSupportTargets: singlePrimary?.supportTargets?.length
      ? singlePrimary.supportTargets.map((supportTarget) => ({ ...supportTarget }))
      : state.selectedSupportTargets,
  };
}

export function applyPromotePrimary(
  current: DeepFocusDraft,
  target: ContextPackPrimaryFocusTarget,
  deepFocusMode: DeepFocusMode,
): DeepFocusDraft | null {
  const currentTargets = current.state.selectedFocusTargets ?? [];
  if (!currentTargets.some((candidate) => isSamePrimaryIdentity(candidate, target))) {
    return null;
  }
  const nextTargets = currentTargets.map((candidate) => ({
    ...candidate,
    role: isSamePrimaryIdentity(candidate, target) ? 'anchor' as const : 'primary' as const,
  }));
  return {
    ...current,
    selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(nextTargets, deepFocusMode),
    state: {
      ...current.state,
      selectedFocusPath: normalizeRelativePath(target.path) || null,
      selectedFocusTargetKind: target.kind,
      selectedFocusTargets: nextTargets,
    },
    scopeCursor: {
      kind: 'primary',
      index: nextTargets.findIndex((candidate) => isSamePrimaryIdentity(candidate, target)),
    },
  };
}

export type RestoreUndoResult =
  /** A primary removal animation is in flight; cancel it without applying state. */
  | { kind: 'inflight-cancellation' }
  /** Primary undo target already present (e.g. duplicate); pop stack only. */
  | { kind: 'noop' }
  /** Apply the restored draft. */
  | { kind: 'apply'; next: DeepFocusDraft };

export function applyRestoreUndo(
  current: DeepFocusDraft,
  undoEntry: UndoEntry,
  isPrimaryRemovalInFlight: boolean,
  deepFocusMode: DeepFocusMode,
): RestoreUndoResult {
  if (isPrimaryRemovalInFlight) {
    return { kind: 'inflight-cancellation' };
  }

  if (undoEntry.kind === 'slot') {
    if (undoEntry.cursor.kind === 'global') {
      return {
        kind: 'apply',
        next: {
          ...current,
          selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(
            current.state.selectedFocusTargets ?? [],
            deepFocusMode,
          ),
          state: {
            ...current.state,
            selectedTestTarget: undoEntry.field === 'testTarget'
              ? undoEntry.target
              : current.state.selectedTestTarget,
            selectedSupportTargets: undoEntry.field === 'supportTargets'
              ? [
                ...current.state.selectedSupportTargets.slice(
                  0,
                  undoEntry.supportIndex ?? current.state.selectedSupportTargets.length,
                ),
                undoEntry.target,
                ...current.state.selectedSupportTargets.slice(
                  undoEntry.supportIndex ?? current.state.selectedSupportTargets.length,
                ),
              ]
              : current.state.selectedSupportTargets,
          },
          scopeCursor: undoEntry.cursor,
        },
      };
    }
    const primaryCursor = undoEntry.cursor;
    const nextTargets = (current.state.selectedFocusTargets ?? []).map((target, index) => {
      if (index !== primaryCursor.index) return target;
      const supports = target.supportTargets ?? [];
      return {
        ...target,
        testTarget: undoEntry.field === 'testTarget' ? undoEntry.target : target.testTarget,
        supportTargets: undoEntry.field === 'supportTargets'
          ? [
            ...supports.slice(0, undoEntry.supportIndex ?? supports.length),
            undoEntry.target,
            ...supports.slice(undoEntry.supportIndex ?? supports.length),
          ]
          : target.supportTargets,
      };
    });
    return {
      kind: 'apply',
        next: {
          ...current,
          selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(nextTargets, deepFocusMode),
          state: { ...current.state, selectedFocusTargets: nextTargets },
          scopeCursor: undoEntry.cursor,
      },
    };
  }

  // primary undo
  const existingTargets = current.state.selectedFocusTargets ?? [];
  if (existingTargets.some((target) => isSamePrimaryIdentity(target, undoEntry.target))) {
    return { kind: 'noop' };
  }
  const wasAnchor = undoEntry.target.role === 'anchor';
  const insertionIndex = Math.min(undoEntry.index, existingTargets.length);
  const restoredTarget: ContextPackPrimaryFocusTarget = {
    ...undoEntry.target,
    role: wasAnchor ? 'anchor' : undoEntry.target.role,
  };
  const nextTargets = [
    ...existingTargets.slice(0, insertionIndex),
    restoredTarget,
    ...existingTargets.slice(insertionIndex),
  ].map((target) => ({
    ...target,
    role: wasAnchor && !isSamePrimaryIdentity(target, restoredTarget)
      ? 'primary' as const
      : target.role,
  }));
  const normalizedTargets = normalizePrimaryTargetRoles(nextTargets);
  const nextAnchor = getAnchorTarget(normalizedTargets);
  return {
    kind: 'apply',
    next: {
      ...current,
      selectedWorkingFocusIds: deriveWorkingFocusIdsFromTargets(normalizedTargets, deepFocusMode),
      state: {
        ...current.state,
        selectedFocusPath: nextAnchor ? normalizeRelativePath(nextAnchor.path) || null : null,
        selectedFocusTargetKind: nextAnchor?.kind ?? null,
        selectedFocusTargets: normalizedTargets,
      },
      scopeCursor: undoEntry.cursor,
    },
  };
}
