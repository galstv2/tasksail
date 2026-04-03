import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PlannerBrokerSection from './PlannerBrokerSection';

afterEach(() => {
  cleanup();
});

describe('PlannerBrokerSection', () => {
  it('renders fallback copy when planner broker data is unavailable', () => {
    render(<PlannerBrokerSection />);

    expect(screen.getByText('Planner Broker')).toBeInTheDocument();
    expect(
      screen.getByText('The planning assistant has not been used yet. Start a planning session to see its status here.'),
    ).toBeInTheDocument();
  });

  it('renders compact planner broker turn telemetry', () => {
    render(
      <PlannerBrokerSection
        plannerBroker={{
          sessionId: 'planner-1',
          brokerStatus: 'completed',
          activeTurnId: null,
          queuedTurnCount: 0,
          copilotSessionId: 'copilot-session-1',
          lastTurnSource: 'resumed-session',
          lastTurnOutcome: 'completed',
          lastTurnAt: '2026-03-20T00:45:00.000Z',
          lastTurnHadContent: true,
          lastExitCode: 0,
          turnCount: 2,
          error: null,
        }}
      />,
    );

    expect(screen.getByText('Status: completed. Queue depth: 0. Turns run: 2.')).toBeInTheDocument();
    expect(
      screen.getByText('Last turn: Resumed session / Completed / content observed.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Active session: planner-1')).toBeInTheDocument();
  });
});
