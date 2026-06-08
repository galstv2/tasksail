import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TerminalFeed from './TerminalFeed';
import type { TerminalFeedProps } from './TerminalFeed';
import type { StreamEvent } from '../../activityStream';
import { createObservabilitySnapshot } from '../../../test';
import { formatLocalTime } from '../../utils/localTimestamp';

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
    taskGuid: null,
    taskShortGuid: null,
    taskTitle: null,
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
    replayedEventIds: new Set(),
    taskScopes: [],
    selectedTaskGuid: null,
    onSelectTaskScope: vi.fn(async () => undefined),
    observabilitySnapshot: null,
    environmentStatus: null,
    ...overrides,
  };
  return render(<TerminalFeed {...props} />);
}

const taskScopes: TerminalFeedProps['taskScopes'] = [
  {
    taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
    taskShortGuid: 'feedbeef',
    taskId: 'TASK-1',
    title: 'Build terminal filter',
  },
  {
    taskGuid: 'facefeed-1234-4234-9234-123456789abc',
    taskShortGuid: 'facefeed',
    taskId: 'TASK-2',
    title: null,
  },
];

describe('TerminalFeed', () => {
  it('renders terminal chrome with title', () => {
    renderFeed();
    const feed = screen.getByLabelText('Terminal feed');
    expect(feed.querySelector('.terminal-feed__title')).toHaveTextContent('Terminal');
  });

  it('renders role filter tabs in predictable order', () => {
    renderFeed();
    const tablist = screen.getByRole('tablist', { name: 'Role filter' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'All',
      'Agent',
      'Pipeline',
      'Planner',
      'Queue',
      'System',
      'Workflow',
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

  it('renders ISO timestamps as local 24-hour time without bracket padding', () => {
    renderFeed({
      activityStream: [
        makeEvent({
          id: 'e1',
          timestamp: '2026-05-23T04:17:00.000Z',
          role: 'planner',
          message: 'Planner session started.',
        }),
      ],
    });

    expect(document.querySelector('.terminal-timestamp')?.textContent).toBe(
      `[${formatLocalTime('2026-05-23T04:17:00.000Z')}]`,
    );
  });

  it('does not duplicate an actor already embedded in a task-scoped message', () => {
    renderFeed({
      activityStream: [
        makeEvent({
          id: 'e1',
          actorName: 'Alice (Product Manager)',
          message: 'Task [feedbeef] - Alice (Product Manager): Is running.',
        }),
      ],
    });

    const line = document.querySelector('.terminal-line');
    expect(line?.querySelector('.terminal-actor')).toBeNull();
    expect(line?.querySelector('.terminal-message')?.textContent).toBe(
      'Task [feedbeef] - Alice (Product Manager): Is running.',
    );
  });

  it('renders a custom task scope menu and calls the selector with full GUIDs', () => {
    const onSelectTaskScope = vi.fn(async () => undefined);
    renderFeed({
      selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
      onSelectTaskScope,
      taskScopes,
    });

    expect(screen.queryByRole('combobox', { name: 'Terminal task scope' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Terminal task scope' });
    expect(trigger).toHaveTextContent('Build terminal filter');
    expect(trigger).toHaveTextContent('Task [feedbeef]');

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Terminal task scope' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', 'terminal-task-scope-listbox');
    expect(within(listbox).getByRole('option', { name: 'All Tasks' })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /Build terminal filter/ })).toHaveTextContent('Task [feedbeef]');
    expect(within(listbox).getByRole('option', { name: /Task TASK-2/ })).toHaveTextContent('Task [facefeed]');
    expect(within(listbox).getByRole('option', { name: /Build terminal filter/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(listbox).getByRole('option', { name: /Task TASK-2/ }));
    expect(onSelectTaskScope).toHaveBeenCalledWith('facefeed-1234-4234-9234-123456789abc');
    expect(screen.queryByRole('listbox', { name: 'Terminal task scope' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'All Tasks' }));
    expect(onSelectTaskScope).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('listbox', { name: 'Terminal task scope' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Enter and Space open the task scope menu from the trigger', () => {
    renderFeed({ taskScopes });
    const trigger = screen.getByRole('button', { name: 'Terminal task scope' });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('listbox', { name: 'Terminal task scope' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Terminal task scope' }), { key: 'Escape' });
    fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.getByRole('listbox', { name: 'Terminal task scope' })).toBeInTheDocument();
  });

  it('renders duplicate task titles with visible short GUID markers', () => {
    renderFeed({
      taskScopes: [
        {
          taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
          taskShortGuid: 'feedbeef',
          taskId: 'TASK-1',
          title: 'Same title',
        },
        {
          taskGuid: 'facefeed-1234-4234-9234-123456789abc',
          taskShortGuid: 'facefeed',
          taskId: 'TASK-2',
          title: 'Same title',
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Terminal task scope' }));

    const options = screen.getAllByRole('option', { name: /Same title/ });
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Task [feedbeef]');
    expect(options[1]).toHaveTextContent('Task [facefeed]');
  });

  it('renders all-tasks trigger text without a short GUID marker', () => {
    renderFeed({ taskScopes });

    const trigger = screen.getByRole('button', { name: 'Terminal task scope' });
    expect(trigger).toHaveTextContent('All Tasks');
    expect(trigger).not.toHaveTextContent('Task [');
  });

  it('marks task scope dropdown active only for a selected task GUID', () => {
    const { rerender } = renderFeed();
    expect(document.querySelector('.terminal-feed__task-scope')).not.toHaveClass(
      'terminal-feed__task-scope--active',
    );

    const props: TerminalFeedProps = {
      activityStream: [],
      replayedEventIds: new Set(),
      taskScopes: [],
      selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
      onSelectTaskScope: vi.fn(async () => undefined),
      observabilitySnapshot: null,
      environmentStatus: null,
    };
    rerender(<TerminalFeed {...props} />);

    expect(document.querySelector('.terminal-feed__task-scope')).toHaveClass(
      'terminal-feed__task-scope--active',
    );
  });

  it('task scope menu closes on outside mousedown', () => {
    renderFeed({ taskScopes });

    const trigger = screen.getByRole('button', { name: 'Terminal task scope' });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Terminal task scope' })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('listbox', { name: 'Terminal task scope' })).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('Escape closes the task scope menu and returns focus to the trigger', () => {
    renderFeed({ taskScopes });
    const trigger = screen.getByRole('button', { name: 'Terminal task scope' });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Terminal task scope' }), { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: 'Terminal task scope' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Tab closes the task scope menu', () => {
    renderFeed({ taskScopes });

    const trigger = screen.getByRole('button', { name: 'Terminal task scope' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Terminal task scope' }), { key: 'Tab' });

    expect(screen.queryByRole('listbox', { name: 'Terminal task scope' })).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('keyboard navigation updates active descendant and Enter selects the full GUID', () => {
    const onSelectTaskScope = vi.fn(async () => undefined);
    renderFeed({ taskScopes, onSelectTaskScope });

    fireEvent.click(screen.getByRole('button', { name: 'Terminal task scope' }));
    const listbox = screen.getByRole('listbox', { name: 'Terminal task scope' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'terminal-task-scope-option-all');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox).toHaveAttribute(
      'aria-activedescendant',
      'terminal-task-scope-option-feedbeef-1234-4234-9234-123456789abc',
    );
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'terminal-task-scope-option-all');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });

    expect(onSelectTaskScope).toHaveBeenCalledWith('feedbeef-1234-4234-9234-123456789abc');
    expect(screen.queryByRole('listbox', { name: 'Terminal task scope' })).not.toBeInTheDocument();
  });

  it('Space selects the active task scope option', () => {
    const onSelectTaskScope = vi.fn(async () => undefined);
    renderFeed({ taskScopes, onSelectTaskScope });

    fireEvent.click(screen.getByRole('button', { name: 'Terminal task scope' }));
    const listbox = screen.getByRole('listbox', { name: 'Terminal task scope' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: ' ' });

    expect(onSelectTaskScope).toHaveBeenCalledWith('facefeed-1234-4234-9234-123456789abc');
    expect(screen.queryByRole('listbox', { name: 'Terminal task scope' })).not.toBeInTheDocument();
  });

  it('renders only the all-tasks option when there are no task scopes', () => {
    renderFeed({ taskScopes: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Terminal task scope' }));

    const options = within(screen.getByRole('listbox', { name: 'Terminal task scope' })).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('All Tasks');
  });

  it('does not filter by task locally and renders task badge before role', () => {
    renderFeed({
      selectedTaskGuid: 'feedbeef-1234-4234-9234-123456789abc',
      activityStream: [
        makeEvent({
          id: 'e1',
          role: 'pipeline',
          taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
          taskShortGuid: 'feedbeef',
          taskTitle: 'Build terminal filter',
          message: 'Task [feedbeef] - Created worktree.',
        }),
        makeEvent({
          id: 'e2',
          role: 'queue',
          taskGuid: 'facefeed-1234-4234-9234-123456789abc',
          taskShortGuid: 'facefeed',
          taskTitle: 'Other task',
          message: 'Task [facefeed] - Activated task.',
        }),
      ],
    });

    const lines = document.querySelectorAll('.terminal-line');
    expect(lines).toHaveLength(2);
    expect(Array.from(lines[0].children).map((child) => child.className)).toEqual([
      'terminal-timestamp',
      'terminal-task',
      'terminal-role terminal-role--pipeline',
      'terminal-message',
    ]);
    expect(lines[0].querySelector('.terminal-task')?.textContent).toBe('Task [feedbeef]');
    expect(lines[0].querySelector('.terminal-message')?.textContent).toBe('Created worktree.');
  });

  it('renders the separate actor span for non-embedded actor messages', () => {
    renderFeed({
      activityStream: [
        makeEvent({
          id: 'e1',
          actorName: 'Lily',
          message: 'Planning started',
        }),
      ],
    });

    const line = document.querySelector('.terminal-line');
    expect(line?.querySelector('.terminal-actor')?.textContent).toBe('Lily');
    expect(line?.querySelector('.terminal-message')?.textContent).toBe('Planning started');
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

  it('filters agent and pipeline events by role tabs', () => {
    const events = [
      makeEvent({ id: 'e1', role: 'queue', message: 'Queue msg' }),
      makeEvent({ id: 'e2', role: 'agent', message: 'Agent msg' }),
      makeEvent({ id: 'e3', role: 'pipeline', severity: 'info', message: 'Pipeline info' }),
      makeEvent({ id: 'e4', role: 'pipeline', severity: 'warning', message: 'Pipeline warning' }),
      makeEvent({ id: 'e5', role: 'workflow', severity: 'warning', message: 'Workflow warning' }),
    ];
    renderFeed({ activityStream: events });

    fireEvent.click(screen.getByRole('tab', { name: 'Agent' }));
    let lines = document.querySelectorAll('.terminal-line');
    expect(lines).toHaveLength(1);
    expect(lines[0].querySelector('.terminal-message')?.textContent).toBe('Agent msg');

    fireEvent.click(screen.getByRole('tab', { name: 'Pipeline' }));
    lines = document.querySelectorAll('.terminal-line');
    expect(lines).toHaveLength(2);
    expect(Array.from(lines).map((line) => line.querySelector('.terminal-message')?.textContent)).toEqual([
      'Pipeline info',
      'Pipeline warning',
    ]);
  });

  it('does not render the warnings and errors only checkbox', () => {
    renderFeed();
    expect(screen.queryByRole('checkbox', { name: /warnings & errors only/i })).not.toBeInTheDocument();
  });

  it('renders explicit role classes for every terminal role', () => {
    renderFeed({
      activityStream: [
        makeEvent({ id: 'planner', role: 'planner', message: 'Planner started' }),
        makeEvent({ id: 'queue', role: 'queue', message: 'Queue started' }),
        makeEvent({ id: 'agent', role: 'agent', message: 'Agent started' }),
        makeEvent({ id: 'pipeline', role: 'pipeline', message: 'Pipeline started' }),
        makeEvent({ id: 'workflow', role: 'workflow', message: 'Workflow started' }),
        makeEvent({ id: 'operator', role: 'operator', message: 'Operator note' }),
        makeEvent({ id: 'system', role: 'system', message: 'System started' }),
      ],
    });

    const roles = document.querySelectorAll('.terminal-role');
    expect(Array.from(roles).map((role) => role.className)).toEqual([
      'terminal-role terminal-role--planner',
      'terminal-role terminal-role--queue',
      'terminal-role terminal-role--agent',
      'terminal-role terminal-role--pipeline',
      'terminal-role terminal-role--workflow',
      'terminal-role terminal-role--operator',
      'terminal-role terminal-role--system',
    ]);
  });

  it('workflow events render under all and workflow tabs with workflow styling', () => {
    const events = [
      makeEvent({ id: 'e1', role: 'workflow', message: 'Workflow msg' }),
      makeEvent({ id: 'e2', role: 'agent', message: 'Agent msg' }),
    ];
    renderFeed({ activityStream: events });

    expect(document.querySelectorAll('.terminal-line')).toHaveLength(2);
    expect(document.querySelector('.terminal-role--workflow')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }));

    const filtered = document.querySelectorAll('.terminal-line');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].querySelector('.terminal-message')?.textContent).toBe('Workflow msg');
    expect(filtered[0].querySelector('.terminal-role')).toHaveClass('terminal-role--workflow');
  });

  it('applies replay suppression only to replayed terminal lines', () => {
    renderFeed({
      activityStream: [
        makeEvent({ id: 'replayed', message: 'Replay msg' }),
        makeEvent({ id: 'live', message: 'Live msg' }),
      ],
      replayedEventIds: new Set(['replayed']),
    });

    const lines = document.querySelectorAll('.terminal-line');
    expect(lines[0]).toHaveClass('terminal-line--replay');
    expect(lines[1]).not.toHaveClass('terminal-line--replay');
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
          cliSessionId: 'provider-session-1',
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

  it('clear terminal button is disabled when stream is empty', () => {
    renderFeed();
    const clear = screen.getByRole('button', { name: /clear terminal/i });
    expect(clear).toBeDisabled();
  });

  it('clear terminal button invokes onClearTerminal when events exist', () => {
    const onClearTerminal = vi.fn();
    renderFeed({
      activityStream: [makeEvent({ id: 'evt-clear-1' })],
      onClearTerminal,
    });
    const clear = screen.getByRole('button', { name: /clear terminal/i });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    expect(onClearTerminal).toHaveBeenCalledTimes(1);
  });

  it('clear terminal button is disabled while active context-pack tasks are running', () => {
    const onClearTerminal = vi.fn();
    renderFeed({
      activityStream: [makeEvent({ id: 'evt-clear-1' })],
      onClearTerminal,
      clearTerminalDisabledReason: 'Clear disabled while active context-pack tasks are running.',
    });

    const clear = screen.getByRole('button', { name: /clear terminal/i });
    expect(clear).toBeDisabled();
    expect(clear).toHaveAttribute('title', 'Clear disabled while active context-pack tasks are running.');
    fireEvent.click(clear);
    expect(onClearTerminal).not.toHaveBeenCalled();
  });

  it('renders blinking cursor', () => {
    renderFeed();
    const cursor = document.querySelector('.terminal-cursor');
    expect(cursor).toBeInTheDocument();
    expect(cursor).toHaveAttribute('aria-hidden', 'true');
  });
});
