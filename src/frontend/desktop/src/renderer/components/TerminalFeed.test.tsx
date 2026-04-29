import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import TerminalFeed from './TerminalFeed';
import type { TerminalFeedProps } from './TerminalFeed';
import type { StreamEvent } from '../activityStream';
import { createObservabilitySnapshot } from '../../test';

afterEach(() => {
  cleanup();
});

function makeEvent(overrides: Partial<StreamEvent> = {}): StreamEvent {
  return {
    id: 'evt-1',
    timestamp: '10:05:30',
    role: 'workflow',
    source: 'test',
    taskId: 'TASK-1',
    severity: 'info',
    message: 'Agent started',
    ...overrides,
  };
}

function makeObservabilitySnapshot(
  ...args: Parameters<typeof createObservabilitySnapshot>
) {
  return createObservabilitySnapshot(...args);
}

function renderFeed(overrides: Partial<TerminalFeedProps> = {}) {
  const props: TerminalFeedProps = {
    activityStream: [],
    observabilitySnapshot: null,
    environmentStatus: null,
    ...overrides,
  };
  return render(<TerminalFeed {...props} />);
}

describe('TerminalFeed', () => {
  it('renders terminal chrome with title', () => {
    renderFeed();
    const feed = screen.getByLabelText('Terminal feed');
    expect(feed.querySelector('.terminal-feed__title')).toHaveTextContent('Terminal');
  });

  it('renders role filter tabs (All, Planner, Queue, Workflow, System)', () => {
    renderFeed();
    const tablist = screen.getByRole('tablist', { name: 'Role filter' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'All',
      'Planner',
      'Queue',
      'Workflow',
      'System',
    ]);
  });

  it('renders stream events as CLI-style lines with timestamp and role', () => {
    const events = [
      makeEvent({ id: 'e1', role: 'planner', message: 'Planning started' }),
      makeEvent({ id: 'e2', role: 'workflow', message: 'Workflow running' }),
    ];
    renderFeed({ activityStream: events });

    const lines = document.querySelectorAll('.terminal-line');
    expect(lines).toHaveLength(2);

    const firstLine = lines[0];
    expect(firstLine.querySelector('.terminal-timestamp')?.textContent).toBe('[10:05:30]');
    expect(firstLine.querySelector('.terminal-role')).toHaveClass('terminal-role--planner');
    expect(firstLine.querySelector('.terminal-message')?.textContent).toBe('Planning started');
  });

  it('clicking a role tab filters visible events', () => {
    const events = [
      makeEvent({ id: 'e1', role: 'planner', message: 'Plan msg' }),
      makeEvent({ id: 'e2', role: 'queue', message: 'Queue msg' }),
      makeEvent({ id: 'e3', role: 'workflow', message: 'Workflow msg' }),
    ];
    renderFeed({ activityStream: events });

    // Initially all visible
    expect(document.querySelectorAll('.terminal-line')).toHaveLength(3);

    // Click Planner tab
    fireEvent.click(screen.getByRole('tab', { name: 'Planner' }));
    const lines = document.querySelectorAll('.terminal-line');
    expect(lines).toHaveLength(1);
    expect(lines[0].querySelector('.terminal-message')?.textContent).toBe('Plan msg');
  });

  it('severity toggle filters to warnings and errors only', () => {
    const events = [
      makeEvent({ id: 'e1', severity: 'info', message: 'Info msg' }),
      makeEvent({ id: 'e2', severity: 'warning', message: 'Warn msg' }),
      makeEvent({ id: 'e3', severity: 'error', message: 'Error msg' }),
    ];
    renderFeed({ activityStream: events });

    expect(document.querySelectorAll('.terminal-line')).toHaveLength(3);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const filtered = document.querySelectorAll('.terminal-line');
    expect(filtered).toHaveLength(2);
    expect(filtered[0].querySelector('.terminal-message')?.textContent).toBe('Warn msg');
    expect(filtered[1].querySelector('.terminal-message')?.textContent).toBe('Error msg');
  });

  it('system details drawer toggle exists and defaults to closed', () => {
    renderFeed({ observabilitySnapshot: makeObservabilitySnapshot() });

    const toggle = screen.getByRole('button', { name: /system details/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('System details')).not.toBeInTheDocument();
  });

  it('clicking the drawer toggle opens and closes the drawer', () => {
    renderFeed({ observabilitySnapshot: makeObservabilitySnapshot() });

    const toggle = screen.getByRole('button', { name: /system details/i });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('System details')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('System details')).not.toBeInTheDocument();
  });

  it('observability sub-components render inside the open drawer', () => {
    renderFeed({
      observabilitySnapshot: makeObservabilitySnapshot({
        plannerBroker: {
          sessionId: 'planner-1',
          brokerStatus: 'completed',
          activeTurnId: null,
          queuedTurnCount: 0,
          cliSessionId: 'copilot-session-1',
          lastTurnSource: 'resumed-session',
          lastTurnOutcome: 'completed',
          lastTurnAt: '2026-03-20T00:45:00.000Z',
          lastTurnHadContent: true,
          lastExitCode: 0,
          turnCount: 2,
          error: null,
        },
        lifecycle: [{ state: 'active', detail: 'Running', observed: true }],
        artifactReferences: [],
        policyBoundary: 'standard',
        message: 'Observability active',
      }),
    });

    const toggle = screen.getByRole('button', { name: /system details/i });
    fireEvent.click(toggle);

    const drawer = screen.getByLabelText('System details');
    expect(within(drawer).getByText('Workflow Progress')).toBeInTheDocument();
    expect(within(drawer).getByText('Task Files')).toBeInTheDocument();
    expect(within(drawer).getByText('Planner Broker')).toBeInTheDocument();
    expect(within(drawer).getByText('Permissions')).toBeInTheDocument();
    expect(within(drawer).getByText('Environment')).toBeInTheDocument();
  });

  it('renders blinking cursor', () => {
    renderFeed();
    const cursor = document.querySelector('.terminal-cursor');
    expect(cursor).toBeInTheDocument();
    expect(cursor).toHaveAttribute('aria-hidden', 'true');
  });
});
