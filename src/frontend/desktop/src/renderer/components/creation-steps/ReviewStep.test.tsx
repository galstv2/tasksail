import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ContextPackCreationDraft } from '../../contextPackCreationTypes';
import { INITIAL_DRAFT, createRepositoryEntry, createFocusAreaEntry } from '../../hooks/useContextPackDraft';
import ReviewStep from './ReviewStep';

afterEach(() => {
  cleanup();
});

describe('ReviewStep', () => {
  it('renders draft summary fields', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      contextPackDir: '/tmp/pack',
      discoveryRoot: '/tmp/root',
      estateName: 'Orders Estate',
      repositories: [createRepositoryEntry({ repoName: 'orders-api', primary: true })],
    };
    render(<ReviewStep draft={draft} />);
    expect(screen.getByText('/tmp/pack')).toBeInTheDocument();
    expect(screen.getByText('Distributed estate')).toBeInTheDocument();
    expect(screen.getByText('Orders Estate')).toBeInTheDocument();
  });

  it('shows "Not set" for empty fields', () => {
    render(<ReviewStep draft={INITIAL_DRAFT} />);
    const notSetElements = screen.getAllByText('Not set');
    expect(notSetElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders validation checklist with pass/fail states', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      contextPackDir: '/tmp/pack',
      discoveryRoot: '/tmp/root',
      estateName: 'Test',
      repositories: [createRepositoryEntry({ repoRoot: '/repo', repoName: 'test', primary: true })],
    };
    render(<ReviewStep draft={draft} />);
    expect(screen.getByText('Readiness')).toBeInTheDocument();
    expect(screen.getByText('Context-pack destination')).toBeInTheDocument();
    expect(screen.getByText('At least one repository')).toBeInTheDocument();
  });

  it('shows repo chips with primary indicator', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      contextPackDir: '/tmp/pack',
      repositories: [
        createRepositoryEntry({ repoName: 'api', primary: true, systemLayer: 'backend' }),
        createRepositoryEntry({ repoName: 'web', primary: false, systemLayer: 'frontend' }),
      ],
    };
    render(<ReviewStep draft={draft} />);
    const chips = screen.getAllByText(/Primary/);
    expect(chips.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/web/)).toBeInTheDocument();
  });

  it('shows focus area validation for monolith mode', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      mode: 'monolith',
      repositories: [createRepositoryEntry()],
      focusAreas: [createFocusAreaEntry(), createFocusAreaEntry()],
    };
    render(<ReviewStep draft={draft} />);
    expect(screen.getByText('At least one focus area')).toBeInTheDocument();
  });

  it('shows monolith focus area chips with repository type badges', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      mode: 'monolith',
      repositories: [createRepositoryEntry()],
      focusAreas: [
        createFocusAreaEntry({ focusName: 'Core Module', focusType: 'service', repositoryType: 'primary', primary: true }),
        createFocusAreaEntry({ focusName: 'Docs', focusType: 'docs', repositoryType: 'support', primary: false }),
      ],
    };

    render(<ReviewStep draft={draft} />);

    expect(screen.getByText(/Primary • Core Module/)).toBeInTheDocument();
    expect(screen.getByText(/Support • Docs/)).toBeInTheDocument();
  });

  it('hides focus area validation in distributed mode', () => {
    render(<ReviewStep draft={INITIAL_DRAFT} />);
    expect(screen.queryByText('At least one focus area')).not.toBeInTheDocument();
  });
});
