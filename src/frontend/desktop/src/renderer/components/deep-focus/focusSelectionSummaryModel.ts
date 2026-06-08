import type {
  ContextPackCatalogEntry,
  ContextPackFocusFilterRepositoryType,
  ContextPackFocusFilterSelection,
} from '../../../shared/desktopContract';
import { isDistributedEstateMode } from '../../contextPack/contextPackModeUtils';
import {
  buildScopeSummaryViewModel,
  buildTopLevelTargets,
  scopedTargetLabel,
  type SummaryPrimaryRow,
} from './sidebarDeepFocusSelectors';
import type { DeepFocusMode, TopLevelTarget } from './SidebarDeepFocusControls.types';

export type FocusSelectionSummaryGroup = {
  label: string;
  value: string;
  tone: 'primary' | 'support' | 'test';
};

function summarizeValues(values: string[]): string {
  const visible = values.filter(Boolean);
  if (visible.length === 0) return 'None';
  if (visible.length <= 2) return visible.join(', ');
  return `${visible[0]}, ${visible[1]} +${visible.length - 2}`;
}

function standardGroups(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): FocusSelectionSummaryGroup[] {
  const ids = isDistributedEstateMode(selectedPack?.estateType)
    ? selection.selectedRepoIds
    : selection.selectedFocusIds;
  const grouped = ids.reduce<{ primary: string[]; support: string[] }>((acc, id) => {
    const target = selectedPack?.focusTargets.find((entry) => entry.focusId === id || entry.repoId === id);
    const repositoryType = target?.repositoryType as ContextPackFocusFilterRepositoryType | null | undefined;
    const role = selection.repositoryTypes?.[id] ?? repositoryType ?? 'primary';
    const bucket = role === 'support' ? acc.support : acc.primary;
    bucket.push(target?.displayName || id);
    return acc;
  }, { primary: [], support: [] });

  return [
    { label: 'Primary', value: summarizeValues(grouped.primary), tone: 'primary' },
    { label: 'Support', value: summarizeValues(grouped.support), tone: 'support' },
  ];
}

function deepFocusModeForPack(selectedPack: ContextPackCatalogEntry | undefined): DeepFocusMode {
  return isDistributedEstateMode(selectedPack?.estateType) ? 'distributed' : 'monolith';
}

function resolveCommittedTopLevel(
  selectedPack: ContextPackCatalogEntry | undefined,
  selection: ContextPackFocusFilterSelection,
): TopLevelTarget | null {
  if (!selectedPack) return null;
  const deepFocusMode = deepFocusModeForPack(selectedPack);
  const topLevelId = deepFocusMode === 'distributed'
    ? selection.deepFocusPrimaryRepoId
    : selection.deepFocusPrimaryFocusId;
  if (!topLevelId) return null;
  return buildTopLevelTargets(selectedPack, deepFocusMode).find((target) => target.id === topLevelId) ?? null;
}

function primaryRowLabel(row: SummaryPrimaryRow): string {
  return row.repoPrefixLabel
    ? `${row.repoPrefixLabel}/${row.basenameLabel}`
    : row.basenameLabel;
}

function deepFocusGroups(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): FocusSelectionSummaryGroup[] {
  const scope = buildScopeSummaryViewModel(
    resolveCommittedTopLevel(selectedPack, selection),
    selection.selectedFocusTargets,
    selection.selectedFocusPath,
    selection.selectedFocusTargetKind,
    selection.selectedTestTarget,
    selection.selectedSupportTargets,
  );
  const primaryValues = scope.primaryRows.map(primaryRowLabel);
  const scopedTestValues = scope.primaryRows.flatMap((row) =>
    row.scopedTest ? [`${primaryRowLabel(row)}: ${scopedTargetLabel(row.scopedTest)}`] : []);
  const scopedSupportValues = scope.primaryRows.flatMap((row) =>
    row.scopedSupports.map((support) => `${primaryRowLabel(row)}: ${scopedTargetLabel(support)}`));
  const testValues = [
    ...(scope.globalTest ? [`Global: ${scopedTargetLabel(scope.globalTest)}`] : []),
    ...scopedTestValues,
  ];
  const supportValues = [
    ...scope.globalSupports.map((target) => `Global: ${scopedTargetLabel(target)}`),
    ...scopedSupportValues,
  ];

  return [
    { label: 'Primary', value: summarizeValues(primaryValues), tone: 'primary' },
    { label: 'Test', value: summarizeValues(testValues), tone: 'test' },
    { label: 'Support', value: summarizeValues(supportValues), tone: 'support' },
  ];
}

export function buildFocusSelectionSummaryGroups(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): FocusSelectionSummaryGroup[] {
  return selection.deepFocusEnabled
    ? deepFocusGroups(selection, selectedPack)
    : standardGroups(selection, selectedPack);
}
