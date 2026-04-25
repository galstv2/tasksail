import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import ContextPackSidebarCompact from './ContextPackSidebarCompact';

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
  activeContextPackDir: '/packs/my-pack',
  selectedContextPackDir: '/packs/my-pack',
  actionPending: null as null | 'refresh' | 'preview' | 'apply' | 'clear' | 'reseed',
  onToggleCollapse: vi.fn(),
  onSelectContextPack: vi.fn(),
  onRefreshCatalog: vi.fn(),
  onOpenCreateModal: vi.fn(),
  onReseedContextPack: vi.fn(),
  onPreviewSwitch: vi.fn(),
  onApplySwitch: vi.fn(),
  onClearActive: vi.fn(),
  onOpenPlannerModal: vi.fn(),
};

describe('ContextPackSidebarCompact', () => {
  it('renders sidebar with action buttons', () => {
    render(<ContextPackSidebarCompact {...defaultProps} />);
    expect(screen.getByLabelText('Context pack sidebar')).toBeInTheDocument();
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();
    expect(screen.getByLabelText('Context pack active')).toBeInTheDocument();
    expect(screen.getByLabelText('Refresh packs')).toBeInTheDocument();
    expect(screen.getByLabelText('Create pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Apply pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Preview pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Reseed pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Clear pack')).toBeInTheDocument();
  });

  it('shows an exclamation status when no context pack is active', () => {
    render(<ContextPackSidebarCompact {...defaultProps} activeContextPackDir={null} />);
    expect(screen.getByLabelText('No active context pack')).toHaveTextContent('!');
  });

  it('calls onToggleCollapse when expand button clicked', () => {
    const onToggleCollapse = vi.fn();
    render(<ContextPackSidebarCompact {...defaultProps} onToggleCollapse={onToggleCollapse} />);
    fireEvent.click(screen.getByLabelText('Expand sidebar'));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it('renders pack icon buttons for each context pack', () => {
    const packs = [makePack(), makePack({ contextPackId: 'pack-2', displayName: 'Other Pack', contextPackDir: '/packs/other' })];
    render(<ContextPackSidebarCompact {...defaultProps} contextPacks={packs} />);
    expect(screen.getByLabelText('My Pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Other Pack')).toBeInTheDocument();
  });

  it('calls onSelectContextPack when pack icon clicked', () => {
    const onSelectContextPack = vi.fn();
    const packs = [makePack()];
    render(
      <ContextPackSidebarCompact
        {...defaultProps}
        contextPacks={packs}
        onSelectContextPack={onSelectContextPack}
      />,
    );
    fireEvent.click(screen.getByLabelText('My Pack'));
    expect(onSelectContextPack).toHaveBeenCalledWith('/packs/my-pack');
  });

  it('calls onOpenCreateModal when create button clicked', () => {
    const onOpenCreateModal = vi.fn();
    render(<ContextPackSidebarCompact {...defaultProps} onOpenCreateModal={onOpenCreateModal} />);
    fireEvent.click(screen.getByLabelText('Create pack'));
    expect(onOpenCreateModal).toHaveBeenCalledOnce();
  });

  it('dispatches compact footer actions', () => {
    const onApplySwitch = vi.fn();
    const onPreviewSwitch = vi.fn();
    const onReseedContextPack = vi.fn();
    const onClearActive = vi.fn();
    render(
      <ContextPackSidebarCompact
        {...defaultProps}
        onApplySwitch={onApplySwitch}
        onPreviewSwitch={onPreviewSwitch}
        onReseedContextPack={onReseedContextPack}
        onClearActive={onClearActive}
      />,
    );

    fireEvent.click(screen.getByLabelText('Apply pack'));
    fireEvent.click(screen.getByLabelText('Preview pack'));
    fireEvent.click(screen.getByLabelText('Reseed pack'));
    fireEvent.click(screen.getByLabelText('Clear pack'));

    expect(onApplySwitch).toHaveBeenCalledOnce();
    expect(onPreviewSwitch).toHaveBeenCalledOnce();
    expect(onReseedContextPack).toHaveBeenCalledOnce();
    expect(onClearActive).toHaveBeenCalledOnce();
  });

  it('disables compact footer actions when selection is unavailable', () => {
    render(
      <ContextPackSidebarCompact
        {...defaultProps}
        activeContextPackDir={null}
        selectedContextPackDir=""
      />,
    );

    expect(screen.getByLabelText('Apply pack')).toBeDisabled();
    expect(screen.getByLabelText('Preview pack')).toBeDisabled();
    expect(screen.getByLabelText('Clear pack')).toBeDisabled();
  });
});
