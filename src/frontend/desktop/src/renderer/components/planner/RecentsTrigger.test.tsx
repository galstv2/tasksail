import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { RecentsTrigger, type RecentsTriggerProps } from './RecentsTrigger';

afterEach(() => {
  cleanup();
});

function makeProps(overrides: Partial<RecentsTriggerProps> = {}): RecentsTriggerProps {
  return {
    count: 0,
    loading: false,
    replayInFlight: false,
    replayingTitle: null,
    popoverOpen: false,
    onToggle: vi.fn(),
    ...overrides,
  };
}

describe('RecentsTrigger', () => {
  it('renders nothing when count is 0 and not loading', () => {
    const { container } = render(<RecentsTrigger {...makeProps()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the shimmer skeleton during first-load with no records', () => {
    render(<RecentsTrigger {...makeProps({ loading: true })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('recents-trigger-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('recents-trigger-skeleton').className).toContain(
      'recents-trigger--skeleton',
    );
  });

  it('renders "Recent Task" when records are present and keeps count in aria-label', () => {
    render(<RecentsTrigger {...makeProps({ count: 4 })} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-haspopup', 'listbox');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveAttribute('aria-controls', 'recents-listbox');
    expect(btn).toHaveAttribute('aria-label', 'Recent conversations, 4 available');
    expect(btn.textContent?.replace(/\s+/g, ' ').trim()).toBe('Recent Task');
  });

  it('renders the replay-aware label and goes non-interactive when replayInFlight', () => {
    render(
      <RecentsTrigger
        {...makeProps({
          count: 4,
          replayInFlight: true,
          replayingTitle: 'Refactor queue advancement gating subsystem',
        })}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-label', 'Replaying Refactor queue advancement gating subsystem');
    expect(btn).toHaveAttribute('tabindex', '-1');
    expect(btn.className).toContain('recents-trigger--replaying');
    expect(btn.textContent).toContain('Replaying');
    expect(btn.textContent).not.toContain('Refactor queue advancement gating subsystem');
  });

  it('reflects aria-expanded from popoverOpen', () => {
    render(<RecentsTrigger {...makeProps({ count: 4, popoverOpen: true })} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(btn.className).toContain('recents-trigger--open');
  });

  it('invokes onToggle exactly once on click', () => {
    const onToggle = vi.fn();
    render(<RecentsTrigger {...makeProps({ count: 4, onToggle })} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('forwards ref to the underlying button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<RecentsTrigger {...makeProps({ count: 4 })} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('renders the .recents-trigger className for focus-ring matching', () => {
    render(<RecentsTrigger {...makeProps({ count: 4 })} />);
    const btn = screen.getByRole('button');
    expect(btn.className.split(' ')).toContain('recents-trigger');
  });
});
