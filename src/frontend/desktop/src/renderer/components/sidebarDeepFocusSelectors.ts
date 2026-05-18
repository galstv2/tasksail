import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import type { TreeRowData } from './DeepFocusTreeRow';
import {
  basename,
  getPrimaryDisplayLabel,
  isSameTarget,
  normalizeRelativePath,
  parentPath,
} from './SidebarDeepFocusUtils';
import type {
  DeepFocusMode,
  TopLevelTarget,
  TreeDirectoryListing,
} from './SidebarDeepFocusControls.types';

export function buildTopLevelTargets(
  selectedPack: ContextPackCatalogEntry,
  deepFocusMode: DeepFocusMode,
): TopLevelTarget[] {
  if (deepFocusMode === 'distributed') {
    return selectedPack.focusTargets
      .filter(
        (
          target,
        ): target is ContextPackCatalogEntry['focusTargets'][number] & {
          repoId: string;
          repoLocalPath: string;
        } =>
          target.kind === 'repository'
          && typeof target.repoId === 'string'
          && typeof target.repoLocalPath === 'string'
          && target.repoLocalPath.length > 0,
      )
      .map((target) => ({
        id: target.repoId,
        label: target.displayName,
        rootPath: '',
        repoLocalPath: target.repoLocalPath,
        ancillaryAllowed: false,
        systemLayer: target.systemLayer ?? null,
      }));
  }
  return selectedPack.focusTargets
    .filter(
      (
        target,
      ): target is ContextPackCatalogEntry['focusTargets'][number] & {
        focusId: string;
        repoLocalPath: string;
      } =>
        target.kind === 'focus-area'
        && typeof target.focusId === 'string'
        && typeof target.repoLocalPath === 'string'
        && target.repoLocalPath.length > 0,
    )
    .map((target) => ({
      id: target.focusId,
      label: target.displayName,
      rootPath: normalizeRelativePath(target.relativePath),
      repoLocalPath: target.repoLocalPath,
      ancillaryAllowed: true,
      systemLayer: target.systemLayer ?? null,
    }));
  }

export function computeCommittedSummaryChips(
  committedPrimaries: ContextPackPrimaryFocusTarget[],
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined,
  selectedSupportTargets: ContextPackDeepFocusTarget[],
  committedTopLevel?: TopLevelTarget | null,
): string[] {
  const singlePrimary = committedPrimaries.length === 1 ? committedPrimaries[0] : null;
  const primaryTargetsChip = singlePrimary
    ? labelPrimaryForDisplay(singlePrimary, primariesSpanMultipleRepos(committedPrimaries), committedTopLevel ?? null)
    : committedPrimaries.length > 1
      ? `${committedPrimaries.length} primary targets`
      : null;
  const effectiveTest = singlePrimary?.testTarget ?? selectedTestTarget ?? null;
  const supportCount = singlePrimary
    ? [
      ...(singlePrimary.supportTargets ?? []),
      ...selectedSupportTargets,
    ].filter(
      (target, index, all) =>
        all.findIndex((candidate) => isSameTarget(candidate, target)) === index,
    ).length
    : selectedSupportTargets.length;

  return [
    primaryTargetsChip,
    effectiveTest
      ? singlePrimary?.testTarget
        ? `Test Target: ${basename(effectiveTest.path)}`
        : `Test Target: ${basename(effectiveTest.path)} (shared)`
      : null,
    supportCount > 0
      ? `${supportCount} supports`
      : null,
  ]
    .filter((chip): chip is string => Boolean(chip))
    .slice(0, 4);
}

export type SummaryPrimaryRow = {
  index: number;
  primary: ContextPackPrimaryFocusTarget;
  basenameLabel: string;
  repoPrefixLabel: string | null;
  isAnchor: boolean;
  scopedTest: ContextPackDeepFocusTarget | null;
  scopedSupports: ContextPackDeepFocusTarget[];
  expandable: boolean;
};

export type ScopeSummaryViewModel = {
  primaryCount: number;
  repoCount: number;
  titleSentence: string;
  primaryRows: SummaryPrimaryRow[];
  globalTest: ContextPackDeepFocusTarget | null;
  globalSupports: ContextPackDeepFocusTarget[];
  hasGlobalBlock: boolean;
};

function buildTitleSentence(primaryCount: number, repoCount: number): string {
  if (primaryCount === 0) return 'No scope set';
  if (primaryCount === 1) return '1 primary target';
  if (repoCount >= 2) return `${primaryCount} primary targets across ${repoCount} repos`;
  return `${primaryCount} primary targets`;
}

export function buildScopeSummaryViewModel(
  committedTopLevel: TopLevelTarget | null,
  committedPrimaries: ContextPackPrimaryFocusTarget[],
  selectedFocusPath: string | null,
  selectedFocusTargetKind: ContextPackFocusTargetKind | null,
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined,
  selectedSupportTargets: ContextPackDeepFocusTarget[],
): ScopeSummaryViewModel {
  const hasScalarPrimaryTarget = committedPrimaries.length === 0
    && committedTopLevel !== null
    && (selectedFocusPath !== null || selectedFocusTargetKind !== null);

  const effectivePrimaries: ContextPackPrimaryFocusTarget[] = hasScalarPrimaryTarget
    ? [{
      path: selectedFocusPath ?? '',
      kind: selectedFocusTargetKind ?? 'directory',
      role: 'anchor',
      repoLocalPath: committedTopLevel?.repoLocalPath ?? '',
      repoId: committedTopLevel?.id ?? '',
    }]
    : committedPrimaries;

  const repoCount = new Set(
    effectivePrimaries
      .map((primary) => primary.repoLocalPath)
      .filter((value): value is string => Boolean(value)),
  ).size;

  const spansRepos = primariesSpanMultipleRepos(effectivePrimaries);

  const primaryRows: SummaryPrimaryRow[] = effectivePrimaries.map((primary, index) => {
    const isWholeRepoPrimary = primary.path === '' && primary.kind === 'directory';
    const repoBasename = primary.repoLocalPath ? basename(primary.repoLocalPath) : '';
    let basenameLabel: string;
    let repoPrefixLabel: string | null = null;
    if (isWholeRepoPrimary) {
      basenameLabel = resolveWholeRepoLabel(repoBasename, committedTopLevel, spansRepos);
    } else {
      basenameLabel = basename(normalizeRelativePath(primary.path));
      if (spansRepos && repoBasename) {
        repoPrefixLabel = repoBasename;
      }
    }
    const scopedTest = primary.testTarget ?? null;
    const scopedSupports = primary.supportTargets ?? [];
    return {
      index,
      primary,
      basenameLabel,
      repoPrefixLabel,
      isAnchor: primary.role === 'anchor',
      scopedTest,
      scopedSupports,
      expandable: scopedTest !== null || scopedSupports.length > 0,
    };
  });

  const globalTest = selectedTestTarget ?? null;
  const globalSupports = selectedSupportTargets;

  return {
    primaryCount: effectivePrimaries.length,
    repoCount,
    titleSentence: buildTitleSentence(effectivePrimaries.length, repoCount),
    primaryRows,
    globalTest,
    globalSupports,
    hasGlobalBlock: globalTest !== null || globalSupports.length > 0,
  };
}

export function primariesSpanMultipleRepos(primaries: ContextPackPrimaryFocusTarget[]): boolean {
  return new Set(
    primaries
      .map((primary) => primary.repoLocalPath)
      .filter((repoLocalPath): repoLocalPath is string => Boolean(repoLocalPath)),
  ).size > 1;
}

const FALLBACK_REPO_LABEL = 'Repo';

// fallbackTopLevel is the active draft's repo and is shared across primaries,
// so for whole-repo primaries that span multiple repos we must prefer the
// per-primary repoBasename — otherwise every capsule inherits the same suffix.
function resolveWholeRepoLabel(
  repoBasename: string,
  fallbackTopLevel: { label: string; rootPath: string } | null,
  spansRepos: boolean,
): string {
  const displayLabel = getPrimaryDisplayLabel(fallbackTopLevel, '');
  const preferred = spansRepos ? repoBasename : displayLabel;
  const secondary = spansRepos ? displayLabel : repoBasename;
  return preferred || secondary || FALLBACK_REPO_LABEL;
}

export function labelPrimaryForDisplay(
  target: ContextPackPrimaryFocusTarget,
  spansRepos: boolean,
  fallbackTopLevel?: { label: string; rootPath: string } | null,
): string {
  const repoBasename = target.repoLocalPath ? basename(target.repoLocalPath) : '';
  if (target.path === '' && target.kind === 'directory') {
    return resolveWholeRepoLabel(repoBasename, fallbackTopLevel ?? null, spansRepos);
  }
  const label = basename(normalizeRelativePath(target.path));
  return spansRepos ? `${repoBasename}/${label}` : label;
}

export function computeSelectionTraySummary(
  draftTopLevel: TopLevelTarget | null,
  draftState: ContextPackDeepFocusState,
): string {
  return [
    draftTopLevel
      ? `Primary: ${getPrimaryDisplayLabel(draftTopLevel, normalizeRelativePath(draftState.selectedFocusPath))}`
      : 'Primary: none',
    draftState.selectedTestTarget
      ? `Test Target: ${basename(draftState.selectedTestTarget.path)}`
      : draftState.selectedTestTarget === null
        ? 'Test Target: none'
        : 'Test Target: none selected',
    `Support: ${draftState.selectedSupportTargets.length}`,
  ].join(' · ');
}

export function treeExpansionKey(topLevelId: string, targetPath: string): string {
  return `${topLevelId}:${targetPath}`;
}

export function buildTreeRows(
  topLevelTargets: TopLevelTarget[],
  expanded: Set<string>,
  directoryListings: Record<string, TreeDirectoryListing>,
): TreeRowData[] {
  const rows: TreeRowData[] = [];

  const appendChildren = (target: TopLevelTarget, parentPath: string, depth: number) => {
    const listing = directoryListings[treeExpansionKey(target.id, parentPath)];
    if (!listing) return;

    listing.entries.forEach((entry) => {
      const row: TreeRowData = {
        id: `tree:${target.id}:${entry.relativePath || entry.name}`,
        label: entry.name,
        displayPath: entry.relativePath,
        targetPath: entry.relativePath,
        kind: entry.kind,
        hasChildren: entry.hasChildren,
        topLevelId: target.id,
        topLevelLabel: target.label,
        topLevelPath: target.rootPath,
        repoLocalPath: target.repoLocalPath,
        isTopLevel: false,
        ancillaryAllowed: true,
        systemLayer: target.systemLayer,
        isTest: entry.isTest,
        artifactType: entry.artifactType,
        pathKind: entry.pathKind,
        depth,
      };
      rows.push(row);

      if (
        entry.kind === 'directory'
        && entry.hasChildren
        && expanded.has(treeExpansionKey(target.id, entry.relativePath))
      ) {
        appendChildren(target, entry.relativePath, depth + 1);
      }
    });
  };

  topLevelTargets.forEach((target) => {
    const rootRow: TreeRowData = {
      id: `top:${target.id}`,
      label: target.label,
      displayPath: target.rootPath || target.label,
      targetPath: target.rootPath,
      kind: 'directory' as const,
      hasChildren: true,
      topLevelId: target.id,
      topLevelLabel: target.label,
      topLevelPath: target.rootPath,
      repoLocalPath: target.repoLocalPath,
      isTopLevel: true,
      ancillaryAllowed: target.ancillaryAllowed,
      systemLayer: target.systemLayer,
      depth: 0,
    };
    rows.push(rootRow);

    if (expanded.has(treeExpansionKey(target.id, target.rootPath))) {
      appendChildren(target, target.rootPath, 1);
    }
  });

  return rows;
}

export function selectParentOfPrimaryRows(
  state: ContextPackDeepFocusState,
  treeFlat: TreeRowData[],
): Set<string> {
  const primaryParentPaths = new Set(
    (state.selectedFocusTargets ?? []).map((primary) => parentPath(primary.path)),
  );

  return new Set(
    treeFlat
      .filter((row) => primaryParentPaths.has(normalizeRelativePath(row.targetPath)))
      .map((row) => row.id),
  );
}

export function selectSiblingSupportCandidates(
  state: ContextPackDeepFocusState,
  parentTargetPath: string,
  treeFlat: TreeRowData[],
): TreeRowData[] {
  const assignedPaths = new Set<string>();

  (state.selectedFocusTargets ?? []).forEach((primary) => {
    assignedPaths.add(normalizeRelativePath(primary.path));
    if (primary.testTarget) {
      assignedPaths.add(normalizeRelativePath(primary.testTarget.path));
    }
    (primary.supportTargets ?? []).forEach((supportTarget) => {
      assignedPaths.add(normalizeRelativePath(supportTarget.path));
    });
  });

  if (state.selectedTestTarget) {
    assignedPaths.add(normalizeRelativePath(state.selectedTestTarget.path));
  }
  state.selectedSupportTargets.forEach((supportTarget) => {
    assignedPaths.add(normalizeRelativePath(supportTarget.path));
  });

  return treeFlat.filter((row) => {
    const rowPath = normalizeRelativePath(row.targetPath);
    return parentPath(rowPath) === parentTargetPath && !assignedPaths.has(rowPath);
  });
}
