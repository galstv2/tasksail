// @vitest-environment jsdom

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, type ComponentProps } from 'react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  vi.useRealTimers();
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
  deepFocusPrimaryRepoId: null as string | null,
  deepFocusPrimaryFocusId: null as string | null,
  selectedFocusPath: null as string | null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
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

  it('does not select the regular workspace primary when re-enabling cleared Deep Focus', () => {
    const onCommitDeepFocusSelection = vi.fn();

    render(
      <SidebarScopeControls
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled={false}
        deepFocusPrimaryRepoId={null}
        selectedFocusPath={null}
        selectedFocusTargetKind={null}
        selectedFocusTargets={[]}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Deep Focus' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        selectedFocusTargets: [],
      }),
    );
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
        // Empty working focus + no committed scope → summary shows the
        // "Edit Scope" empty-state CTA. Per spec §2.3 the previous fixture
        // (`['/tmp/repo-1']`) only produced the empty state by accident
        // because the path string never matched any manifest id.
        selectedWorkingFocusIds={[]}
        deepFocusEnabled
        onListRepoTree={onListRepoTree}
      />,
    );

    expect(screen.getByTestId('deep-focus-summary')).toBeInTheDocument();
    expect(screen.getByText('Edit Scope')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));

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
        deepFocusPrimaryRepoId="repo-1"
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);

    const srcRow = (await screen.findAllByText('src'))[0];
    const srcButton = srcRow.closest('[role="button"]')!;

    fireEvent.click(srcButton);
    const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    fireEvent.click(within(actionBar).getByRole('button', { name: 'Add Primary Target' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        deepFocusEnabled: true,
        // Per spec §2.6: scalar holds the source primary manifest `repoId`
        // (distributed mode), not the resolved `repoLocalPath`.
        deepFocusPrimaryRepoId: 'repo-1',
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: 'src',
        selectedFocusTargetKind: 'directory',
      }),
    );
  });

  it('allows clearing the active Deep Focus target while staying in deep focus mode', async () => {
    const onCommitDeepFocusSelection = vi.fn();

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled
        selectedFocusPath="src"
        selectedFocusTargetKind="directory"
        selectedFocusTargets={[
          { path: 'src', kind: 'directory', role: 'anchor' },
        ]}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all selections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommitDeepFocusSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        selectedFocusTargets: [],
      }),
    );
  });

  it('does not rehydrate Deep Focus from the regular workspace primary after clearing', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const platformTarget = {
      ...makePack().focusTargets[0],
      focusId: 'platform',
      repoId: 'platform',
      displayName: 'Platform',
      repoLocalPath: '/tmp/platform',
    };
    const toolsTarget = {
      ...makePack().focusTargets[0],
      focusId: 'tools',
      repoId: 'tools',
      displayName: 'Tools',
      repoLocalPath: '/tmp/tools',
    };

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({
          estateType: 'distributed-platform',
          repoCount: 2,
          focusTargets: [platformTarget, toolsTarget],
        })}
        // Regular mode may still have Tools selected, but an empty Deep Focus
        // state must stay empty and must not rehydrate from that regular-mode
        // primary.
        selectedWorkingFocusIds={['tools']}
        deepFocusEnabled
        deepFocusPrimaryRepoId={null}
        selectedFocusPath={null}
        selectedFocusTargetKind={null}
        selectedFocusTargets={[]}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
      />,
    );

    expect(screen.getByTestId('deep-focus-summary')).toHaveTextContent('No primary targets');
    expect(screen.getByTestId('deep-focus-summary')).not.toHaveTextContent('Frontend');
    expect(screen.getByTestId('deep-focus-summary')).not.toHaveTextContent('Tools');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));

    expect(screen.queryByRole('region', { name: 'Selected row actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /primary targets selected/i })).not.toBeInTheDocument();
    // With the refactored editor, Apply is hidden when there are no unapplied
    // changes. The empty Deep Focus state must remain clean rather than
    // rehydrating from the regular workspace's Tools primary, so closing the
    // editor must not commit anything.
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(onCommitDeepFocusSelection).not.toHaveBeenCalled();
  });

  it('assigns Test and Support roles via selected-row actions', async () => {
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
          { name: 'lib', relativePath: 'lib', kind: 'directory', hasChildren: true },
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
        deepFocusPrimaryRepoId="repo-1"
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
    const assignRole = (rowButton: Element, roleName: string) => {
      fireEvent.click(rowButton);
      const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
      fireEvent.click(within(actionBar).getByRole('button', { name: roleName }));
    };

    // Assign src as Primary
    const srcRow = (await screen.findAllByText('src'))[0].closest('[role="button"]')!;
    assignRole(srcRow, 'Add Primary Target');

    // After making `src` a primary, the editor cursor moves to that primary's
    // scope. To add a global Test/Support we must first switch the cursor back
    // to "All primaries" via the scope rail — the cursor strictly bounds which
    // scope's actions appear in the inline command strip.
    const rail = within(screen.getByRole('navigation', { name: 'Deep Focus scopes' }));
    fireEvent.click(rail.getByRole('button', { name: 'All primaries' }));

    // Assign tests as Test
    const testsRow = screen.getAllByText('tests')[0].closest('[role="button"]')!;
    assignRole(testsRow, 'Use as Test for all primaries');

    // Assign lib as Support
    const libRow = screen.getAllByText('lib')[0].closest('[role="button"]')!;
    assignRole(libRow, 'Add as Support · For all primaries');
    expect(screen.queryByRole('menu', { name: /Actions for/ })).not.toBeInTheDocument();

    // Verify role chips appear inside their respective row containers
    const srcContainer = srcRow.closest('.deep-focus-row-container')!;
    expect(within(srcContainer as HTMLElement).getByText('Primary Target')).toBeInTheDocument();

    // Apply and verify commit
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFocusPath: 'src',
        selectedTestTarget: expect.objectContaining({
          path: 'tests',
          kind: 'directory',
          repoLocalPath: '/tmp/repo-1',
          repoId: 'repo-1',
        }),
        selectedSupportTargets: [
          expect.objectContaining({
            path: 'lib',
            kind: 'directory',
            repoLocalPath: '/tmp/repo-1',
            repoId: 'repo-1',
          }),
        ],
      }),
    );
  });

  it('selects rows to show action-bar actions and assigns global roles without long press', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        { name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true },
        { name: 'tests', relativePath: 'tests', kind: 'directory', hasChildren: true },
        { name: 'lib', relativePath: 'lib', kind: 'directory', hasChildren: true },
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
        deepFocusPrimaryRepoId="repo-1"
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    expect(screen.queryByRole('region', { name: 'Selected row actions' })).not.toBeInTheDocument();

    // A primary must exist before global test/support targets are offered —
    // they're consumed by primaries as readonly context, so with zero
    // primaries the actions are no-ops and intentionally hidden.
    const srcRow = within(tree).getByText('src').closest('[role="button"]')!;
    fireEvent.click(srcRow);
    let actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    fireEvent.click(within(actionBar).getByRole('button', { name: 'Add Primary Target' }));

    // make-primary switches the cursor to the new primary; switch back to
    // 'All primaries' so subsequent row clicks emit set-global-test /
    // add-global-support rather than set-primary-test / add-primary-support.
    fireEvent.click(screen.getByRole('button', { name: 'All primaries' }));

    const testsRow = within(tree).getByText('tests').closest('[role="button"]')!;
    fireEvent.click(testsRow);
    actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    expect(testsRow).toHaveClass('deep-focus-row--command-selected');
    expect(within(actionBar).getByRole('button', { name: 'Use as Test for all primaries' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: /Actions for tests/ })).not.toBeInTheDocument();
    fireEvent.click(within(actionBar).getByRole('button', { name: 'Use as Test for all primaries' }));

    const libRow = within(tree).getByText('lib').closest('[role="button"]')!;
    fireEvent.click(libRow);
    actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    expect(libRow).toHaveClass('deep-focus-row--command-selected');
    expect(testsRow).not.toHaveClass('deep-focus-row--command-selected');
    fireEvent.click(within(actionBar).getByRole('button', { name: 'Add as Support · For all primaries' }));

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFocusPath: 'src',
        selectedTestTarget: expect.objectContaining({
          path: 'tests',
          kind: 'directory',
          repoLocalPath: '/tmp/repo-1',
          repoId: 'repo-1',
        }),
        selectedSupportTargets: [
          expect.objectContaining({
            path: 'lib',
            kind: 'directory',
            repoLocalPath: '/tmp/repo-1',
            repoId: 'repo-1',
          }),
        ],
      }),
    );
  });

  it('renders the parent support action first only for parent-of-primary rows', async () => {
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        { name: 'api', relativePath: 'src/api', kind: 'directory', hasChildren: true },
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
        deepFocusPrimaryRepoId="repo-1"
        selectedFocusPath="src/api/users.ts"
        selectedFocusTargetKind="file"
        selectedFocusTargets={[
          { path: 'src/api/users.ts', kind: 'file', role: 'anchor' },
          { path: 'tests/integration', kind: 'directory', role: 'primary' },
        ]}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    fireEvent.click(within(tree).getByText('src/api').closest('[role="button"]')!);
    let actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    // Visible text is the role-qualified pill ("Support · Just for users.ts");
    // the accessible name carries the full action phrase ("Add as Support · …")
    // for screen readers (spec §6.1).
    expect(within(actionBar).getAllByRole('button')[0]).toHaveAccessibleName(
      'Add as Support · Just for users.ts',
    );

    fireEvent.click(within(tree).getByText('tests').closest('[role="button"]')!);
    actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    expect(within(actionBar).getAllByRole('button')[0]).not.toHaveAccessibleName(
      /^Add as Support/,
    );
  });

  it('adds parent support and renders sibling ghost rows in-tree', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const onListRepoTree = vi.fn().mockImplementation((_repoLocalPath: string, relativePath?: string) => Promise.resolve({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: relativePath === 'src/api'
        ? [
          { name: 'users', relativePath: 'src/api/users', kind: 'directory', hasChildren: true },
          { name: 'auth', relativePath: 'src/api/auth', kind: 'directory', hasChildren: true },
        ]
        : [
          { name: 'api', relativePath: 'src/api', kind: 'directory', hasChildren: true },
          { name: 'tests', relativePath: 'tests', kind: 'directory', hasChildren: true },
        ],
      currentPath: relativePath ?? '',
      repoLocalPath: '/tmp/repo-1',
      truncated: false,
    }));

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled
        deepFocusPrimaryRepoId="repo-1"
        selectedFocusPath="src/api/users"
        selectedFocusTargetKind="directory"
        selectedFocusTargets={[
          { path: 'src/api/users', kind: 'directory', role: 'anchor' },
          { path: 'tests/integration', kind: 'directory', role: 'primary' },
        ]}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    fireEvent.click(within(tree).getByText('src/api').closest('[role="button"]')!);
    const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    fireEvent.click(within(actionBar).getByRole('button', {
      name: 'Add as Support · Just for users',
    }));

    expect(await within(tree).findByText('Support for users')).toBeInTheDocument();
    const authGhost = await within(tree).findByRole('button', {
      name: 'Include auth as support for users',
    });
    expect(within(tree).queryByRole('button', {
      name: 'Include users as support for users',
    })).not.toBeInTheDocument();
    expect(screen.queryByText('This is already writable as part of the primary.')).not.toBeInTheDocument();

    fireEvent.click(authGhost);
    await waitFor(() => {
      expect(within(tree).queryByRole('button', {
        name: 'Include auth as support for users',
      })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    // Ghost-flow semantic: clicking the sibling narrows the parent down to
    // just that sibling. The parent (`src/api`) is dropped because the new
    // target sits inside its writable area — keeping both would violate the
    // `scoped-support-redundant-under-support` rule.
    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFocusTargets: [
          expect.objectContaining({
            supportTargets: [
              expect.objectContaining({
                path: 'src/api/auth',
                kind: 'directory',
                repoLocalPath: '/tmp/repo-1',
                repoId: 'repo-1',
              }),
            ],
          }),
          expect.any(Object),
        ],
      }),
    );
  });

  it('clears parent support ghost rows when primary state changes or Escape is pressed on a ghost row', async () => {
    const onListRepoTree = vi.fn().mockImplementation((_repoLocalPath: string, relativePath?: string) => Promise.resolve({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: relativePath === 'src/api'
        ? [
          { name: 'users', relativePath: 'src/api/users', kind: 'directory', hasChildren: true },
          { name: 'auth', relativePath: 'src/api/auth', kind: 'directory', hasChildren: true },
        ]
        : [
          { name: 'api', relativePath: 'src/api', kind: 'directory', hasChildren: true },
          { name: 'tests', relativePath: 'tests', kind: 'directory', hasChildren: true },
        ],
      currentPath: relativePath ?? '',
      repoLocalPath: '/tmp/repo-1',
      truncated: false,
    }));

    const renderEditor = () => render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled
        deepFocusPrimaryRepoId="repo-1"
        selectedFocusPath="src/api/users"
        selectedFocusTargetKind="directory"
        selectedFocusTargets={[
          { path: 'src/api/users', kind: 'directory', role: 'anchor' },
          { path: 'tests/integration', kind: 'directory', role: 'primary' },
        ]}
        onListRepoTree={onListRepoTree}
      />,
    );

    const openGhostRows = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
      const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
      fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
      const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
      fireEvent.click(within(tree).getByText('src/api').closest('[role="button"]')!);
      const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
      fireEvent.click(within(actionBar).getByRole('button', {
        name: 'Add as Support · Just for users',
      }));
      const ghost = await within(tree).findByRole('button', {
        name: 'Include auth as support for users',
      });
      return { tree, actionBar, ghost };
    };

    const firstRender = renderEditor();
    const first = await openGhostRows();
    fireEvent.focus(first.ghost);
    fireEvent.keyDown(first.ghost, { key: 'Escape' });
    await waitFor(() => {
      expect(within(first.tree).queryByRole('button', {
        name: 'Include auth as support for users',
      })).not.toBeInTheDocument();
    });
    firstRender.unmount();

    renderEditor();
    const second = await openGhostRows();
    fireEvent.click(within(second.tree).getByText('tests').closest('[role="button"]')!);
    fireEvent.click(within(screen.getByRole('region', { name: 'Selected row actions' })).getByRole('button', { name: 'Add Primary Target' }));
    await waitFor(() => {
      expect(within(second.tree).queryByRole('button', {
        name: 'Include auth as support for users',
      })).not.toBeInTheDocument();
    });
  });

  it('does not ship row popover artifacts', () => {
    const forbiddenComponent = ['DeepFocus', 'RowPopover'].join('');
    const forbiddenCssClass = ['deep-focus', 'row-popover'].join('-');
    const componentDir = 'src/renderer/components';
    const componentNames = readdirSync(componentDir);
    expect(componentNames).not.toContain(`${forbiddenComponent}.tsx`);

    const deepFocusCssDir = 'src/renderer/styles/sidebar/deep-focus';
    const css = readdirSync(deepFocusCssDir)
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(join(deepFocusCssDir, name), 'utf-8'))
      .join('\n');
    expect(css).not.toContain(forbiddenCssClass);
  });

  it('selecting one distributed root primary does not select sibling root repositories', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const platformTarget = {
      ...makePack().focusTargets[0],
      focusId: 'platform',
      repoId: 'platform',
      displayName: 'Platform',
      repoLocalPath: '/tmp/platform',
      systemLayer: 'platform',
    };
    const toolsTarget = {
      ...makePack().focusTargets[0],
      focusId: 'tools',
      repoId: 'tools',
      displayName: 'Tools',
      repoLocalPath: '/tmp/tools',
      systemLayer: 'tooling',
    };

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({
          estateType: 'distributed-platform',
          repoCount: 2,
          focusTargets: [platformTarget, toolsTarget],
        })}
        selectedWorkingFocusIds={[]}
        deepFocusEnabled
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const platformRow = screen.getByText('Platform').closest('[role="button"]') as HTMLElement;
    const toolsRow = screen.getByText('Tools').closest('[role="button"]') as HTMLElement;

    fireEvent.click(platformRow);
    const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    fireEvent.click(within(actionBar).getByRole('button', { name: 'Add Primary Target' }));

    expect(within(platformRow).getByText('Primary Target')).toBeInTheDocument();
    expect(within(toolsRow).queryByText('Primary Target')).not.toBeInTheDocument();
    expect(within(actionBar).getByText('Platform')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Deep Focus scopes' })).getByRole('button', { name: 'Primary Target: Platform' })).toBeInTheDocument();
    expect(screen.queryByText('Viewing repo root')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        // Per spec §2.6: scalar holds the source primary manifest `repoId`,
        // not the resolved `repoLocalPath`.
        deepFocusPrimaryRepoId: 'platform',
        selectedFocusPath: null,
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [
          expect.objectContaining({ path: '', kind: 'directory', role: 'anchor' }),
        ],
      }),
    );
  });

  it('does not open a role menu from long press', async () => {
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
        deepFocusPrimaryRepoId="repo-1"
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    const srcRow = within(tree).getByText('src').closest('[role="button"]')!;

    vi.useFakeTimers();
    fireEvent.mouseDown(srcRow, { button: 0 });
    act(() => { vi.advanceTimersByTime(600); });

    expect(screen.queryByRole('menu', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selected row actions' })).not.toBeInTheDocument();

    fireEvent.mouseUp(srcRow);
    vi.useRealTimers();
  });

  it('commits a classified test file as a global test target', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        {
          name: 'externalMcpHandlers.ts',
          relativePath: 'src/frontend/desktop/electron/externalMcpHandlers.ts',
          kind: 'file',
          hasChildren: false,
          isTest: false,
        },
        {
          name: 'externalMcpHandlers.test.ts',
          relativePath: 'src/frontend/desktop/electron/externalMcpHandlers.test.ts',
          kind: 'file',
          hasChildren: false,
          isTest: true,
          artifactType: 'test-code',
          pathKind: 'tests',
        },
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
        deepFocusPrimaryRepoId="repo-1"
        selectedFocusPath="src/frontend/desktop/electron/externalMcpHandlers.ts"
        selectedFocusTargetKind="file"
        selectedFocusTargets={[
          {
            path: 'src/frontend/desktop/electron/externalMcpHandlers.ts',
            kind: 'file',
            role: 'anchor',
            repoId: 'repo-1',
            repoLocalPath: '/tmp/repo-1',
          },
        ]}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    const testRow = within(tree).getByText('externalMcpHandlers.test.ts').closest('[role="button"]')!;

    fireEvent.click(testRow);
    fireEvent.click(within(screen.getByRole('region', { name: 'Selected row actions' }))
      .getByRole('button', { name: 'Use as Test for all primaries' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.queryByText('Test target must be a folder, not a file.')).not.toBeInTheDocument();
    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(expect.objectContaining({
      selectedTestTarget: expect.objectContaining({
        path: 'src/frontend/desktop/electron/externalMcpHandlers.test.ts',
        kind: 'file',
        repoLocalPath: '/tmp/repo-1',
        repoId: 'repo-1',
      }),
    }));
  });

  it('keeps scoped details out of an edit footer while preserving tree context', async () => {
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        { name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true },
        { name: 'tests', relativePath: 'tests', kind: 'directory', hasChildren: true },
        { name: 'docs', relativePath: 'docs', kind: 'directory', hasChildren: true },
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
        selectedFocusPath="src"
        selectedFocusTargetKind="directory"
        selectedFocusTargets={[{
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests', kind: 'directory' },
          supportTargets: [{ path: 'docs', kind: 'directory' }],
        }]}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
    await screen.findByRole('list', { name: 'Deep Focus tree' });

    expect(screen.getAllByText('All primaries').length).toBeGreaterThan(0);
    expect(screen.queryByRole('status', { name: /primary targets selected/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('tests').length).toBeGreaterThan(0);
    expect(screen.getAllByText('docs').length).toBeGreaterThan(0);
    const chooseTestPattern = new RegExp(`${'Choose'} a test`, 'i');
    const addSupportPattern = new RegExp(`${'Add'} support`, 'i');
    expect(screen.queryByRole('button', { name: chooseTestPattern })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: addSupportPattern })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove primary/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set as Main/i })).not.toBeInTheDocument();
  });

  it('exposes remove primary-target actions for an existing primary row', async () => {
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        { name: 'UserRoute.ts', relativePath: 'src/UserRoute.ts', kind: 'file', hasChildren: false },
        { name: 'AdminRoute.ts', relativePath: 'src/AdminRoute.ts', kind: 'file', hasChildren: false },
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
        selectedFocusPath="src/UserRoute.ts"
        selectedFocusTargetKind="file"
        selectedFocusTargets={[
          { path: 'src/UserRoute.ts', kind: 'file', role: 'anchor' },
          { path: 'src/AdminRoute.ts', kind: 'file', role: 'primary' },
        ]}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = screen.getAllByText('Frontend')[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    fireEvent.click(repoRow!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });

    // The editor opens with the cursor on the anchor primary (UserRoute). The
    // command strip is strictly scoped to the active cursor, so to expose
    // remove actions for AdminRoute we first switch the cursor to that primary
    // via the scope rail.
    const rail = within(screen.getByRole('navigation', { name: 'Deep Focus scopes' }));
    expect(rail.getByRole('button', { name: 'Primary Target: AdminRoute.ts' })).toBeInTheDocument();
    fireEvent.click(rail.getByRole('button', { name: 'Primary Target: AdminRoute.ts' }));

    fireEvent.click(within(tree).getByText('AdminRoute.ts').closest('[role="button"]')!);
    const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    expect(within(actionBar).queryByRole('button', { name: 'Set as Main' })).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(within(actionBar).getByRole('button', { name: 'Remove AdminRoute.ts as Primary' }));
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByText('AdminRoute.ts removed')).toBeInTheDocument();
    act(() => { vi.runOnlyPendingTimers(); });
    vi.useRealTimers();
  });

  it('expands monolith focus areas with monolith-root-relative paths and focus-area breadcrumbs', async () => {
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
        deepFocusPrimaryFocusId="focus-1"
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const areaRow = screen.getAllByText('Core Module')[0]?.closest('[role="button"]');
    expect(areaRow).not.toBeNull();
    fireEvent.click(areaRow!.querySelector('.deep-focus-row__chevron') as Element);

    await waitFor(() => {
      expect(onListRepoTree).toHaveBeenCalledWith('/tmp/repo-1', 'services/core-module');
    });

    const breadcrumb = within(screen.getByLabelText('Deep Focus breadcrumb'));
    expect(breadcrumb.getByText('Focus Areas')).toBeInTheDocument();
    expect(breadcrumb.getByText('Core Module')).toBeInTheDocument();
    expect(breadcrumb.queryByText('services')).not.toBeInTheDocument();
  });

  it('expands and collapses directories in place with chevron, double-click, and Enter', async () => {
    const onListRepoTree = vi.fn().mockImplementation((_repoLocalPath: string, relativePath?: string) => Promise.resolve({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: relativePath === 'src'
        ? [
          { name: 'index.ts', relativePath: 'src/index.ts', kind: 'file', hasChildren: false },
        ]
        : [
          { name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true },
          { name: 'README.md', relativePath: 'README.md', kind: 'file', hasChildren: false },
        ],
      currentPath: relativePath ?? '',
      repoLocalPath: '/tmp/repo-1',
      truncated: false,
    }));

    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedPack={makePack({ estateType: 'distributed-platform' })}
        selectedWorkingFocusIds={['repo-1']}
        deepFocusEnabled
        deepFocusPrimaryRepoId="repo-1"
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const repoRow = (await screen.findAllByText('Frontend'))[0]?.closest('[role="button"]');
    expect(repoRow).not.toBeNull();
    const repoChevron = repoRow!.querySelector('.deep-focus-row__chevron');
    expect(repoChevron).not.toBeNull();

    fireEvent.click(repoChevron!);
    const srcRow = (await screen.findAllByText('src'))[0]?.closest('[role="button"]');
    expect(srcRow).not.toBeNull();
    expect(repoChevron).toHaveClass('deep-focus-row__chevron--expanded');
    expect(screen.getByText('README.md')).toBeInTheDocument();

    fireEvent.click(srcRow!.querySelector('.deep-focus-row__chevron') as Element);
    const indexRow = (await screen.findByText('index.ts')).closest('[role="button"]')!;
    fireEvent.click(indexRow);
    expect(indexRow).toHaveClass('deep-focus-row--command-selected');
    expect(srcRow!.querySelector('.deep-focus-row__chevron')).toHaveClass('deep-focus-row__chevron--expanded');

    fireEvent.keyDown(srcRow!, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
    });

    fireEvent.click(repoChevron!);
    await waitFor(() => {
      expect(screen.queryByText('src')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(onListRepoTree).toHaveBeenCalledWith('/tmp/repo-1', undefined);
    expect(onListRepoTree).toHaveBeenCalledWith('/tmp/repo-1', 'src');
  });

  it('moves keyboard focus through expanded rows in visible order and has no back navigation control', async () => {
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        { name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true },
        { name: 'README.md', relativePath: 'README.md', kind: 'file', hasChildren: false },
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
        deepFocusPrimaryRepoId="repo-1"
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    await screen.findByTestId('deep-focus-editor');
    const repoRow = (await screen.findAllByText('Frontend'))[0]?.closest('[role="button"]') as HTMLElement;
    fireEvent.keyDown(repoRow, { key: 'Enter' });
    const srcRow = (await screen.findAllByText('src'))[0]?.closest('[role="button"]') as HTMLElement;
    const readmeRow = screen.getByText('README.md').closest('[role="button"]') as HTMLElement;

    fireEvent.keyDown(repoRow, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(srcRow).toHaveAttribute('tabindex', '0');
    });
    fireEvent.keyDown(srcRow, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(readmeRow).toHaveAttribute('tabindex', '0');
    });
    expect(screen.queryByRole('button', { name: 'Back one level' })).not.toBeInTheDocument();
  });
});
