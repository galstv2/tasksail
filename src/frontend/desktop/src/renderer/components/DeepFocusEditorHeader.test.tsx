// @vitest-environment jsdom

import { createRef } from 'react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeepFocusEditorHeader } from './DeepFocusEditorHeader';
import { makeDeepFocusEditorModel } from './useDeepFocusEditorModel.testFactory';

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

function renderHeader(props: Partial<Parameters<typeof DeepFocusEditorHeader>[0]> = {}) {
  const onQueryChange = vi.fn();
  const onClearSearch = vi.fn();
  const onToggleExpansion = vi.fn();
  const result = render(
    <DeepFocusEditorHeader
      model={props.model ?? makeDeepFocusEditorModel()}
      breadcrumbs={{ visibleBreadcrumbs: [], hiddenBreadcrumbs: [] }}
      searchInputRef={createRef<HTMLInputElement>()}
      onQueryChange={props.onQueryChange ?? onQueryChange}
      onClearSearch={props.onClearSearch ?? onClearSearch}
      onToggleExpansion={props.onToggleExpansion ?? onToggleExpansion}
      expansionMode={props.expansionMode ?? 'expand'}
      expansionBusy={props.expansionBusy ?? false}
    />,
  );
  return { ...result, onQueryChange, onClearSearch, onToggleExpansion };
}

describe('DeepFocusEditorHeader', () => {
  it('does not render a Deep Focus heading or summary chip (those moved out of the editor)', () => {
    renderHeader({ model: makeDeepFocusEditorModel() });
    expect(screen.queryByRole('heading', { name: 'Deep Focus' })).not.toBeInTheDocument();
    expect(document.querySelector('.deep-focus-editor-header__summary-chip')).toBeNull();
    expect(document.querySelector('.deep-focus-editor-header__identity-row')).toBeNull();
  });

  it('does not render Clear All, Cancel/Done, Apply, or a dismiss button (they live elsewhere)', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear all selections/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close editor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel unapplied changes' })).not.toBeInTheDocument();
  });

  it('renders the search input as the first row of the header', () => {
    const { container } = renderHeader();
    const header = container.querySelector('.deep-focus-editor-header') as HTMLElement;
    const firstRow = header.firstElementChild as HTMLElement;
    expect(firstRow.classList.contains('deep-focus-editor-header__search-row')).toBe(true);
  });

  it('wires onQueryChange and onClearSearch through the search input', () => {
    const { onQueryChange, onClearSearch } = renderHeader({
      model: makeDeepFocusEditorModel({ search: { query: 'use', active: true } }),
    });
    fireEvent.change(screen.getByPlaceholderText('Search files and folders'), {
      target: { value: 'user' },
    });
    expect(onQueryChange).toHaveBeenCalledWith('user');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it('renders an Expand All button when nothing is expanded and a Collapse All button when something is', () => {
    const expandSpy = vi.fn();
    const { rerender } = renderHeader({
      expansionMode: 'expand',
      onToggleExpansion: expandSpy,
    });
    const expandButton = screen.getByRole('button', { name: 'Expand all folders' });
    expect(expandButton).not.toBeDisabled();
    fireEvent.click(expandButton);
    expect(expandSpy).toHaveBeenCalledTimes(1);

    const collapseSpy = vi.fn();
    rerender(
      <DeepFocusEditorHeader
        model={makeDeepFocusEditorModel()}
        breadcrumbs={{ visibleBreadcrumbs: [], hiddenBreadcrumbs: [] }}
        searchInputRef={createRef<HTMLInputElement>()}
        onQueryChange={vi.fn()}
        onClearSearch={vi.fn()}
        onToggleExpansion={collapseSpy}
        expansionMode="collapse"
        expansionBusy={false}
      />,
    );
    const collapseButton = screen.getByRole('button', { name: 'Collapse all folders' });
    expect(collapseButton).not.toBeDisabled();
    fireEvent.click(collapseButton);
    expect(collapseSpy).toHaveBeenCalledTimes(1);
  });

  it('disables the toggle while expansionBusy is true', () => {
    renderHeader({ expansionMode: 'expand', expansionBusy: true });
    const button = screen.getByRole('button', { name: 'Expand all folders' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
