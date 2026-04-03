import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DocumentDraft, SaveState } from '../../hooks/useRealignmentDocument';

import GlobalRealignmentEditor from './GlobalRealignmentEditor';

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    hasActiveContextPack: true,
    draft: {
      standingExpectations: 'Be precise',
      behavioralGuidance: 'No guessing',
      lessonsLearned: '',
      fairnessFraming: 'Equal treatment',
    } as DocumentDraft,
    version: 3,
    updatedAt: '2026-03-22T10:00:00Z',
    loading: false,
    loadError: null,
    saveState: { status: 'idle' } as SaveState,
    dirty: false,
    onFieldChange: vi.fn(),
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    onReload: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('GlobalRealignmentEditor', () => {
  it('shows empty state when no context pack is active', () => {
    render(<GlobalRealignmentEditor {...defaultProps({ hasActiveContextPack: false })} />);

    expect(screen.getByText(/Activate a context pack/)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<GlobalRealignmentEditor {...defaultProps({ loading: true })} />);

    expect(screen.getByText('Loading document...')).toBeInTheDocument();
  });

  it('shows load error', () => {
    render(<GlobalRealignmentEditor {...defaultProps({ loadError: 'Network error.' })} />);

    expect(screen.getByTestId('document-editor-error')).toHaveTextContent('Network error.');
  });

  it('renders all four field textareas with values', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.getByTestId('doc-field-standingExpectations')).toHaveValue('Be precise');
    expect(screen.getByTestId('doc-field-behavioralGuidance')).toHaveValue('No guessing');
    expect(screen.getByTestId('doc-field-lessonsLearned')).toHaveValue('');
    expect(screen.getByTestId('doc-field-fairnessFraming')).toHaveValue('Equal treatment');
  });

  it('calls onFieldChange when textarea value changes', () => {
    const onFieldChange = vi.fn();
    render(<GlobalRealignmentEditor {...defaultProps({ onFieldChange })} />);

    fireEvent.change(screen.getByTestId('doc-field-lessonsLearned'), {
      target: { value: 'New lesson' },
    });

    expect(onFieldChange).toHaveBeenCalledWith('lessonsLearned', 'New lesson');
  });

  it('disables save when not dirty', () => {
    render(<GlobalRealignmentEditor {...defaultProps({ dirty: false })} />);

    expect(screen.getByTestId('doc-save')).toBeDisabled();
  });

  it('enables save when dirty', () => {
    render(<GlobalRealignmentEditor {...defaultProps({ dirty: true })} />);

    expect(screen.getByTestId('doc-save')).toBeEnabled();
  });

  it('calls onSave when save is clicked', () => {
    const onSave = vi.fn();
    render(<GlobalRealignmentEditor {...defaultProps({ dirty: true, onSave })} />);

    fireEvent.click(screen.getByTestId('doc-save'));

    expect(onSave).toHaveBeenCalled();
  });

  it('calls onDiscard when discard is clicked', () => {
    const onDiscard = vi.fn();
    render(<GlobalRealignmentEditor {...defaultProps({ dirty: true, onDiscard })} />);

    fireEvent.click(screen.getByTestId('doc-discard'));

    expect(onDiscard).toHaveBeenCalled();
  });

  it('shows success status after save', () => {
    render(
      <GlobalRealignmentEditor
        {...defaultProps({
          saveState: { status: 'saved', message: 'Document updated.' } as SaveState,
        })}
      />,
    );

    expect(screen.getByTestId('doc-status')).toHaveTextContent('Document updated.');
  });

  it('shows error status on save failure', () => {
    render(
      <GlobalRealignmentEditor
        {...defaultProps({
          saveState: { status: 'error', message: 'Permission denied.' } as SaveState,
        })}
      />,
    );

    expect(screen.getByTestId('doc-status')).toHaveTextContent('Permission denied.');
  });

  it('shows version and updated date', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.getByText('Version 3')).toBeInTheDocument();
    expect(screen.getByText('Updated 2026-03-22')).toBeInTheDocument();
  });

  it('shows saving text on save button during save', () => {
    render(
      <GlobalRealignmentEditor
        {...defaultProps({
          saveState: { status: 'saving' } as SaveState,
        })}
      />,
    );

    expect(screen.getByTestId('doc-save')).toHaveTextContent('Saving...');
  });

  it('shows conflict state with reload button', () => {
    const onReload = vi.fn();
    render(
      <GlobalRealignmentEditor
        {...defaultProps({
          saveState: {
            status: 'conflict',
            message: 'The document was modified externally.',
          } as SaveState,
          onReload,
        })}
      />,
    );

    const conflict = screen.getByTestId('doc-conflict');
    expect(conflict).toHaveTextContent('The document was modified externally.');

    fireEvent.click(screen.getByTestId('doc-reload'));
    expect(onReload).toHaveBeenCalled();
  });
});
