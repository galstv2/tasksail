// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry, PlannerChildTaskExecutionScope } from '../../../shared/desktopContract';
import ChildScopeOverridePanel from './ChildScopeOverridePanel';

expect.extend(matchers);

afterEach(cleanup);

const selectedPack: ContextPackCatalogEntry = {
  contextPackId: 'orders',
  displayName: 'Orders',
  contextPackDir: '/packs/orders',
  manifestPath: null,
  bootstrapReady: true,
  source: 'configured-path',
  isActive: true,
  estateType: 'distributed-platform',
  defaultScopeMode: null,
  repoCount: 1,
  primaryWorkingRepoIds: [],
  focusTargets: [{
    focusId: 'orders-api',
    displayName: 'Orders API',
    kind: 'repository',
    repoId: 'orders-api',
    repoLocalPath: '/repo/orders-api',
    serviceName: null,
    systemLayer: null,
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
};

const childScope: PlannerChildTaskExecutionScope = {
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  scopeMode: 'focused',
  selectedRepoIds: ['orders-api'],
  selectedFocusIds: [],
  repositoryTypes: { 'orders-api': 'primary' },
  deepFocusEnabled: true,
  deepFocusPrimaryRepoId: 'orders-api',
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: 'src/orders',
  selectedFocusTargetKind: 'directory',
  selectedFocusTargets: [{
    path: 'src/orders',
    kind: 'directory',
    role: 'anchor',
    repoId: 'orders-api',
    repoLocalPath: '/repo/orders-api',
  }],
  selectedTestTarget: null,
  selectedSupportTargets: [{ path: 'docs', kind: 'directory', repoId: 'orders-api', repoLocalPath: '/repo/orders-api' }],
};

describe('ChildScopeOverridePanel selection builder inheritance', () => {
  it('inherits the builder through DeepFocusSelector and keeps Focus Filters hidden', async () => {
    render(
      <ChildScopeOverridePanel
        selectedPack={selectedPack}
        parentScope={childScope}
        childScope={childScope}
        statusLabel="Using parent scope"
        summary="Deep Focus"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onListRepoTree={vi.fn().mockResolvedValue({ entries: [], truncated: false })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));

    const builder = await screen.findByLabelText('Deep Focus Selection Builder');
    expect(builder).toBeInTheDocument();
    expect(within(builder).getByText('All primaries')).toBeInTheDocument();
    expect(screen.queryByLabelText('Manage focus filters')).not.toBeInTheDocument();
  });

  it('does not import the Selection Builder directly in the child panel', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/components/planner/ChildScopeOverridePanel.tsx'),
      'utf8',
    );

    expect(source).not.toContain('DeepFocusSelectionBuilder');
  });
});
