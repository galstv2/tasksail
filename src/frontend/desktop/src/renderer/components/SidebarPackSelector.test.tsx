import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import SidebarPackSelector from './SidebarPackSelector';

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
    focusTargets: [],
    ...overrides,
  };
}

const defaultProps = {
  contextPacks: [] as ContextPackCatalogEntry[],
  selectedContextPackDir: '',
  isBusy: false,
  onSelectContextPack: vi.fn(),
  onOpenCreateModal: vi.fn(),
};

describe('SidebarPackSelector', () => {
  it('shows empty state with create button when no packs', () => {
    render(<SidebarPackSelector {...defaultProps} />);
    expect(screen.getByText('No context packs discovered yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Create context pack')).toBeInTheDocument();
  });

  it('calls onOpenCreateModal from empty state', () => {
    const onOpenCreateModal = vi.fn();
    render(<SidebarPackSelector {...defaultProps} onOpenCreateModal={onOpenCreateModal} />);
    fireEvent.click(screen.getByLabelText('Create context pack'));
    expect(onOpenCreateModal).toHaveBeenCalledWith({ kind: 'fresh' });
  });

  it('calls onOpenCreateModal with repo prefill from onboarding', () => {
    const onOpenCreateModal = vi.fn();
    render(
      <SidebarPackSelector
        {...defaultProps}
        repoRoot="/repo/root"
        onOpenCreateModal={onOpenCreateModal}
      />,
    );
    fireEvent.click(screen.getByText('Use this repository'));
    expect(onOpenCreateModal).toHaveBeenCalledWith({
      kind: 'prefill-from-repo',
      repoRoot: '/repo/root',
    });
  });

  it('renders trigger with selected pack name', () => {
    const packs = [makePack()];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    expect(screen.getByText('My Pack')).toBeInTheDocument();
  });

  it('shows "Select a pack" when no pack matches selection', () => {
    const packs = [makePack()];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/other"
      />,
    );
    expect(screen.getByText('Select a pack')).toBeInTheDocument();
  });

  it('opens dropdown on trigger click', () => {
    const packs = [makePack()];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    fireEvent.click(screen.getByLabelText('Select context pack'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('calls onSelectContextPack when option is clicked', () => {
    const onSelectContextPack = vi.fn();
    const packs = [makePack(), makePack({ contextPackId: 'pack-2', displayName: 'Pack Two', contextPackDir: '/packs/two' })];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
        onSelectContextPack={onSelectContextPack}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select context pack'));
    fireEvent.click(screen.getByText('Pack Two'));
    expect(onSelectContextPack).toHaveBeenCalledWith('/packs/two');
  });

  it('shows ready status for bootstrapReady non-active pack', () => {
    const packs = [makePack({ bootstrapReady: true, isActive: false })];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('shows incomplete status for non-bootstrapReady pack', () => {
    const packs = [makePack({ bootstrapReady: false, isActive: false })];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    expect(screen.getByText('incomplete')).toBeInTheDocument();
  });

  it('shows needs-review variant for bootstrap-empty review state', () => {
    const packs = [
      makePack({
        packSeedState: 'bootstrap-empty',
        packSeedStateInfo: {
          state: 'bootstrap-empty',
          reason: 'new-flow-needs-review',
        },
      }),
    ];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    fireEvent.click(screen.getByLabelText('Select context pack'));
    expect(screen.getByText('needs review')).toBeInTheDocument();
    expect(screen.queryByText('needs population')).not.toBeInTheDocument();
  });

  it('shows needs population for bootstrap-empty pack without an active reseed marker', () => {
    const packs = [
      makePack({
        packSeedState: 'bootstrap-empty',
        packSeedStateInfo: {
          state: 'bootstrap-empty',
          reason: 'new-flow-seed-skipped',
          inProgress: false,
        },
      }),
    ];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    fireEvent.click(screen.getByLabelText('Select context pack'));
    expect(screen.getByText('needs population')).toBeInTheDocument();
    expect(screen.queryByText('Reseeding...')).not.toBeInTheDocument();
  });

  it('shows reseeding badge before bootstrap-empty badges while a reseed is in progress', () => {
    const packs = [
      makePack({
        packSeedState: 'bootstrap-empty',
        packSeedStateInfo: {
          state: 'bootstrap-empty',
          reason: 'new-flow-needs-review',
          inProgress: true,
        },
      }),
    ];
    render(
      <SidebarPackSelector
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    fireEvent.click(screen.getByLabelText('Select context pack'));
    expect(screen.getByText('Reseeding...')).toBeInTheDocument();
    expect(screen.queryByText('needs review')).not.toBeInTheDocument();
    expect(screen.queryByText('needs population')).not.toBeInTheDocument();
  });
});
