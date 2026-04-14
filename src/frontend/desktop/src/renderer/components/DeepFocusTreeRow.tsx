import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ContextPackDeepFocusTarget, ContextPackFocusTargetKind } from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';

export type FocusRole = 'primary' | 'test' | 'support';

export type TreeRowData = {
  id: string;
  label: string;
  displayPath: string;
  targetPath: string;
  kind: ContextPackFocusTargetKind;
  hasChildren: boolean;
  topLevelId: string;
  topLevelLabel: string;
  topLevelPath: string;
  repoLocalPath: string;
  isTopLevel: boolean;
  ancillaryAllowed: boolean;
};

type DeepFocusTreeRowProps = {
  row: TreeRowData;
  index: number;
  focusedIndex: number;
  focusedKey: string | null;
  drillingIndex: number | null;
  isPrimary: boolean;
  isTest: boolean;
  isSupport: boolean;
  popoverOpen: boolean;
  rowRef: (element: HTMLDivElement | null) => void;
  onFocus: (index: number, id: string) => void;
  onActivate: (index: number) => void;
  onLongPress: (index: number) => void;
  onAssignRole: (role: FocusRole, topLevelId: string, target: ContextPackDeepFocusTarget) => void;
  onDismissPopover: () => void;
};

const LONG_PRESS_MS = 500;

function FolderTreeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4.5a1 1 0 0 1 1-1h2.3l1.2 1.4H12.5a1 1 0 0 1 1 1v1H2.5z"
        fill="currentColor"
        opacity="0.38"
      />
      <path
        d="M2.5 6.5h11v4.8a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2z"
        fill="currentColor"
      />
    </svg>
  );
}

function FileNodeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M4 2.5h5.2L12 5.3v8.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M9.2 2.5V5a.8.8 0 0 0 .8.8h2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 8.2h5.6M5.2 10.4h4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronRightIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RolePopover({
  row,
  isPrimary,
  isTest,
  isSupport,
  onAssign,
  onDismiss,
}: {
  row: TreeRowData;
  isPrimary: boolean;
  isTest: boolean;
  isSupport: boolean;
  onAssign: (role: FocusRole) => void;
  onDismiss: () => void;
}): JSX.Element {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const popoverRect = el.getBoundingClientRect();

    // Find the closest scrollable ancestor (the .deep-focus-list container)
    let scrollParent: HTMLElement | null = el.parentElement;
    while (scrollParent) {
      const overflow = getComputedStyle(scrollParent).overflowY;
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') break;
      scrollParent = scrollParent.parentElement;
    }
    const clippingTop = scrollParent
      ? scrollParent.getBoundingClientRect().top
      : 0;

    if (popoverRect.top < clippingTop) {
      setFlipped(true);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onDismiss();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onDismiss]);

  const testDisabledForFile = row.kind === 'file';

  return (
    <div
      ref={popoverRef}
      className={classNames('deep-focus-role-popover', flipped && 'deep-focus-role-popover--below')}
      role="group"
      aria-label={`Assign role for ${row.label}`}
    >
      <button
        type="button"
        className={classNames(
          'deep-focus-role-bubble',
          'deep-focus-role-bubble--primary',
          isPrimary && 'deep-focus-role-bubble--active',
        )}
        onClick={(e) => { e.stopPropagation(); onAssign('primary'); }}
      >
        Primary
      </button>
      <button
        type="button"
        className={classNames(
          'deep-focus-role-bubble',
          'deep-focus-role-bubble--test',
          isTest && 'deep-focus-role-bubble--active',
          testDisabledForFile && 'deep-focus-role-bubble--disabled',
        )}
        disabled={testDisabledForFile}
        title={testDisabledForFile ? 'Test can only be assigned to folders' : undefined}
        onClick={(e) => { e.stopPropagation(); onAssign('test'); }}
      >
        Test
      </button>
      <button
        type="button"
        className={classNames(
          'deep-focus-role-bubble',
          'deep-focus-role-bubble--support',
          isSupport && 'deep-focus-role-bubble--active',
        )}
        onClick={(e) => { e.stopPropagation(); onAssign('support'); }}
      >
        Support
      </button>
    </div>
  );
}

export function DeepFocusTreeRow({
  row,
  index,
  focusedIndex,
  focusedKey,
  drillingIndex,
  isPrimary,
  isTest,
  isSupport,
  popoverOpen,
  rowRef,
  onFocus,
  onActivate,
  onLongPress,
  onAssignRole,
  onDismissPopover,
}: DeepFocusTreeRowProps): JSX.Element {
  const target: ContextPackDeepFocusTarget = useMemo(
    () => ({ path: row.targetPath, kind: row.kind }),
    [row.targetPath, row.kind],
  );

  const longPressTimer = useRef<number | null>(null);
  const [pressActive, setPressActive] = useState(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setPressActive(false);
  }, []);

  useEffect(() => {
    return clearLongPress;
  }, [clearLongPress]);

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    setPressActive(true);
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      setPressActive(false);
      onLongPress(index);
    }, LONG_PRESS_MS);
  };

  const handleMouseUp = () => {
    clearLongPress();
  };

  const handleMouseLeave = () => {
    clearLongPress();
  };

  const handleAssign = useCallback(
    (role: FocusRole) => {
      onAssignRole(role, row.topLevelId, target);
      onDismissPopover();
    },
    [onAssignRole, onDismissPopover, row.topLevelId, target],
  );

  const roleChip = isPrimary ? 'Primary' : isTest ? 'Test' : isSupport ? 'Support' : null;
  const chipVariant = isPrimary ? 'primary' : isTest ? 'test' : isSupport ? 'support' : null;

  return (
    <div className="deep-focus-row-container">
      {popoverOpen ? (
        <RolePopover
          row={row}
          isPrimary={isPrimary}
          isTest={isTest}
          isSupport={isSupport}
          onAssign={handleAssign}
          onDismiss={onDismissPopover}
        />
      ) : null}
      <div
        ref={rowRef}
        role="button"
        tabIndex={focusedIndex === index ? 0 : -1}
        className={classNames(
          'deep-focus-row',
          row.kind === 'directory' ? 'deep-focus-row--directory' : 'deep-focus-row--file',
          isPrimary && 'deep-focus-row--selected',
          !isPrimary && isTest && 'deep-focus-row--test-selected',
          isPrimary && isTest && 'deep-focus-row--primary-and-test',
          isSupport && 'deep-focus-row--support-selected',
          pressActive && 'deep-focus-row--press-active',
          popoverOpen && 'deep-focus-row--popover-open',
        )}
        onFocus={() => { onFocus(index, row.id); }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={() => { void onActivate(index); }}
        data-focused={focusedKey === row.id ? 'true' : undefined}
      >
        <span className="deep-focus-row__icon" aria-hidden="true">
          {row.kind === 'directory' ? <FolderTreeIcon /> : <FileNodeIcon />}
        </span>
        <span className="deep-focus-row__label">
          <span className="deep-focus-row__title-row">
            <span className="deep-focus-row__name">{row.label}</span>
            {roleChip ? (
              <span className={classNames('status-chip', 'status-chip--xs', `status-chip--${chipVariant}`)}>
                {roleChip}
              </span>
            ) : null}
          </span>
          {row.displayPath && row.displayPath !== row.label ? (
            <span className="deep-focus-row__path" title={row.displayPath}>
              {row.displayPath}
            </span>
          ) : null}
        </span>
        {row.kind === 'directory' ? (
          <span
            className={classNames(
              'deep-focus-row__chevron',
              drillingIndex === index && 'deep-focus-row__chevron--drilling',
            )}
            aria-hidden="true"
          >
            <ChevronRightIcon />
          </span>
        ) : null}
      </div>
    </div>
  );
}
