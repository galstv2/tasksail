import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ContextPackCreationDraft } from '../../contextPack/contextPackCreationTypes';
import { INITIAL_DRAFT, createRepositoryEntry, createFocusAreaEntry } from '../../hooks/context-pack/useContextPackDraft';
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
    expect(screen.getByText('Distributed')).toBeInTheDocument();
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

  it('shows repo chips with category labels, not Primary/Support', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      contextPackDir: '/tmp/pack',
      repositories: [
        createRepositoryEntry({ repoName: 'api', primary: true, repoCategory: 'service' }),
        createRepositoryEntry({ repoName: 'web', primary: false, repoCategory: 'frontend' }),
      ],
    };
    render(<ReviewStep draft={draft} />);
    expect(screen.queryByText(/Primary •/)).not.toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Frontend')).toBeInTheDocument();
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

  it('shows monolith focus area chips with kind labels, not Primary/Support', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      mode: 'monolith',
      repositories: [createRepositoryEntry()],
      focusAreas: [
        createFocusAreaEntry({ focusName: 'Core Module', focusCategory: 'service', primary: true, relativePath: 'services/core' }),
        createFocusAreaEntry({ focusName: 'Docs', focusCategory: 'documentation', primary: false, relativePath: 'docs' }),
      ],
    };

    render(<ReviewStep draft={draft} />);

    expect(screen.queryByText(/Primary •/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Support •/)).not.toBeInTheDocument();
    expect(screen.getByText('Core Module')).toBeInTheDocument();
    expect(screen.getByText(/Service/)).toBeInTheDocument();
    expect(screen.getByText(/Documentation/)).toBeInTheDocument();
    expect(screen.getByText(/services\/core/)).toBeInTheDocument();
  });

  it('shows monolith focus-area validation checks without focus wording', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      mode: 'monolith',
      repositories: [createRepositoryEntry({ repoRoot: '/repo', repoName: 'mono', primary: true })],
      focusAreas: [
        createFocusAreaEntry({ focusName: 'Core Module', primary: true, relativePath: 'services/core' }),
      ],
    };

    render(<ReviewStep draft={draft} />);

    expect(screen.getByText('At least one focus area')).toBeInTheDocument();
    expect(screen.getByText('Focus areas have relative paths')).toBeInTheDocument();
    expect(screen.queryByText('Working folder selected')).not.toBeInTheDocument();
  });

  it('fails the focus-area path check when a focus area lacks a relative path', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      mode: 'monolith',
      repositories: [createRepositoryEntry()],
      focusAreas: [
        createFocusAreaEntry({ focusName: 'Core Module', primary: true, relativePath: '   ' }),
      ],
    };

    const { container } = render(<ReviewStep draft={draft} />);
    const relativePathItem = Array.from(
      container.querySelectorAll('.context-pack-modal__validation-item'),
    ).find((item) => item.textContent?.includes('Focus areas have relative paths'));

    expect(relativePathItem).toHaveClass('context-pack-modal__validation-item--fail');
  });

  it('hides focus area validation in distributed mode', () => {
    render(<ReviewStep draft={INITIAL_DRAFT} />);
    expect(screen.queryByText('At least one focus area')).not.toBeInTheDocument();
  });
});
