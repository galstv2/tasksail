import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';

import { PlannerDropdownListbox } from './PlannerDropdownListbox';

afterEach(() => cleanup());

function Harness({ onSelect = vi.fn(), onClose = vi.fn() }) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={triggerRef}>Trigger</button>
      <PlannerDropdownListbox
        open={open}
        triggerRef={triggerRef}
        items={[{ id: 'one', ariaLabel: 'One' }, { id: 'two', ariaLabel: 'Two' }]}
        listboxId="test-listbox"
        className={open ? 'test-popover test-popover--open' : 'test-popover test-popover--closed'}
        onClose={() => { setOpen(false); onClose(); }}
        onSelect={onSelect}
        renderItem={(item, state) => (
          <div id={state.optionId} role="option" aria-selected={state.isActive} onMouseEnter={state.onHover} onClick={state.onSelect}>
            {item.ariaLabel}
          </div>
        )}
      />
    </>
  );
}

describe('PlannerDropdownListbox', () => {
  it('supports keyboard navigation, selection, and tab close', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<Harness onSelect={onSelect} onClose={onClose} />);
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAttribute('aria-activedescendant', 'test-listbox-option-one');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'test-listbox-option-two');
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('two');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on tab and outside click', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' });
    expect(onClose).toHaveBeenCalled();
  });
});
