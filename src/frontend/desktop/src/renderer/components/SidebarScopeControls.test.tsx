import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import type { CompactSidebarModel } from '../selectors/contextPackSidebarModel';
import SidebarScopeControls from './SidebarScopeControls';

afterEach(() => {
  cleanup();
});

function makePack(overrides: Partial<ContextPackCatalogEntry> = {}): ContextPackCatalogEntry {
  return {
    contextPackId: 'pack-1',
    displayName: 'My Pack',
    contextPackDir: '/packs/my-pack',
    manifestPath: null,
    bootstrapReady: true,
    source: 'configured-path',
    isActive: false,
    estateType: null,
    defaultScopeMode: null,
    repoCount: 1,
    primaryWorkingRepoIds: [],
    focusTargets: [
      {
        focusId: 'repo-1',
        displayName: 'Frontend',
        kind: 'repository',
        repoId: 'repo-1',
        serviceName: null,
        systemLayer: 'presentation',
        repoRole: null,
        repositoryType: null,
        relativePath: null,
        focusType: null,
        group: null,
        defaultFocusable: true,
        activationPriority: 0,
        adjacentRepoIds: [],
        adjacentFocusIds: [],
      },
    ],
    ...overrides,
  };
}

function makeModel(overrides: Partial<CompactSidebarModel> = {}): CompactSidebarModel {
  return {
    activeHeading: '',
    activeLocation: '',
    activeStatusLabel: '',
    activeStatusTone: 'idle',
    selectedPackSummary: [],
    focusHint: null,
    selectedWorkingFocusSummary: null,
    switchResultSummary: null,
    reseedResultSummary: null,
    ...overrides,
  };
}

const defaultProps = {
  selectedPack: undefined as ContextPackCatalogEntry | undefined,
  selectedWorkingFocusIds: [] as string[],
  focusHint: null as string | null,
  onSelectWorkingFocus: vi.fn(),
  sidebarModel: makeModel(),
};

describe('SidebarScopeControls', () => {
  it('returns null when no selectedPack', () => {
    const { container } = render(<SidebarScopeControls {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders workspace focus heading', () => {
    render(<SidebarScopeControls {...defaultProps} selectedPack={makePack()} />);
    expect(screen.getByText('Workspace Focus')).toBeInTheDocument();
  });

  it('renders focus targets as checkboxes', () => {
    render(<SidebarScopeControls {...defaultProps} selectedPack={makePack()} />);
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Presentation')).toBeInTheDocument();
  });

  it('renders repositories subtitle for distributed packs and focus areas for monolith packs', () => {
    const { rerender } = render(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
      />,
    );
    expect(screen.getByText('Repositories')).toBeInTheDocument();

    rerender(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack({
          estateType: 'monolith',
          focusTargets: [
            {
              ...makePack().focusTargets[0],
              kind: 'focus-area',
              repoId: null,
              systemLayer: null,
              focusType: 'service',
              repositoryType: 'primary',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Focus Areas')).toBeInTheDocument();
  });

  it('calls onSelectWorkingFocus when checkbox toggled', () => {
    const onSelectWorkingFocus = vi.fn();
    render(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack()}
        onSelectWorkingFocus={onSelectWorkingFocus}
      />,
    );
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onSelectWorkingFocus).toHaveBeenCalledWith('repo-1');
  });

  it('shows focus hint when provided', () => {
    render(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack()}
        focusHint="Select at least one"
      />,
    );
    expect(screen.getByText('Select at least one')).toBeInTheDocument();
  });

  it('renders sidebar model summary chips', () => {
    const model = makeModel({
      selectedPackSummary: [{ label: '2 repos', tone: 'active' }],
    });
    render(
      <SidebarScopeControls {...defaultProps} selectedPack={makePack()} sidebarModel={model} />,
    );
    expect(screen.getByText('2 repos')).toBeInTheDocument();
  });

  it('renders working focus summary text', () => {
    const model = makeModel({ selectedWorkingFocusSummary: 'Frontend selected' });
    render(
      <SidebarScopeControls {...defaultProps} selectedPack={makePack()} sidebarModel={model} />,
    );
    expect(screen.getByText(/Frontend selected/)).toBeInTheDocument();
  });

  it('renders repository type badge for monolith focus targets', () => {
    render(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack({
          estateType: 'monolith',
          focusTargets: [
            {
              ...makePack().focusTargets[0],
              focusId: 'focus-1',
              displayName: 'Core Module',
              kind: 'focus-area',
              repoId: null,
              systemLayer: null,
              focusType: 'service',
              repositoryType: 'primary',
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument();
  });
});
