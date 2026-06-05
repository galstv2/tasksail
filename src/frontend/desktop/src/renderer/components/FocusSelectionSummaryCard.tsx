import type {
  ContextPackCatalogEntry,
  ContextPackFocusFilterSelection,
} from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';
import { buildFocusSelectionSummaryGroups } from './focusSelectionSummaryModel';

type FocusSelectionSummaryCardProps = {
  selectedPack: ContextPackCatalogEntry | undefined;
  selection: ContextPackFocusFilterSelection;
  title: string;
  flag?: string;
  className?: string;
  draft?: boolean;
  contentOnly?: boolean;
};

export default function FocusSelectionSummaryCard({
  selectedPack,
  selection,
  title,
  flag,
  className,
  draft,
  contentOnly,
}: FocusSelectionSummaryCardProps): JSX.Element {
  const groups = buildFocusSelectionSummaryGroups(selection, selectedPack);
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
