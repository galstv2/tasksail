// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import type { ActiveWorkGuardState } from '../../hooks/useActiveWorkGuard';
import RealignmentReviewPanel from './RealignmentReviewPanel';

afterEach(() => {
  cleanup();
});

function makeSession(
  overrides: Partial<ReinforcementRealignmentSessionEntry> = {},
): ReinforcementRealignmentSessionEntry {
  return {
    realignmentId: 'RA-1',
    triggerTaskId: 'T-1',
    triggerFeedbackId: 'FB-1',
    participatingAgents: ['provider-builder', 'provider-qa'],
    failureAnalysis: 'Test gap',
    rootCause: 'Missing edge case',
    correctiveActions: ['Add coverage'],
    status: 'open',
    meetingNotes: 'Discussed fixes.',
    createdAt: '2026-03-22T00:00:00Z',
    ...overrides,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    hasActiveContextPack: true as boolean,
    sessions: [makeSession()] as ReinforcementRealignmentSessionEntry[],
    selectedSession: null as ReinforcementRealignmentSessionEntry | null,
    selectedSessionId: null as string | null,
    loading: false,
    error: null as string | null,
    onSelectSession: vi.fn(),
    activeWorkGuard: { status: 'allowed', hasUnprocessedFeedback: true } as ActiveWorkGuardState,
    onStartRealignment: vi.fn(),
    analysisRun: { status: 'idle' as const },
    onRunAnalysis: vi.fn(),
    ...overrides,
  };
}

describe('RealignmentReviewPanel', () => {
  it('renders empty state when no active context pack', () => {
    render(<RealignmentReviewPanel {...defaultProps({ hasActiveContextPack: false })} />);
    expect(screen.getByTestId('realignment-empty')).toBeTruthy();
  });

  it('renders error state', () => {
    render(<RealignmentReviewPanel {...defaultProps({ error: 'Failed to load' })} />);
    const errorEl = screen.getByTestId('realignment-error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).toBe('Failed to load');
  });

  it('renders loading state', () => {
    render(<RealignmentReviewPanel {...defaultProps({ loading: true })} />);
    expect(screen.getByText('Loading sessions...')).toBeTruthy();
  });

  it('renders session list when sessions exist', () => {
    render(<RealignmentReviewPanel {...defaultProps()} />);
    expect(screen.getByTestId('session-list')).toBeTruthy();
  });

  it('renders empty session list message when no sessions', () => {
    render(<RealignmentReviewPanel {...defaultProps({ sessions: [] })} />);
    expect(screen.getByTestId('session-list-empty')).toBeTruthy();
  });

  it('renders session detail when a session is selected', () => {
    const session = makeSession();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          selectedSession: session,
          selectedSessionId: session.realignmentId,
        })}
      />,
    );
    expect(screen.getByTestId('session-detail')).toBeTruthy();
  });

  it('calls onSelectSession when session item clicked', () => {
    const onSelectSession = vi.fn();
    render(
      <RealignmentReviewPanel {...defaultProps({ onSelectSession })} />,
    );

    fireEvent.click(screen.getByTestId('session-item-RA-1'));

    expect(onSelectSession).toHaveBeenCalledWith('RA-1');
  });

  it('calls onSelectSession(null) when back button clicked in detail', () => {
    const onSelectSession = vi.fn();
    const session = makeSession();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          onSelectSession,
          selectedSession: session,
          selectedSessionId: session.realignmentId,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('session-detail-back'));

    expect(onSelectSession).toHaveBeenCalledWith(null);
  });

  it('shows start button enabled when guard is allowed', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({ activeWorkGuard: { status: 'allowed', hasUnprocessedFeedback: true } })}
      />,
    );
    const btn = screen.getByTestId('realignment-start');
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows start button disabled when guard is blocked', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          activeWorkGuard: {
            status: 'blocked',
            message: 'Active work exists',
            activeTaskId: 'T-1',
          },
        })}
      />,
    );
    const btn = screen.getByTestId('realignment-start');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    const blockedEl = screen.getByTestId('realignment-guard-blocked');
    expect(blockedEl.textContent).toContain('Active work exists');
  });

  it('shows checking text when guard is loading', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({ activeWorkGuard: { status: 'loading' } })}
      />,
    );
    const btn = screen.getByTestId('realignment-start');
    expect(btn.textContent).toBe('Checking...');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows confirmation dialog and calls onStartRealignment on confirm', () => {
    const onStartRealignment = vi.fn();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          activeWorkGuard: { status: 'allowed', hasUnprocessedFeedback: true },
          onStartRealignment,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('realignment-start'));
    expect(onStartRealignment).not.toHaveBeenCalled();
    expect(screen.getByText('Start corrective realignment?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Start realignment'));
    expect(onStartRealignment).toHaveBeenCalled();
  });

  it('disables start button when no unprocessed feedback exists', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          activeWorkGuard: { status: 'allowed', hasUnprocessedFeedback: false },
        })}
      />,
    );
    expect(screen.getByTestId('realignment-start')).toBeDisabled();
  });

  it('does not show guard section in detail view', () => {
    const session = makeSession();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          selectedSession: session,
          selectedSessionId: session.realignmentId,
        })}
      />,
    );
    expect(screen.queryByTestId('realignment-guard')).toBeNull();
  });

  it('renders Run analysis for open sessions and calls onRunAnalysis', () => {
    const onRunAnalysis = vi.fn();
    render(<RealignmentReviewPanel {...defaultProps({ onRunAnalysis })} />);

    const btn = screen.getByTestId('realignment-run-RA-1');
    expect(btn.textContent).toBe('Run analysis');

    fireEvent.click(btn);

    expect(onRunAnalysis).toHaveBeenCalledWith('RA-1');
  });

  it('renders Re-run analysis for error sessions', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          sessions: [makeSession({ status: 'error' })],
        })}
      />,
    );

    expect(screen.getByTestId('realignment-run-RA-1').textContent).toBe('Re-run analysis');
  });

  it('does not render analysis action for archived sessions', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          sessions: [makeSession({ status: 'archived' })],
        })}
      />,
    );

    expect(screen.queryByTestId('realignment-run-RA-1')).toBeNull();
  });

  it('renders the same analysis action in detail view', () => {
    const session = makeSession({ status: 'error' });
    const onRunAnalysis = vi.fn();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          selectedSession: session,
          selectedSessionId: session.realignmentId,
          onRunAnalysis,
        })}
      />,
    );

    const btn = screen.getByTestId('realignment-detail-run-RA-1');
    expect(btn.textContent).toBe('Re-run analysis');

    fireEvent.click(btn);

    expect(onRunAnalysis).toHaveBeenCalledWith('RA-1');
  });

  it('shows skipped lock contention message without changing session rendering', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          analysisRun: {
            status: 'skipped',
            realignmentId: 'RA-1',
            message: 'Realignment analysis is already running for this session.',
          },
        })}
      />,
    );

    expect(screen.getByTestId('realignment-run-RA-1').textContent).toBe('Run analysis');
    expect(screen.getByTestId('realignment-run-message-RA-1').textContent).toContain(
      'already running',
    );
  });

  it('does not gate session analysis actions on active-work guard state', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          activeWorkGuard: {
            status: 'blocked',
            message: 'Active work exists',
            activeTaskId: 'T-1',
          },
        })}
      />,
    );

    expect(screen.getByTestId('realignment-start')).toBeDisabled();
    expect(screen.getByTestId('realignment-run-RA-1')).not.toBeDisabled();
  });
});
