import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import type { PlannerListConversationHistorySummary } from '../../../shared/desktopContractPlanner';
import { registerEscHandler } from '../../utils/modalShellEscRegistry';
import { RecentsRow } from './RecentsRow';

export type RecentsErrorState = 'refresh-failed' | null;

export interface RecentsPopoverProps {
  open: boolean;
  records: PlannerListConversationHistorySummary[];
  triggerRef: RefObject<HTMLButtonElement>;
  onSelect: (recordId: string) => void;
  onClose: () => void;
  errorState?: RecentsErrorState;
  onRetry?: () => void;
}

const POPOVER_ESC_PRIORITY = 10;

type AnchorRect = { top: number; left: number; width: number };

function useAnchorRect(
  triggerRef: RefObject<HTMLElement>,
  open: boolean,
): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setRect(null);
      return;
    }
    const measure = (): void => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 6, left: r.right, width: r.width });
    };
    measure();
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, { capture: true });
    };
  }, [open, triggerRef]);

  return rect;
}

export function RecentsPopover(props: RecentsPopoverProps) {
  const { open, records, triggerRef, onSelect, onClose, errorState, onRetry } = props;
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const rect = useAnchorRect(triggerRef, open);
  const [activeIndex, setActiveIndex] = useState(0);

  const closeAndReturnFocus = useCallback(() => {
    onClose();
    triggerRef.current?.focus();
  }, [onClose, triggerRef]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    listboxRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const unregister = registerEscHandler(POPOVER_ESC_PRIORITY, closeAndReturnFocus);
    return unregister;
  }, [open, closeAndReturnFocus]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (listboxRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const handleBlur = (): void => {
      onClose();
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [open, onClose, triggerRef]);

  const activeId = useMemo(() => {
    if (!records.length) return undefined;
    const safeIndex = Math.min(Math.max(activeIndex, 0), records.length - 1);
    return `recents-row-${records[safeIndex].id}`;
  }, [records, activeIndex]);

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (!records.length) return;
    const last = records.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((idx) => (idx >= last ? 0 : idx + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((idx) => (idx <= 0 ? last : idx - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(last);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const safe = Math.min(Math.max(activeIndex, 0), last);
      const record = records[safe];
      if (record) {
        onSelect(record.id);
        onClose();
      }
    } else if (e.key === 'Tab') {
      onClose();
    }
  };

  const positionStyle =
    rect != null
      ? {
          top: `${rect.top}px`,
          right: `${window.innerWidth - rect.left}px`,
        }
      : { top: '-9999px', right: '-9999px' };

  const className = [
    'recents-popover',
    open ? 'recents-popover--open' : 'recents-popover--closed',
  ].join(' ');

  const popover = (
    <div
      ref={listboxRef}
      role="listbox"
      id="recents-listbox"
      aria-activedescendant={activeId}
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      className={className}
      style={positionStyle}
      onKeyDown={handleKeyDown}
      data-testid="recents-popover"
    >
      {errorState === 'refresh-failed' && (
        <div className="recents-popover__error-bar" role="status">
          <span className="recents-popover__error-text">
            Couldn&rsquo;t refresh recent conversations.
          </span>
          {onRetry && (
            <button
              type="button"
              className="recents-popover__error-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </div>
      )}
      <div className="recents-popover__list">
        {records.map((record, index) => (
          <RecentsRow
            key={record.id}
            record={record}
            isActive={index === activeIndex}
            isFirst={index === 0}
            onSelect={() => {
              onSelect(record.id);
              onClose();
            }}
            onHover={() => setActiveIndex(index)}
          />
        ))}
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}

export default RecentsPopover;
