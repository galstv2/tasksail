import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ContextPackSidebar from './ContextPackSidebar';

afterEach(() => {
  cleanup();
});

function createSidebarProps() {
  return {
    contextPacks: [
      {
        contextPackId: 'orders-estate',
        displayName: 'Orders Estate',
        contextPackDir: '/tmp/context-packs/orders-estate',
        manifestPath: '/tmp/context-packs/orders-estate/qmd/repo-sources.json',
        bootstrapReady: true,
        source: 'active-env' as const,
        isActive: true,
        estateType: 'distributed-platform' as const,
        defaultScopeMode: 'focused' as const,
        repoCount: 2,
        primaryWorkingRepoIds: ['orders-api'],
        focusTargets: [
          {
            focusId: 'orders-api',
            displayName: 'Orders API',
            kind: 'repository' as const,
            repoId: 'orders-api',
            repoLocalPath: '/tmp/context-packs/orders-estate/orders-api',
            serviceName: 'Orders API',
            systemLayer: 'backend',
            repoRole: 'backend-service',
            repositoryType: null,
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: true,
            activationPriority: 10,
            adjacentRepoIds: ['orders-web'],
            adjacentFocusIds: [],
          },
          {
            focusId: 'orders-web',
            displayName: 'Orders Web',
            kind: 'repository' as const,
            repoId: 'orders-web',
            repoLocalPath: '/tmp/context-packs/orders-estate/orders-web',
            serviceName: 'Orders Web',
            systemLayer: 'frontend',
            repoRole: 'frontend',
            repositoryType: null,
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: false,
            activationPriority: 5,
            adjacentRepoIds: ['orders-api'],
            adjacentFocusIds: [],
          },
        ],
      },
      {
        contextPackId: 'billing-estate',
        displayName: 'Billing Estate',
        contextPackDir: '/tmp/context-packs/billing-estate',
        manifestPath: '/tmp/context-packs/billing-estate/qmd/repo-sources.json',
        bootstrapReady: true,
        source: 'search-root' as const,
        isActive: false,
        estateType: 'distributed-platform' as const,
        defaultScopeMode: 'focused' as const,
        repoCount: 1,
        primaryWorkingRepoIds: ['billing-api'],
        focusTargets: [
          {
            focusId: 'billing-api',
            displayName: 'Billing API',
            kind: 'repository' as const,
            repoId: 'billing-api',
            repoLocalPath: '/tmp/context-packs/billing-estate/billing-api',
            serviceName: 'Billing API',
            systemLayer: 'backend',
            repoRole: 'backend-service',
            repositoryType: null,
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: true,
            activationPriority: 8,
            adjacentRepoIds: [],
            adjacentFocusIds: [],
          },
        ],
      },
    ],
    activeContextPackDir: '/tmp/context-packs/orders-estate',
    selectedContextPackDir: '/tmp/context-packs/orders-estate',
    selectedRepoIds: ['orders-api'],
    selectedFocusIds: [],
    actionPending: null,
    message: 'Discovered 2 context pack(s) from approved local sources.',
    error: '',
    lastResult: null,
    lastReseedResult: null,
    collapsed: false,
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
}

describe('ContextPackSidebar', () => {
  it('renders a compact active-state summary and a visible create-pack affordance', () => {
    render(<ContextPackSidebar {...createSidebarProps()} />);

    expect(screen.getByRole('heading', { name: 'Context packs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create context pack' })).toBeEnabled();
    expect(screen.getByTestId('context-pack-active-state')).toHaveTextContent('Orders Estate is active');
    expect(screen.getByLabelText('Selected context pack summary')).toHaveTextContent('Distributed');
    expect(screen.getByLabelText('Selected context pack summary')).toHaveTextContent('2 repos');
    expect(screen.getByTestId('context-pack-selection-summary')).toHaveTextContent('Focus: Orders API');
  });

  it('launches creation from the header and empty-state affordances', () => {
    const props = createSidebarProps();
    const { rerender } = render(<ContextPackSidebar {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create context pack' }));
    expect(props.onOpenCreateModal).toHaveBeenCalledTimes(1);

    rerender(
      <ContextPackSidebar
        {...props}
        contextPacks={[]}
        activeContextPackDir={null}
        selectedContextPackDir=""
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Create context pack' })[1]);
    expect(props.onOpenCreateModal).toHaveBeenCalledTimes(2);
  });

  it('keeps compact core actions visible and dispatches handlers', () => {
    const props = createSidebarProps();
    render(<ContextPackSidebar {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview pack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply pack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear pack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh packs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reseed pack' }));

    expect(props.onPreviewSwitch).toHaveBeenCalledTimes(1);
    expect(props.onApplySwitch).toHaveBeenCalledTimes(1);
    expect(props.onClearActive).toHaveBeenCalledTimes(1);
    expect(props.onRefreshCatalog).toHaveBeenCalledTimes(1);
    expect(props.onReseedContextPack).toHaveBeenCalledTimes(1);
  });

  it('shows restore messaging and status for drift-detected packs without inline result details', () => {
    render(
      <ContextPackSidebar
        {...createSidebarProps()}
        contextPacks={[
          {
            ...createSidebarProps().contextPacks[0],
            source: 'recent-state',
            status: 'active-dirty-workspace',
            statusMessage:
              'Managed workspace folders drifted from the last successful sync. Reconcile before continuing.',
            restoreAvailable: true,
            lastSyncedAt: '2026-03-08T12:00:00Z',
          },
        ]}
        lastResult={{
          ok: true,
          wrapperAction: 'preview',
          stage: 'complete',
          status: 'success',
          activation: { performed: false, exitCode: null, output: '' },
          envStateCleared: false,
          error: null,
          contextPackId: 'orders-estate',
          contextPackDir: '/tmp/context-packs/orders-estate',
          workspaceFile: '/repo/tasksail.code-workspace',
          stateFile: '/repo/.platform-state/workspace-context-sync.json',
          scopeMode: 'focused',
          selectedRepoIds: ['orders-api'],
          selectedFocusIds: [],
          warnings: ['orders-web is missing on disk'],
          foldersToAdd: ['/tmp/context-packs/orders-estate'],
          foldersToRemove: [],
          managedFolders: ['/tmp/context-packs/orders-estate'],
          targetFolders: ['/tmp/context-packs/orders-estate'],
          lastSyncedAt: null,
          deepFocusEnabled: false,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedTestTarget: null,
          selectedSupportTargets: [],
        }}
        lastReseedResult={{
          contextPackDir: '/tmp/context-packs/orders-estate',
          overallStatus: 'seeded',
          reportPath: '/tmp/context-packs/orders-estate/qmd/context-pack-seed-report.json',
          seededRepoCount: 2,
          blockedRepoCount: 0,
          conventionsSummaryStatus: 'available',
          conventionsPolicy: 'only-if-missing',
          workspaceFolderCount: null,
          workspaceFileCount: null,
        }}
      />,
    );

    expect(screen.getByTestId('context-pack-status-message')).toHaveTextContent(
      'Managed workspace folders drifted from the last successful sync. Reconcile before continuing.',
    );
    expect(screen.getByRole('button', { name: 'Reconcile pack' })).toBeInTheDocument();
    expect(screen.getByTestId('context-pack-restore-hint')).toBeInTheDocument();
    expect(screen.queryByText('Latest switch result')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest reseed result')).not.toBeInTheDocument();
  });

  it('renders collapsed state with icon-only buttons', () => {
    const props = createSidebarProps();
    render(<ContextPackSidebar {...props} collapsed={true} />);

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByLabelText('Context pack active')).toHaveTextContent('✓');
    expect(screen.getByRole('button', { name: 'Orders Estate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Billing Estate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh packs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create pack' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reseed pack' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Context packs' })).not.toBeInTheDocument();
  });

  it('renders expanded state with pack selector and action buttons', () => {
    const props = createSidebarProps();
    render(<ContextPackSidebar {...props} collapsed={false} />);

    expect(screen.getByRole('heading', { name: 'Context packs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    const trigger = screen.getByLabelText('Select context pack');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Orders Estate');
    expect(screen.getByRole('button', { name: 'Preview pack' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply pack' })).toBeInTheDocument();
  });

  it('toggle button switches between collapsed and expanded', () => {
    const props = createSidebarProps();
    const { rerender } = render(<ContextPackSidebar {...props} collapsed={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(props.onToggleCollapse).toHaveBeenCalledTimes(1);

    rerender(<ContextPackSidebar {...props} collapsed={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(props.onToggleCollapse).toHaveBeenCalledTimes(2);
  });

  it('does not render inline feedback blocks', () => {
    render(
      <ContextPackSidebar
        {...createSidebarProps()}
        lastResult={{
          ok: true,
          wrapperAction: 'preview',
          stage: 'complete',
          status: 'success',
          activation: { performed: false, exitCode: null, output: '' },
          envStateCleared: false,
          error: null,
          contextPackId: 'orders-estate',
          contextPackDir: '/tmp/context-packs/orders-estate',
          workspaceFile: '/repo/tasksail.code-workspace',
          stateFile: '/repo/.platform-state/workspace-context-sync.json',
          scopeMode: 'focused',
          selectedRepoIds: ['orders-api'],
          selectedFocusIds: [],
          warnings: ['orders-web is missing on disk'],
          foldersToAdd: ['/tmp/context-packs/orders-estate'],
          foldersToRemove: [],
          managedFolders: ['/tmp/context-packs/orders-estate'],
          targetFolders: ['/tmp/context-packs/orders-estate'],
          lastSyncedAt: null,
          deepFocusEnabled: false,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedTestTarget: null,
          selectedSupportTargets: [],
        }}
        lastReseedResult={{
          contextPackDir: '/tmp/context-packs/orders-estate',
          overallStatus: 'seeded',
          reportPath: '/tmp/context-packs/orders-estate/qmd/context-pack-seed-report.json',
          seededRepoCount: 2,
          blockedRepoCount: 0,
          conventionsSummaryStatus: 'available',
          conventionsPolicy: 'only-if-missing',
          workspaceFolderCount: null,
          workspaceFileCount: null,
        }}
      />,
    );

    expect(screen.queryByText('Latest switch result')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest reseed result')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Context pack result summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Context pack reseed summary')).not.toBeInTheDocument();
  });
});
