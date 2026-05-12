import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusDerivedRoot,
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import { deepFocusStrings } from './SidebarDeepFocusStrings';

export type EditScopeCursor =
  | { kind: 'global' }
  | { kind: 'primary'; index: number };

export type TreeRowBadge =
  | { kind: 'primary'; label: 'P'; ariaLabel: 'Primary target' }
  | { kind: 'test'; label: 'T'; ariaLabel: 'Scoped test target' }
  | { kind: 'support'; label: 'S'; ariaLabel: 'Scoped support target' };

export type ScopedRoleAction =
  | { type: 'make-primary' }
  | { type: 'promote-anchor'; index: number }
  | { type: 'remove-primary'; index: number }
  | { type: 'set-global-test' }
  | { type: 'add-global-support' }
  | { type: 'remove-global' }
  | { type: 'set-primary-test'; index: number }
  | { type: 'add-primary-support'; index: number }
  | { type: 'remove-primary-member'; index: number }
  | { type: 'promote-test-to-global' }
  | { type: 'promote-support-to-global' };

export type PopoverAction = {
  action: ScopedRoleAction;
  label: string;
  // Optional terse noun used as the visible button text in the inline-commands
  // strip. The full `label` is used for accessibility and tests.
  shortLabel?: string;
  disabled?: boolean;
};

export function actionKey(action: ScopedRoleAction): string {
  return `${action.type}:${'index' in action ? action.index : 'global'}`;
}

export type SlotField = 'testTarget' | 'supportTargets';

export type ScopedValidationError = {
  scope: EditScopeCursor;
  field: SlotField;
  index?: number;
  reason:
    | 'scoped-test-equals-self'
    | 'scoped-test-equals-other-primary'
    | 'scoped-test-ancestor-of-primary'
    | 'scoped-support-equals-self'
    | 'scoped-support-equals-primary-test'
    | 'scoped-support-equals-other-primary'
    | 'scoped-support-inside-own-primary-writable'
    | 'scoped-support-redundant-under-test'
    | 'scoped-support-redundant-under-support'
    | 'primary-target-inside-primary-writable'
    | 'global-support-inside-primary-writable'
    | 'global-support-redundant-under-global-test'
    | 'global-support-redundant-under-global-support'
    | 'cross-primary-support-overlaps-writable'
    | 'support-duplicated-across-scopes'
    | 'scoped-fields-on-repo-root-primary';
  conflictsWith?: {
    scope: EditScopeCursor;
    field: SlotField;
    index?: number;
  };
};

type BadgeRow = {
  targetPath: string;
  kind: ContextPackFocusTargetKind;
  systemLayer?: string | null;
  label?: string;
  topLevelId?: string;
  isTopLevel?: boolean;
  activeTopLevelId?: string | null;
};

const TEST_DIR_NAME_PATTERN = /^(__)?(tests?|specs?|e2e)(__)?$|[.\-_](tests?|specs?|e2e)$/i;

/**
 * Returns true when a row should be treated as a test-classified directory.
 * Mirrors the visual `--test-layer` rule in DeepFocusTreeRow so the
 * gate and the styling stay in lockstep.
 */
export function isTestClassifiedRow(row: {
  kind: ContextPackFocusTargetKind;
  systemLayer?: string | null;
  label?: string;
}): boolean {
  if (row.kind !== 'directory') return false;
  if (row.systemLayer === 'test') return true;
  return row.label != null && TEST_DIR_NAME_PATTERN.test(row.label);
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const startOfLocalDayUtc = (d: Date): number =>
  Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

export function formatRecentsTimestamp(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const dayDiff = Math.floor((startOfLocalDayUtc(now) - startOfLocalDayUtc(date)) / 86_400_000);
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff >= 2 && dayDiff <= 6) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function normalizeRelativePath(path: string | null | undefined): string {
  return path ?? '';
}

export function primaryIdentityKey(
  target: Pick<ContextPackPrimaryFocusTarget, 'path' | 'kind' | 'repoLocalPath' | 'repoId' | 'focusId'>,
): string {
  return JSON.stringify([
    target.repoLocalPath ?? '',
    target.repoId ?? '',
    target.focusId ?? '',
    normalizeRelativePath(target.path),
    target.kind,
  ]);
}

function cloneDeepFocusTarget(
  target: ContextPackDeepFocusTarget | null | undefined,
): ContextPackDeepFocusTarget | null | undefined {
  if (target === undefined) {
    return undefined;
  }
  return target ? { ...target } : null;
}

function clonePrimaryFocusTarget(
  target: ContextPackPrimaryFocusTarget,
): ContextPackPrimaryFocusTarget {
  return {
    ...target,
    testTarget: cloneDeepFocusTarget(target.testTarget),
    supportTargets: (target.supportTargets ?? []).map((supportTarget) => ({ ...supportTarget })),
  };
}

function cloneDerivedRoot(
  target: ContextPackDeepFocusDerivedRoot,
): ContextPackDeepFocusDerivedRoot {
  return {
    ...target,
    sourceTargets: (target.sourceTargets ?? []).map(clonePrimaryFocusTarget),
  };
}

function cloneDeepFocusState(state: ContextPackDeepFocusState): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: state.deepFocusEnabled,
    deepFocusPrimaryRepoId: state.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: state.deepFocusPrimaryFocusId,
    selectedFocusPath: state.selectedFocusPath,
    selectedFocusTargetKind: state.selectedFocusTargetKind,
    selectedFocusTargets: (state.selectedFocusTargets ?? []).map(clonePrimaryFocusTarget),
    selectedTestTarget: cloneDeepFocusTarget(state.selectedTestTarget),
    selectedSupportTargets: state.selectedSupportTargets.map((target) => ({ ...target })),
    derivedWritableRoots: (state.derivedWritableRoots ?? []).map(cloneDerivedRoot),
    derivedReadonlyContextRoots: (state.derivedReadonlyContextRoots ?? []).map(cloneDerivedRoot),
  };
}

function hasDistributedIdentity(target: ContextPackPrimaryFocusTarget): boolean {
  return Boolean(target.repoLocalPath && target.repoId);
}

function hasMonolithIdentity(target: ContextPackPrimaryFocusTarget): boolean {
  return Boolean(target.repoLocalPath && target.focusId);
}

function warnDiscardedLegacyPrimaries(reason: string): void {
  console.warn('[deep-focus] discarded malformed legacy primaries:', reason);
}

export function hydrateLegacyPrimaries(options: {
  state: ContextPackDeepFocusState;
  catalogEntry: ContextPackCatalogEntry | undefined;
}): ContextPackDeepFocusState {
  const primaries = options.state.selectedFocusTargets ?? [];
  if (primaries.length === 0) {
    return cloneDeepFocusState(options.state);
  }

  if (
    options.state.deepFocusPrimaryRepoId
    && primaries.every(hasDistributedIdentity)
  ) {
    return cloneDeepFocusState(options.state);
  }

  if (
    options.state.deepFocusPrimaryFocusId
    && primaries.every(hasMonolithIdentity)
  ) {
    return cloneDeepFocusState(options.state);
  }

  if (options.state.deepFocusPrimaryRepoId) {
    const resolvedTarget = options.catalogEntry?.focusTargets.find(
      (target) =>
        target.repoId === options.state.deepFocusPrimaryRepoId
        && Boolean(target.repoLocalPath),
    );
    if (resolvedTarget?.repoId && resolvedTarget.repoLocalPath) {
      return {
        ...cloneDeepFocusState(options.state),
        selectedFocusTargets: primaries.map((target) =>
          hasDistributedIdentity(target)
            ? clonePrimaryFocusTarget(target)
            : {
                ...clonePrimaryFocusTarget(target),
                repoLocalPath: resolvedTarget.repoLocalPath ?? undefined,
                repoId: resolvedTarget.repoId ?? undefined,
              },
        ),
      };
    }
  }

  if (options.state.deepFocusPrimaryFocusId) {
    const resolvedTarget = options.catalogEntry?.focusTargets.find(
      (target) =>
        target.focusId === options.state.deepFocusPrimaryFocusId
        && Boolean(target.repoLocalPath),
    );
    if (resolvedTarget?.focusId && resolvedTarget.repoLocalPath) {
      return {
        ...cloneDeepFocusState(options.state),
        selectedFocusTargets: primaries.map((target) =>
          hasMonolithIdentity(target)
            ? clonePrimaryFocusTarget(target)
            : {
                ...clonePrimaryFocusTarget(target),
                repoLocalPath: resolvedTarget.repoLocalPath ?? undefined,
                focusId: resolvedTarget.focusId,
              },
        ),
      };
    }
  }

  warnDiscardedLegacyPrimaries(
    options.state.deepFocusPrimaryRepoId
      ? `repo id ${options.state.deepFocusPrimaryRepoId} did not resolve to a catalog focus target`
      : options.state.deepFocusPrimaryFocusId
        ? `focus id ${options.state.deepFocusPrimaryFocusId} did not resolve to a catalog focus target`
        : 'legacy primaries were missing a resolvable primary scalar',
  );
  return {
    ...cloneDeepFocusState(options.state),
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusTargets: [],
  };
}

/**
 * Enforce the support-scope mutual-exclusion invariant on persisted state
 * loaded from disk (spec §5.3). A path P found in both `selectedSupportTargets`
 * (globals) and any `primary.supportTargets` is removed from globals — the
 * per-primary placement is the more specific declaration and is preserved.
 *
 * Cross-primary sharing (same path in two distinct primaries) is intentional
 * and out of scope for this invariant; we leave it untouched.
 *
 * Returns the same state reference when no migration is needed so downstream
 * equality checks can skip re-renders.
 */
export function migrateSupportScopes(
  state: ContextPackDeepFocusState,
): ContextPackDeepFocusState {
  const primaries = state.selectedFocusTargets ?? [];
  const globals = state.selectedSupportTargets ?? [];
  if (primaries.length === 0 || globals.length === 0) {
    return state;
  }

  const filteredGlobals = globals.filter(
    (target) =>
      !primaries.some((primary) =>
        (primary.supportTargets ?? []).some((supportTarget) =>
          isSameTarget(supportTarget, target),
        ),
      ),
  );
  const removedCount = globals.length - filteredGlobals.length;
  if (removedCount === 0) {
    return state;
  }

  console.warn(
    `[deep-focus] removed ${removedCount} duplicated support ${
      removedCount === 1 ? 'path' : 'paths'
    } from globals (already present in per-primary scope)`,
  );

  return { ...state, selectedSupportTargets: filteredGlobals };
}

export function basename(path: string): string {
  if (!path) return 'Repo root';
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function parentPath(path: string): string {
  const normalized = normalizeRelativePath(path);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : '';
}

export function getAnchorTarget(
  targets: ContextPackPrimaryFocusTarget[],
): ContextPackPrimaryFocusTarget | undefined {
  return targets.find((target) => target.role === 'anchor') ?? targets[0];
}

export function isSameTarget(
  left: ContextPackDeepFocusTarget | null | undefined,
  right: ContextPackDeepFocusTarget | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.path === right.path && left.kind === right.kind;
}

export function countSupportFiles(
  primaries: ContextPackPrimaryFocusTarget[],
  selectedSupportTargets: ContextPackDeepFocusTarget[],
): number {
  const merged = [
    ...selectedSupportTargets,
    ...primaries.flatMap((primary) => primary.supportTargets ?? []),
  ];
  return merged.filter(
    (target, index) => merged.findIndex((candidate) => isSameTarget(candidate, target)) === index,
  ).length;
}

export function isCursorEqual(left: EditScopeCursor, right: EditScopeCursor): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'global') return true;
  return right.kind === 'primary' && left.index === right.index;
}

export function actionTone(action: ScopedRoleAction): 'primary' | 'destructive' | 'default' {
  if (
    action.type === 'remove-global'
    || action.type === 'remove-primary'
    || action.type === 'remove-primary-member'
  ) {
    return 'destructive';
  }
  if (action.type === 'make-primary' || action.type === 'promote-anchor') {
    return 'primary';
  }
  return 'default';
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target.isContentEditable;
}

function isSameRowTarget(
  target: ContextPackDeepFocusTarget | null | undefined,
  rowTarget: ContextPackDeepFocusTarget,
  row: BadgeRow,
): boolean {
  if (!isSameTarget(target, rowTarget)) return false;
  if (
    row.isTopLevel
    && rowTarget.path === ''
    && rowTarget.kind === 'directory'
    && row.activeTopLevelId
  ) {
    return row.topLevelId === row.activeTopLevelId;
  }
  return true;
}

function isSamePrimaryRowTarget(
  target: ContextPackPrimaryFocusTarget | null | undefined,
  rowTarget: ContextPackDeepFocusTarget,
  row: BadgeRow,
): boolean {
  if (!isSameTarget(target, rowTarget)) return false;
  if (!target?.repoLocalPath && !target?.repoId && !target?.focusId) {
    return true;
  }
  if (!row.topLevelId) {
    return true;
  }
  return target.repoId === row.topLevelId || target.focusId === row.topLevelId;
}

export function pathContains(parentPath: string, childPath: string): boolean {
  if (!parentPath) {
    return childPath.length > 0;
  }
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

function isStrictAncestorPath(candidatePath: string, childPath: string): boolean {
  const normalizedCandidate = normalizeRelativePath(candidatePath);
  const normalizedChild = normalizeRelativePath(childPath);
  return normalizedCandidate !== normalizedChild && pathContains(normalizedCandidate, normalizedChild);
}

export function isDirectoryAncestorTarget(
  ancestor: Pick<ContextPackDeepFocusTarget, 'path' | 'kind'>,
  candidate: Pick<ContextPackDeepFocusTarget, 'path' | 'kind'>,
): boolean {
  return ancestor.kind === 'directory'
    && isStrictAncestorPath(ancestor.path, candidate.path);
}

export function targetsOverlap(
  left: ContextPackDeepFocusTarget,
  right: ContextPackDeepFocusTarget,
): boolean {
  return (
    left.path === right.path
    || pathContains(left.path, right.path)
    || pathContains(right.path, left.path)
  );
}

export function countKinds(targets: ContextPackDeepFocusTarget[]): {
  directoryCount: number;
  fileCount: number;
} {
  return targets.reduce(
    (counts, target) => {
      if (target.kind === 'directory') {
        counts.directoryCount += 1;
      } else {
        counts.fileCount += 1;
      }
      return counts;
    },
    { directoryCount: 0, fileCount: 0 },
  );
}

export function isMonolithEstateType(estateType: string | null | undefined): boolean {
  return estateType === 'monolith' || estateType === 'monolith-platform';
}

export function supportsDeepFocus(estateType: string | null | undefined): boolean {
  return estateType === 'distributed-platform' || isMonolithEstateType(estateType);
}

export function joinRelativePath(basePath: string, childPath: string): string {
  if (!basePath) return childPath;
  if (!childPath) return basePath;
  return `${basePath}/${childPath}`;
}

export function removePathPrefix(path: string, prefix: string): string {
  if (!prefix) return path;
  if (path === prefix) return '';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
}

export function getPrimaryDisplayPath(
  target: { label: string; rootPath: string } | null,
  selectedPath: string,
): string {
  if (selectedPath) return selectedPath;
  if (!target) return '';
  return target.rootPath || target.label;
}

export function getPrimaryDisplayLabel(
  target: { label: string; rootPath: string } | null,
  selectedPath: string,
): string {
  if (!target) return 'None selected';
  if (!selectedPath || selectedPath === target.rootPath) {
    return target.label;
  }
  return basename(selectedPath);
}

/**
 * Build a display-label lookup for support targets by cross-referencing
 * empty-path targets against the non-primary top-level repos/areas.
 *
 * Returns a Map keyed by target index. Callers fall back to `basename()`
 * for entries not in the map (i.e. targets with non-empty paths).
 */
export function buildSupportDisplayLabels(
  supportTargets: readonly ContextPackDeepFocusTarget[],
  topLevelTargets: ReadonlyArray<{ id: string; label: string; rootPath: string }>,
  primaryTopLevelId: string | null,
): Map<number, string> {
  const labels = new Map<number, string>();
  const nonPrimaryRoots = topLevelTargets.filter(
    (t) => t.id !== primaryTopLevelId && t.rootPath === '',
  );
  let rootIndex = 0;
  for (let i = 0; i < supportTargets.length; i++) {
    if (!supportTargets[i].path && rootIndex < nonPrimaryRoots.length) {
      labels.set(i, nonPrimaryRoots[rootIndex].label);
      rootIndex++;
    }
  }
  return labels;
}

export function inferDraftPrimaryTarget(
  path: string | null,
  kind: ContextPackFocusTargetKind | null,
): ContextPackDeepFocusTarget | null {
  if (path === null) {
    return null;
  }
  return {
    path: normalizeRelativePath(path),
    kind: kind ?? 'directory',
  };
}

function primaryName(target: ContextPackPrimaryFocusTarget | undefined): string {
  if (!target) return '';
  return target.path ? basename(target.path) : 'repo root';
}

function cursorPrimary(
  state: ContextPackDeepFocusState,
  cursor: EditScopeCursor,
): ContextPackPrimaryFocusTarget | undefined {
  return cursor.kind === 'primary'
    ? state.selectedFocusTargets?.[cursor.index]
    : undefined;
}

function isRepoRootPrimary(target: ContextPackPrimaryFocusTarget | undefined): boolean {
  return target?.path === '' && target.kind === 'directory';
}

function primaryBelongsToRowTopLevel(
  primary: ContextPackPrimaryFocusTarget,
  row: BadgeRow,
): boolean {
  if (!primary.repoLocalPath && !primary.repoId && !primary.focusId) {
    return true;
  }
  if (!row.topLevelId) {
    return true;
  }
  return primary.repoId === row.topLevelId || primary.focusId === row.topLevelId;
}

function primaryTargetsShareTopLevel(
  left: ContextPackPrimaryFocusTarget,
  right: ContextPackPrimaryFocusTarget,
): boolean {
  const leftIdentifiers = [left.repoId, left.focusId, left.repoLocalPath].filter(Boolean);
  const rightIdentifiers = [right.repoId, right.focusId, right.repoLocalPath].filter(Boolean);
  if (leftIdentifiers.length === 0 || rightIdentifiers.length === 0) {
    return true;
  }
  return leftIdentifiers.some((identifier) => rightIdentifiers.includes(identifier));
}

function primaryContainsRowTarget(
  primary: ContextPackPrimaryFocusTarget,
  rowTarget: ContextPackDeepFocusTarget,
  row: BadgeRow,
): boolean {
  return primaryBelongsToRowTopLevel(primary, row)
    && isDirectoryAncestorTarget(primary, rowTarget);
}

/**
 * Returns the index of the *deepest* (most specific) primary that contains the
 * given row, or -1 if none. When primaries are nested — e.g. a root anchor at
 * '' plus an explicit primary at 'Tools' — `findIndex` would return the
 * anchor, but the user-meaningful containing primary is the narrowest one
 * they explicitly chose. Used wherever we need to act on "the parent primary"
 * (popover remove affordance, inline-strip disabled tooltip).
 */
function findDeepestContainingPrimaryIndex(
  primaries: ContextPackPrimaryFocusTarget[],
  rowTarget: ContextPackDeepFocusTarget,
  row: BadgeRow,
): number {
  let deepestIndex = -1;
  let deepestLength = -1;
  primaries.forEach((primary, index) => {
    if (!primaryContainsRowTarget(primary, rowTarget, row)) return;
    const length = normalizeRelativePath(primary.path).length;
    if (length > deepestLength) {
      deepestIndex = index;
      deepestLength = length;
    }
  });
  return deepestIndex;
}

/**
 * Returns the index of the primary whose writable area strictly contains the
 * given row, or -1 if none. Used by the inline-commands strip to render a
 * disabled "For all primaries" button with an explanatory tooltip when the
 * row sits inside a primary's writable area (spec §6.1).
 */
export function findPrimaryContainingRow(
  state: ContextPackDeepFocusState,
  row: {
    targetPath: string;
    kind: ContextPackFocusTargetKind;
    systemLayer?: string | null;
    label?: string;
    topLevelId?: string;
    isTopLevel?: boolean;
    activeTopLevelId?: string | null;
  },
): number {
  const rowTarget: ContextPackDeepFocusTarget = {
    path: normalizeRelativePath(row.targetPath),
    kind: row.kind,
  };
  return findDeepestContainingPrimaryIndex(
    state.selectedFocusTargets ?? [],
    rowTarget,
    row,
  );
}

function primaryWritableTarget(primary: ContextPackPrimaryFocusTarget): ContextPackDeepFocusTarget {
  return primary.kind === 'file'
    ? { path: parentPath(primary.path), kind: 'directory' }
    : primary;
}

export function computeRowBadges(
  row: BadgeRow,
  state: ContextPackDeepFocusState,
  cursor: EditScopeCursor,
): TreeRowBadge[] {
  const rowTarget: ContextPackDeepFocusTarget = {
    path: normalizeRelativePath(row.targetPath),
    kind: row.kind,
  };
  const primaries = state.selectedFocusTargets ?? [];
  const badges: TreeRowBadge[] = [];
  const currentPrimary = cursorPrimary(state, cursor);

  const primaryIndex = primaries.findIndex((target) => isSamePrimaryRowTarget(target, rowTarget, row));
  if (primaryIndex >= 0) {
    badges.push(
      { kind: 'primary', label: 'P', ariaLabel: 'Primary target' },
    );
  }

  if (cursor.kind === 'primary' && currentPrimary) {
    if (isSameRowTarget(currentPrimary.testTarget, rowTarget, row)) {
      badges.push({ kind: 'test', label: 'T', ariaLabel: 'Scoped test target' });
    }
    if ((currentPrimary.supportTargets ?? []).some((target) => isSameRowTarget(target, rowTarget, row))) {
      badges.push({ kind: 'support', label: 'S', ariaLabel: 'Scoped support target' });
    }
  }

  return badges.slice(0, 2);
}

export function computePopoverActions(
  row: BadgeRow,
  state: ContextPackDeepFocusState,
  cursor: EditScopeCursor,
): PopoverAction[] {
  const rowTarget: ContextPackDeepFocusTarget = {
    path: normalizeRelativePath(row.targetPath),
    kind: row.kind,
  };
  const primaries = state.selectedFocusTargets ?? [];
  const primaryIndex = primaries.findIndex((target) => isSamePrimaryRowTarget(target, rowTarget, row));
  const containingPrimaryIndex = findDeepestContainingPrimaryIndex(primaries, rowTarget, row);
  const rowCoveredByPrimary = containingPrimaryIndex >= 0;
  // Shared global-bucket gates: a row already covered by the global test or
  // an existing global support entry cannot be re-added; same logic applies
  // whether the cursor is on a primary or on global. Computed once so the
  // primary-cursor branch can surface the global cluster alongside its own.
  const rowUnderGlobalTest = state.selectedTestTarget != null
    && (isSameTarget(state.selectedTestTarget, rowTarget) || isDirectoryAncestorTarget(state.selectedTestTarget, rowTarget));
  const rowUnderGlobalSupport = state.selectedSupportTargets.some((supportTarget) =>
    isSameTarget(supportTarget, rowTarget) || isDirectoryAncestorTarget(supportTarget, rowTarget));
  const rowIsGlobalTestTarget = isSameRowTarget(state.selectedTestTarget, rowTarget, row);
  const rowIsGlobalSupportTarget = state.selectedSupportTargets.some((target) => isSameRowTarget(target, rowTarget, row));

  if (cursor.kind === 'primary') {
    const primary = primaries[cursor.index];
    if (!primary) {
      return [];
    }
    // Row IS itself a primary → only meaningful action is to remove it.
    // A primary cannot also be the test target or support target of another
    // primary (or itself); the validator rejects scoped-support-equals-self
    // and scoped-test-equals-other-primary. Mirror the global-cursor branch
    // below which already short-circuits the same way.
    if (primaryIndex >= 0) {
      return [
        { action: { type: 'remove-primary', index: primaryIndex }, label: deepFocusStrings.popover.actions.removePrimary },
      ];
    }
    const name = primaryName(primary);
    const actions: PopoverAction[] = [];
    if (!rowCoveredByPrimary) {
      actions.push({ action: { type: 'make-primary' }, label: deepFocusStrings.popover.actions.makePrimary });
    }
    // Hide per-primary test when the row is already the global test:
    // `set-primary-test` does NOT strip the row from the global bucket
    // (unlike `add-primary-support`), so emitting it would create a real
    // redundancy where the same row sits in both scopes simultaneously.
    // Per-primary support stays available because its reducer auto-demotes
    // from the global bucket — the action is a transition, not a redundant
    // additive.
    //
    // Test selection is gated on the name-based heuristic in every scope —
    // the user explicitly does NOT want every folder inside a primary to be
    // a test candidate just because the parent is primary.
    if (isTestClassifiedRow(row) && !rowIsGlobalTestTarget) {
      actions.push({ action: { type: 'set-primary-test', index: cursor.index }, label: deepFocusStrings.popover.actions.setPrimaryTest(name) });
    }
    // Block add-as-support when the row is already covered by *any* primary's
    // writable area (including the cursor's own primary — a child of a primary
    // is already part of its writable scope, so adding it again as a readonly
    // support entry is redundant), when the row is already inside the cursor
    // primary's testTarget (the test fully shadows it as read context), or
    // when the row is already inside another support entry on the cursor
    // primary (redundant nesting).
    const rowUnderCursorTest = primary.testTarget != null
      && (isSameTarget(primary.testTarget, rowTarget) || isDirectoryAncestorTarget(primary.testTarget, rowTarget));
    const rowUnderCursorSupport = (primary.supportTargets ?? []).some((supportTarget) =>
      isSameTarget(supportTarget, rowTarget) || isDirectoryAncestorTarget(supportTarget, rowTarget));
    if (!rowCoveredByPrimary && !rowUnderCursorTest && !rowUnderCursorSupport) {
      actions.push({ action: { type: 'add-primary-support', index: cursor.index }, label: deepFocusStrings.popover.actions.addPrimarySupport(name) });
    }
    if (
      isSameRowTarget(primary.testTarget, rowTarget, row)
      || (primary.supportTargets ?? []).some((target) => isSameRowTarget(target, rowTarget, row))
    ) {
      actions.push({ action: { type: 'remove-primary-member', index: cursor.index }, label: deepFocusStrings.popover.actions.removePrimaryMember(name) });
    }
    // Surface the global cluster alongside per-primary actions: when the
    // cursor is on a specific primary the user can still promote a row to
    // be test/support "for all primaries" without switching to the global
    // cursor. Same gating as the global-cursor branch below: test classified
    // for `set-global-test`; not already covered by global test/support and
    // not inside any primary writable area for `add-global-support`.
    if (isTestClassifiedRow(row) && !rowIsGlobalTestTarget) {
      actions.push({ action: { type: 'set-global-test' }, label: deepFocusStrings.popover.actions.setGlobalTest });
    }
    if (!rowCoveredByPrimary && !rowUnderGlobalTest && !rowUnderGlobalSupport) {
      actions.push({ action: { type: 'add-global-support' }, label: deepFocusStrings.popover.actions.addGlobalSupport });
    }
    if (rowIsGlobalTestTarget || rowIsGlobalSupportTarget) {
      actions.push({ action: { type: 'remove-global' }, label: deepFocusStrings.popover.actions.removeGlobal });
    }
    // Row is covered by a primary but isn't itself one → expose a way to clear
    // the containing primary so the user can promote this child in its place.
    // Without this, a covered row offers nothing useful and the user is stuck.
    if (rowCoveredByPrimary) {
      actions.push({ action: { type: 'remove-primary', index: containingPrimaryIndex }, label: deepFocusStrings.popover.actions.removePrimary });
    }
    return actions.slice(0, 8);
  }

  if (primaryIndex >= 0) {
    return [
      { action: { type: 'remove-primary', index: primaryIndex }, label: deepFocusStrings.popover.actions.removePrimary },
    ];
  }

  // Global test/support targets are readonly *context* attached to primaries
  // (spec §5.1 — the global buckets feed every primary). With zero primaries
  // they have no consumer, so emitting the actions here produces a no-op
  // mutation that the user can't see in the UI. Hide them until at least one
  // primary exists; `make-primary` is the only meaningful exit from the
  // empty-state. `remove-global` stays available as a cleanup affordance for
  // any leftover state from a prior session.
  const hasPrimaries = primaries.length > 0;
  const actions: PopoverAction[] = [
    ...(!rowCoveredByPrimary
      ? [{ action: { type: 'make-primary' } as const, label: deepFocusStrings.popover.actions.makePrimary }]
      : []),
    ...(hasPrimaries && isTestClassifiedRow(row)
      ? [{ action: { type: 'set-global-test' } as const, label: deepFocusStrings.popover.actions.setGlobalTest }]
      : []),
    ...(hasPrimaries && !rowCoveredByPrimary && !rowUnderGlobalTest && !rowUnderGlobalSupport
      ? [{ action: { type: 'add-global-support' } as const, label: deepFocusStrings.popover.actions.addGlobalSupport }]
      : []),
    ...(rowIsGlobalTestTarget || rowIsGlobalSupportTarget
      ? [{ action: { type: 'remove-global' } as const, label: deepFocusStrings.popover.actions.removeGlobal }]
      : []),
    // Same affordance as the primary-cursor branch: covered rows get a way
    // to clear the containing primary so they can be promoted.
    ...(rowCoveredByPrimary
      ? [{ action: { type: 'remove-primary', index: containingPrimaryIndex } as const, label: deepFocusStrings.popover.actions.removePrimary }]
      : []),
  ];
  return actions.slice(0, 4);
}

export type PromotableScope = {
  testTarget: ContextPackDeepFocusTarget | null;
  supportTargets: ContextPackDeepFocusTarget[];
};

const NO_PROMOTION: PromotableScope = { testTarget: null, supportTargets: [] };

/**
 * Eligibility floor: at least 2 non-root primaries must exist. With one
 * primary the universal-quantifier ("every primary has X") is trivially true
 * after a single assignment, so promoting would be premature rather than a
 * meaningful coalescing of intent. Repo-root primaries are excluded because
 * the spec rejects scoped fields on them, so they cannot contribute to or
 * block equivalence.
 */
export function detectPromotableScope(state: ContextPackDeepFocusState): PromotableScope {
  const primaries = state.selectedFocusTargets ?? [];
  const eligible = primaries.filter((primary) => !isRepoRootPrimary(primary));
  if (eligible.length < 2) return NO_PROMOTION;

  let testCandidate: ContextPackDeepFocusTarget | null = null;
  const firstTest = eligible[0]!.testTarget;
  if (firstTest) {
    const everyMatches = eligible.every((primary) =>
      isSameTarget(primary.testTarget, firstTest));
    const alreadyGlobal = isSameTarget(state.selectedTestTarget, firstTest);
    if (everyMatches && !alreadyGlobal) {
      testCandidate = firstTest;
    }
  }

  const firstSupports = eligible[0]!.supportTargets ?? [];
  const supportCandidates = firstSupports.filter((candidate) => {
    const everyHas = eligible.every((primary) =>
      (primary.supportTargets ?? []).some((entry) => isSameTarget(entry, candidate)));
    if (!everyHas) return false;
    const alreadyGlobal = state.selectedSupportTargets.some(
      (entry) => isSameTarget(entry, candidate),
    );
    return !alreadyGlobal;
  });

  if (testCandidate === null && supportCandidates.length === 0) return NO_PROMOTION;
  return { testTarget: testCandidate, supportTargets: supportCandidates };
}

export function validateNestedScopeForUi(state: ContextPackDeepFocusState): ScopedValidationError[] {
  const primaries = state.selectedFocusTargets ?? [];
  const errors: ScopedValidationError[] = [];

  primaries.forEach((primary, primaryIndex) => {
    const scope: EditScopeCursor = { kind: 'primary', index: primaryIndex };
    if (primary.path === '') {
      // Mirrors backend rule `scoped-fields-on-repo-root-primary`
      // (deepFocusNormalization.ts ~159). A repo-root primary covers the whole
      // tree; nested test/support folders are nonsensical relative to it.
      if (primary.testTarget) {
        errors.push({ scope, field: 'testTarget', reason: 'scoped-fields-on-repo-root-primary' });
      }
      (primary.supportTargets ?? []).forEach((_, supportIndex) => {
        errors.push({ scope, field: 'supportTargets', index: supportIndex, reason: 'scoped-fields-on-repo-root-primary' });
      });
    }
    const containingPrimaryIndex = primaries.findIndex((candidate, index) =>
      index !== primaryIndex
      && primaryTargetsShareTopLevel(candidate, primary)
      && isDirectoryAncestorTarget(candidate, primary));
    if (containingPrimaryIndex >= 0) {
      errors.push({
        scope,
        field: 'supportTargets',
        reason: 'primary-target-inside-primary-writable',
        conflictsWith: { scope: { kind: 'primary', index: containingPrimaryIndex }, field: 'supportTargets' },
      });
    }

    if (primary.testTarget) {
      if (isSameTarget(primary.testTarget, primary)) {
        errors.push({ scope, field: 'testTarget', reason: 'scoped-test-equals-self' });
      } else if (primaries.some((candidate, index) => index !== primaryIndex && isSameTarget(candidate, primary.testTarget))) {
        errors.push({ scope, field: 'testTarget', reason: 'scoped-test-equals-other-primary' });
      } else if (isStrictAncestorPath(primary.testTarget.path, primary.path)) {
        errors.push({ scope, field: 'testTarget', reason: 'scoped-test-ancestor-of-primary' });
      }
    }

    const supportTargets = primary.supportTargets ?? [];
    supportTargets.forEach((supportTarget, supportIndex) => {
      if (isSameTarget(supportTarget, primary)) {
        errors.push({ scope, field: 'supportTargets', index: supportIndex, reason: 'scoped-support-equals-self' });
      } else if (isDirectoryAncestorTarget(primary, supportTarget)) {
        // Support sits inside the primary's own writable area — the primary
        // already covers it as writable, so adding it again as readonly is
        // redundant. Defense-in-depth for the popover gate.
        errors.push({ scope, field: 'supportTargets', index: supportIndex, reason: 'scoped-support-inside-own-primary-writable' });
      } else if (isSameTarget(primary.testTarget, supportTarget)) {
        errors.push({ scope, field: 'supportTargets', index: supportIndex, reason: 'scoped-support-equals-primary-test' });
      } else if (primary.testTarget && isDirectoryAncestorTarget(primary.testTarget, supportTarget)) {
        errors.push({ scope, field: 'supportTargets', index: supportIndex, reason: 'scoped-support-redundant-under-test' });
      } else {
        const coveringSupportIndex = supportTargets.findIndex((candidate, index) =>
          index !== supportIndex && isDirectoryAncestorTarget(candidate, supportTarget));
        if (coveringSupportIndex >= 0) {
          errors.push({
            scope,
            field: 'supportTargets',
            index: supportIndex,
            reason: 'scoped-support-redundant-under-support',
            conflictsWith: { scope, field: 'supportTargets', index: coveringSupportIndex },
          });
          return;
        }
        const otherPrimaryIndex = primaries.findIndex((candidate, index) => index !== primaryIndex && isSameTarget(candidate, supportTarget));
        if (otherPrimaryIndex >= 0) {
          errors.push({
            scope,
            field: 'supportTargets',
            index: supportIndex,
            reason: 'scoped-support-equals-other-primary',
            conflictsWith: { scope: { kind: 'primary', index: otherPrimaryIndex }, field: 'supportTargets' },
          });
          return;
        }
        const conflictingPrimaryIndex = primaries.findIndex((candidate, index) =>
          index !== primaryIndex && targetsOverlap(primaryWritableTarget(candidate), supportTarget));
        if (conflictingPrimaryIndex >= 0) {
          errors.push({
            scope,
            field: 'supportTargets',
            index: supportIndex,
            reason: 'cross-primary-support-overlaps-writable',
            conflictsWith: { scope: { kind: 'primary', index: conflictingPrimaryIndex }, field: 'supportTargets' },
          });
        }
      }
    });
  });

  state.selectedSupportTargets.forEach((supportTarget, supportIndex) => {
    const globalScope: EditScopeCursor = { kind: 'global' };
    if (state.selectedTestTarget && isDirectoryAncestorTarget(state.selectedTestTarget, supportTarget)) {
      errors.push({
        scope: globalScope,
        field: 'supportTargets',
        index: supportIndex,
        reason: 'global-support-redundant-under-global-test',
      });
      return;
    }

    const coveringSupportIndex = state.selectedSupportTargets.findIndex((candidate, index) =>
      index !== supportIndex && isDirectoryAncestorTarget(candidate, supportTarget));
    if (coveringSupportIndex >= 0) {
      errors.push({
        scope: globalScope,
        field: 'supportTargets',
        index: supportIndex,
        reason: 'global-support-redundant-under-global-support',
        conflictsWith: { scope: globalScope, field: 'supportTargets', index: coveringSupportIndex },
      });
      return;
    }

    const containingPrimaryIndex = primaries.findIndex((primary) =>
      isDirectoryAncestorTarget(primary, supportTarget));
    if (containingPrimaryIndex >= 0) {
      errors.push({
        scope: globalScope,
        field: 'supportTargets',
        index: supportIndex,
        reason: 'global-support-inside-primary-writable',
        conflictsWith: { scope: { kind: 'primary', index: containingPrimaryIndex }, field: 'supportTargets' },
      });
      return;
    }

    const duplicatingPrimaryIndex = primaries.findIndex((primary) =>
      (primary.supportTargets ?? []).some((target) => isSameTarget(target, supportTarget)));
    if (duplicatingPrimaryIndex >= 0) {
      errors.push({
        scope: globalScope,
        field: 'supportTargets',
        index: supportIndex,
        reason: 'support-duplicated-across-scopes',
        conflictsWith: { scope: { kind: 'primary', index: duplicatingPrimaryIndex }, field: 'supportTargets' },
      });
    }
  });

  return errors;
}
