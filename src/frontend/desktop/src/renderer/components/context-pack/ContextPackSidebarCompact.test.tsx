import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../../shared/desktopContract';
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

  it('renders only the active pack icon when a context pack is active', () => {
    const packs = [
      makePack({ contextPackId: 'pack-1', displayName: 'My Pack', contextPackDir: '/packs/my-pack' }),
      makePack({ contextPackId: 'pack-2', displayName: 'Other Pack', contextPackDir: '/packs/other', isActive: true }),
    ];
    render(
      <ContextPackSidebarCompact
        {...defaultProps}
        contextPacks={packs}
        activeContextPackDir="/packs/other"
      />,
    );
    expect(screen.queryByLabelText('My Pack')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Other Pack')).toBeInTheDocument();
  });

  it('falls back to the first ready pack icon when no context pack is active', () => {
    const packs = [
      makePack({ contextPackId: 'pack-1', displayName: 'Incomplete Pack', contextPackDir: '/packs/incomplete', bootstrapReady: false }),
      makePack({ contextPackId: 'pack-2', displayName: 'First Ready Pack', contextPackDir: '/packs/ready-1', bootstrapReady: true }),
      makePack({ contextPackId: 'pack-3', displayName: 'Second Ready Pack', contextPackDir: '/packs/ready-2', bootstrapReady: true }),
    ];
    render(
      <ContextPackSidebarCompact
        {...defaultProps}
        contextPacks={packs}
        activeContextPackDir={null}
      />,
    );
    expect(screen.queryByLabelText('Incomplete Pack')).not.toBeInTheDocument();
    expect(screen.getByLabelText('First Ready Pack')).toBeInTheDocument();
    expect(screen.queryByLabelText('Second Ready Pack')).not.toBeInTheDocument();
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
