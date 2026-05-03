import { useCallback, useEffect, useRef, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react';

import type { ContextPackPrimaryFocusTarget } from '../../shared/desktopContract';
import type { VisibleTreeRow } from './DeepFocusTreeCanvas';
import type { TreeRowData } from './DeepFocusTreeRow';
import { isEditableKeyboardTarget, type EditScopeCursor } from './SidebarDeepFocusUtils';

function getEventRowIndex(target: EventTarget | null): number | null {
  if (!(target instanceof HTMLElement)) return null;
  const rowElement = target.closest<HTMLElement>('[data-row-index]');
  const rowIndex = Number(rowElement?.dataset.rowIndex);
  return Number.isInteger(rowIndex) ? rowIndex : null;
}

type FocusRestoreTarget = HTMLElement | null;

type DeepFocusKeyboardOptions = {
  editorOpen: boolean;
  rows: VisibleTreeRow[];
  focusedIndex: number;
  setFocusedIndex: Dispatch<SetStateAction<number>>;
  setFocusedKey: Dispatch<SetStateAction<string | null>>;
  selectedRowId: string | null;
  scopeCursor: EditScopeCursor;
  undoStackLength: number;
  searchInputRef: RefObject<HTMLInputElement>;
  onActivateRow: (index: number) => void;
  onApply: () => boolean;
  onCancel: () => void;
  onRestoreLastUndo: () => void;
  onClearGhostCandidate: () => void;
  onClearSelectedRow: () => void;
  onResetScopeCursor: () => void;
  onRemovePrimaryTarget: (target: ContextPackPrimaryFocusTarget) => void;
  getPrimaryTargetForRow: (row: TreeRowData | null) => ContextPackPrimaryFocusTarget | null;
  onRequestScopeFocus: (cursor: EditScopeCursor) => void;
};

export type DeepFocusKeyboard = {
  rowRef: (index: number, element: HTMLDivElement | null) => void;
  toggleButtonRef: RefObject<HTMLButtonElement>;
  summaryActionRef: RefObject<HTMLButtonElement>;
  captureEditEntry: () => void;
  focusRow: (index: number, rowId: string) => void;
  focusAfterCommand: (rowId: string, scopeCursor?: EditScopeCursor) => void;
  focusAfterApply: () => void;
  cancelEditMode: () => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export function useDeepFocusKeyboard({
  editorOpen,
  rows,
  focusedIndex,
  setFocusedIndex,
  setFocusedKey,
  selectedRowId,
  scopeCursor,
  undoStackLength,
  searchInputRef,
  onActivateRow,
  onApply,
  onCancel,
  onRestoreLastUndo,
  onClearGhostCandidate,
  onClearSelectedRow,
  onResetScopeCursor,
  onRemovePrimaryTarget,
  getPrimaryTargetForRow,
  onRequestScopeFocus,
}: DeepFocusKeyboardOptions): DeepFocusKeyboard {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rowsRef = useRef<VisibleTreeRow[]>(rows);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const summaryActionRef = useRef<HTMLButtonElement>(null);
  const editEntryRef = useRef<FocusRestoreTarget>(null);
  const previousRowFocusStateRef = useRef({ editorOpen: false, focusedIndex });
  const focusTimerIdsRef = useRef<Set<number>>(new Set());

  rowsRef.current = rows;

  useEffect(() => {
    return () => {
      focusTimerIdsRef.current.forEach((id) => window.clearTimeout(id));
      focusTimerIdsRef.current.clear();
    };
  }, []);

  const scheduleFocus = useCallback((getTarget: () => FocusRestoreTarget) => {
    const timerId = window.setTimeout(() => {
      focusTimerIdsRef.current.delete(timerId);
      getTarget()?.focus();
    }, 0);
    focusTimerIdsRef.current.add(timerId);
  }, []);

  const focusRowById = useCallback((rowId: string) => {
    scheduleFocus(() => {
      const index = rowsRef.current.findIndex((entry) => entry.row.id === rowId);
      return index >= 0 ? rowRefs.current[index] ?? null : null;
    });
  }, [scheduleFocus]);

  useEffect(() => {
    const previous = previousRowFocusStateRef.current;
    const shouldFocusRow = editorOpen
      && (!previous.editorOpen || previous.focusedIndex !== focusedIndex);
    previousRowFocusStateRef.current = { editorOpen, focusedIndex };
    if (!shouldFocusRow) return;
    rowRefs.current[focusedIndex]?.focus();
  }, [editorOpen, focusedIndex]);

  const focusRow = useCallback((index: number, rowId: string) => {
    setFocusedIndex(index);
    setFocusedKey(rowId);
  }, [setFocusedIndex, setFocusedKey]);

  const captureEditEntry = useCallback(() => {
    editEntryRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }, []);

  const focusAfterApply = useCallback(() => {
    scheduleFocus(() => summaryActionRef.current ?? toggleButtonRef.current);
  }, [scheduleFocus]);

  const cancelEditMode = useCallback(() => {
    onCancel();
    scheduleFocus(() => (editEntryRef.current?.isConnected ? editEntryRef.current : toggleButtonRef.current));
  }, [onCancel, scheduleFocus]);

  const focusAfterCommand = useCallback((rowId: string, requestedScopeCursor?: EditScopeCursor) => {
    if (requestedScopeCursor) {
      onRequestScopeFocus(requestedScopeCursor);
      return;
    }
    focusRowById(rowId);
  }, [focusRowById, onRequestScopeFocus]);

  const moveFocus = useCallback((direction: -1 | 1) => {
    const currentRows = rowsRef.current;
    if (currentRows.length === 0) return;
    setFocusedIndex((current) => {
      const nextDisplayIndex = Math.min(currentRows.length - 1, Math.max(0, current + direction));
      setFocusedKey(currentRows[nextDisplayIndex]?.row.id ?? null);
      return nextDisplayIndex;
    });
  }, [setFocusedIndex, setFocusedKey]);

  const onEditorKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
      event.preventDefault();
      searchInputRef.current?.focus();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (onApply()) {
        focusAfterApply();
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && undoStackLength > 0) {
      event.preventDefault();
      onRestoreLastUndo();
      return;
    }
    if (isEditableKeyboardTarget(event.target)) {
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const focusedPrimary = getPrimaryTargetForRow(rowsRef.current[focusedIndex]?.row ?? null);
      if (focusedPrimary) {
        event.preventDefault();
        onRemovePrimaryTarget(focusedPrimary);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      const eventRowIndex = getEventRowIndex(event.target);
      if (rowsRef.current[eventRowIndex ?? focusedIndex]?.ghostSupportCandidate) {
        onClearGhostCandidate();
        return;
      }
      if (selectedRowId) {
        onClearSelectedRow();
        focusRowById(selectedRowId);
        return;
      }
      if (scopeCursor.kind === 'primary') {
        onResetScopeCursor();
        return;
      }
      cancelEditMode();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onActivateRow(getEventRowIndex(event.target) ?? focusedIndex);
    }
  }, [
    cancelEditMode,
    focusAfterApply,
    focusedIndex,
    focusRowById,
    getPrimaryTargetForRow,
    moveFocus,
    onActivateRow,
    onApply,
    onClearGhostCandidate,
    onClearSelectedRow,
    onRemovePrimaryTarget,
    onResetScopeCursor,
    onRestoreLastUndo,
    scopeCursor.kind,
    searchInputRef,
    selectedRowId,
    undoStackLength,
  ]);

  const rowRef = useCallback((index: number, element: HTMLDivElement | null) => {
    rowRefs.current[index] = element;
  }, []);

  return {
    rowRef,
    toggleButtonRef,
    summaryActionRef,
    captureEditEntry,
    focusRow,
    focusAfterCommand,
    focusAfterApply,
    cancelEditMode,
    onEditorKeyDown,
  };
}
