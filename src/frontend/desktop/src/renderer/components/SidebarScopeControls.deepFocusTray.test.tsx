// @vitest-environment jsdom

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, type ComponentProps } from 'react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import type { CompactSidebarModel } from '../selectors/contextPackSidebarModel';
import { DeepFocusScopeRail } from './DeepFocusScopeRail';
import { primaryIdentityKey } from './SidebarDeepFocusUtils';
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
    estateType: 'distributed-platform',
    defaultScopeMode: null,
    repoCount: 1,
    primaryWorkingRepoIds: [],
    focusTargets: [{
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
    }],
    ...overrides,
  };
}

function makeModel(): CompactSidebarModel {
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
  };
}

const defaultProps = {
  selectedPack: makePack(),
  // Per spec §2.3: working focus ids are manifest IDs (repoId in distributed
  // mode, focusId in monolith mode). For the default distributed pack with
  // focusTargets[0].repoId='repo-1', the working focus id is 'repo-1'.
  selectedWorkingFocusIds: ['repo-1'],
  deepFocusEnabled: true,
  deepFocusPrimaryRepoId: 'repo-1',
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: undefined,
  selectedSupportTargets: [],
  focusHint: null,
  onSelectWorkingFocus: vi.fn(),
  onCommitDeepFocusSelection: vi.fn(),
  onListRepoTree: vi.fn().mockResolvedValue(null),
  sidebarModel: makeModel(),
} satisfies ComponentProps<typeof SidebarScopeControls>;

const userAdminEntries = [
  { name: 'UserRoute.ts', relativePath: 'src/UserRoute.ts', kind: 'file' as const, hasChildren: false },
  { name: 'AdminRoute.ts', relativePath: 'src/AdminRoute.ts', kind: 'file' as const, hasChildren: false },
];

describe('SidebarScopeControls Deep Focus scope rail', () => {
  it('commits monolith Deep Focus selections with full monolith-root-relative paths', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [
        { name: 'src', relativePath: 'services/core-module/src', kind: 'directory', hasChildren: true },
        { name: 'README.md', relativePath: 'services/core-module/README.md', kind: 'file', hasChildren: false },
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
          focusTargets: [{
            ...makePack().focusTargets[0],
            focusId: 'focus-1',
            displayName: 'Core Module',
            kind: 'focus-area',
            repoId: null,
            systemLayer: null,
            focusType: 'service',
            repositoryType: 'primary',
            relativePath: 'services/core-module',
          }],
        })}
        selectedWorkingFocusIds={['focus-1']}
        deepFocusPrimaryRepoId={null}
        deepFocusPrimaryFocusId="focus-1"
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(screen.getAllByText('Core Module')[0]!.closest('[role="button"]')!.querySelector('.deep-focus-row__chevron') as Element);
    fireEvent.click((await screen.findAllByText('src'))[0]!.closest('[role="button"]')!);
    fireEvent.click(within(screen.getByRole('region', { name: 'Selected row actions' })).getByRole('button', { name: 'Add Primary Target' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith(expect.objectContaining({
      deepFocusPrimaryRepoId: null,
      // Per spec §2.6: in monolith mode `deepFocusPrimaryFocusId` holds the
      // source focus manifest identifier, not the resolved repo path.
      deepFocusPrimaryFocusId: 'focus-1',
      selectedFocusPath: 'services/core-module/src',
      selectedFocusTargetKind: 'directory',
    }));
  });

  it('renders edit-mode scope controls without the legacy selection controls footer', async () => {
    const onCommitDeepFocusSelection = vi.fn();
    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={vi.fn().mockResolvedValue({
          action: 'contextPack.listRepoTree',
          mode: 'read-only',
          message: 'Listed repo tree entries.',
          entries: [{ name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true }],
          currentPath: '',
          repoLocalPath: '/tmp/repo-1',
          truncated: false,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const rail = await screen.findByRole('navigation', { name: 'Deep Focus scopes' });
    expect(screen.queryByRole('heading', { name: 'Deep Focus' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search files and folders')).toBeInTheDocument();
    expect(document.querySelector('.deep-focus-editor-header__summary-chip')).toBeNull();
    expect(screen.queryByText('0 Primary Targets')).not.toBeInTheDocument();
    expect(screen.queryByText('0 Support Files')).not.toBeInTheDocument();
    expect(screen.queryByText('Test Folder: none')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close editor' })).toBeInTheDocument();
    expect(within(document.querySelector('.deep-focus-footer__actions') as HTMLElement)
      .getByText('Done')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /All primaries/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selected row actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /primary targets selected/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Dismiss — no tests')).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Dismiss — no tests' })).not.toBeInTheDocument();
    expect(within(document.querySelector('.deep-focus-footer__actions') as HTMLElement)
      .queryByText('Apply')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(onCommitDeepFocusSelection).not.toHaveBeenCalled();
  });

  it('supports scope rail copy, removal undo, and keyboard removal', async () => {
    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedFocusPath="src/UserRoute.ts"
        selectedFocusTargetKind="file"
        selectedFocusTargets={[
          { path: 'src/UserRoute.ts', kind: 'file', role: 'anchor' },
          { path: 'src/AdminRoute.ts', kind: 'file', role: 'primary' },
        ]}
        onListRepoTree={vi.fn().mockResolvedValue({
          action: 'contextPack.listRepoTree',
          mode: 'read-only',
          message: 'Listed repo tree entries.',
          entries: userAdminEntries,
          currentPath: '',
          repoLocalPath: '/tmp/repo-1',
          truncated: false,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(screen.getAllByText('Frontend')[0]!.closest('[role="button"]')!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    const rail = screen.getByRole('navigation', { name: 'Deep Focus scopes' });
    expect(within(rail).getByRole('button', { name: 'Primary Target: UserRoute.ts' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Primary Target: AdminRoute.ts' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /primary targets selected/i })).not.toBeInTheDocument();

    expect(within(rail).getByRole('button', { name: 'Primary Target: UserRoute.ts' })).toBeInTheDocument();

    fireEvent.click(within(tree).getByText('AdminRoute.ts').closest('[role="button"]')!);
    const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    expect(within(actionBar).queryByRole('button', { name: 'Set as Main' })).not.toBeInTheDocument();

    const userRow = within(tree).getByText('UserRoute.ts').closest('[role="button"]')!;
    fireEvent.focus(userRow);
    fireEvent.keyDown(userRow, { key: 'Delete' });
    expect(screen.getByText('UserRoute.ts removed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('UserRoute.ts removed')).not.toBeInTheDocument();
    fireEvent.focus(within(tree).getByText('UserRoute.ts').closest('[role="button"]')!);
    fireEvent.keyDown(within(tree).getByText('UserRoute.ts').closest('[role="button"]')!, { key: 'ArrowUp', ctrlKey: true });
    expect(within(rail).getByRole('button', { name: 'Primary Target: UserRoute.ts' })).toBeInTheDocument();
  });

  it('animates primary removal and holds layout before committing the row removal', async () => {
    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedFocusPath="src/UserRoute.ts"
        selectedFocusTargetKind="file"
        selectedFocusTargets={[
          { path: 'src/UserRoute.ts', kind: 'file', role: 'anchor' },
          { path: 'src/AdminRoute.ts', kind: 'file', role: 'primary' },
        ]}
        onListRepoTree={vi.fn().mockResolvedValue({
          action: 'contextPack.listRepoTree',
          mode: 'read-only',
          message: 'Listed repo tree entries.',
          entries: userAdminEntries,
          currentPath: '',
          repoLocalPath: '/tmp/repo-1',
          truncated: false,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(screen.getAllByText('Frontend')[0]!.closest('[role="button"]')!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    fireEvent.click(within(tree).getByText('UserRoute.ts').closest('[role="button"]')!);

    vi.useFakeTimers();
    fireEvent.click(within(screen.getByRole('region', { name: 'Selected row actions' })).getByRole('button', { name: 'Remove UserRoute.ts as Primary' }));
    act(() => { vi.advanceTimersByTime(0); });
    const rail = screen.getByRole('navigation', { name: 'Deep Focus scopes' });
    const userPill = within(rail).getByRole('button', { name: 'Primary Target: UserRoute.ts' });
    expect(userPill).toHaveClass('deep-focus-scope-rail__capsule--removing');
    expect(within(rail).getAllByRole('button')).toHaveLength(3);

    act(() => { vi.advanceTimersByTime(239); });
    expect(within(rail).getAllByRole('button')).toHaveLength(3);
    act(() => { vi.advanceTimersByTime(1); });
    expect(within(rail).getAllByRole('button')).toHaveLength(2);
  });

  it('renders same-path Primary Targets from different repos as distinct scope capsules', () => {
    const primaries = [
      {
        path: 'src',
        kind: 'directory' as const,
        role: 'anchor' as const,
        repoLocalPath: '/repos/tools',
        repoId: 'tools',
      },
      {
        path: 'src',
        kind: 'directory' as const,
        role: 'primary' as const,
        repoLocalPath: '/repos/platform',
        repoId: 'platform',
      },
    ];
    const platformKey = primaryIdentityKey(primaries[1]);

    render(
      <>
        <DeepFocusScopeRail
          primaries={primaries}
          cursor={{ kind: 'global' }}
          draftTopLevel={null}
          exitingPrimaryKey={platformKey}
          focusRequest={null}
          onSelectCursor={vi.fn()}
          onFocusRequestHandled={vi.fn()}
        />
      </>,
    );

    const rail = screen.getByRole('navigation', { name: 'Deep Focus scopes' });
    expect(within(rail).getByRole('button', { name: 'Primary Target: tools/src' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Primary Target: platform/src' })).toHaveClass('deep-focus-scope-rail__capsule--removing');

  });

  it('keeps single-repo scope capsules unprefixed', () => {
    const primaries = [
      {
        path: 'src/UserRoute.ts',
        kind: 'file' as const,
        role: 'anchor' as const,
        repoLocalPath: '/repos/frontend',
        repoId: 'frontend',
      },
      {
        path: 'src/AdminRoute.ts',
        kind: 'file' as const,
        role: 'primary' as const,
        repoLocalPath: '/repos/frontend',
        repoId: 'frontend',
      },
    ];

    render(
      <>
        <DeepFocusScopeRail
          primaries={primaries}
          cursor={{ kind: 'global' }}
          draftTopLevel={null}
          exitingPrimaryKey={null}
          focusRequest={null}
          onSelectCursor={vi.fn()}
          onFocusRequestHandled={vi.fn()}
        />
      </>,
    );

    const rail = screen.getByRole('navigation', { name: 'Deep Focus scopes' });
    expect(within(rail).getByRole('button', { name: 'Primary Target: UserRoute.ts' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Primary Target: AdminRoute.ts' })).toBeInTheDocument();
    expect(screen.queryByText('frontend/UserRoute.ts')).not.toBeInTheDocument();
    expect(screen.queryByText('frontend/AdminRoute.ts')).not.toBeInTheDocument();
  });

  it('renders the scope rail empty state without legacy footer controls', async () => {
    render(<ScopeControlsWithEditor {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));

    const rail = screen.getByRole('navigation', { name: 'Deep Focus scopes' });
    expect(within(rail).getByRole('button', { name: /All primaries/ })).toBeInTheDocument();
    expect(within(rail).getByText('No primary targets yet')).toBeInTheDocument();

    expect(screen.queryByRole('status', { name: /0 primary targets selected/i })).not.toBeInTheDocument();
    expect(screen.queryByText('No primary targets yet')).toBeInTheDocument();
  });

  it('adds a primary pill with entry state without rendering legacy footer controls', async () => {
    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        onListRepoTree={vi.fn().mockResolvedValue({
          action: 'contextPack.listRepoTree',
          mode: 'read-only',
          message: 'Listed repo tree entries.',
          entries: [{ name: 'UserRoute.ts', relativePath: 'src/UserRoute.ts', kind: 'file', hasChildren: false }],
          currentPath: '',
          repoLocalPath: '/tmp/repo-1',
          truncated: false,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(screen.getAllByText('Frontend')[0]!.closest('[role="button"]')!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    fireEvent.click(within(tree).getByText('UserRoute.ts').closest('[role="button"]')!);
    fireEvent.click(within(screen.getByRole('region', { name: 'Selected row actions' })).getByRole('button', { name: 'Add Primary Target' }));

    const userPill = await within(screen.getByRole('navigation', { name: 'Deep Focus scopes' })).findByRole('button', { name: /UserRoute\.ts/ });
    await waitFor(() => expect(userPill).toHaveClass('deep-focus-scope-rail__capsule--entering'));
    expect(screen.queryByRole('status', { name: /primary targets selected/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel unapplied changes' })).toBeInTheDocument();
    expect(within(document.querySelector('.deep-focus-footer__actions') as HTMLElement)
      .getByText('Cancel')).toBeInTheDocument();
  });

  it('couples primary capsule activation to row command scope', async () => {
    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedFocusPath="src/UserRoute.ts"
        selectedFocusTargetKind="file"
        selectedFocusTargets={[
          { path: 'src/UserRoute.ts', kind: 'file', role: 'anchor' },
          { path: 'src/AdminRoute.ts', kind: 'file', role: 'primary' },
        ]}
        onListRepoTree={vi.fn().mockResolvedValue({
          action: 'contextPack.listRepoTree',
          mode: 'read-only',
          message: 'Listed repo tree entries.',
          entries: [...userAdminEntries, { name: 'tests', relativePath: 'tests', kind: 'directory', hasChildren: true }],
          currentPath: '',
          repoLocalPath: '/tmp/repo-1',
          truncated: false,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(screen.getAllByText('Frontend')[0]!.closest('[role="button"]')!.querySelector('.deep-focus-row__chevron') as Element);
    const tree = await screen.findByRole('list', { name: 'Deep Focus tree' });
    const adminPill = within(screen.getByRole('navigation', { name: 'Deep Focus scopes' })).getByRole('button', { name: /AdminRoute\.ts/ });
    fireEvent.click(adminPill);
    expect(adminPill).toHaveClass('deep-focus-scope-rail__capsule--active');
    expect(within(screen.getByRole('navigation', { name: 'Deep Focus scopes' })).getAllByRole('button', { pressed: true })).toHaveLength(1);

    fireEvent.click(within(tree).getByText('tests').closest('[role="button"]')!);
    const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    expect(within(actionBar).getByRole('button', { name: 'Use as Test for AdminRoute.ts' })).toBeInTheDocument();
  });

  it('keeps legacy selection controls unmounted after closing and reopening the editor', async () => {
    render(<ScopeControlsWithEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    expect(screen.queryByRole('status', { name: /primary targets selected/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    expect(screen.queryByRole('status', { name: /primary targets selected/i })).not.toBeInTheDocument();
  });

  it('keeps hover, click, Escape, and command focus behavior distinct', async () => {
    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        onListRepoTree={vi.fn().mockResolvedValue({
          action: 'contextPack.listRepoTree',
          mode: 'read-only',
          message: 'Listed repo tree entries.',
          entries: [{ name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true }],
          currentPath: '',
          repoLocalPath: '/tmp/repo-1',
          truncated: false,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const frontendRow = screen.getAllByText('Frontend')[0]!.closest('[role="button"]')!;

    fireEvent.mouseEnter(frontendRow);
    expect(frontendRow).not.toHaveClass('deep-focus-row--command-selected');
    expect(screen.queryByRole('region', { name: 'Selected row actions' })).not.toBeInTheDocument();

    fireEvent.click(frontendRow);
    expect(frontendRow).toHaveClass('deep-focus-row--command-selected');
    const actionBar = screen.getByRole('region', { name: 'Selected row actions' });
    fireEvent.click(within(actionBar).getByRole('button', { name: 'Add Primary Target' }));
    await waitFor(() => expect(frontendRow).toHaveFocus());

    fireEvent.keyDown(frontendRow, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Selected row actions' })).not.toBeInTheDocument();
    await waitFor(() => expect(frontendRow).toHaveFocus());
  });

  it('keeps search focus when filtering changes the visible rows', async () => {
    render(
      <ScopeControlsWithEditor
        {...defaultProps}
        onListRepoTree={vi.fn().mockResolvedValue({
          action: 'contextPack.listRepoTree',
          mode: 'read-only',
          message: 'Listed repo tree entries.',
          entries: userAdminEntries,
          currentPath: '',
          repoLocalPath: '/tmp/repo-1',
          truncated: false,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(screen.getAllByText('Frontend')[0]!.closest('[role="button"]')!.querySelector('.deep-focus-row__chevron') as Element);
    await screen.findByText('AdminRoute.ts');

    const searchInput = screen.getByPlaceholderText('Search files and folders');
    searchInput.focus();
    fireEvent.change(searchInput, { target: { value: 'Admin' } });

    expect(screen.queryByText('UserRoute.ts')).not.toBeInTheDocument();
    await waitFor(() => expect(searchInput).toHaveFocus());
  });

  it('expands folders with Enter and restores focus after Apply or Cancel', async () => {
    const onListRepoTree = vi.fn().mockResolvedValue({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      entries: [{ name: 'src', relativePath: 'src', kind: 'directory', hasChildren: true }],
      currentPath: '',
      repoLocalPath: '/tmp/repo-1',
      truncated: false,
    });
    const { rerender } = render(
      <ScopeControlsWithEditor
        {...defaultProps}
        onListRepoTree={onListRepoTree}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const frontendRow = screen.getAllByText('Frontend')[0]!.closest('[role="button"]')!;
    fireEvent.focus(frontendRow);
    fireEvent.keyDown(frontendRow, { key: 'Enter' });
    expect(await screen.findByText('src')).toBeInTheDocument();

    fireEvent.click((await screen.findAllByText('src'))[0]!.closest('[role="button"]')!);
    fireEvent.click(within(screen.getByRole('region', { name: 'Selected row actions' })).getByRole('button', { name: 'Add Primary Target' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Scope' })).toHaveFocus());

    rerender(
      <ScopeControlsWithEditor
        {...defaultProps}
        selectedFocusPath="src"
        selectedFocusTargetKind="directory"
        selectedFocusTargets={[{ path: 'src', kind: 'directory', role: 'anchor' }]}
        onListRepoTree={onListRepoTree}
      />,
    );
    const editButton = screen.getByRole('button', { name: 'Edit Scope' });
    editButton.focus();
    fireEvent.click(editButton);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all selections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel unapplied changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle Deep Focus' })).toHaveFocus());
  });

  it('clears the editor search query when closeEditor runs (Cancel path)', async () => {
    render(<ScopeControlsWithEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const searchInput = screen.getByPlaceholderText('Search files and folders') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'frontend' } });
    expect(searchInput.value).toBe('frontend');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));

    expect(screen.getByPlaceholderText('Search files and folders')).toHaveValue('');
  });

  it('keeps Deep Focus primary polish CSS bound to motion and token contracts', () => {
    const deepFocusDir = 'src/renderer/styles/sidebar/deep-focus';
    const cascadeOrder = [
      'deep-focus-shell.css',
      'deep-focus-summary.css',
      'deep-focus-tree-row.css',
      'deep-focus-scope-rail.css',
      'deep-focus-toolbar.css',
      'deep-focus-animations.css',
    ];
    expect(new Set(cascadeOrder)).toEqual(new Set(readdirSync(deepFocusDir).filter((n) => n.endsWith('.css'))));
    const css = cascadeOrder.map((name) => readFileSync(join(deepFocusDir, name), 'utf-8')).join('\n');
    const keyboardHook = readFileSync('src/renderer/components/useDeepFocusKeyboard.ts', 'utf-8');
    const primaryPolishCss = [
      '.deep-focus-scope-rail__capsule--entering',
      '.deep-focus-scope-rail__capsule--removing',
      '.deep-focus-primary-removal-toast',
      '.deep-focus-row--selected',
      '.deep-focus-row--test-selected',
      '.deep-focus-row--support-selected',
      '.deep-focus-row--command-selected',
    ].map((selector) => {
      const start = css.indexOf(selector);
      const end = css.indexOf('\n}', start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return css.slice(start, end + 2);
    }).join('\n');

    // Animations bind through platform motion tokens (`--df-motion-*`,
    // `--ts-ease`) instead of hardcoded durations and easing curves so the
    // Deep Focus surface inherits any platform-level retuning of motion.
    expect(primaryPolishCss).toContain('animation: deepFocusPrimaryAppend var(--df-motion-expand) var(--ts-ease) 24ms both;');
    expect(primaryPolishCss).toContain('animation: deepFocusPrimaryRemove var(--df-motion-standard) var(--ts-ease) both;');
    expect(css).toContain('transform: translateY(-2px);');
    expect(css).not.toContain('transform: translateY(-3px);');
    expect(css).toContain('animation: none;');
    expect(keyboardHook).toContain('summaryActionRef');
    expect(keyboardHook).toContain('toggleButtonRef');
    expect(css).not.toContain('deepFocusAnchorSwap');
    expect(primaryPolishCss).toContain('var(--ts-info)');
    expect(primaryPolishCss).toContain('var(--df-success, var(--ts-success))');
    expect(primaryPolishCss).toContain('var(--df-accent2, var(--ts-accent2))');
    expect(primaryPolishCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect([...primaryPolishCss.matchAll(/padding:\s*([^;\n]+);/g)]
      .map((match) => match[0])
      .filter((declaration) => !/^padding:\s*(?:0|var\()/.test(declaration))).toEqual([]);
  });
});
