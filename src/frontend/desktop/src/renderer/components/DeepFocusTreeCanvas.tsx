import { classNames } from '../utils/classNames';
import { DeepFocusTreeRow, type TreeRowData } from './DeepFocusTreeRow';
import type { PopoverAction, ScopedRoleAction, TreeRowBadge } from './SidebarDeepFocusUtils';

export type VisibleTreeRow = {
  row: TreeRowData;
  originalIndex: number;
  badges?: TreeRowBadge[];
  expanded?: boolean;
  isSupportContextParent?: boolean;
  supportContextPrimaryLabel?: string;
  ghostSupportCandidate?: {
    primaryIndex: number;
    candidateLabel: string;
    primaryLabel: string;
  };
};

type DeepFocusTreeCanvasProps = {
  rows: VisibleTreeRow[];
  currentRowsLength: number;
  treeLoading: boolean;
  showTreeLoading: boolean;
  treeTruncated: boolean;
  emptyStateLabel: string;
  focusedIndex: number;
  focusedKey: string | null;
  selectedRowId: string | null;
  selectedRowCommands: PopoverAction[];
  rowRef: (index: number, element: HTMLDivElement | null) => void;
  onRowFocus: (index: number, id: string) => void;
  onRowSelect: (row: TreeRowData, index: number, ghostSupportCandidate: VisibleTreeRow['ghostSupportCandidate']) => void;
  onToggleExpand: (rowId: string) => void;
  onSelectedRowAction: (action: ScopedRoleAction) => void;
};

export function DeepFocusTreeCanvas({
  rows,
  currentRowsLength,
  treeLoading,
  showTreeLoading,
  treeTruncated,
  emptyStateLabel,
  focusedIndex,
  focusedKey,
  selectedRowId,
  selectedRowCommands,
  rowRef,
  onRowFocus,
  onRowSelect,
  onToggleExpand,
  onSelectedRowAction,
}: DeepFocusTreeCanvasProps): JSX.Element {
  return (
    <div
      className={classNames(
        'deep-focus-list',
        treeLoading && 'deep-focus-list--loading',
      )}
      role="list"
      aria-label="Deep Focus tree"
    >
      {showTreeLoading && currentRowsLength === 0 ? (
        Array.from({ length: 4 }).map((_, index) => (
          <div key={`loading-${index}`} className="deep-focus-loading-row" />
        ))
      ) : rows.length > 0 ? (
        rows.map(({
          row,
          badges = [],
          expanded = false,
          isSupportContextParent = false,
          supportContextPrimaryLabel,
          ghostSupportCandidate,
        }, visibleIndex) => (
          <DeepFocusTreeRow
            key={row.id}
            row={row}
            index={visibleIndex}
            focusedIndex={focusedIndex}
            focusedKey={focusedKey}
            depth={row.depth}
            expanded={expanded}
            badges={badges}
            selected={!ghostSupportCandidate && selectedRowId === row.id}
            rowRef={(element) => { rowRef(visibleIndex, element); }}
            onFocus={onRowFocus}
            onSelect={(selectedRow, index) => { onRowSelect(selectedRow, index, ghostSupportCandidate); }}
             onToggleExpand={onToggleExpand}
             inlineCommands={!ghostSupportCandidate && selectedRowId === row.id ? {
               actions: selectedRowCommands,
               onAction: onSelectedRowAction,
             } : undefined}
             isSupportContextParent={isSupportContextParent}
            supportContextPrimaryLabel={supportContextPrimaryLabel}
            ghostSupportCandidate={ghostSupportCandidate}
          />
        ))
      ) : (
        <div className="deep-focus-empty-state">
          {emptyStateLabel}
        </div>
      )}
      {treeTruncated ? (
        <div className="deep-focus-truncation-notice">Showing first 500 items</div>
      ) : null}
    </div>
  );
}
