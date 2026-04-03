import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentTerminalSession } from '../../shared/desktopContract';
import AgentTaskSessionsBlock from './AgentTaskSessionsBlock';

afterEach(() => {
  cleanup();
});

function makeSession(overrides: Partial<AgentTerminalSession> = {}): AgentTerminalSession {
  return {
    taskId: 'TASK-1',
    agentId: 'software-engineer',
    agentLabel: 'Dalton (Software Engineer)',
    sessionId: 'sess-1',
    instanceId: null,
    launchPid: null,
    liveness: 'alive',
    stuckState: 'none',
    stuckReason: null,
    sliceId: null,
    slicePath: null,
    launchState: 'started',
    terminalState: 'running',
    lastUpdatedAt: '2026-03-12T10:00:00Z',
    latestOutputLines: [],
    stdoutLogPath: null,
    stderrLogPath: null,
    severity: 'info',
    ...overrides,
  };
}

const defaultProps = {
  title: 'Agent sessions',
  meta: 'observed terminals',
  emptyMessage: 'No sessions observed.',
  agentTerminalSessions: [] as AgentTerminalSession[],
};

describe('AgentTaskSessionsBlock', () => {
  it('shows empty message when no sessions', () => {
    render(<AgentTaskSessionsBlock {...defaultProps} />);
    expect(screen.getByText('No sessions observed.')).toBeInTheDocument();
  });

  it('renders session with agent label and severity', () => {
    const sessions = [makeSession()];
    render(<AgentTaskSessionsBlock {...defaultProps} agentTerminalSessions={sessions} />);
    expect(screen.getByText('Dalton (Software Engineer)')).toBeInTheDocument();
    expect(screen.getByText('info')).toBeInTheDocument();
  });

  it('renders multiple sessions', () => {
    const sessions = [
      makeSession({ sessionId: 's1', agentLabel: 'Agent One' }),
      makeSession({ sessionId: 's2', agentLabel: 'Agent Two' }),
    ];
    render(<AgentTaskSessionsBlock {...defaultProps} agentTerminalSessions={sessions} />);
    expect(screen.getByText('Agent One')).toBeInTheDocument();
    expect(screen.getByText('Agent Two')).toBeInTheDocument();
  });

  it('shows terminal state chips', () => {
    const sessions = [makeSession({ terminalState: 'running', launchState: 'started' })];
    render(<AgentTaskSessionsBlock {...defaultProps} agentTerminalSessions={sessions} />);
    expect(screen.getByText('Terminal running')).toBeInTheDocument();
    expect(screen.getByText('Launch started')).toBeInTheDocument();
  });

  it('shows output excerpt when available', () => {
    const sessions = [makeSession({ latestOutputLines: ['Line 1', 'Line 2'] })];
    render(<AgentTaskSessionsBlock {...defaultProps} agentTerminalSessions={sessions} />);
    expect(screen.getByText(/Line 1/)).toBeInTheDocument();
    expect(screen.getByText(/Line 2/)).toBeInTheDocument();
  });
});
