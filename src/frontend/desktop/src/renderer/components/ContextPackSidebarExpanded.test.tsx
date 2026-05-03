// @vitest-environment jsdom

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import ContextPackSidebarExpanded from './ContextPackSidebarExpanded';

expect.extend(matchers);

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
  activeContextPackDir: null as string | null,
  selectedContextPackDir: '',
  selectedRepoIds: [] as string[],
  selectedFocusIds: [] as string[],
  deepFocusEnabled: false,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedTestTarget: undefined,
  selectedSupportTargets: [],
  actionPending: null as 'refresh' | 'preview' | 'apply' | 'clear' | 'reseed' | null,
  message: '',
  error: '',
  lastResult: null,
  lastReseedResult: null,
  onToggleCollapse: vi.fn(),
  onSelectContextPack: vi.fn(),
  onSelectWorkingFocus: vi.fn(),
  onRefreshCatalog: vi.fn(),
  onOpenCreateModal: vi.fn(),
  onReseedContextPack: vi.fn(),
  onPreviewSwitch: vi.fn(),
  onApplySwitch: vi.fn(),
  onClearActive: vi.fn(),
  onCommitDeepFocusSelection: vi.fn(),
  onListRepoTree: vi.fn().mockResolvedValue(null),
  onOpenPlannerModal: vi.fn(),
  showMultiPrimaryWarning: false,
  onDismissMultiPrimaryWarning: vi.fn(),
};

describe('ContextPackSidebarExpanded', () => {
  it('renders sidebar with heading', () => {
    render(<ContextPackSidebarExpanded {...defaultProps} />);
    expect(screen.getByLabelText('Context pack sidebar')).toBeInTheDocument();
    expect(screen.getByText('Context packs')).toBeInTheDocument();
  });

  it('renders collapse button', () => {
    const onToggleCollapse = vi.fn();
    render(<ContextPackSidebarExpanded {...defaultProps} onToggleCollapse={onToggleCollapse} />);
    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it('renders Apply and Preview buttons', () => {
    render(<ContextPackSidebarExpanded {...defaultProps} />);
    expect(screen.getByLabelText('Apply pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Preview pack')).toBeInTheDocument();
  });

  it('disables action buttons when no selection', () => {
    render(<ContextPackSidebarExpanded {...defaultProps} selectedContextPackDir="" />);
    expect(screen.getByLabelText('Apply pack')).toBeDisabled();
    expect(screen.getByLabelText('Preview pack')).toBeDisabled();
  });

  it('enables action buttons with selection', () => {
    const packs = [makePack()];
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    expect(screen.getByLabelText('Apply pack')).not.toBeDisabled();
    expect(screen.getByLabelText('Preview pack')).not.toBeDisabled();
  });

  it('shows Applying… when apply is pending', () => {
    const packs = [makePack()];
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
        actionPending="apply"
      />,
    );
    expect(screen.getByText('Applying\u2026')).toBeInTheDocument();
  });

  it('shows error message when error is set', () => {
    render(<ContextPackSidebarExpanded {...defaultProps} error="Pack apply failed" />);
    expect(screen.getByText('Pack apply failed')).toBeInTheDocument();
  });

  it('disables buttons when actionPending is set', () => {
    const packs = [makePack()];
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
        actionPending="preview"
      />,
    );
    expect(screen.getByLabelText('Apply pack')).toBeDisabled();
    expect(screen.getByLabelText('Refresh packs')).toBeDisabled();
  });

  it('renders Reseed and Clear toolbar buttons', () => {
    render(<ContextPackSidebarExpanded {...defaultProps} />);
    expect(screen.getByLabelText('Reseed pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Clear pack')).toBeInTheDocument();
  });

  it('disables Clear when no active context pack is applied', () => {
    render(<ContextPackSidebarExpanded {...defaultProps} activeContextPackDir={null} />);
    expect(screen.getByLabelText('Clear pack')).toBeDisabled();
  });

  it('enables Clear when an active context pack exists', () => {
    render(<ContextPackSidebarExpanded {...defaultProps} activeContextPackDir="/packs/my-pack" />);
    expect(screen.getByLabelText('Clear pack')).not.toBeDisabled();
  });

  it('renders generic primary selection warning copy', () => {
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        showMultiPrimaryWarning
      />,
    );

    expect(screen.getByRole('alertdialog', { name: 'Primary selection required' })).toBeInTheDocument();
    expect(screen.getByText('Primary Selection Required')).toBeInTheDocument();
    expect(screen.getByText(/Exactly one Primary must be selected/)).toBeInTheDocument();
  });

  it('keeps expanded sidebar layering classes during editor close choreography', async () => {
    const pack = makePack({
      estateType: 'distributed-platform',
      focusTargets: [
        {
          focusId: 'repo-1',
          displayName: 'Frontend',
          kind: 'repository',
          repoId: 'repo-1',
          repoLocalPath: '/tmp/repo-1',
          serviceName: null,
          systemLayer: 'frontend',
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
    });

    const { container } = render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={[pack]}
        selectedContextPackDir="/packs/my-pack"
        selectedRepoIds={['repo-1']}
        deepFocusEnabled
      />,
    );

    // With `selectedRepoIds=['repo-1']` matching a manifest id, the summary is
    // in the populated state and exposes the scope editor entry point.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    await screen.findByTestId('deep-focus-editor');
    expect(container.querySelector('.context-pack-sidebar')).toHaveClass('deep-focus-sidebar--expanded');

    fireEvent.click(screen.getAllByRole('button', { name: 'Close editor' })[0]!);
    expect(container.querySelector('.context-pack-sidebar')).toHaveClass('deep-focus-sidebar--closing');
  });
});
