// @vitest-environment jsdom

import { readFileSync } from 'node:fs';

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry, ContextPackFocusFilterSelection } from '../../../shared/desktopContract';
import FocusFilterModal from './FocusFilterModal';

expect.extend(matchers);

afterEach(() => cleanup());

const pack: ContextPackCatalogEntry = {
  contextPackId: 'pack',
  displayName: 'Platform Pack',
  contextPackDir: '/packs/platform',
  manifestPath: null,
  bootstrapReady: true,
  source: 'configured-path',
  isActive: false,
  estateType: 'distributed-platform',
  defaultScopeMode: 'focused',
  repoCount: 1,
  primaryWorkingRepoIds: [],
  focusTargets: [],
};

function repositoryTarget(
  id: string,
  displayName: string,
  repoLocalPath: string,
): ContextPackCatalogEntry['focusTargets'][number] {
  return {
    focusId: id,
    displayName,
    kind: 'repository',
    repoId: id,
    repoLocalPath,
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
  };
}

const distributedDeepFocusPack: ContextPackCatalogEntry = {
  ...pack,
  repoCount: 2,
  focusTargets: [
    repositoryTarget('platform', 'Platform', '/workspace/platform'),
    repositoryTarget('tools', 'Tools', '/workspace/tools'),
  ],
};

const selection: ContextPackFocusFilterSelection = {
  selectedRepoIds: ['api'],
  selectedFocusIds: [],
  deepFocusEnabled: false,
  deepFocusPrimaryRepoId: null,
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: undefined,
  selectedSupportTargets: [],
};

const deepFocusSelection: ContextPackFocusFilterSelection = {
  ...selection,
  deepFocusEnabled: true,
  selectedRepoIds: [],
};

const sidebarScopeCss = readFileSync('src/renderer/styles/sidebar/sidebar-scope.css', 'utf8');

function renderFocusFilterModal(
  overrides: Partial<ComponentProps<typeof FocusFilterModal>> = {},
) {
  const props: ComponentProps<typeof FocusFilterModal> = {
    isOpen: true,
    selectedPack: pack,
    filters: [],
    currentSelection: selection,
    pending: false,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(true),
    onApply: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<FocusFilterModal {...props} />);
  return props;
}

describe('FocusFilterModal', () => {
  it('renders through ModalShell and clears the name after a successful filter creation', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderFocusFilterModal({ onSave });
    expect(screen.getByRole('dialog', { name: 'Focus Filters' })).toBeInTheDocument();
    expect(screen.getByText('Focus Filters')).toBeInTheDocument();
    const input = screen.getByLabelText('Filter name');
    fireEvent.change(input, { target: { value: 'Primary API' } });
    fireEvent.click(screen.getByText('Create filter'));
    expect(onSave).toHaveBeenCalledWith('Primary API');
    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  it('keeps the typed name when filter creation fails', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    renderFocusFilterModal({ onSave });

    const input = screen.getByLabelText('Filter name');
    fireEvent.change(input, { target: { value: 'Primary API' } });
    fireEvent.click(screen.getByText('Create filter'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('Primary API');
    });
    expect(input).toHaveValue('Primary API');
  });

  it('applies selected filters and closes after success', async () => {
    const onApply = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const onDelete = vi.fn();
    renderFocusFilterModal({
      filters: [{
        id: 'filter-1',
        name: 'API',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection,
      }],
      onClose,
      onApply,
      onDelete,
    });
    fireEvent.click(screen.getByText('API'));
    fireEvent.click(screen.getByText('Apply filter'));
    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith('filter-1');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByLabelText('Delete focus filter API'));
    expect(onDelete).toHaveBeenCalledWith('filter-1');
  });

  it('keeps the modal open when filter apply fails', async () => {
    const onApply = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    renderFocusFilterModal({
      filters: [{
        id: 'filter-1',
        name: 'API',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection,
      }],
      onClose,
      onApply,
    });

    fireEvent.click(screen.getByText('API'));
    fireEvent.click(screen.getByText('Apply filter'));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith('filter-1');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows standard filter primary and support targets in the saved row', () => {
    renderFocusFilterModal({
      selectedPack: {
        ...pack,
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
          {
            focusId: 'docs',
            displayName: 'Docs',
            kind: 'repository',
            repoId: 'docs',
            repoLocalPath: '/repos/docs',
            serviceName: null,
            systemLayer: null,
            repoRole: null,
            repositoryType: 'support',
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: false,
            activationPriority: 0,
            adjacentRepoIds: [],
            adjacentFocusIds: [],
          },
        ],
      },
      filters: [{
        id: 'filter-1',
        name: 'API plus docs',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection: {
          ...selection,
          selectedRepoIds: ['api', 'docs'],
          repositoryTypes: { api: 'primary', docs: 'support' },
        },
      }],
    });

    const row = screen.getByText('API plus docs').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('data-mode', 'standard');
    expect(within(row!).queryByText('Deep Focus')).toBeNull();
    expect(within(row!).getByText('Primary')).toBeInTheDocument();
    expect(within(row!).getByText('API')).toBeInTheDocument();
    expect(within(row!).getByText('Support')).toBeInTheDocument();
    expect(within(row!).getByText('Docs')).toBeInTheDocument();
  });

  it('shows Deep Focus primary, test, and support slots in the saved row', () => {
    renderFocusFilterModal({
      filters: [{
        id: 'filter-1',
        name: 'API deep focus',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection: {
          ...deepFocusSelection,
          selectedFocusTargets: [{
            path: '/repo/api/src',
            kind: 'directory',
            repoLocalPath: '/repo/api',
            repoId: 'api',
            testTarget: { path: '/repo/api/tests', kind: 'directory' },
            supportTargets: [{ path: '/repo/api/docs', kind: 'directory' }],
          }],
          selectedTestTarget: { path: '/repo/shared/tests', kind: 'directory' },
          selectedSupportTargets: [{ path: '/repo/shared/docs', kind: 'directory' }],
        },
      }],
    });

    const row = screen.getByText('API deep focus').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('data-mode', 'deep-focus');
    const modeFlag = within(row!).getByText('Deep Focus', { selector: '.focus-filter-modal__row-flag' });
    expect(modeFlag).toBeInTheDocument();
    expect(within(row!).getByText('Primary')).toBeInTheDocument();
    expect(within(row!).getByText('src')).toBeInTheDocument();
    expect(within(row!).getByText('Test')).toBeInTheDocument();
    expect(within(row!).getByText('Global: tests, src: tests')).toBeInTheDocument();
    expect(within(row!).getByText('Support')).toBeInTheDocument();
    expect(within(row!).getByText('Global: docs, src: docs')).toBeInTheDocument();
  });

  it('shows path-derived distributed Deep Focus primaries in the current workspace card', () => {
    renderFocusFilterModal({
      selectedPack: distributedDeepFocusPack,
      currentSelection: {
        ...deepFocusSelection,
        deepFocusPrimaryRepoId: 'platform',
        selectedFocusTargets: [
          {
            path: 'libs',
            kind: 'directory',
            repoLocalPath: '/workspace/platform',
            repoId: 'platform',
            role: 'anchor',
          },
          {
            path: 'Acme.Cli',
            kind: 'directory',
            repoLocalPath: '/workspace/tools',
            repoId: 'tools',
            role: 'primary',
          },
        ],
      },
    });

    const row = screen.getByText('Current workspace selection').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('platform/libs, tools/Acme.Cli')).toBeInTheDocument();
    expect(within(row!).queryByText('Platform, Tools')).toBeNull();
  });

  it('shows path-derived distributed Deep Focus primaries in saved filter rows', () => {
    renderFocusFilterModal({
      selectedPack: distributedDeepFocusPack,
      filters: [{
        id: 'filter-deep-focus',
        name: 'Distributed deep focus',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection: {
          ...deepFocusSelection,
          deepFocusPrimaryRepoId: 'platform',
          selectedFocusTargets: [
            {
              path: 'libs',
              kind: 'directory',
              repoLocalPath: '/workspace/platform',
              repoId: 'platform',
              role: 'anchor',
            },
            {
              path: 'Acme.Cli',
              kind: 'directory',
              repoLocalPath: '/workspace/tools',
              repoId: 'tools',
              role: 'primary',
            },
          ],
        },
      }],
    });

    const row = screen.getByText('Distributed deep focus').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('platform/libs, tools/Acme.Cli')).toBeInTheDocument();
    expect(within(row!).queryByText('Platform, Tools')).toBeNull();
  });

  it('shows path-derived Deep Focus test and support labels when identity metadata is present', () => {
    renderFocusFilterModal({
      selectedPack: distributedDeepFocusPack,
      currentSelection: {
        ...deepFocusSelection,
        deepFocusPrimaryRepoId: 'platform',
        selectedFocusTargets: [{
          path: 'libs',
          kind: 'directory',
          repoLocalPath: '/workspace/platform',
          repoId: 'platform',
          role: 'anchor',
        }],
        selectedTestTarget: {
          path: 'tests/platform',
          kind: 'directory',
          repoLocalPath: '/workspace/platform',
          repoId: 'platform',
        },
        selectedSupportTargets: [{
          path: 'docs/platform.md',
          kind: 'file',
          repoLocalPath: '/workspace/platform',
          repoId: 'platform',
        }],
      },
    });

    const row = screen.getByText('Current workspace selection').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Global: platform')).toBeInTheDocument();
    expect(within(row!).getByText('Global: platform.md')).toBeInTheDocument();
    expect(within(row!).queryByText('Global: Platform')).toBeNull();
  });

  it('shows the scalar selectedFocusPath instead of the parent anchor label', () => {
    renderFocusFilterModal({
      selectedPack: distributedDeepFocusPack,
      currentSelection: {
        ...deepFocusSelection,
        deepFocusPrimaryRepoId: 'platform',
        selectedFocusPath: 'src/orders',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [],
      },
    });

    const row = screen.getByText('Current workspace selection').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('orders')).toBeInTheDocument();
    expect(within(row!).queryByText('Platform')).toBeNull();
  });

  it('uses the default ModalShell surface instead of terminal mode', () => {
    renderFocusFilterModal();
    expect(screen.getByRole('dialog', { name: 'Focus Filters' })).not.toHaveClass('modal-shell--terminal');
  });

  it('renders the ESC hint and footer actions with Apply after Cancel', () => {
    renderFocusFilterModal();

    const escHint = screen.getByText('ESC to close');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const apply = screen.getByRole('button', { name: 'Apply filter' });
    expect(escHint).toHaveClass('modal-shell__footer-esc');
    expect(cancel).toHaveClass('action-button');
    expect(cancel).not.toHaveClass('action-button--primary');
    expect(apply).toHaveClass('action-button', 'action-button--primary');

    const footer = escHint.closest('.modal-shell__footer');
    expect(footer).not.toBeNull();
    expect(cancel.closest('.modal-shell__footer')).toBe(footer);
    expect(apply.closest('.modal-shell__footer')).toBe(footer);
    expect(Array.from(footer!.children)).toEqual([escHint, cancel, apply]);
  });

  it('renders Create filter as visually active when a unique name is entered', () => {
    renderFocusFilterModal();

    const save = screen.getByRole('button', { name: 'Create filter' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Filter name'), { target: { value: 'Primary API' } });
    expect(save).not.toBeDisabled();
    expect(save).toHaveClass('focus-filter-modal__save-button');
    expect(sidebarScopeCss).toContain('.focus-filter-modal__save-button:not(:disabled)');
    expect(sidebarScopeCss).toContain('background: var(--ts-accent-subtle);');
  });

  it('disables Create filter for duplicate filter names case-insensitively', () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderFocusFilterModal({
      filters: [{
        id: 'filter-1',
        name: 'Primary API',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection,
      }],
      onSave,
    });

    fireEvent.change(screen.getByLabelText('Filter name'), { target: { value: 'primary api' } });
    const save = screen.getByRole('button', { name: 'Create filter' });
    expect(save).toBeDisabled();
    expect(screen.getByText('A filter with that name already exists.')).toBeInTheDocument();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables Create filter for duplicate selections', () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderFocusFilterModal({
      filters: [{
        id: 'filter-1',
        name: 'Existing API',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection: {
          ...selection,
          selectedRepoIds: ['api'],
        },
      }],
      currentSelection: {
        ...selection,
        selectedRepoIds: ['api'],
      },
      onSave,
    });

    fireEvent.change(screen.getByLabelText('Filter name'), { target: { value: 'Different name' } });
    const save = screen.getByRole('button', { name: 'Create filter' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Already saved as “Existing API”.')).toBeInTheDocument();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables Create filter for an empty Deep Focus selection even when a name is entered', () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderFocusFilterModal({
      currentSelection: deepFocusSelection,
      onSave,
    });

    const row = screen.getByText('Current workspace selection').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(row).toHaveClass('focus-filter-modal__row--draft');
    expect(row).toHaveAttribute('data-mode', 'deep-focus');
    expect(within(row!).getByText('Not saved')).toBeInTheDocument();
    expect(within(row!).getByText('Primary')).toBeInTheDocument();
    expect(within(row!).getByText('Test')).toBeInTheDocument();
    expect(within(row!).getByText('Support')).toBeInTheDocument();
    expect(within(row!).getAllByText('—')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Filter name'), { target: { value: 'Empty focus' } });
    const save = screen.getByRole('button', { name: 'Create filter' });
    expect(save).toBeDisabled();
    expect(screen.getByText(
      'Select at least one repository, folder, or Deep Focus target before creating a filter.',
    )).toBeInTheDocument();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('enables Create filter for Deep Focus when any Deep Focus slot is selected', () => {
    renderFocusFilterModal({
      currentSelection: {
        ...deepFocusSelection,
        selectedSupportTargets: [{ path: '/repo/api/docs', kind: 'directory' }],
      },
    });

    fireEvent.change(screen.getByLabelText('Filter name'), { target: { value: 'Support docs' } });
    expect(screen.getByRole('button', { name: 'Create filter' })).not.toBeDisabled();
  });

  it('uses em-dash placeholders for empty Deep Focus primary and test slots', () => {
    renderFocusFilterModal({ currentSelection: deepFocusSelection });

    const row = screen.getByText('Current workspace selection').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(within(row!).getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText(/No Primary/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No Test/)).not.toBeInTheDocument();
  });

  it('summarizes filled Deep Focus slots and keeps support count numeric', () => {
    renderFocusFilterModal({
      currentSelection: {
        ...deepFocusSelection,
        selectedFocusTargets: [{
          path: '/repo/api',
          kind: 'directory',
          repoLocalPath: '/repo/api',
          repoId: 'api',
        }],
        selectedTestTarget: {
          path: '/repo/api/tests',
          kind: 'directory',
        },
        selectedSupportTargets: [{
          path: '/repo/api/docs',
          kind: 'directory',
        }, {
          path: '/repo/api/scripts',
          kind: 'directory',
        }],
      },
    });

    const row = screen.getByText('Current workspace selection').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Primary')).toBeInTheDocument();
    expect(within(row!).getByText('api')).toBeInTheDocument();
    expect(within(row!).getByText('Test')).toBeInTheDocument();
    expect(within(row!).getByText('Global: tests')).toBeInTheDocument();
    expect(within(row!).getByText('Support')).toBeInTheDocument();
    expect(within(row!).getByText('Global: docs, Global: scripts')).toBeInTheDocument();
  });

  it('keeps the filter-name input keyboard-focusable and backed by the focus-ring CSS contract', () => {
    renderFocusFilterModal();

    const input = screen.getByLabelText('Filter name');
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(input).not.toHaveAttribute('style');
    expect(sidebarScopeCss).toContain('.focus-filter-modal__save-row input:focus');
    expect(sidebarScopeCss).toContain('box-shadow: 0 0 0 2px var(--ts-accent-subtle);');
  });

  it('keeps per-row Delete muted at rest through class-only styling', () => {
    renderFocusFilterModal({
      filters: [{
        id: 'filter-1',
        name: 'API',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection,
      }],
    });

    const deleteButton = screen.getByLabelText('Delete focus filter API');
    expect(deleteButton).toHaveClass('focus-filter-modal__delete');
    expect(deleteButton).not.toHaveAttribute('style');
    expect(sidebarScopeCss).toContain('.focus-filter-modal__delete:hover');
    expect(sidebarScopeCss).toContain('.focus-filter-modal__delete:focus-visible');
  });

  it('renders empty Deep Focus slots with the empty modifier and an em-dash value', () => {
    renderFocusFilterModal({
      filters: [{
        id: 'filter-empty',
        name: 'Empty slots',
        contextPackDir: pack.contextPackDir,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
        selection: {
          ...deepFocusSelection,
          selectedFocusTargets: [{
            path: '/repo/api',
            kind: 'directory',
            repoLocalPath: '/repo/api',
            repoId: 'api',
          }],
        },
      }],
    });

    const row = screen.getByText('Empty slots').closest<HTMLElement>('.focus-filter-modal__row');
    expect(row).not.toBeNull();
    const testDetail = within(row!).getByText('Test').closest('.focus-filter-modal__row-detail');
    const supportDetail = within(row!).getByText('Support').closest('.focus-filter-modal__row-detail');
    expect(testDetail).toHaveClass('focus-filter-modal__row-detail--empty');
    expect(supportDetail).toHaveClass('focus-filter-modal__row-detail--empty');
    expect(within(testDetail as HTMLElement).getByText('—')).toBeInTheDocument();
    expect(within(supportDetail as HTMLElement).getByText('—')).toBeInTheDocument();
    expect(sidebarScopeCss).toContain('.focus-filter-modal__row-detail--empty');
    expect(sidebarScopeCss).toMatch(
      /\.focus-filter-modal__row-detail--empty\s+\.focus-filter-modal__row-detail-value\s*\{[^}]*color:\s*var\(--ts-text-soft\)/,
    );
  });
});
