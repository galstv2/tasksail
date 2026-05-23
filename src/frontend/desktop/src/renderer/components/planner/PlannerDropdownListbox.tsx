import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { registerEscHandler } from '../../utils/modalShellEscRegistry';

export type PlannerDropdownListboxItem = {
  id: string;
  ariaLabel: string;
  disabled?: boolean;
};

export type PlannerDropdownListboxProps = {
  open: boolean;
  triggerRef: RefObject<HTMLElement>;
  items: readonly PlannerDropdownListboxItem[];
  listboxId: string;
  className?: string;
  testId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  renderItem: (
    item: PlannerDropdownListboxItem,
    state: { optionId: string; isActive: boolean; isFirst: boolean; onHover: () => void; onSelect: () => void },
  ) => ReactNode;
  topAccessory?: ReactNode;
  getOptionId?: (item: PlannerDropdownListboxItem) => string;
};

const POPOVER_ESC_PRIORITY = 10;

type AnchorRect = { top: number; left: number; width: number };

function useAnchorRect(triggerRef: RefObject<HTMLElement>, open: boolean): AnchorRect | null {
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

function nextEnabled(items: readonly PlannerDropdownListboxItem[], start: number, direction: 1 | -1): number {
  if (items.length === 0) return -1;
  let index = start;
  for (let seen = 0; seen < items.length; seen += 1) {
    index = (index + direction + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

export function PlannerDropdownListbox({
  open,
  triggerRef,
  items,
  listboxId,
  className,
  testId,
  onSelect,
  onClose,
  renderItem,
  topAccessory,
  getOptionId,
}: PlannerDropdownListboxProps): JSX.Element {
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const rect = useAnchorRect(triggerRef, open);
  const [activeIndex, setActiveIndex] = useState(0);

  const closeAndReturnFocus = useCallback(() => {
    onClose();
    triggerRef.current?.focus();
  }, [onClose, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const first = items.findIndex((item) => !item.disabled);
    setActiveIndex(first >= 0 ? first : 0);
    listboxRef.current?.focus();
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    return registerEscHandler(POPOVER_ESC_PRIORITY, closeAndReturnFocus);
  }, [open, closeAndReturnFocus]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (listboxRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const handleBlur = (): void => onClose();
    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [open, onClose, triggerRef]);

  const activeId = useMemo(() => {
    const active = items[activeIndex];
    if (!active) return undefined;
    return getOptionId ? getOptionId(active) : `${listboxId}-option-${active.id}`;
  }, [activeIndex, getOptionId, items, listboxId]);

  const selectItem = useCallback((item: PlannerDropdownListboxItem) => {
    if (item.disabled) return;
    onSelect(item.id);
    onClose();
  }, [onClose, onSelect]);

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((idx) => nextEnabled(items, idx, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((idx) => nextEnabled(items, idx, -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(Math.max(0, items.findIndex((item) => !item.disabled)));
    } else if (event.key === 'End') {
      event.preventDefault();
      const reversed = [...items].reverse().findIndex((item) => !item.disabled);
      setActiveIndex(reversed < 0 ? 0 : items.length - 1 - reversed);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) selectItem(item);
    } else if (event.key === 'Tab') {
      onClose();
    }
  };

  const positionStyle = rect
    ? { top: `${rect.top}px`, right: `${window.innerWidth - rect.left}px` }
    : { top: '-9999px', right: '-9999px' };

  return createPortal(
    <div
      ref={listboxRef}
      role="listbox"
      id={listboxId}
      aria-activedescendant={activeId}
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      className={className}
      style={positionStyle}
      onKeyDown={handleKeyDown}
      data-testid={testId}
    >
      {topAccessory}
      <div className={`${className?.split(' ')[0] ?? 'planner-dropdown'}__list`}>
        {items.map((item, index) => (
          <div key={item.id} aria-label={item.ariaLabel}>
            {renderItem(item, {
              optionId: getOptionId ? getOptionId(item) : `${listboxId}-option-${item.id}`,
              isActive: index === activeIndex,
              isFirst: index === 0,
              onHover: () => !item.disabled && setActiveIndex(index),
              onSelect: () => selectItem(item),
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
