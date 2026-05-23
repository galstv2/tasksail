import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusFilterSelection,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';

type FocusSelectionSummaryGroup = {
  label: string;
  value: string;
  tone: 'primary' | 'support' | 'test';
};

type FocusSelectionSummaryCardProps = {
  selectedPack: ContextPackCatalogEntry | undefined;
  selection: ContextPackFocusFilterSelection;
  title: string;
  flag?: string;
  className?: string;
  draft?: boolean;
  contentOnly?: boolean;
};

function basenameOf(path: string | null | undefined): string {
  if (!path) return 'None';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function targetLabel(
  selectedPack: ContextPackCatalogEntry | undefined,
  id: string | null | undefined,
): string {
  if (!id) return 'None';
  const target = selectedPack?.focusTargets.find((entry) =>
    entry.focusId === id || entry.repoId === id);
  return target?.displayName || id;
}

function primaryTargetLabel(
  target: ContextPackPrimaryFocusTarget,
  selectedPack: ContextPackCatalogEntry | undefined,
): string {
  if (target.repoId || target.focusId) {
    const resolved = targetLabel(selectedPack, target.repoId ?? target.focusId);
    if (resolved !== 'None') return resolved;
  }
  return basenameOf(target.path);
}

function deepTargetLabel(
  target: ContextPackDeepFocusTarget,
  selectedPack: ContextPackCatalogEntry | undefined,
): string {
  if (target.repoId || target.focusId) {
    const resolved = targetLabel(selectedPack, target.repoId ?? target.focusId);
    if (resolved !== 'None') return resolved;
  }
  if (!target.path && target.repoLocalPath) {
    return basenameOf(target.repoLocalPath);
  }
  return basenameOf(target.path);
}

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
  const ids = selectedPack?.estateType === 'distributed-platform'
    ? selection.selectedRepoIds
    : selection.selectedFocusIds;
  const grouped = ids.reduce<{ primary: string[]; support: string[] }>((acc, id) => {
    const target = selectedPack?.focusTargets.find((entry) => entry.focusId === id || entry.repoId === id);
    const role = selection.repositoryTypes?.[id] ?? target?.repositoryType ?? 'primary';
    const bucket = role === 'support' ? acc.support : acc.primary;
    bucket.push(target?.displayName || id);
    return acc;
  }, { primary: [], support: [] });

  return [
    { label: 'Primary', value: summarizeValues(grouped.primary), tone: 'primary' },
    { label: 'Support', value: summarizeValues(grouped.support), tone: 'support' },
  ];
}

function deepFocusGroups(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): FocusSelectionSummaryGroup[] {
  const primaryValues = selection.selectedFocusTargets.length > 0
    ? selection.selectedFocusTargets.map((target) => primaryTargetLabel(target, selectedPack))
    : [targetLabel(selectedPack, selection.deepFocusPrimaryRepoId ?? selection.deepFocusPrimaryFocusId)];
  const scopedTestValues = selection.selectedFocusTargets
    .filter((target) => Boolean(target.testTarget))
    .map((target) => `${primaryTargetLabel(target, selectedPack)}: ${deepTargetLabel(target.testTarget!, selectedPack)}`);
  const scopedSupportValues = selection.selectedFocusTargets.flatMap((target) =>
    (target.supportTargets ?? []).map((support) =>
      `${primaryTargetLabel(target, selectedPack)}: ${deepTargetLabel(support, selectedPack)}`));
  const testValues = [
    ...(selection.selectedTestTarget ? [`Global: ${deepTargetLabel(selection.selectedTestTarget, selectedPack)}`] : []),
    ...scopedTestValues,
  ];
  const supportValues = [
    ...selection.selectedSupportTargets.map((target) => `Global: ${deepTargetLabel(target, selectedPack)}`),
    ...scopedSupportValues,
  ];

  return [
    { label: 'Primary', value: summarizeValues(primaryValues), tone: 'primary' },
    { label: 'Test', value: summarizeValues(testValues), tone: 'test' },
    { label: 'Support', value: summarizeValues(supportValues), tone: 'support' },
  ];
}

function detailGroups(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): FocusSelectionSummaryGroup[] {
  return selection.deepFocusEnabled
    ? deepFocusGroups(selection, selectedPack)
    : standardGroups(selection, selectedPack);
}

export default function FocusSelectionSummaryCard({
  selectedPack,
  selection,
  title,
  flag,
  className,
  draft,
  contentOnly,
}: FocusSelectionSummaryCardProps): JSX.Element {
  const groups = detailGroups(selection, selectedPack);
  const content = (
    <>
        <span className="focus-selection-summary-card__header focus-filter-modal__row-header">
          <span className="focus-selection-summary-card__name focus-filter-modal__row-name">{title}</span>
          {flag ? (
            <span className={classNames(
              'focus-selection-summary-card__flag',
              'focus-filter-modal__row-flag',
              draft && 'focus-filter-modal__row-flag--draft',
            )}
            >
              {flag}
            </span>
          ) : null}
        </span>
        <span className="focus-selection-summary-card__details focus-filter-modal__row-details">
          {groups.map((group) => {
            const isEmpty = group.value === 'None';
            return (
              <span
                key={`${group.label}:${group.value}`}
                className={classNames(
                  'focus-selection-summary-card__detail',
                  'focus-filter-modal__row-detail',
                  `focus-filter-modal__row-detail--${group.tone}`,
                  isEmpty && 'focus-filter-modal__row-detail--empty',
                )}
              >
                <span className="focus-selection-summary-card__detail-label focus-filter-modal__row-detail-label">{group.label}</span>
                <span className="focus-selection-summary-card__detail-value focus-filter-modal__row-detail-value">
                  {isEmpty ? '—' : group.value}
                </span>
              </span>
            );
          })}
        </span>
    </>
  );

  if (contentOnly) {
    return <>{content}</>;
  }

  return (
    <div
      className={classNames(
        'focus-selection-summary-card',
        'focus-filter-modal__row',
        draft && 'focus-filter-modal__row--draft',
        className,
      )}
      data-mode={selection.deepFocusEnabled ? 'deep-focus' : 'standard'}
    >
      <div className="focus-selection-summary-card__body focus-filter-modal__row-select focus-filter-modal__row-select--static">
        {content}
      </div>
    </div>
  );
}
