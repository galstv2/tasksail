import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

// Shared multi-select menu primitive: a disclosure trigger that reveals a
// listbox of toggleable options. Each option renders a primary label pinned
// left and an optional category label pinned right.
//
// The menu floats above the page rather than expanding in flow: it is
// portaled to document.body with position:fixed and a popover z-index, so it
// escapes the overflow clipping of any scroll container the trigger lives in
// (e.g. the Agent Config modal body) and layers above the modal instead of
// growing it. Position is measured from the trigger's bounding rect, flips
// above the trigger when space below is tight, and is recomputed on
// scroll/resize so the menu tracks the trigger.

export type MultiSelectOption = {
  value: string;
  /** Primary text, pinned to the left of the option row. */
  label: string;
  /** Optional secondary text (e.g. a category), pinned to the right. */
  trailingLabel?: string;
  /** Overrides the option's accessible name (defaults to label + trailing). */
  optionAriaLabel?: string;
  disabled?: boolean;
};

export type MultiSelectProps = {
  options: MultiSelectOption[];
  selectedValues: string[];
  onToggle: (value: string, selected: boolean) => void;
  /** Accessible name for the listbox. */
  ariaLabel: string;
  /** Accessible name for the trigger button (defaults to ariaLabel). */
  triggerAriaLabel?: string;
  /** Trigger text shown when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

const VIEWPORT_PAD = 8;
const TRIGGER_GAP = 4;
const PREFERRED_MAX_HEIGHT = 240;

type MenuPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

// Anchor the floating menu to the trigger rect. Prefer opening downward;
// flip upward (anchored by `bottom`) when there is more room above. Clamp the
// horizontal position and cap both width and height to the viewport so the
// fixed-position menu never renders past an edge. Exported for unit testing —
// the flip branch is unreachable through the rendered component in jsdom,
// where getBoundingClientRect() returns zeros.
export function computeMenuPosition(rect: DOMRect): MenuPosition {
  const spaceBelow = window.innerHeight - rect.bottom - TRIGGER_GAP - VIEWPORT_PAD;
  const spaceAbove = rect.top - TRIGGER_GAP - VIEWPORT_PAD;
  const placeBelow = spaceBelow >= PREFERRED_MAX_HEIGHT || spaceBelow >= spaceAbove;
  const available = Math.max(0, placeBelow ? spaceBelow : spaceAbove);
  // Never claim more height than the chosen side actually has.
  const maxHeight = Math.min(PREFERRED_MAX_HEIGHT, available);
  const width = Math.min(rect.width, window.innerWidth - 2 * VIEWPORT_PAD);
  const left = Math.max(
    VIEWPORT_PAD,
    Math.min(rect.left, window.innerWidth - width - VIEWPORT_PAD),
  );
  const base = { left, width, maxHeight };
  return placeBelow
    ? { ...base, top: rect.bottom + TRIGGER_GAP }
    : { ...base, bottom: window.innerHeight - rect.top + TRIGGER_GAP };
}

function MultiSelect({
  options,
  selectedValues,
  onToggle,
  ariaLabel,
  triggerAriaLabel,
  placeholder = 'Select…',
  disabled = false,
  className,
}: MultiSelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const listboxId = useId();

  const selectedSet = new Set(selectedValues);
  const selectedLabels = options.filter((o) => selectedSet.has(o.value)).map((o) => o.label);
  const summary = selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder;
  const triggerDisabled = disabled || options.length === 0;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(
    (index: number) => {
      if (triggerDisabled) return;
      setActiveIndex(Math.max(0, Math.min(index, options.length - 1)));
      setOpen(true);
    },
    [triggerDisabled, options.length],
  );

  // Measure and position the floating menu against the trigger before paint,
  // then keep it anchored as ancestors scroll or the viewport resizes.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    let frame = 0;
    const measure = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      // Trigger fully scrolled out of the viewport — dismiss instead of
      // floating detached over the header/footer or off-screen. Strict
      // comparisons so a zero rect (jsdom) does not spuriously close.
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      setPosition(computeMenuPosition(rect));
    };
    // Coalesce scroll/resize bursts to one measurement per frame.
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    // Capture phase so scrolling of any ancestor (e.g. the modal body) is seen.
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [open]);

  // Close when clicking outside the trigger or the (portaled) menu.
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Move DOM focus to the active option whenever the menu opens or moves.
  useEffect(() => {
    if (open) {
      optionRefs.current[Math.min(activeIndex, options.length - 1)]?.focus();
    }
  }, [open, activeIndex, options.length]);

  const moveActive = useCallback(
    (delta: number) => {
      setActiveIndex((index) => {
        const count = options.length;
        return count === 0 ? 0 : (index + delta + count) % count;
      });
    },
    [options.length],
  );

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(options.length - 1);
    }
  };

  const onOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLLIElement>,
    option: MultiSelectOption,
  ): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!option.disabled) onToggle(option.value, !selectedSet.has(option.value));
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        // Return focus to the trigger first; the portaled listbox lives at the
        // body level, so an un-handled Tab would jump focus outside the modal.
        close(true);
        break;
      default:
        break;
    }
  };

  // Hidden until positioned so the menu never paints at the wrong spot. The
  // layout effect resolves the position before the first paint.
  const menuStyle: CSSProperties = position
    ? {
        top: position.top,
        bottom: position.bottom,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }
    : { visibility: 'hidden' };

  return (
    <div className={`ts-multiselect${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="ts-multiselect__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={triggerAriaLabel ?? ariaLabel}
        disabled={triggerDisabled}
        onClick={() => (open ? setOpen(false) : openMenu(0))}
        onKeyDown={onTriggerKeyDown}
      >
        <span
          className={`ts-multiselect__summary${
            selectedLabels.length === 0 ? ' ts-multiselect__summary--placeholder' : ''
          }`}
        >
          {summary}
        </span>
        <svg
          className="ts-multiselect__chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open &&
        createPortal(
          <ul
            id={listboxId}
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label={ariaLabel}
            className="ts-multiselect__menu"
            style={menuStyle}
          >
            {options.map((option, index) => {
              const selected = selectedSet.has(option.value);
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  aria-label={
                    option.optionAriaLabel
                    ?? (option.trailingLabel
                      ? `${option.label} (${option.trailingLabel})`
                      : undefined)
                  }
                  tabIndex={index === activeIndex ? 0 : -1}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  className={`ts-multiselect__option${
                    selected ? ' ts-multiselect__option--selected' : ''
                  }`}
                  onClick={() => {
                    if (option.disabled) return;
                    setActiveIndex(index);
                    onToggle(option.value, !selected);
                  }}
                  onKeyDown={(event) => onOptionKeyDown(event, option)}
                >
                  <span className="ts-multiselect__check" aria-hidden="true">
                    {selected ? '✓' : ''}
                  </span>
                  <span className="ts-multiselect__option-label">{option.label}</span>
                  {option.trailingLabel && (
                    <span className="ts-multiselect__option-trailing">{option.trailingLabel}</span>
                  )}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}

export default MultiSelect;
