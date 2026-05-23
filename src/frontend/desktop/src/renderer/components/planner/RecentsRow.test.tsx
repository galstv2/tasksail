import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { PlannerListConversationHistorySummary } from '../../../shared/desktopContractPlanner';
import { RecentsRow } from './RecentsRow';
import { formatPlannerDropdownTimestamp } from './parentArchiveTimestamp';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-04T14:30:00'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeRecord(
  overrides: Partial<PlannerListConversationHistorySummary> = {},
): PlannerListConversationHistorySummary {
  return {
    id: 'rec-001',
    title: 'Refactor queue advancement gating subsystem',
    createdAt: '2026-05-04T12:30:00',
    finalizedDestinationPath: '/tmp/conversation.json',
    messageCount: 12,
    taskKind: 'standard',
    scopeMode: 'pack',
    primaryRepoId: 'acme-svc',
    primaryFocusRelativePath: 'src/lib/queue.ts',
    ...overrides,
  };
}

describe('RecentsRow', () => {
  it('renders primary title and local timestamp', () => {
    render(
      <RecentsRow
        record={makeRecord()}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(screen.getByText('Refactor queue advancement gating subsystem')).toBeInTheDocument();
    expect(screen.queryByText('acme-svc')).toBeNull();
    expect(screen.getByText(formatPlannerDropdownTimestamp('2026-05-04T12:30:00')!)).toBeInTheDocument();
  });

  it('omits the taskKind chip for standard records', () => {
    render(
      <RecentsRow
        record={makeRecord({ taskKind: 'standard' })}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(screen.queryByText('child-task')).toBeNull();
  });

  it('renders the taskKind chip for child-task records', () => {
    render(
      <RecentsRow
        record={makeRecord({ taskKind: 'child-task' })}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(screen.getByText('child-task')).toBeInTheDocument();
  });

  it('exposes a tooltip with messageCount and primaryFocusRelativePath', () => {
    render(
      <RecentsRow
        record={makeRecord()}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    const row = screen.getByRole('option');
    expect(row).toHaveAttribute('title', '12 messages · src/lib/queue.ts');
  });

  it('omits the focus path from the tooltip when null', () => {
    render(
      <RecentsRow
        record={makeRecord({ primaryFocusRelativePath: null, messageCount: 1 })}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    const row = screen.getByRole('option');
    expect(row).toHaveAttribute('title', '1 message');
  });

  it('reflects aria-selected via isActive', () => {
    const { rerender } = render(
      <RecentsRow
        record={makeRecord()}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'false');
    rerender(
      <RecentsRow
        record={makeRecord()}
        isActive={true}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option').className).toContain('planner-picker-row--active');
  });

  it('emits onSelect on click', () => {
    const onSelect = vi.fn();
    render(
      <RecentsRow
        record={makeRecord()}
        isActive={false}
        isFirst={true}
        onSelect={onSelect}
        onHover={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('emits onHover on mouseenter', () => {
    const onHover = vi.fn();
    render(
      <RecentsRow
        record={makeRecord()}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={onHover}
      />,
    );
    fireEvent.mouseEnter(screen.getByRole('option'));
    expect(onHover).toHaveBeenCalledOnce();
  });

  it('marks the first row with the recents-row--first modifier', () => {
    render(
      <RecentsRow
        record={makeRecord()}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(screen.getByRole('option').className).toContain('planner-picker-row--first');
  });

  it('omits the first modifier for non-first rows', () => {
    render(
      <RecentsRow
        record={makeRecord()}
        isActive={false}
        isFirst={false}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(screen.getByRole('option').className).not.toContain('planner-picker-row--first');
  });

  it('uses the record id in the option dom id (for aria-activedescendant)', () => {
    render(
      <RecentsRow
        record={makeRecord({ id: 'rec-xyz' })}
        isActive={false}
        isFirst={true}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    expect(screen.getByRole('option')).toHaveAttribute('id', 'recents-row-rec-xyz');
  });
});
