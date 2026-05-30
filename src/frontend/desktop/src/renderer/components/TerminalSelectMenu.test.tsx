// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TerminalSelectMenu, { type TerminalSelectMenuOption } from './TerminalSelectMenu';

const OPTIONS: TerminalSelectMenuOption[] = [
  { value: 'a', id: 'opt-a', primaryLabel: 'Alpha' },
  { value: 'b', id: 'opt-b', primaryLabel: 'Beta' },
  { value: 'c', id: 'opt-c', primaryLabel: 'Gamma is a very long artifact label that truncates' },
];

function renderMenu(overrides: Partial<Parameters<typeof TerminalSelectMenu>[0]> = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  render(
    <TerminalSelectMenu
      options={OPTIONS}
      selectedValue="a"
      onSelect={onSelect}
      ariaLabel="Artifact Explorer"
      listboxId="test-listbox"
      {...overrides}
    />,
  );
  return { onSelect };
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Artifact Explorer' }));
  return screen.getByRole('listbox', { name: 'Artifact Explorer' });
}

describe('TerminalSelectMenu', () => {
  afterEach(() => cleanup());

  it('selects an option on click and closes the menu', () => {
    const { onSelect } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox', { name: 'Artifact Explorer' })).not.toBeInTheDocument();
  });

  it('opens from the trigger via Enter and via Space', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Artifact Explorer' });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('listbox', { name: 'Artifact Explorer' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Artifact Explorer' }), { key: 'Escape' });

    fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.getByRole('listbox', { name: 'Artifact Explorer' })).toBeInTheDocument();
  });

  it('navigates with ArrowDown/ArrowUp/Home/End and wraps at the edges', () => {
    renderMenu();
    const listbox = openMenu();
    expect(listbox).toHaveAttribute('aria-activedescendant', 'opt-a');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'opt-b');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'opt-a');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'opt-c');
    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'opt-a');
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'opt-c');
  });

  it('selects the active option with Enter', () => {
    const { onSelect } = renderMenu();
    const listbox = openMenu();
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Artifact Explorer' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Artifact Explorer' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Artifact Explorer' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('dismisses on Tab and on outside mousedown without restoring focus', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Artifact Explorer' });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Artifact Explorer' }), { key: 'Tab' });
    expect(screen.queryByRole('listbox', { name: 'Artifact Explorer' })).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox', { name: 'Artifact Explorer' })).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('marks the selected option and the active option', () => {
    renderMenu();
    const listbox = openMenu();
    const alpha = screen.getByRole('option', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(alpha).toHaveClass('terminal-select-menu__option--active');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveClass('terminal-select-menu__option--active');
  });

  it('renders a truncation hook class on long option labels', () => {
    renderMenu();
    openMenu();
    const longLabel = screen.getByText('Gamma is a very long artifact label that truncates');
    expect(longLabel).toHaveClass('terminal-select-menu__option-primary');
  });

  it('does not open when disabled', () => {
    renderMenu({ disabled: true });
    const trigger = screen.getByRole('button', { name: 'Artifact Explorer' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox', { name: 'Artifact Explorer' })).not.toBeInTheDocument();
  });
});
