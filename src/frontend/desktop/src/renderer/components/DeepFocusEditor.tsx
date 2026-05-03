import type { KeyboardEvent, RefObject } from 'react';

import type { ContextPackPrimaryFocusTarget } from '../../shared/desktopContract';
import type { BreadcrumbItem } from './DeepFocusBreadcrumb';
import { DeepFocusEditorHeader } from './DeepFocusEditorHeader';
import { DeepFocusScopeRail } from './DeepFocusScopeRail';
import { DeepFocusTreeCanvas } from './DeepFocusTreeCanvas';
import type { TreeRowData } from './DeepFocusTreeRow';
import {
  basename,
  type EditScopeCursor,
  type ScopedRoleAction,
} from './SidebarDeepFocusUtils';
import { deepFocusStrings } from './SidebarDeepFocusStrings';
import type { UndoEntry } from './SidebarDeepFocusControls.types';
import type { DeepFocusEditorModel } from './useDeepFocusEditorModel';

type BreadcrumbLayoutProps = {
  visibleBreadcrumbs: BreadcrumbItem[];
  hiddenBreadcrumbs: BreadcrumbItem[];
};

type EditorNavProps = {
  onClearAll: () => void;
  onExit: () => void;
  onApply: () => void;
  applyDisabled: boolean;
  hasUnappliedChanges: boolean;
};

type SelectedRowActionProps = {
  onAction: (action: ScopedRoleAction) => void;
};

type PromotionProps = {
  onPromoteTest: () => void;
  onPromoteSupport: (path: string) => void;
};

type SearchProps = {
  inputRef: RefObject<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onClear: () => void;
};

type ScopeStripProps = {
  primaries: ContextPackPrimaryFocusTarget[];
  cursor: EditScopeCursor;
  draftTopLevel?: { label: string; rootPath: string } | null;
  exitingPrimaryKey: string | null;
  focusRequest: EditScopeCursor | null;
  onSelectCursor: (cursor: EditScopeCursor) => void;
  onFocusRequestHandled: () => void;
};

type TreeCanvasProps = {
  focusedIndex: number;
  focusedKey: string | null;
  rowRef: (index: number, element: HTMLDivElement | null) => void;
  onRowFocus: (index: number, id: string) => void;
  onRowSelect: (
    row: TreeRowData,
    index: number,
    ghostSupportCandidate: DeepFocusEditorModel['tree']['visibleRows'][number]['ghostSupportCandidate'],
  ) => void;
  onToggleExpand: (rowId: string) => void;
};

type FooterProps = {
  undoStack: UndoEntry[];
  applyError: string | null;
  onRestoreLastUndo: () => void;
};

type DeepFocusEditorProps = {
  model: DeepFocusEditorModel;
  breadcrumbs: BreadcrumbLayoutProps;
  nav: EditorNavProps;
  selectedRowActions: SelectedRowActionProps;
  search: SearchProps;
  scopeStrip: ScopeStripProps;
  tree: TreeCanvasProps;
  footer: FooterProps;
  promotion: PromotionProps;
  onToggleExpansion: () => void;
  expansionMode: 'expand' | 'collapse';
  expansionBusy: boolean;
  onEditorKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

function renderPromotionHints(
  detected: DeepFocusEditorModel['promotion'],
  handlers: PromotionProps,
): JSX.Element | null {
  const hasTest = detected.testTarget !== null;
  const hasSupports = detected.supportTargets.length > 0;
  if (!hasTest && !hasSupports) return null;
  return (
    <div className="deep-focus-promotion-hints">
      {hasTest ? (
        <button
          type="button"
          className="deep-focus-promotion-chip"
          onClick={handlers.onPromoteTest}
          title={`Every primary uses ${detected.testTarget!.path} as its test. Lift it to a single global test.`}
        >
          Promote test {basename(detected.testTarget!.path)} to global
        </button>
      ) : null}
      {detected.supportTargets.map((target) => (
        <button
          key={`promote-support:${target.kind}:${target.path}`}
          type="button"
          className="deep-focus-promotion-chip"
          onClick={() => handlers.onPromoteSupport(target.path)}
          title={`Every primary includes ${target.path} as support. Lift it to a single global support.`}
        >
          Promote support {basename(target.path)} to global
        </button>
      ))}
    </div>
  );
}

export function DeepFocusEditor({
  model,
  breadcrumbs,
  nav,
  selectedRowActions,
  search,
  scopeStrip,
  tree,
  footer,
  promotion,
  onToggleExpansion,
  expansionMode,
  expansionBusy,
  onEditorKeyDown,
}: DeepFocusEditorProps): JSX.Element {
  const promotionHints = renderPromotionHints(model.promotion, promotion);
  return (
    <div className="deep-focus-editor" onKeyDown={onEditorKeyDown}>
      <DeepFocusEditorHeader
        model={model}
        breadcrumbs={breadcrumbs}
        searchInputRef={search.inputRef}
        onQueryChange={search.onQueryChange}
        onClearSearch={search.onClear}
        onToggleExpansion={onToggleExpansion}
        expansionMode={expansionMode}
        expansionBusy={expansionBusy}
      />

      <DeepFocusScopeRail
        primaries={scopeStrip.primaries}
        cursor={scopeStrip.cursor}
        draftTopLevel={scopeStrip.draftTopLevel}
        exitingPrimaryKey={scopeStrip.exitingPrimaryKey}
        focusRequest={scopeStrip.focusRequest}
        onSelectCursor={scopeStrip.onSelectCursor}
        onFocusRequestHandled={scopeStrip.onFocusRequestHandled}
      />

      {promotionHints}

      <div className="deep-focus-editor__body">
        <DeepFocusTreeCanvas
          rows={model.tree.visibleRows}
          currentRowsLength={model.tree.currentRowsLength}
          treeLoading={model.tree.loading}
          showTreeLoading={model.tree.showLoadingRows}
          treeTruncated={model.tree.truncated}
          emptyStateLabel={model.tree.emptyStateLabel}
          focusedIndex={tree.focusedIndex}
          focusedKey={tree.focusedKey}
          selectedRowId={model.selectedRow.id}
          selectedRowCommands={model.selectedRow.commandList}
          rowRef={tree.rowRef}
          onRowFocus={tree.onRowFocus}
          onRowSelect={tree.onRowSelect}
          onToggleExpand={tree.onToggleExpand}
          onSelectedRowAction={selectedRowActions.onAction}
        />

        <div className="deep-focus-footer">
          <div className="deep-focus-footer__actions" role="group" aria-label="Editor actions">
            <button
              type="button"
              className="deep-focus-footer__clear-all"
              onClick={nav.onClearAll}
              aria-label="Clear all selections"
            >
              Clear All
            </button>
            <span className="deep-focus-footer__spacer" aria-hidden="true" />
            <button
              type="button"
              className="deep-focus-footer__cancel"
              onClick={nav.onExit}
            >
              {nav.hasUnappliedChanges ? 'Cancel' : 'Done'}
            </button>
            {nav.hasUnappliedChanges ? (
              <button
                type="button"
                className="action-button action-button--primary deep-focus-footer__apply"
                onClick={nav.onApply}
                disabled={nav.applyDisabled}
              >
                Apply
              </button>
            ) : null}
          </div>
          {footer.undoStack.length > 0 ? (
            <div className="deep-focus-primary-removal-toast" role="status">
              {footer.undoStack.length > 1
                ? deepFocusStrings.toast.stacked(footer.undoStack[footer.undoStack.length - 1]!.label, footer.undoStack.length)
                : footer.undoStack[footer.undoStack.length - 1]!.label}
              <button type="button" onClick={footer.onRestoreLastUndo}>
                {footer.undoStack.length > 1 ? deepFocusStrings.toast.undoStacked(footer.undoStack.length) : deepFocusStrings.toast.undo}
              </button>
            </div>
          ) : null}
          {footer.applyError ? (
            <p className="deep-focus-footer__error" role="alert">{footer.applyError}</p>
          ) : null}
          {model.validation.hasFeedback ? (
            <div className="deep-focus-footer__inline-errors" role="alert">
              {model.validation.errors.map((error, index) => (
                <span key={`${error.reason}:${index}`}>{deepFocusStrings.validation[error.reason]}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
