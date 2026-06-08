import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCreationDraft } from '../../contextPack/contextPackCreationTypes';
import { INITIAL_DRAFT, createRepositoryEntry, createFocusAreaEntry } from '../../hooks/context-pack/useContextPackDraft';
import ShapeStep from './ShapeStep';

afterEach(() => {
  cleanup();
});

const distributedDraft: ContextPackCreationDraft = {
  ...INITIAL_DRAFT,
  mode: 'distributed',
  repositories: [
    createRepositoryEntry({ key: 'r1', repoName: 'Repo One', primary: true }),
    createRepositoryEntry({ key: 'r2', repoName: 'Repo Two', primary: false }),
  ],
};

const monolithDraft: ContextPackCreationDraft = {
  ...INITIAL_DRAFT,
  mode: 'monolith',
  repositories: [createRepositoryEntry({ key: 'r1', repoName: 'Main Repo', primary: true })],
  focusAreas: [
    createFocusAreaEntry({ key: 'f1', focusName: 'Core', primary: true }),
  ],
};

const defaultProps = {
  busy: false,
  draft: distributedDraft,
  onAddRepository: vi.fn(),
  onRemoveRepository: vi.fn(),
  onRepositoryFieldChange: vi.fn(),
  onSetPrimaryRepository: vi.fn(),
  onAddFocusArea: vi.fn(),
  onRemoveFocusArea: vi.fn(),
  onFocusAreaFieldChange: vi.fn(),
  onSetPrimaryFocusArea: vi.fn(),
};

describe('ShapeStep', () => {
  it('renders repository cards for each repository in draft', () => {
    render(<ShapeStep {...defaultProps} />);
    expect(screen.getByText('Repository 1')).toBeInTheDocument();
    expect(screen.getByText('Repository 2')).toBeInTheDocument();
  });

  it('shows distributed heading', () => {
    render(<ShapeStep {...defaultProps} />);
    expect(screen.getByText('Repository estate definition')).toBeInTheDocument();
  });

  it('treats distributed-platform as a distributed shape', () => {
    render(<ShapeStep {...defaultProps} draft={{ ...distributedDraft, mode: 'distributed-platform' }} />);
    expect(screen.getByText('Repository estate definition')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add repository' })).toBeInTheDocument();
    expect(screen.queryByText('Focus areas')).not.toBeInTheDocument();
  });

  it('add repository button calls onAddRepository', () => {
    const onAddRepository = vi.fn();
    render(<ShapeStep {...defaultProps} onAddRepository={onAddRepository} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    expect(onAddRepository).toHaveBeenCalled();
  });

  it('renders monolith heading and focus areas section', () => {
    render(<ShapeStep {...defaultProps} draft={monolithDraft} />);
    expect(screen.getByText('Monolith focus definition')).toBeInTheDocument();
    expect(
      screen.getByText('Define the main monolith repo, optional infrastructure repositories, and focus areas.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add infrastructure repo' })).toBeInTheDocument();
    expect(screen.getByText('Focus areas')).toBeInTheDocument();
    expect(screen.getByText('Focus area 1')).toBeInTheDocument();
  });

  it('treats monolith-platform as a monolith shape', () => {
    render(<ShapeStep {...defaultProps} draft={{ ...monolithDraft, mode: 'monolith-platform' }} />);
    expect(screen.getByText('Monolith focus definition')).toBeInTheDocument();
    expect(screen.getByText('Focus areas')).toBeInTheDocument();
  });

  it('hides focus areas in distributed mode', () => {
    render(<ShapeStep {...defaultProps} />);
    expect(screen.queryByText('Focus areas')).not.toBeInTheDocument();
  });

  it('add focus area button calls onAddFocusArea in monolith mode', () => {
    const onAddFocusArea = vi.fn();
    render(<ShapeStep {...defaultProps} draft={monolithDraft} onAddFocusArea={onAddFocusArea} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add focus area' }));
    expect(onAddFocusArea).toHaveBeenCalled();
  });

  it('shows the new-project guidance banner for wizard-created drafts', () => {
    render(
      <ShapeStep
        {...defaultProps}
        draft={{ ...distributedDraft, creationOrigin: 'new' }}
      />,
    );

    expect(
      screen.getByText(
        'Your project is ready. Adjust advanced details below or go straight to Review.',
      ),
    ).toBeInTheDocument();
  });
});
