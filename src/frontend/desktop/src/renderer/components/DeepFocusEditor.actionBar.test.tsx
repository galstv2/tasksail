// @vitest-environment jsdom

import { createRef } from 'react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeepFocusEditor } from './DeepFocusEditor';
import { makeDeepFocusEditorModel } from './useDeepFocusEditorModel.testFactory';

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

type RenderOpts = {
  hasUnappliedChanges?: boolean;
  applyDisabled?: boolean;
  onClearAll?: ReturnType<typeof vi.fn>;
  onExit?: ReturnType<typeof vi.fn>;
  onApply?: ReturnType<typeof vi.fn>;
};

function renderEditor(opts: RenderOpts = {}) {
  const onClearAll = opts.onClearAll ?? vi.fn();
  const onExit = opts.onExit ?? vi.fn();
  const onApply = opts.onApply ?? vi.fn();
  const result = render(
    <DeepFocusEditor
      model={makeDeepFocusEditorModel()}
      breadcrumbs={{ visibleBreadcrumbs: [], hiddenBreadcrumbs: [] }}
      nav={{
        onClearAll,
        onExit,
        onApply,
        applyDisabled: opts.applyDisabled ?? false,
        hasUnappliedChanges: opts.hasUnappliedChanges ?? false,
      }}
      selectedRowActions={{ onAction: vi.fn() }}
      search={{
        inputRef: createRef<HTMLInputElement>(),
        onQueryChange: vi.fn(),
        onClear: vi.fn(),
      }}
      scopeStrip={{
        primaries: [],
        cursor: { kind: 'global' },
        draftTopLevel: { label: 'Frontend', rootPath: '/' },
        exitingPrimaryKey: null,
        focusRequest: null,
        onSelectCursor: vi.fn(),
        onFocusRequestHandled: vi.fn(),
      }}
      tree={{
        focusedIndex: -1,
        focusedKey: null,
        rowRef: vi.fn(),
        onRowFocus: vi.fn(),
        onRowSelect: vi.fn(),
        onToggleExpand: vi.fn(),
      }}
      footer={{ undoStack: [], applyError: null, onRestoreLastUndo: vi.fn() }}
      promotion={{ onPromoteTest: vi.fn(), onPromoteSupport: vi.fn() }}
      onToggleExpansion={vi.fn()}
      expansionMode="expand"
      expansionBusy={false}
      onEditorKeyDown={vi.fn()}
    />,
  );
  return { ...result, onClearAll, onExit, onApply };
}

describe('DeepFocusEditor action bar', () => {
  it('renders Clear All / Done / [no Apply] in left-to-right order when clean', () => {
    const { container } = renderEditor({ hasUnappliedChanges: false });
    const actions = container.querySelector('.deep-focus-footer__actions') as HTMLElement;
    expect(actions).not.toBeNull();
    const buttonText = within(actions)
      .getAllByRole('button')
      .map((node) => node.textContent?.trim());
    expect(buttonText).toEqual(['Clear All', 'Done']);
    expect(within(actions).queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('renders Apply (and disables it via applyDisabled) when dirty', () => {
    const { container } = renderEditor({ hasUnappliedChanges: true, applyDisabled: true });
    const actions = container.querySelector('.deep-focus-footer__actions') as HTMLElement;
    const buttonText = within(actions)
      .getAllByRole('button')
      .map((node) => node.textContent?.trim());
    expect(buttonText).toEqual(['Clear All', 'Cancel', 'Apply']);
    expect(within(actions).getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('flips Done/Cancel copy with hasUnappliedChanges', () => {
    const clean = renderEditor({ hasUnappliedChanges: false });
    expect(within(clean.container.querySelector('.deep-focus-footer__actions') as HTMLElement)
      .getByText('Done')).toBeInTheDocument();
    cleanup();

    const dirty = renderEditor({ hasUnappliedChanges: true });
    expect(within(dirty.container.querySelector('.deep-focus-footer__actions') as HTMLElement)
      .getByText('Cancel')).toBeInTheDocument();
  });

  it('wires onClearAll, onExit, and onApply through the action bar buttons', () => {
    const { container, onClearAll, onExit, onApply } = renderEditor({ hasUnappliedChanges: true });
    const actions = container.querySelector('.deep-focus-footer__actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('button', { name: 'Clear all selections' }));
    fireEvent.click(within(actions).getByText('Cancel'));
    fireEvent.click(within(actions).getByRole('button', { name: 'Apply' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('keeps the action bar above the existing footer error/toast slots', () => {
    const { container } = renderEditor({ hasUnappliedChanges: false });
    const footer = container.querySelector('.deep-focus-footer') as HTMLElement;
    const children = Array.from(footer.children);
    const actionsIndex = children.findIndex((node) =>
      node.classList.contains('deep-focus-footer__actions'));
    expect(actionsIndex).toBe(0);
  });
});
