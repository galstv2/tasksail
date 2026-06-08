import type { ChangeEvent, RefObject } from 'react';

import { DeepFocusBreadcrumb, type BreadcrumbItem } from './DeepFocusBreadcrumb';
import { DeepFocusSelectionBuilderAffordance } from './DeepFocusSelectionBuilder';
import type { DeepFocusEditorModel } from './useDeepFocusEditorModel';

type BreadcrumbLayoutProps = {
  visibleBreadcrumbs: BreadcrumbItem[];
  hiddenBreadcrumbs: BreadcrumbItem[];
};

function ChevronIcon({ mode }: { mode: 'expand' | 'collapse' }): JSX.Element {
  const [topPath, bottomPath] = mode === 'collapse'
    ? ['M4 6l4-3 4 3', 'M4 11l4-3 4 3']
    : ['M4 5l4 3 4-3', 'M4 10l4 3 4-3'];
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={topPath} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={bottomPath} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

type DeepFocusEditorHeaderProps = {
  model: DeepFocusEditorModel;
  breadcrumbs: BreadcrumbLayoutProps;
  searchInputRef: RefObject<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onClearSearch: () => void;
  onToggleExpansion: () => void;
  expansionMode: 'expand' | 'collapse';
  expansionBusy: boolean;
};

export function DeepFocusEditorHeader({
  model,
  breadcrumbs,
  searchInputRef,
  onQueryChange,
  onClearSearch,
  onToggleExpansion,
  expansionMode,
  expansionBusy,
}: DeepFocusEditorHeaderProps): JSX.Element {
  const expansionLabel = expansionMode === 'collapse'
    ? 'Collapse all folders'
    : 'Expand all folders';
  return (
    <header className="deep-focus-editor-header">
      <div className="deep-focus-editor-header__search-row">
        <div className="deep-focus-search">
          <svg className="deep-focus-search__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M10.3 10.3 13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            className="deep-focus-search__input"
            placeholder="Search files and folders"
            value={model.search.query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { onQueryChange(event.target.value); }}
            aria-label="Search files and folders"
          />
          {model.search.active ? (
            <button
              type="button"
              className="deep-focus-search__clear"
              onClick={onClearSearch}
              aria-label="Clear search"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
        <DeepFocusSelectionBuilderAffordance model={model.selectionBuilder} />
        <button
          type="button"
          className="deep-focus-collapse-all"
          onClick={onToggleExpansion}
          disabled={expansionBusy}
          aria-label={expansionLabel}
          aria-busy={expansionBusy}
          title={expansionLabel}
        >
          <ChevronIcon mode={expansionMode} />
        </button>
      </div>

      <DeepFocusBreadcrumb
        visibleBreadcrumbs={breadcrumbs.visibleBreadcrumbs}
        hiddenBreadcrumbs={breadcrumbs.hiddenBreadcrumbs}
      />
    </header>
  );
}
