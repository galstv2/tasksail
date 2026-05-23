// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../../shared/desktopContract';
import type { DeepFocusSelectorProps } from './DeepFocusSelector';
import DeepFocusSelector from './DeepFocusSelector';

const deepFocusMock = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
}));

vi.mock('../SidebarDeepFocusControls', () => ({
  default: (props: Record<string, unknown>) => {
    deepFocusMock.lastProps = props;
    return <div data-testid="deep-focus-controls" />;
  },
}));

expect.extend(matchers);

afterEach(() => {
  deepFocusMock.lastProps = null;
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

function makeProps(overrides: Partial<DeepFocusSelectorProps> = {}): DeepFocusSelectorProps {
  return {
    selectedPack: makePack(),
    selectedWorkingFocusIds: [],
    deepFocusEnabled: true,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: undefined,
    selectedSupportTargets: [],
    onCommitDeepFocusSelection: vi.fn(),
    onListRepoTree: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('DeepFocusSelector', () => {
  it('returns null when no selected pack is provided', () => {
    const { container } = render(<DeepFocusSelector {...makeProps({ selectedPack: undefined })} />);

    expect(container.innerHTML).toBe('');
    expect(deepFocusMock.lastProps).toBeNull();
  });

  it('collapses distributed scalar IDs to the repo scalar before delegation', () => {
    render(
      <DeepFocusSelector
        {...makeProps({
          selectedPack: makePack({ estateType: 'distributed-platform' }),
          selectedWorkingFocusIds: ['regular-repo'],
          deepFocusPrimaryRepoId: 'repo-primary',
          deepFocusPrimaryFocusId: 'focus-primary',
        })}
      />,
    );

    expect(screen.getByTestId('deep-focus-controls')).toBeInTheDocument();
    expect(deepFocusMock.lastProps).toMatchObject({
      deepFocusPrimaryId: 'repo-primary',
      selectedWorkingFocusIds: ['repo-primary'],
    });
  });

  it('collapses monolith scalar IDs to the focus scalar before delegation', () => {
    render(
      <DeepFocusSelector
        {...makeProps({
          selectedPack: makePack({ estateType: 'monolith' }),
          selectedWorkingFocusIds: ['regular-focus'],
          deepFocusPrimaryRepoId: 'repo-primary',
          deepFocusPrimaryFocusId: 'focus-primary',
        })}
      />,
    );

    expect(deepFocusMock.lastProps).toMatchObject({
      deepFocusPrimaryId: 'focus-primary',
      selectedWorkingFocusIds: ['focus-primary'],
    });
  });

  it('forwards callbacks and Deep Focus state without reshaping', () => {
    const onCommitDeepFocusSelection = vi.fn();
    const onListRepoTree = vi.fn().mockResolvedValue(null);
    const onManageFocusFilters = vi.fn();
    const onDeepFocusEditorToggle = vi.fn();
    const selectedFocusTargets = [{ path: 'src', kind: 'directory' as const, role: 'anchor' as const }];
    const selectedTestTarget = { path: 'src/app.test.ts', kind: 'file' as const };
    const selectedSupportTargets = [{ path: 'docs', kind: 'directory' as const }];

    render(
      <DeepFocusSelector
        {...makeProps({
          selectedFocusPath: 'src',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets,
          selectedTestTarget,
          selectedSupportTargets,
          onCommitDeepFocusSelection,
          onListRepoTree,
          onManageFocusFilters,
          onDeepFocusEditorToggle,
          editorOpen: true,
        })}
      />,
    );

    expect(deepFocusMock.lastProps).toMatchObject({
      selectedFocusPath: 'src',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets,
      selectedTestTarget,
      selectedSupportTargets,
      onCommitDeepFocusSelection,
      onListRepoTree,
      onManageFocusFilters,
      onDeepFocusEditorToggle,
      editorOpen: true,
    });
  });

  it('does not leak regular working IDs when no Deep Focus scope exists', () => {
    render(
      <DeepFocusSelector
        {...makeProps({
          selectedWorkingFocusIds: ['regular-repo'],
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedFocusTargets: [],
        })}
      />,
    );

    expect(deepFocusMock.lastProps).toMatchObject({
      deepFocusPrimaryId: null,
      selectedWorkingFocusIds: [],
    });
  });

  it('preserves regular working IDs when scoped Deep Focus metadata exists without a scalar fallback', () => {
    render(
      <DeepFocusSelector
        {...makeProps({
          selectedWorkingFocusIds: ['regular-repo'],
          selectedFocusTargets: [{ path: 'src', kind: 'directory', role: 'anchor' }],
        })}
      />,
    );

    expect(deepFocusMock.lastProps).toMatchObject({
      deepFocusPrimaryId: null,
      selectedWorkingFocusIds: ['regular-repo'],
    });
  });

  it('keeps DeepFocusSelector free of persistence and client boundaries', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/components/focus-selection/DeepFocusSelector.tsx'),
      'utf8',
    );

    const forbiddenNames = [
      ['desktop', 'Shell', 'Client'].join(''),
      ['use', 'Ipc', 'Call'].join(''),
      ['save', 'Deep', 'Focus', 'Selections'].join(''),
      ['save', 'Context', 'Pack', 'Sidebar', 'State'].join(''),
      ['client', '.'].join(''),
      ['use', 'Context', 'Pack', 'Selection'].join(''),
      ['use', 'Context', 'Pack', 'Switching'].join(''),
    ];

    for (const forbiddenName of forbiddenNames) {
      expect(source).not.toContain(forbiddenName);
    }
  });
});
