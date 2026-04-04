import type {
  ContextPackCatalogEntry,
  ContextPackFocusTarget,
  ContextPackReseedExecutionResult,
  ContextPackRuntimeStatus,
  ContextPackSwitchExecutionResult,
} from '../../shared/desktopContract';

export function selectPreferredContextPackDir(
  contextPacks: ContextPackCatalogEntry[],
  candidates: Array<string | null | undefined>,
): string {
  for (const candidate of candidates) {
    if (
      candidate &&
      contextPacks.some((entry) => entry.contextPackDir === candidate)
    ) {
      return candidate;
    }
  }
  return contextPacks[0]?.contextPackDir ?? '';
}

export type CompactSidebarChip = {
  label: string;
  tone: 'idle' | 'active' | 'blocked' | 'completed';
};

export type CompactSidebarModel = {
  activeHeading: string;
  activeLocation: string;
  activeStatusLabel: string;
  activeStatusTone: CompactSidebarChip['tone'];
  selectedPackSummary: CompactSidebarChip[];
  focusHint: string | null;
  selectedWorkingFocusSummary: string | null;
  switchResultSummary: string | null;
  reseedResultSummary: string | null;
};

export function formatSource(source: ContextPackCatalogEntry['source']): string {
  switch (source) {
    case 'configured-path':
      return 'configured';
    case 'search-root':
      return 'discovered';
    case 'active-env':
      return 'active env';
    case 'recent-state':
      return 'recent';
    default:
      return source;
  }
}

export function formatFocusLabel(target: ContextPackFocusTarget): string {
  const suffix =
    target.kind === 'repository'
      ? target.serviceName &&
        target.serviceName !== target.displayName &&
        target.repoId
        ? ` · ${target.repoId}`
        : ''
      : target.relativePath && target.relativePath !== target.displayName
        ? ` · ${target.relativePath}`
        : '';
  return `${target.displayName}${suffix}`;
}

export function formatRuntimeStatus(status: ContextPackRuntimeStatus | undefined): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'active-dirty-workspace':
      return 'modified';
    case 'activation-failed':
      return 'failed';
    case 'workspace-sync-failed':
      return 'sync failed';
    default:
      return 'inactive';
  }
}

export function mapRuntimeStatusTone(
  status: ContextPackRuntimeStatus | undefined,
): CompactSidebarChip['tone'] {
  switch (status) {
    case 'active':
      return 'active';
    case 'inactive':
    case undefined:
      return 'completed';
    default:
      return 'blocked';
  }
}

export function buildFocusHint(args: {
  selectedPack: ContextPackCatalogEntry | undefined;
}): string | null {
  const { selectedPack } = args;

  if (!selectedPack?.focusTargets.length) {
    return null;
  }

  if (selectedPack.estateType === 'distributed-platform') {
    return 'Only the selected repos are included in the workspace.';
  }

  return 'The Primary focus area determines where agents run. Other selected areas are visible but not the working directory.';
}

export function summarizeSwitchResult(
  result: ContextPackSwitchExecutionResult | null,
): string | null {
  if (!result) {
    return null;
  }

  const warningCount = result.warnings.length;
  return [
    result.wrapperAction,
    result.stage ?? 'n/a',
    warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : 'no warnings',
  ].join(' · ');
}

export function summarizeReseedResult(
  result: ContextPackReseedExecutionResult | null,
): string | null {
  if (!result) {
    return null;
  }

  return [
    result.overallStatus,
    `${result.seededRepoCount} seeded`,
    `${result.blockedRepoCount} blocked`,
  ].join(' · ');
}

export function buildCompactSidebarModel(args: {
  contextPacks: ContextPackCatalogEntry[];
  activeContextPackDir: string | null;
  selectedContextPackDir: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  lastResult: ContextPackSwitchExecutionResult | null;
  lastReseedResult: ContextPackReseedExecutionResult | null;
}): CompactSidebarModel {
  const {
    contextPacks,
    activeContextPackDir,
    selectedContextPackDir,
    selectedRepoIds,
    selectedFocusIds,
    lastResult,
    lastReseedResult,
  } = args;

  const activePack = contextPacks.find((entry) => entry.isActive);
  const selectedPack = contextPacks.find(
    (entry) => entry.contextPackDir === selectedContextPackDir,
  );
  const selectedWorkingFocusIds =
    selectedPack?.estateType === 'distributed-platform' ? selectedRepoIds : selectedFocusIds;
  const selectedWorkingFocuses = selectedPack?.focusTargets.filter((target) =>
    selectedWorkingFocusIds.includes(target.focusId),
  );

  const selectedPackSummary: CompactSidebarChip[] = [];
  if (selectedPack) {
    selectedPackSummary.push({
      label: selectedPack.estateType === 'distributed-platform' ? 'Distributed' : 'Monolith',
      tone: 'idle',
    });
    selectedPackSummary.push({
      label: `${selectedPack.repoCount} repo${selectedPack.repoCount === 1 ? '' : 's'}`,
      tone: 'idle',
    });
    if (selectedWorkingFocuses && selectedWorkingFocuses.length > 0) {
      selectedPackSummary.push({
        label: `${selectedWorkingFocuses.length} focus`,
        tone: 'completed',
      });
    }
  }

  return {
    activeHeading: activePack?.displayName ?? selectedPack?.displayName ?? 'No active context pack',
    activeLocation: activePack?.displayName
      ? `${activePack.displayName} is active`
      : 'No active context pack is currently applied.',
    activeStatusLabel: activeContextPackDir
      ? formatRuntimeStatus(activePack?.status)
      : 'no active pack',
    activeStatusTone: activeContextPackDir
      ? mapRuntimeStatusTone(activePack?.status)
      : 'completed',
    selectedPackSummary,
    focusHint: buildFocusHint({ selectedPack }),
    selectedWorkingFocusSummary:
      selectedWorkingFocuses && selectedWorkingFocuses.length > 0
        ? selectedWorkingFocuses.map((target) => formatFocusLabel(target)).join(', ')
        : null,
    switchResultSummary: summarizeSwitchResult(lastResult),
    reseedResultSummary: summarizeReseedResult(lastReseedResult),
  };
}
