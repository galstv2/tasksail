import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { classNames } from '../utils/classNames';

export type TerminalSelectMenuOption = {
  value: string;
  id: string;
  primaryLabel: string;
  secondaryLabel?: string;
};

export type TerminalSelectMenuProps = {
  options: TerminalSelectMenuOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  ariaLabel: string;
  listboxId: string;
  className?: string;
  placeholderLabel?: string;
  disabled?: boolean;
};

// Narrow terminal-style single-select: a custom trigger button plus a listbox,
// matching the terminal task dropdown's keyboard, dismissal, and focus behavior.
// Extracted from TerminalFeed so the Artifact Explorer can reuse it verbatim.
function TerminalSelectMenu({
  options,
  selectedValue,
  onSelect,
  ariaLabel,
  listboxId,
  className,
  placeholderLabel,
  disabled = false,
}: TerminalSelectMenuProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === selectedValue),
    [options, selectedValue],
  );

  const activeOptionId = menuOpen
    ? options[Math.min(activeOptionIndex, options.length - 1)]?.id
    : undefined;

  const selectedOptionIndex = useCallback(() => {
    const index = options.findIndex((option) => option.value === selectedValue);
    return index >= 0 ? index : 0;
  }, [options, selectedValue]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }, []);

  const dismissMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const openMenu = useCallback(() => {
    setActiveOptionIndex(selectedOptionIndex());
    setMenuOpen(true);
  }, [selectedOptionIndex]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    listboxRef.current?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function handleMouseDown(event: globalThis.MouseEvent): void {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) {
        return;
      }
      dismissMenu();
    }
    function handleBlur(): void {
      dismissMenu();
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [menuOpen, dismissMenu]);

  function selectOption(index: number): void {
    const safeIndex = Math.min(Math.max(index, 0), options.length - 1);
    const option = options[safeIndex];
    if (!option) {
      return;
    }
    closeMenu();
    onSelect(option.value);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    }
  }

  function handleListboxKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const lastIndex = options.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveOptionIndex((index) => (index >= lastIndex ? 0 : index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveOptionIndex((index) => (index <= 0 ? lastIndex : index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveOptionIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveOptionIndex(lastIndex);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(activeOptionIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'Tab') {
      // Tab and outside dismissals are explicit attempts to leave the menu;
      // they should not restore focus to the trigger.
      dismissMenu();
    }
  }

  return (
    <div className={classNames('terminal-select-menu', className)} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={classNames(
          'terminal-select-menu__trigger',
          menuOpen && 'terminal-select-menu__trigger--open',
        )}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (menuOpen) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="terminal-select-menu__trigger-label">
          {selectedOption ? (
            <>
              <span className="terminal-select-menu__option-primary">{selectedOption.primaryLabel}</span>
              {selectedOption.secondaryLabel && (
                <span className="terminal-select-menu__option-marker">{selectedOption.secondaryLabel}</span>
              )}
            </>
          ) : (
            <span className="terminal-select-menu__option-primary">{placeholderLabel ?? ''}</span>
          )}
        </span>
        <svg className="terminal-select-menu__chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menuOpen && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={activeOptionId}
          tabIndex={0}
          className="terminal-select-menu__listbox"
          onKeyDown={handleListboxKeyDown}
        >
          {options.map((option, index) => {
            const isSelected = option.value === selectedValue;
            return (
              <button
                key={option.id}
                id={option.id}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                className={classNames(
                  'terminal-select-menu__option',
                  isSelected && 'terminal-select-menu__option--selected',
                  index === activeOptionIndex && 'terminal-select-menu__option--active',
                )}
                onMouseEnter={() => setActiveOptionIndex(index)}
                onClick={() => selectOption(index)}
              >
                <span className="terminal-select-menu__option-primary">{option.primaryLabel}</span>
                {option.secondaryLabel && (
                  <span className="terminal-select-menu__option-marker">{option.secondaryLabel}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TerminalSelectMenu;
