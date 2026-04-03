// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReinforcementOverviewData } from '../../../shared/desktopContract';
import ReinforcementOverviewPanel from './ReinforcementOverviewPanel';

afterEach(() => {
  cleanup();
});

function makeOverview(
  overrides: Partial<ReinforcementOverviewData> = {},
): ReinforcementOverviewData {
  return {
    totalTasks: 0,
    totalReward: 0,
    unrewardedCount: 0,
    streakProgress: 0,
    streakThreshold: 5,
    lastSettlementId: null,
    agents: [],
    ...overrides,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    hasActiveContextPack: true as boolean,
    overview: makeOverview() as ReinforcementOverviewData | null,
    loading: false,
    error: null as string | null,
    ...overrides,
  };
}

describe('ReinforcementOverviewPanel', () => {
  it('renders empty state when no active context pack', () => {
    render(
      <ReinforcementOverviewPanel
        {...defaultProps({ hasActiveContextPack: false })}
      />,
    );
    expect(screen.getByTestId('overview-empty')).toBeTruthy();
  });

  it('renders loading state', () => {
    render(
      <ReinforcementOverviewPanel
        {...defaultProps({ loading: true, overview: null })}
      />,
    );
    expect(screen.getByText('Loading overview...')).toBeTruthy();
  });

  it('renders error state', () => {
    render(
      <ReinforcementOverviewPanel
        {...defaultProps({ error: 'Failed', overview: makeOverview() })}
      />,
    );
    const el = screen.getByTestId('overview-error');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Failed');
  });

  it('renders summary stats', () => {
    const overview = makeOverview({
      totalTasks: 5,
      totalReward: 10000,
      streakProgress: 3,
      streakThreshold: 10,
      unrewardedCount: 2,
    });
    render(
      <ReinforcementOverviewPanel {...defaultProps({ overview })} />,
    );
    expect(screen.getByTestId('overview-total-tasks').textContent).toContain('5');
    expect(screen.getByTestId('overview-streak').textContent).toContain('3/10');
  });

  it('renders per-agent reward cards', () => {
    const overview = makeOverview({
      agents: [
        {
          agentId: 'software-engineer',
          role: 'Software Engineer',
          multiplier: 1.5,
          lifetimeReward: 5000,
          unrewardedTaskCount: 0,
          unrewardedRewardTotal: 0,
        },
      ],
    });
    render(
      <ReinforcementOverviewPanel {...defaultProps({ overview })} />,
    );
    const card = screen.getByTestId('agent-card-software-engineer');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('5,000');
  });

  it('renders last settlement id', () => {
    const overview = makeOverview({ lastSettlementId: 'S-123' });
    render(
      <ReinforcementOverviewPanel {...defaultProps({ overview })} />,
    );
    const el = screen.getByTestId('overview-last-settlement');
    expect(el.textContent).toContain('S-123');
  });
});
