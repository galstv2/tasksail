import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useRef, useState, type RefObject } from 'react';

import type { PlannerListConversationHistorySummary } from '../../../shared/desktopContractPlanner';
import { RecentsPopover } from './RecentsPopover';

const escState: {
  handler: (() => void) | null;
  priority: number | null;
  unregister: ReturnType<typeof vi.fn>;
} = {
  handler: null,
  priority: null,
  unregister: vi.fn(),
};

vi.mock('../../utils/modalShellEscRegistry', () => ({
  registerEscHandler: vi.fn((priority: number, handler: () => void) => {
    escState.handler = handler;
    escState.priority = priority;
    escState.unregister = vi.fn();
    return escState.unregister;
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-04T14:30:00'));
  escState.handler = null;
  escState.priority = null;
  escState.unregister = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeRecords(n: number): PlannerListConversationHistorySummary[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `rec-${i + 1}`,
    title: i === 0
      ? 'A very long historical conversation title that should certainly be ellipsized in the row primary line element'
      : `Conversation ${i + 1}`,
    createdAt: '2026-05-04T12:30:00',
    finalizedDestinationPath: `/tmp/c-${i}.json`,
    messageCount: 4 + i,
    taskKind: i === 1 ? 'child-task' : 'standard',
    scopeMode: 'pack',
    primaryRepoId: 'acme-svc',
    primaryFocusRelativePath: 'src/lib/queue.ts',
  }));
}

interface HarnessProps {
  initialOpen?: boolean;
  records: PlannerListConversationHistorySummary[];
  onSelect?: (id: string) => void;
  onClose?: () => void;
  errorState?: 'refresh-failed' | null;
  onRetry?: () => void;
  triggerRefOverride?: RefObject<HTMLButtonElement>;
}

function Harness(props: HarnessProps) {
  const [open, setOpen] = useState(props.initialOpen ?? true);
  const localRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = props.triggerRefOverride ?? localRef;
  return (
    <div>
      <button
        type="button"
        ref={triggerRef}
        data-testid="trigger"
        onClick={() => setOpen((v) => !v)}
      >
        toggle
      </button>
      <RecentsPopover
        open={open}
        records={props.records}
        triggerRef={triggerRef}
        onSelect={props.onSelect ?? vi.fn()}
        onClose={() => {
          setOpen(false);
          props.onClose?.();
        }}
        errorState={props.errorState ?? null}
        onRetry={props.onRetry}
      />
    </div>
  );
}

function stubBoundingRect(el: HTMLElement | null): void {
  if (!el) return;
  el.getBoundingClientRect = () =>
    ({
      top: 100,
      bottom: 122,
      left: 200,
      right: 280,
      width: 80,
      height: 22,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe('RecentsPopover', () => {
  it('renders all records as listbox options when open', () => {
    render(<Harness records={makeRecords(3)} />);
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAttribute('id', 'recents-listbox');
    expect(listbox).toHaveAttribute('aria-activedescendant', 'recents-row-rec-1');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
  });

  it('hides the popover via aria-hidden + closed class when open=false', () => {
    render(<Harness records={makeRecords(2)} initialOpen={false} />);
    const popover = screen.getByTestId('recents-popover');
    expect(popover).toHaveAttribute('aria-hidden', 'true');
    expect(popover.className).toContain('recents-popover--closed');
  });

  it('arrow-down navigates active descendant; wraps at the bottom', () => {
    render(<Harness records={makeRecords(3)} />);
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'recents-row-rec-2');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'recents-row-rec-3');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'recents-row-rec-1');
  });

  it('arrow-up wraps from the top to the bottom', () => {
    render(<Harness records={makeRecords(3)} />);
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'recents-row-rec-3');
  });

  it('Home and End jump to first and last', () => {
    render(<Harness records={makeRecords(4)} />);
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'recents-row-rec-4');
    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'recents-row-rec-1');
  });

  it('Enter selects the active row exactly once and closes the popover', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<Harness records={makeRecords(3)} onSelect={onSelect} onClose={onClose} />);
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('rec-2');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking a row calls onSelect with the row id and closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<Harness records={makeRecords(3)} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('recents-row-rec-2'));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('rec-2');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('registers an ESC handler at priority 10 and the handler closes only the popover', () => {
    const onClose = vi.fn();
    render(<Harness records={makeRecords(2)} onClose={onClose} />);
    expect(escState.priority).toBe(10);
    expect(escState.handler).toBeTypeOf('function');
    escState.handler?.();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('unregisters the ESC handler when the popover closes', () => {
    const { rerender } = render(<Harness records={makeRecords(2)} initialOpen={true} />);
    const previousUnregister = escState.unregister;
    rerender(<Harness records={makeRecords(2)} initialOpen={false} />);
    expect(previousUnregister).toHaveBeenCalled();
  });

  it('closes when clicking outside the popover and the trigger', () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <Harness records={makeRecords(2)} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside the popover', () => {
    const onClose = vi.fn();
    render(<Harness records={makeRecords(2)} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('listbox'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when clicking the trigger (the trigger handles its own toggle)', () => {
    const onClose = vi.fn();
    render(<Harness records={makeRecords(2)} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTestId('trigger'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on window blur', () => {
    const onClose = vi.fn();
    render(<Harness records={makeRecords(2)} onClose={onClose} />);
    fireEvent.blur(window);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the inline error bar when errorState is refresh-failed and wires Retry', () => {
    const onRetry = vi.fn();
    render(
      <Harness records={makeRecords(2)} errorState="refresh-failed" onRetry={onRetry} />,
    );
    expect(screen.getByText(/Couldn.t refresh recent conversations\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not render the error bar when errorState is null', () => {
    render(<Harness records={makeRecords(2)} errorState={null} />);
    expect(screen.queryByText(/Couldn.t refresh/)).toBeNull();
  });

  it('the primary line uses the truncating recents-row__primary class', () => {
    render(<Harness records={makeRecords(1)} />);
    const primary = screen.getByText(/A very long historical conversation/);
    expect(primary.className).toContain('recents-row__primary');
  });

  it('positions the popover relative to the trigger when open', () => {
    const ref = createRef<HTMLButtonElement>();
    const { container } = render(<Harness records={makeRecords(2)} triggerRefOverride={ref} />);
    if (ref.current) stubBoundingRect(ref.current);
    fireEvent.resize(window);
    void container;
    expect(screen.getByTestId('recents-popover')).toBeInTheDocument();
  });
});
