import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DocumentDraft } from '../../hooks/useRealignmentDocument';

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
    updatedAt: '2026-03-22T10:00:00Z',
    loading: false,
    loadError: null,
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

  it('renders field values as read-only text', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.getByTestId('doc-field-standingExpectations')).toHaveTextContent('Be precise');
    expect(screen.getByTestId('doc-field-behavioralGuidance')).toHaveTextContent('No guessing');
    expect(screen.getByTestId('doc-field-fairnessFraming')).toHaveTextContent('Equal treatment');
  });

  it('shows placeholder for empty fields', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.getByTestId('doc-field-lessonsLearned')).toHaveTextContent('No entries yet.');
  });

  it('shows updated date in source label', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.getByText(/Last updated 2026-03-22/)).toBeInTheDocument();
  });

  it('does not render save or discard buttons', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.queryByTestId('doc-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('doc-discard')).not.toBeInTheDocument();
  });
});
