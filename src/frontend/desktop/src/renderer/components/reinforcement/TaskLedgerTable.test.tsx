// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReinforcementTaskEntry } from '../../../shared/desktopContract';
import TaskLedgerTable from './TaskLedgerTable';

afterEach(() => {
  cleanup();
});

function makeTask(overrides: Partial<ReinforcementTaskEntry> = {}): ReinforcementTaskEntry {
  return {
    taskId: 'T-1',
    title: 'Default task',
    difficulty: 'medium',
    effectiveReward: 100,
    settlementStatus: 'unrewarded',
    qualityOutcome: 'pass',
    year: '2026',
    ...overrides,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    hasActiveContextPack: true as boolean,
    tasks: [] as ReinforcementTaskEntry[],
    availableYears: ['2026'] as string[],
    selectedYear: null as string | null,
    loading: false,
    error: null as string | null,
    onSelectYear: vi.fn(),
    ...overrides,
  };
}

describe('TaskLedgerTable', () => {
  it('renders empty state when no active context pack', () => {
    render(<TaskLedgerTable {...defaultProps({ hasActiveContextPack: false })} />);
    expect(screen.getByTestId('ledger-empty')).toBeTruthy();
  });

  it('renders loading state', () => {
    render(<TaskLedgerTable {...defaultProps({ loading: true })} />);
    expect(screen.getByText('Loading tasks...')).toBeTruthy();
  });

  it('renders error state', () => {
    render(<TaskLedgerTable {...defaultProps({ error: 'Something broke' })} />);
    const el = screen.getByTestId('ledger-error');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Something broke');
  });

  it('renders task rows', () => {
    const tasks = [
      makeTask({ taskId: 'T-1', title: 'First task' }),
      makeTask({ taskId: 'T-2', title: 'Second task' }),
    ];
    render(<TaskLedgerTable {...defaultProps({ tasks })} />);
    expect(screen.getByTestId('ledger-rows')).toBeTruthy();
    expect(screen.getByTestId('ledger-row-T-1')).toBeTruthy();
    expect(screen.getByTestId('ledger-row-T-2')).toBeTruthy();
  });

  it('search filters rows', () => {
    const tasks = [
      makeTask({ taskId: 'T-1', title: 'Fix login bug' }),
      makeTask({ taskId: 'T-2', title: 'Add signup flow' }),
    ];
    render(<TaskLedgerTable {...defaultProps({ tasks })} />);

    const input = screen.getByTestId('ledger-search');
    fireEvent.change(input, { target: { value: 'login' } });

    expect(screen.getByTestId('ledger-row-T-1')).toBeTruthy();
    expect(screen.queryByTestId('ledger-row-T-2')).toBeNull();
  });

  it('shows no results message when search matches nothing', () => {
    const tasks = [makeTask({ taskId: 'T-1', title: 'Fix login bug' })];
    render(<TaskLedgerTable {...defaultProps({ tasks })} />);

    const input = screen.getByTestId('ledger-search');
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });

    expect(screen.getByTestId('ledger-no-results')).toBeTruthy();
  });

  it('year filter select appears with multiple years', () => {
    render(
      <TaskLedgerTable
        {...defaultProps({ availableYears: ['2026', '2025'], tasks: [makeTask()] })}
      />,
    );
    expect(screen.getByTestId('ledger-year-select')).toBeTruthy();
  });

  it('source label is visible', () => {
    render(<TaskLedgerTable {...defaultProps({ tasks: [makeTask()] })} />);
    const el = screen.getByTestId('ledger-source');
    expect(el.textContent).toContain('active context pack archive');
  });
});
