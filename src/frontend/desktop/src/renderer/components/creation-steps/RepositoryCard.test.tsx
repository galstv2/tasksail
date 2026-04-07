import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRepositoryEntry } from '../../hooks/useContextPackDraft';
import RepositoryCard from './RepositoryCard';

afterEach(() => {
  cleanup();
});

const repo = createRepositoryEntry({
  key: 'r1',
  repoRoot: '/tmp/repo',
  repoName: 'Test Repo',
  repoId: 'test-repo',
  primary: false,
});

const defaultProps = {
  repository: repo,
  index: 1,
  mode: 'distributed' as const,
  busy: false,
  onRepositoryFieldChange: vi.fn(),
  onSetPrimaryRepository: vi.fn(),
  onRemoveRepository: vi.fn(),
};

describe('RepositoryCard', () => {
  it('renders repository heading with index', () => {
    render(<RepositoryCard {...defaultProps} />);
    expect(screen.getByText('Repository 2')).toBeInTheDocument();
  });

  it('renders "Main repository" heading for first monolith repo', () => {
    render(<RepositoryCard {...defaultProps} index={0} mode="monolith" />);
    expect(screen.getByText('Main repository')).toBeInTheDocument();
  });

  it('remove button calls onRemoveRepository with key', () => {
    const onRemoveRepository = vi.fn();
    render(<RepositoryCard {...defaultProps} onRemoveRepository={onRemoveRepository} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemoveRepository).toHaveBeenCalledWith('r1');
  });

  it('hides remove button for first repository', () => {
    render(<RepositoryCard {...defaultProps} index={0} />);
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('primary toggle calls onSetPrimaryRepository', () => {
    const onSetPrimaryRepository = vi.fn();
    render(<RepositoryCard {...defaultProps} onSetPrimaryRepository={onSetPrimaryRepository} />);
    fireEvent.click(screen.getByRole('button', { name: /Start from here/i }));
    expect(onSetPrimaryRepository).toHaveBeenCalledWith('r1');
  });

  it('field change calls onRepositoryFieldChange', () => {
    const onRepositoryFieldChange = vi.fn();
    render(<RepositoryCard {...defaultProps} onRepositoryFieldChange={onRepositoryFieldChange} />);
    const repoRootInput = screen.getAllByRole('textbox').find(
      (i) => (i as HTMLInputElement).value === '/tmp/repo',
    );
    fireEvent.change(repoRootInput!, { target: { value: '/new/path' } });
    expect(onRepositoryFieldChange).toHaveBeenCalledWith('r1', 'repoRoot', '/new/path');
  });
});
