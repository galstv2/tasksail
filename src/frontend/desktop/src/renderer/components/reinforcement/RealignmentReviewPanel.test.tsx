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
    participatingAgents: ['software-engineer', 'qa'],
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
    activeWorkGuard: { status: 'allowed' } as ActiveWorkGuardState,
    onStartRealignment: vi.fn(),
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
        {...defaultProps({ activeWorkGuard: { status: 'allowed' } })}
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

  it('calls onStartRealignment when start button clicked', () => {
    const onStartRealignment = vi.fn();
    render(
      <RealignmentReviewPanel
        {...defaultProps({
          activeWorkGuard: { status: 'allowed' },
          onStartRealignment,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('realignment-start'));
    expect(onStartRealignment).toHaveBeenCalled();
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
});
