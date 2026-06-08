// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../../shared/desktopContract';
import type { CompactSidebarModel } from '../../selectors/contextPackSidebarModel';
import StandardFocusSelector, { type StandardFocusSelectorProps } from './StandardFocusSelector';

expect.extend(matchers);

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function makeTarget(overrides: Partial<ContextPackCatalogEntry['focusTargets'][number]> = {}): ContextPackCatalogEntry['focusTargets'][number] {
  return {
    focusId: 'repo-1',
    displayName: 'Frontend',
    kind: 'repository',
    repoId: 'repo-1',
    repoLocalPath: '/tmp/repo-1',
    serviceName: null,
    systemLayer: 'presentation',
    repoRole: null,
    repositoryType: null,
    repoCategory: null,
    repoCategoryAuthored: false,
    relativePath: null,
    focusType: null,
    group: null,
    defaultFocusable: true,
    activationPriority: 0,
    adjacentRepoIds: [],
    adjacentFocusIds: [],
    ...overrides,
  };
}

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
    focusTargets: [makeTarget()],
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

function makeProps(overrides: Partial<StandardFocusSelectorProps> = {}): StandardFocusSelectorProps {
  return {
    selectedPack: makePack(),
    selectedWorkingFocusIds: [],
    deepFocusEnabled: false,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
    focusHint: null,
    sidebarModel: makeModel(),
    supportsDeepFocus: true,
    onSelectWorkingFocus: vi.fn(),
    onCommitDeepFocusSelection: vi.fn(),
    ...overrides,
  };
}

describe('StandardFocusSelector', () => {
  it('returns null when no selected pack is provided', () => {
    const { container } = render(<StandardFocusSelector {...makeProps({ selectedPack: undefined })} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders distributed repository rows from controlled selected repo ids', () => {
    const onSelectWorkingFocus = vi.fn();
    render(
      <StandardFocusSelector
        {...makeProps({
          selectedPack: makePack({
            focusTargets: [
              makeTarget({ focusId: 'repo-1', displayName: 'Frontend' }),
              makeTarget({ focusId: 'repo-2', displayName: 'Backend', repoId: 'repo-2' }),
            ],
          }),
          selectedWorkingFocusIds: ['repo-2'],
          onSelectWorkingFocus,
        })}
      />,
    );

    expect(screen.getByText('Repositories')).toBeInTheDocument();
    const backendRow = screen.getByText('Backend').closest('.scope-focus-row');
    expect(backendRow).toHaveClass('scope-focus-row--checked');
    expect(backendRow?.querySelector('input')).toBeChecked();

    fireEvent.click(screen.getByText('Frontend').closest('.scope-focus-row')!);

    expect(onSelectWorkingFocus).toHaveBeenCalledWith('repo-1');
  });

  it('renders monolith folder rows with relative paths from controlled selected focus ids', () => {
    render(
      <StandardFocusSelector
        {...makeProps({
          selectedPack: makePack({
            estateType: 'monolith',
            focusTargets: [
              makeTarget({
                focusId: 'focus-1',
                displayName: 'Core Module',
                kind: 'focus-area',
                repoId: null,
                systemLayer: null,
                focusType: 'service',
                relativePath: 'services/core-module',
              }),
            ],
          }),
          selectedWorkingFocusIds: ['focus-1'],
        })}
      />,
    );

    expect(screen.getByText('Folders')).toBeInTheDocument();
    const coreRow = screen.getByText('Core Module').closest('.scope-focus-row');
    expect(coreRow).toHaveClass('scope-focus-row--checked');
    expect(coreRow?.querySelector('input')).toBeChecked();
    expect(screen.getByText('services/core-module')).toBeInTheDocument();
    expect(screen.getByTitle('Core Module — services/core-module')).toBeInTheDocument();
  });

  it('filters rows locally and clears search without invoking callbacks', () => {
    const onSelectWorkingFocus = vi.fn();
    const onCommitDeepFocusSelection = vi.fn();
    const onManageFocusFilters = vi.fn();
    const onToggleRepositoryType = vi.fn();
    render(
      <StandardFocusSelector
        {...makeProps({
          selectedPack: makePack({
            focusTargets: [
              makeTarget({ focusId: 'repo-1', displayName: 'Frontend' }),
              makeTarget({ focusId: 'repo-2', displayName: 'Backend', repoId: 'repo-2' }),
            ],
          }),
          onSelectWorkingFocus,
          onCommitDeepFocusSelection,
          onManageFocusFilters,
          onToggleRepositoryType,
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search repositories'), { target: { value: 'back' } });

    expect(screen.queryByText('Frontend')).not.toBeInTheDocument();
    expect(screen.getByText('Backend')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search repositories'), { target: { value: 'missing' } });
    expect(screen.getByText('No repositories match.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Backend')).toBeInTheDocument();
    expect(onSelectWorkingFocus).not.toHaveBeenCalled();
    expect(onCommitDeepFocusSelection).not.toHaveBeenCalled();
    expect(onManageFocusFilters).not.toHaveBeenCalled();
    expect(onToggleRepositoryType).not.toHaveBeenCalled();
  });

  it('renders monolith search empty copy', () => {
    render(
      <StandardFocusSelector
        {...makeProps({
          selectedPack: makePack({
            estateType: 'monolith',
            focusTargets: [
              makeTarget({
                focusId: 'focus-1',
                displayName: 'Core Module',
                kind: 'focus-area',
                repoId: null,
                systemLayer: null,
              }),
            ],
          }),
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search folders'), { target: { value: 'missing' } });

    expect(screen.getByText('No folders match.')).toBeInTheDocument();
  });

  it('routes repository type badge clicks with target focus id and current type', () => {
    const onToggleRepositoryType = vi.fn();
    render(
      <StandardFocusSelector
        {...makeProps({
          selectedPack: makePack({
            focusTargets: [
              makeTarget({ focusId: 'repo-1', repositoryType: 'primary' }),
              makeTarget({ focusId: 'repo-2', repoId: 'repo-2', displayName: 'API', repositoryType: 'support' }),
            ],
          }),
          onToggleRepositoryType,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Primary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Support' }));

    expect(onToggleRepositoryType).toHaveBeenNthCalledWith(1, 'repo-1', 'primary');
    expect(onToggleRepositoryType).toHaveBeenNthCalledWith(2, 'repo-2', 'support');
  });

  it('keeps category metadata separate from focus selection and repository type toggles', () => {
    const onSelectWorkingFocus = vi.fn();
    const onToggleRepositoryType = vi.fn();
    render(
      <StandardFocusSelector
        {...makeProps({
          selectedPack: makePack({
            focusTargets: [
              makeTarget({
                focusId: 'orders-api',
                repoId: 'orders-api',
                displayName: 'Orders API',
                repositoryType: 'support',
                repoCategory: 'service',
                repoCategoryAuthored: true,
              }),
            ],
          }),
          onSelectWorkingFocus,
          onToggleRepositoryType,
        })}
      />,
    );

    const row = screen.getByText('Orders API').closest('.scope-focus-row')!;
    expect(row).not.toHaveTextContent('Service');

    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'Support' }));

    expect(onSelectWorkingFocus).toHaveBeenCalledWith('orders-api');
    expect(onToggleRepositoryType).toHaveBeenCalledWith('orders-api', 'support');
  });

  it('preserves saved Deep Focus fields when toggling Deep Focus mode', () => {
    const selectedFocusTargets = [{ path: 'src', kind: 'directory' as const, role: 'anchor' as const }];
    const selectedTestTarget = { path: 'src/app.test.ts', kind: 'file' as const };
    const selectedSupportTargets = [{ path: 'docs', kind: 'directory' as const }];
    const onCommitDeepFocusSelection = vi.fn();
    render(
      <StandardFocusSelector
        {...makeProps({
          deepFocusEnabled: false,
          deepFocusPrimaryRepoId: 'repo-primary',
          deepFocusPrimaryFocusId: 'focus-primary',
          selectedFocusPath: 'src',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets,
          selectedTestTarget,
          selectedSupportTargets,
          onCommitDeepFocusSelection,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Deep Focus' }));

    expect(onCommitDeepFocusSelection).toHaveBeenCalledWith({
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'repo-primary',
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'src',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets,
      selectedTestTarget,
      selectedSupportTargets,
    });
  });

  it('wires the focus-filter button only through the provided callback', () => {
    const onManageFocusFilters = vi.fn();
    const { rerender } = render(
      <StandardFocusSelector {...makeProps({ onManageFocusFilters })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage focus filters' }));
    expect(onManageFocusFilters).toHaveBeenCalledTimes(1);

    rerender(<StandardFocusSelector {...makeProps({ onManageFocusFilters: undefined })} />);

    expect(screen.getByRole('button', { name: 'Manage focus filters' })).toBeEnabled();
  });

  it('renders summary details and synced timestamp with existing classes', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'));
    render(
      <StandardFocusSelector
        {...makeProps({
          selectedPack: makePack({ lastSyncedAt: '2026-05-19T11:50:00.000Z' }),
          focusHint: 'Select at least one repository.',
          sidebarModel: makeModel({
            selectedPackSummary: [{ label: '2 repos', tone: 'active' }],
            selectedWorkingFocusSummary: 'Frontend selected',
          }),
        })}
      />,
    );

    const summary = screen.getByTestId('context-pack-selection-summary');
    expect(screen.getByText('Select at least one repository.')).toHaveClass('sidebar-meta', 'scope-card__hint');
    expect(within(summary).getByText('2 repos')).toHaveClass('sidebar-detail-tag');
    expect(within(summary).getByText('Focus: Frontend selected')).toHaveClass('sidebar-meta');
    expect(within(summary).getByText('Synced 10m ago')).toHaveAttribute('title', '2026-05-19T11:50:00.000Z');
  });

  it('keeps StandardFocusSelector free of Deep Focus editor and persistence boundaries', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/components/deep-focus/StandardFocusSelector.tsx'),
      'utf8',
    );

    const forbiddenNames = [
      ['on', 'List', 'Repo', 'Tree'].join(''),
      ['on', 'Deep', 'Focus', 'Editor', 'Toggle'].join(''),
      ['editor', 'Open'].join(''),
      ['Focus', 'Filter', 'Modal'].join(''),
      ['Modal', 'Shell'].join(''),
      ['desktop', 'Shell', 'Client'].join(''),
      ['use', 'Ipc', 'Call'].join(''),
      ['save', 'Deep', 'Focus', 'Selections'].join(''),
      ['save', 'Context', 'Pack', 'Sidebar', 'State'].join(''),
      ['client', '.'].join(''),
    ];

    for (const forbiddenName of forbiddenNames) {
      expect(source).not.toContain(forbiddenName);
    }
  });
});
