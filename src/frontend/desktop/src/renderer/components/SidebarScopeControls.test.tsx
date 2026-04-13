// @vitest-environment jsdom

import { useState, type ComponentProps } from 'react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import type { CompactSidebarModel } from '../selectors/contextPackSidebarModel';
import SidebarScopeControls from './SidebarScopeControls';

function ScopeControlsWithEditor(props: ComponentProps<typeof SidebarScopeControls>): JSX.Element {
  const [editorOpen, setEditorOpen] = useState(false);
  return (
    <SidebarScopeControls
      {...props}
      editorOpen={editorOpen}
      onDeepFocusEditorToggle={(expanded) => {
        setEditorOpen(expanded);
        props.onDeepFocusEditorToggle?.(expanded);
      }}
    />
  );
}

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
    focusTargets: [
      {
        focusId: 'repo-1',
        displayName: 'Frontend',
        kind: 'repository',
        repoId: 'repo-1',
        repoLocalPath: '/tmp/repo-1',
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
  deepFocusEnabled: false,
  selectedFocusPath: null as string | null,
  selectedFocusTargetKind: null,
  selectedTestTarget: undefined,
  selectedSupportTargets: [],
  focusHint: null as string | null,
  onSelectWorkingFocus: vi.fn(),
  onCommitDeepFocusSelection: vi.fn(),
  onListRepoTree: vi.fn().mockResolvedValue(null),
  sidebarModel: makeModel(),
};

describe('SidebarScopeControls', () => {
  it('returns null when no selectedPack', () => {
    const { container } = render(<SidebarScopeControls {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders workspace focus heading', () => {
    render(<SidebarScopeControls {...defaultProps} selectedPack={makePack()} />);
    expect(screen.getByText('Workspace Selection')).toBeInTheDocument();
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

    expect(screen.getByText('Folders')).toBeInTheDocument();
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

  it('shows the relative path and combined tooltip for monolith focus rows', () => {
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
              relativePath: 'services/core-module',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('services/core-module')).toBeInTheDocument();
    expect(screen.getByTitle('Core Module — services/core-module')).toBeInTheDocument();
  });

  it('renders the Deep Focus toggle for distributed and monolith packs', () => {
    const { rerender } = render(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Toggle Deep Focus' })).toBeInTheDocument();

    rerender(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack({ estateType: 'monolith' })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Toggle Deep Focus' })).toBeInTheDocument();

    rerender(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack({ estateType: 'monolith-platform' })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Toggle Deep Focus' })).toBeInTheDocument();
  });

  it('renders compact Deep Focus summary and opens the editor', async () => {
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        { name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true },
        { name: 'tests', relativePath: 'tests', kind: 'directory', hasChildren: true },
      ],
      currentPath: '',
      repoLocalPath: '/tmp/repo-1',
      truncated: false,
    });

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled
        onListRepoTree={onListRepoTree}
      />,
    );

    expect(screen.getByTestId('deep-focus-summary')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByTestId('deep-focus-editor')).toBeInTheDocument();
    expect(screen.getByText('Repositories')).toBeInTheDocument();
  });

  it('commits working Deep Focus selection from the editor', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const onListRepoTree = vi
      .fn()
      .mockResolvedValueOnce({
        action: 'contextPack.listRepoTree',
        mode: 'read-only',
        message: 'Listed repo tree entries.',
        entries: [
          { name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true },
          { name: 'tests', relativePath: 'tests', kind: 'directory', hasChildren: true },
        ],
        currentPath: '',
        repoLocalPath: '/tmp/repo-1',
        truncated: false,
      });

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.doubleClick(repoRow!);

    const srcRow = (await screen.findAllByText('src'))[0];
    fireEvent.click(srcRow.closest('[role="button"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        deepFocusEnabled: true,
        selectedRepoIds: ['repo-1'],
        selectedFocusIds: [],
        selectedFocusPath: 'src',
        selectedFocusTargetKind: 'directory',
      }),
    );
  });

  it('drills monolith focus areas with monolith-root-relative paths and focus-area breadcrumbs', async () => {
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        {
          name: 'src',
          relativePath: 'services/core-module/src',
          kind: 'directory',
          hasChildren: true,
        },
      ],
      currentPath: 'services/core-module',
      repoLocalPath: '/tmp/repo-1',
      truncated: false,
    });

    render(
      <ScopeControlsWithEditor
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
              relativePath: 'services/core-module',
            },
          ],
        })}
        selectedWorkingFocusIds={['focus-1']}
        deepFocusEnabled
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const areaRow = screen.getAllByText('Core Module')[0]?.closest('[role="button"]');
    expect(areaRow).not.toBeNull();
    fireEvent.doubleClick(areaRow!);

    await waitFor(() => {
      expect(onListRepoTree).toHaveBeenCalledWith('/tmp/repo-1', 'services/core-module');
    });

    const breadcrumb = within(screen.getByLabelText('Deep Focus breadcrumb'));
    expect(breadcrumb.getByText('Focus Areas')).toBeInTheDocument();
    expect(breadcrumb.getByText('Core Module')).toBeInTheDocument();
    expect(breadcrumb.queryByText('services')).not.toBeInTheDocument();
  });

  it('commits monolith Deep Focus selections with full monolith-root-relative paths', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        {
          name: 'src',
          relativePath: 'services/core-module/src',
          kind: 'directory',
          hasChildren: true,
        },
        {
          name: 'README.md',
          relativePath: 'services/core-module/README.md',
          kind: 'file',
          hasChildren: false,
        },
      ],
      currentPath: 'services/core-module',
      repoLocalPath: '/tmp/repo-1',
      truncated: false,
    });

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({
          estateType: 'monolith-platform',
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
              relativePath: 'services/core-module',
            },
          ],
        })}
        selectedWorkingFocusIds={['focus-1']}
        deepFocusEnabled
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const areaRow = screen.getAllByText('Core Module')[0]?.closest('[role="button"]');
    expect(areaRow).not.toBeNull();
    fireEvent.doubleClick(areaRow!);

    const srcRow = (await screen.findAllByText('src'))[0];
    fireEvent.click(srcRow.closest('[role="button"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        deepFocusEnabled: true,
        selectedRepoIds: [],
        selectedFocusIds: ['focus-1'],
        selectedFocusPath: 'services/core-module/src',
        selectedFocusTargetKind: 'directory',
      }),
    );
  });

  it('renders a collapsed single-line selection tray and persists dismissed no-tests', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const onListRepoTree = vi
      .fn()
      .mockResolvedValueOnce({
        action: 'contextPack.listRepoTree',
        mode: 'read-only',
        message: 'Listed repo tree entries.',
        entries: [
          { name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true },
          { name: 'tests', relativePath: 'tests', kind: 'directory', hasChildren: true },
        ],
        currentPath: '',
        repoLocalPath: '/tmp/repo-1',
        truncated: false,
      });

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const traySummary = await screen.findByTestId('deep-focus-selection-tray-summary');
    expect(traySummary).toHaveTextContent('Primary: Frontend');
    expect(traySummary).toHaveTextContent('Test: choose target');
    expect(screen.queryByText('Dismiss — no tests')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle selection tray' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss — no tests' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedTestTarget: null,
      }),
    );
  });

  it('applies drill transition classes while navigating the deep focus tree', async () => {
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        { name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true },
      ],
      currentPath: '',
      repoLocalPath: '/tmp/repo-1',
      truncated: false,
    });

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const repoRow = (await screen.findAllByText('Frontend'))[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.doubleClick(repoRow!);

    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Deep Focus tree' }).className).toMatch(
        /deep-focus-list--drill-forward-(exit|enter)/,
      );
    });
  });
});
