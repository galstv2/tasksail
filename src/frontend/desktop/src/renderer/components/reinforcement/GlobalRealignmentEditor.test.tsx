// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DocumentDraft } from '../../hooks/reinforcement/useRealignmentDocument';

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

    expect(screen.getByText(/Activate a context pack/)).toBeTruthy();
  });

  it('shows loading state', () => {
    render(<GlobalRealignmentEditor {...defaultProps({ loading: true })} />);

    expect(screen.getByText('Loading document...')).toBeTruthy();
  });

  it('shows load error', () => {
    render(<GlobalRealignmentEditor {...defaultProps({ loadError: 'Network error.' })} />);

    expect(screen.getByTestId('document-editor-error').textContent).toContain('Network error.');
  });

  it('renders field values as read-only text', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.getByTestId('doc-field-standingExpectations').textContent).toContain('Be precise');
    expect(screen.getByTestId('doc-field-behavioralGuidance').textContent).toContain('No guessing');
    expect(screen.getByTestId('doc-field-fairnessFraming').textContent).toContain('Equal treatment');
  });

  it('hides empty fields when other fields have entries', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.queryByTestId('doc-field-lessonsLearned')).toBeNull();
    expect(screen.queryByText('No entries yet.')).toBeNull();
  });

  it('shows updated date in source label', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.getByText(/Last updated 2026-03-22/)).toBeTruthy();
  });

  it('does not render save or discard buttons', () => {
    render(<GlobalRealignmentEditor {...defaultProps()} />);

    expect(screen.queryByTestId('doc-save')).toBeNull();
    expect(screen.queryByTestId('doc-discard')).toBeNull();
  });
});
