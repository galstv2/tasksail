// @vitest-environment jsdom

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../../shared/desktopContract';
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
  currentWorkspaceSelection: { selectedRepoIds: [], selectedFocusIds: [], deepFocusEnabled: false, deepFocusPrimaryRepoId: null, deepFocusPrimaryFocusId: null, selectedFocusPath: null, selectedFocusTargetKind: null, selectedFocusTargets: [], selectedTestTarget: null, selectedSupportTargets: [] },
  actionPending: null as 'refresh' | 'preview' | 'apply' | 'clear' | 'reseed' | null,
  message: '',
  error: '',
  lastResult: null,
  lastReseedResult: null,
  onToggleCollapse: vi.fn(),
  onSelectContextPack: vi.fn(),
  onSelectWorkingFocus: vi.fn(),
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
  bootstrapEmptyConfirmPending: false,
  onConfirmActivateAnyway: vi.fn(),
  onConfirmPopulateAndSeed: vi.fn(),
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
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        activeContextPackDir="/packs/active-pack"
        selectedContextPackDir=""
      />,
    );
    expect(screen.getByLabelText('Apply pack')).toBeDisabled();
    expect(screen.getByLabelText('Preview pack')).toBeDisabled();
    expect(screen.getByTestId('planner-open-btn')).toBeDisabled();
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

  it('opens the Focus Filters modal from Workspace Selection', () => {
    const packs = [makePack()];
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
      />,
    );

    fireEvent.click(screen.getByLabelText('Manage focus filters'));
    expect(screen.getByRole('dialog', { name: 'Focus Filters' })).toBeInTheDocument();
  });

  it('forwards the centralized currentWorkspaceSelection into Focus Filters, not legacy selectedRepoIds', () => {
    // Guards the centralized Focus Filters "Current workspace
    // selection" card must reflect the memoized currentWorkspaceSelection prop
    // (api/Primary), not a selection rebuilt inline from selectedRepoIds
    // (legacy-only).
    const packs = [
      makePack({
        estateType: 'distributed-platform',
        focusTargets: [
          {
            focusId: 'api',
            displayName: 'API',
            kind: 'repository',
            repoId: 'api',
            repoLocalPath: '/repos/api',
            serviceName: null,
            systemLayer: null,
            repoRole: null,
            repositoryType: 'primary',
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: true,
            activationPriority: 1,
            adjacentRepoIds: [],
            adjacentFocusIds: [],
          },
        ],
      }),
    ];
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
        selectedRepoIds={['legacy-only']}
        currentWorkspaceSelection={{
          selectedRepoIds: ['api'],
          selectedFocusIds: [],
          repositoryTypes: { api: 'primary' },
          deepFocusEnabled: false,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText('Manage focus filters'));
    const row = screen
      .getByText('Current workspace selection')
      .closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Primary')).toBeInTheDocument();
    expect(within(row!).getByText('API')).toBeInTheDocument();
    expect(within(row!).queryByText('legacy-only')).toBeNull();
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
  });

  it('renders Reseed and Clear toolbar buttons for an active selected pack', () => {
    const packs = [makePack({ isActive: true })];
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        activeContextPackDir="/packs/my-pack"
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    expect(screen.getByLabelText('Reseed pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Clear pack')).toBeInTheDocument();
  });

  it('does not render Clear when no context pack is selected', () => {
    render(<ContextPackSidebarExpanded {...defaultProps} activeContextPackDir={null} />);
    expect(screen.queryByLabelText('Clear pack')).not.toBeInTheDocument();
  });

  it('enables Clear when the selected context pack is active', () => {
    const packs = [makePack({ isActive: true })];
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        activeContextPackDir="/packs/my-pack"
        selectedContextPackDir="/packs/my-pack"
      />,
    );
    expect(screen.getByLabelText('Clear pack')).not.toBeDisabled();
  });

  it('keeps Deep Focus visible for an active plain distributed pack', () => {
    const packs = [
      makePack({
        isActive: true,
        estateType: 'distributed',
        focusTargets: [
          {
            focusId: 'platform',
            displayName: 'Platform',
            kind: 'repository',
            repoId: 'platform',
            repoLocalPath: '/repos/platform',
            serviceName: null,
            systemLayer: null,
            repoRole: null,
            repositoryType: 'primary',
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: true,
            activationPriority: 0,
            adjacentRepoIds: [],
            adjacentFocusIds: [],
          },
        ],
      }),
    ];
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        activeContextPackDir="/packs/my-pack"
        selectedContextPackDir="/packs/my-pack"
        selectedRepoIds={['platform']}
        selectedFocusIds={[]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Toggle Deep Focus' })).toBeInTheDocument();
    expect(screen.getByText('Repositories')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('renders Delete for an inactive selected pack and keeps the modal open on delete failure', async () => {
    const packs = [makePack({ isActive: false })];
    const onDeleteContextPack = vi.fn().mockResolvedValue(false);
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
        onDeleteContextPack={onDeleteContextPack}
      />,
    );

    fireEvent.click(screen.getByLabelText('Delete context pack'));
    expect(screen.getByRole('dialog', { name: 'Delete context pack' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await screen.findByRole('dialog', { name: 'Delete context pack' });
    expect(onDeleteContextPack).toHaveBeenCalledWith('/packs/my-pack');
  });

  it('disables Delete for an inactive selected pack while a task is active', () => {
    const packs = [makePack({ isActive: false })];
    const onDeleteContextPack = vi.fn();
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
        deleteBlockedByActiveTask
        onDeleteContextPack={onDeleteContextPack}
      />,
    );

    const deleteButton = screen.getByLabelText('Delete context pack');
    expect(deleteButton).toBeDisabled();
    fireEvent.click(deleteButton);
    expect(screen.queryByRole('dialog', { name: 'Delete context pack' })).not.toBeInTheDocument();
    expect(onDeleteContextPack).not.toHaveBeenCalled();
  });

  it('closes the delete modal after a successful delete', async () => {
    const packs = [makePack({ isActive: false })];
    const onDeleteContextPack = vi.fn().mockResolvedValue(true);
    render(
      <ContextPackSidebarExpanded
        {...defaultProps}
        contextPacks={packs}
        selectedContextPackDir="/packs/my-pack"
        onDeleteContextPack={onDeleteContextPack}
      />,
    );

    fireEvent.click(screen.getByLabelText('Delete context pack'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Delete context pack' })).not.toBeInTheDocument();
    });
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
    expect(screen.getByText(/Select at least one Primary/)).toBeInTheDocument();
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
