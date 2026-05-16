// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
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
    analysisRun: { status: 'idle' as const },
    onRunAnalysis: vi.fn(),
    onDismissRealignment: vi.fn(),
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
    expect(screen.getByTestId('realignment-source').textContent).toContain(
      'Click an open task',
    );
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

  it('shows start button enabled when a runnable session is selected', () => {
    const session = makeSession();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          selectedSession: session,
          selectedSessionId: session.realignmentId,
        })}
      />,
    );
    const btn = screen.getByTestId('realignment-start');
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('locks starting another realignment while one is running', () => {
    const session = makeSession();
    const running = makeSession({ realignmentId: 'RA-2', triggerTaskId: 'T-2', status: 'running' });
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          sessions: [session, running],
          selectedSession: session,
          selectedSessionId: session.realignmentId,
        })}
      />,
    );
    const btn = screen.getByTestId('realignment-start');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('realignment-lock-hint').textContent).toContain('in progress');
  });

  it('labels running sessions as in progress', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          sessions: [makeSession({ status: 'running' })],
        })}
      />,
    );
    expect(screen.getByText('In Progress')).toBeTruthy();
  });

  it('shows confirmation dialog and runs analysis for the selected session on confirm', () => {
    const session = makeSession();
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
    fireEvent.click(screen.getByTestId('realignment-start'));
    expect(onRunAnalysis).not.toHaveBeenCalled();
    expect(screen.getByText('Start corrective realignment?')).toBeTruthy();

    fireEvent.click(screen.getByText('Start realignment'));
    expect(onRunAnalysis).toHaveBeenCalledWith('RA-1');
  });

  it('does not show top-level start controls until a session is selected', () => {
    render(
      <RealignmentReviewPanel
        {...defaultProps()}
      />,
    );
    expect(screen.queryByTestId('realignment-start')).toBeNull();
    expect(screen.queryByTestId('realignment-select-hint')).toBeNull();
  });

  it('confirms before dismissing a selected realignment', () => {
    const session = makeSession();
    const onDismissRealignment = vi.fn();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          selectedSession: session,
          selectedSessionId: session.realignmentId,
          onDismissRealignment,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('realignment-dismiss'));
    expect(onDismissRealignment).not.toHaveBeenCalled();
    expect(screen.getByText('Dismiss realignment?')).toBeTruthy();

    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismissRealignment).toHaveBeenCalledWith('RA-1');
  });

  it('shows retry copy for failed realignments', () => {
    const session = makeSession({ status: 'error' });
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          selectedSession: session,
          selectedSessionId: session.realignmentId,
        })}
      />,
    );

    expect(screen.getByTestId('realignment-start').textContent).toBe('Retry Corrective Realignment');
  });

  it('shows the start control in detail view', () => {
    const session = makeSession();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          selectedSession: session,
          selectedSessionId: session.realignmentId,
        })}
      />,
    );
    expect(screen.getByTestId('realignment-guard')).toBeTruthy();
  });

  it('does not render per-row analysis buttons', () => {
    const session = makeSession();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          sessions: [session],
        })}
      />,
    );

    expect(screen.queryByTestId('realignment-run-RA-1')).toBeNull();
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

    expect(screen.getByTestId('realignment-run-message-RA-1').textContent).toContain(
      'already running',
    );
  });
});
