import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { WorkflowLifecycleEntry } from '../../../shared/desktopContract';
import ObservabilityLifecycleSection from './ObservabilityLifecycleSection';

afterEach(() => {
  cleanup();
});

function makeEntry(overrides: Partial<WorkflowLifecycleEntry> = {}): WorkflowLifecycleEntry {
  return {
    state: 'active',
    observed: true,
    detail: 'In progress',
    ...overrides,
  };
}

describe('ObservabilityLifecycleSection', () => {
  it('shows empty state when no lifecycle entries', () => {
    render(<ObservabilityLifecycleSection lifecycle={[]} />);
    expect(screen.getByText('No steps have started yet. Progress will appear here once the task begins.')).toBeInTheDocument();
  });

  it('renders section title', () => {
    render(<ObservabilityLifecycleSection lifecycle={[]} />);
    expect(screen.getByText('Workflow Progress')).toBeInTheDocument();
  });

  it('renders lifecycle entry with state and detail', () => {
    render(<ObservabilityLifecycleSection lifecycle={[makeEntry()]} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('renders complete state with check icon', () => {
    render(
      <ObservabilityLifecycleSection
        lifecycle={[makeEntry({ state: 'complete', detail: 'Finished' })]}
      />,
    );
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('\u2705')).toBeInTheDocument();
  });

  it('renders blocked state with warning icon', () => {
    render(
      <ObservabilityLifecycleSection
        lifecycle={[makeEntry({ state: 'blocked', detail: 'Waiting on review' })]}
      />,
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('\u26A0\uFE0F')).toBeInTheDocument();
  });

  it('renders multiple entries', () => {
    const entries = [
      makeEntry({ state: 'complete', detail: 'Done' }),
      makeEntry({ state: 'active', detail: 'Running' }),
      makeEntry({ state: 'queued', detail: 'Pending' }),
    ];
    render(<ObservabilityLifecycleSection lifecycle={entries} />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
});
