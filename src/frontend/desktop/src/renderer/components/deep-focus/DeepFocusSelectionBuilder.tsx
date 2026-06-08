import type {
  DeepFocusSelectionBuilderPrimaryItem,
  DeepFocusSelectionBuilderScopedItem,
  DeepFocusSelectionBuilderViewModel,
} from './sidebarDeepFocusSelectors';

type DeepFocusSelectionBuilderProps = {
  model: DeepFocusSelectionBuilderViewModel;
};

type SectionTone = 'primary' | 'support' | 'test';

function renderPrimaryRow(item: DeepFocusSelectionBuilderPrimaryItem): JSX.Element {
  return (
    <div className="deep-focus-selection-builder__row" key={item.key}>
      <span className="deep-focus-selection-builder__label" title={item.title}>{item.label}</span>
    </div>
  );
}

function renderScopedRow(item: DeepFocusSelectionBuilderScopedItem): JSX.Element {
  return (
    <div className="deep-focus-selection-builder__row" key={item.key}>
      <span className="deep-focus-selection-builder__label" title={item.title}>{item.label}</span>
      <span className="deep-focus-selection-builder__chip" title={item.scopeLabel}>
        {item.scopeLabel}
      </span>
    </div>
  );
}

function renderSection<TItem>({
  tone,
  title,
  items,
  renderItem,
}: {
  tone: SectionTone;
  title: string;
  items: TItem[];
  renderItem: (item: TItem) => JSX.Element;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section
      className={`deep-focus-selection-builder__section deep-focus-selection-builder__section--${tone}`}
      aria-label={`${title} selections`}
    >
      <div className="deep-focus-selection-builder__section-header">
        <span className="deep-focus-selection-builder__section-name">{title}</span>
        <span className="deep-focus-selection-builder__section-count">{items.length}</span>
      </div>
      <div className="deep-focus-selection-builder__rows">
        {items.map(renderItem)}
      </div>
    </section>
  );
}

function renderTotal(tone: SectionTone, label: string, count: number): JSX.Element {
  return (
    <span
      className={`deep-focus-selection-builder__total deep-focus-selection-builder__total--${tone}`}
      aria-label={`${count} ${label}`}
      title={`${count} ${label}`}
    >
      {count}
    </span>
  );
}

function InfoGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="5.1" r="0.95" fill="currentColor" />
      <rect x="7.15" y="7" width="1.7" height="4.7" rx="0.85" fill="currentColor" />
    </svg>
  );
}

export function DeepFocusSelectionBuilder({
  model,
}: DeepFocusSelectionBuilderProps): JSX.Element {
  return (
    <section className="deep-focus-selection-builder" aria-label="Deep Focus Selection Builder">
      <div className="deep-focus-selection-builder__header">
        <span className="deep-focus-selection-builder__title">Selection Builder</span>
        <div className="deep-focus-selection-builder__totals">
          {renderTotal('primary', 'primary', model.counts.primary)}
          {renderTotal('support', 'support', model.counts.support)}
          {renderTotal('test', 'test', model.counts.test)}
        </div>
      </div>
      {model.empty ? (
        <div className="deep-focus-selection-builder__empty">No selections</div>
      ) : (
        <div className="deep-focus-selection-builder__body">
          {renderSection({
            tone: 'primary',
            title: 'Primary',
            items: model.primaryItems,
            renderItem: renderPrimaryRow,
          })}
          {renderSection({
            tone: 'support',
            title: 'Support',
            items: model.supportItems,
            renderItem: renderScopedRow,
          })}
          {renderSection({
            tone: 'test',
            title: 'Test',
            items: model.testItems,
            renderItem: renderScopedRow,
          })}
        </div>
      )}
    </section>
  );
}

/*
 * Hover/focus affordance: keeps the builder out of the editor's vertical flow
 * so a growing draft can never compress the file tree. Only a thin trigger row
 * stays inline; the card is revealed in a CSS-only popover that overlays the
 * tree. No state, no effects — visibility is driven entirely by :hover and
 * :focus-within.
 */
export function DeepFocusSelectionBuilderAffordance({
  model,
}: DeepFocusSelectionBuilderProps): JSX.Element {
  const total = model.counts.primary + model.counts.support + model.counts.test;
  const triggerLabel = `Selection builder, ${total} ${total === 1 ? 'selection' : 'selections'}`;
  return (
    <div className="deep-focus-selection-builder-affordance">
      <button
        type="button"
        className="deep-focus-selection-builder-affordance__trigger"
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <InfoGlyph />
      </button>
      <div className="deep-focus-selection-builder-affordance__popover">
        <DeepFocusSelectionBuilder model={model} />
      </div>
    </div>
  );
}
