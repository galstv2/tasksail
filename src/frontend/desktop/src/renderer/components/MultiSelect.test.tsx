import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';

import MultiSelect, { computeMenuPosition, type MultiSelectOption } from './MultiSelect';

function makeRect(r: Partial<DOMRect>): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...r,
  } as DOMRect;
}

afterEach(cleanup);

const OPTIONS: MultiSelectOption[] = [
  { value: 'a', label: 'Alpha', trailingLabel: 'Skill', optionAriaLabel: 'Toggle Alpha (Skill)' },
  { value: 'b', label: 'Beta', trailingLabel: 'Plugin', optionAriaLabel: 'Toggle Beta (Plugin)' },
];

function setup(overrides: Partial<ComponentProps<typeof MultiSelect>> = {}) {
  const onToggle = vi.fn();
  render(
    <MultiSelect
      options={OPTIONS}
      selectedValues={[]}
      onToggle={onToggle}
      ariaLabel="Test options"
      triggerAriaLabel="Open test options"
      placeholder="Pick…"
      {...overrides}
    />,
  );
  return { onToggle };
}

describe('MultiSelect', () => {
  it('shows the placeholder and keeps the menu closed initially', () => {
    setup();
    const trigger = screen.getByLabelText('Open test options');
    expect(trigger).toHaveTextContent('Pick…');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('summarizes selected option labels on the trigger', () => {
    setup({ selectedValues: ['a', 'b'] });
    expect(screen.getByLabelText('Open test options')).toHaveTextContent('Alpha, Beta');
  });

  it('renders the open menu as a floating portal on document.body, not nested in the trigger box', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Open test options'));

    const listbox = screen.getByRole('listbox', { name: 'Test options' });
    // Portaled to body so it can float above (not grow) any scroll container.
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox.closest('.ts-multiselect')).toBeNull();
  });

  it('opens on click and renders each option with label left, category right, and selection state', () => {
    setup({ selectedValues: ['a'] });
    fireEvent.click(screen.getByLabelText('Open test options'));

    const listbox = screen.getByRole('listbox', { name: 'Test options' });
    const alpha = within(listbox).getByLabelText('Toggle Alpha (Skill)');
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(within(alpha).getByText('Alpha')).toBeTruthy();
    expect(within(alpha).getByText('Skill')).toBeTruthy();

    const beta = within(listbox).getByLabelText('Toggle Beta (Plugin)');
    expect(beta).toHaveAttribute('aria-selected', 'false');
  });

  it('toggles membership on option click without closing the menu', () => {
    const { onToggle } = setup({ selectedValues: ['a'] });
    fireEvent.click(screen.getByLabelText('Open test options'));

    fireEvent.click(screen.getByLabelText('Toggle Alpha (Skill)')); // selected -> deselect
    expect(onToggle).toHaveBeenCalledWith('a', false);

    fireEvent.click(screen.getByLabelText('Toggle Beta (Plugin)')); // unselected -> select
    expect(onToggle).toHaveBeenCalledWith('b', true);

    // Multi-select: the menu stays open after a toggle.
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    setup();
    const trigger = screen.getByLabelText('Open test options');
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByLabelText('Toggle Alpha (Skill)'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when clicking outside the control', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Open test options'));
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('stays open on mousedown inside the portaled menu', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Open test options'));
    // mousedown inside the (body-level) portaled menu must not dismiss it.
    fireEvent.mouseDown(screen.getByLabelText('Toggle Alpha (Skill)'));
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('closes and returns focus to the trigger on Tab', () => {
    setup();
    const trigger = screen.getByLabelText('Open test options');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByLabelText('Toggle Alpha (Skill)'), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('registers scroll (capture) + resize listeners on open and removes them on close', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    setup();

    fireEvent.click(screen.getByLabelText('Open test options'));
    const scrollAdd = addSpy.mock.calls.find(([type]) => type === 'scroll');
    expect(scrollAdd?.[2]).toBe(true); // capture phase
    expect(addSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true);

    fireEvent.keyDown(screen.getByLabelText('Toggle Alpha (Skill)'), { key: 'Escape' });
    expect(
      removeSpy.mock.calls.some(([type, , opts]) => type === 'scroll' && opts === true),
    ).toBe(true);
    expect(removeSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('disables the trigger when there are no options', () => {
    setup({ options: [] });
    expect(screen.getByLabelText('Open test options')).toBeDisabled();
  });

  it('opens via ArrowDown, focusing the first option, and toggles it with Enter', () => {
    const { onToggle } = setup();
    const trigger = screen.getByLabelText('Open test options');
    trigger.focus();

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const alpha = screen.getByLabelText('Toggle Alpha (Skill)');
    expect(document.activeElement).toBe(alpha);

    fireEvent.keyDown(alpha, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith('a', true);
  });
});

describe('computeMenuPosition', () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;

  function setViewport(width: number, height: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  afterEach(() => {
    setViewport(originalWidth, originalHeight);
  });

  it('anchors below the trigger when there is ample room', () => {
    setViewport(1024, 768);
    const pos = computeMenuPosition(makeRect({ top: 100, bottom: 120, left: 50, width: 200 }));
    expect(pos.top).toBe(124); // bottom + TRIGGER_GAP(4)
    expect(pos.bottom).toBeUndefined();
    expect(pos.left).toBe(50);
    expect(pos.width).toBe(200);
    expect(pos.maxHeight).toBe(240); // capped to PREFERRED_MAX_HEIGHT
  });

  it('flips above (bottom-anchored) when room below is tight and above is larger', () => {
    setViewport(1024, 768);
    const pos = computeMenuPosition(makeRect({ top: 740, bottom: 760, left: 50, width: 200 }));
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(768 - 740 + 4); // innerHeight - rect.top + TRIGGER_GAP
  });

  it('caps maxHeight to the available space in the chosen direction (no overflow floor)', () => {
    setViewport(1024, 200);
    // Near the bottom of a short viewport: above has 118px, below has 38px → flips up.
    const pos = computeMenuPosition(makeRect({ top: 130, bottom: 150, left: 50, width: 200 }));
    expect(pos.bottom).toBeDefined();
    expect(pos.maxHeight).toBe(118); // 130 - GAP(4) - PAD(8), never floored above available
  });

  it('caps width and clamps left so a viewport-wide trigger does not overflow', () => {
    setViewport(1024, 768);
    const pos = computeMenuPosition(makeRect({ top: 100, bottom: 120, left: 0, width: 2000 }));
    expect(pos.width).toBe(1024 - 2 * 8); // innerWidth - 2*VIEWPORT_PAD
    expect(pos.left).toBe(8); // VIEWPORT_PAD floor
  });
});
