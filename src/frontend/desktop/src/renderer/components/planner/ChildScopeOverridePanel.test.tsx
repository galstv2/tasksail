// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChildScopeOverridePanel from './ChildScopeOverridePanel';
import type { ContextPackCatalogEntry, PlannerChildTaskExecutionScope } from '../../../shared/desktopContract';

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
  repoCount: 2,
  primaryWorkingRepoIds: [],
  focusTargets: [
    {
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
    },
    {
      focusId: 'billing-api',
      displayName: 'Billing API',
      kind: 'repository',
      repoId: 'billing-api',
      repoLocalPath: '/repo/billing-api',
      serviceName: null,
      systemLayer: null,
      repoRole: null,
      repositoryType: null,
      relativePath: null,
      focusType: null,
      group: null,
      defaultFocusable: true,
      activationPriority: 1,
      adjacentRepoIds: [],
      adjacentFocusIds: [],
    },
  ],
};

const scope: PlannerChildTaskExecutionScope = {
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  scopeMode: 'focused',
  selectedRepoIds: ['orders-api'],
  selectedFocusIds: [],
  repositoryTypes: { 'orders-api': 'primary' },
  deepFocusEnabled: false,
  deepFocusPrimaryRepoId: null,
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

describe('ChildScopeOverridePanel', () => {
  it('uses the standard selector, hides focus filters, and saves the draft child scope', () => {
    const onSave = vi.fn();
    render(
      <ChildScopeOverridePanel
        selectedPack={selectedPack}
        parentScope={scope}
        childScope={scope}
        statusLabel="Using parent scope"
        summary="Orders API"
        onCancel={vi.fn()}
        onSave={onSave}
        onListRepoTree={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Adjust child scope')).toBeInTheDocument();
    expect(document.querySelector('.planner-modal__child-scope-selector')).toHaveAttribute('data-scope-mode', 'standard');
    expect(screen.getByText('Repositories')).toBeInTheDocument();
    expect(screen.queryByLabelText('Manage focus filters')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save child scope' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ selectedRepoIds: ['orders-api'] }));
  });

  it('changes standard primary/support roles independently without mutating selection order or pack metadata', () => {
    const onSave = vi.fn();
    render(
      <ChildScopeOverridePanel
        selectedPack={selectedPack}
        parentScope={{
          ...scope,
          selectedRepoIds: ['orders-api', 'billing-api'],
          repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'support' },
        }}
        childScope={{
          ...scope,
          selectedRepoIds: ['orders-api', 'billing-api'],
          repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'support' },
        }}
        statusLabel="Using parent scope"
        summary="Orders API, Billing API"
        onCancel={vi.fn()}
        onSave={onSave}
        onListRepoTree={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Support' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save child scope' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      selectedRepoIds: ['orders-api', 'billing-api'],
      repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'primary' },
    }));
    expect(selectedPack.focusTargets.map((target) => target.repositoryType)).toEqual([null, null]);
  });

  it('can change one selected standard primary to support while keeping other roles unchanged', () => {
    const onSave = vi.fn();
    render(
      <ChildScopeOverridePanel
        selectedPack={selectedPack}
        parentScope={{
          ...scope,
          selectedRepoIds: ['orders-api', 'billing-api'],
          repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'primary' },
        }}
        childScope={{
          ...scope,
          selectedRepoIds: ['orders-api', 'billing-api'],
          repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'primary' },
        }}
        statusLabel="Using parent scope"
        summary="Orders API, Billing API"
        onCancel={vi.fn()}
        onSave={onSave}
        onListRepoTree={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Primary' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save child scope' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      selectedRepoIds: ['orders-api', 'billing-api'],
      repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'support' },
    }));
    expect(selectedPack.focusTargets.map((target) => target.repositoryType)).toEqual([null, null]);
  });

  it('opens the Deep Focus editor with controlled panel state', async () => {
    render(
      <ChildScopeOverridePanel
        selectedPack={selectedPack}
        parentScope={{
          ...scope,
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'orders-api',
          selectedFocusPath: 'src/orders',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [{ path: 'src/orders', kind: 'directory', repoId: 'orders-api', repoLocalPath: '/repo/orders-api' }],
        }}
        childScope={{
          ...scope,
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'orders-api',
          selectedFocusPath: 'src/orders',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [{ path: 'src/orders', kind: 'directory', repoId: 'orders-api', repoLocalPath: '/repo/orders-api' }],
        }}
        statusLabel="Using parent scope"
        summary="Deep Focus: 1 primary, 0 support"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onListRepoTree={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));

    expect(document.querySelector('.planner-modal__child-scope-selector')).toHaveAttribute('data-scope-mode', 'deep-focus');
    expect(await screen.findByTestId('deep-focus-editor')).toBeInTheDocument();
  });

  it('scopes standard and Deep Focus scroll containers to the child scope panel', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/styles/planner-child-scope.css'), 'utf8');

    expect(css).toMatch(
      /\.planner-modal__child-scope-selector\[data-scope-mode="standard"\] \.scope-focus-list\s*\{[^}]*overflow-y: auto;/s,
    );
    expect(css).toMatch(
      /\.planner-modal__child-scope-selector\[data-scope-mode="deep-focus"\] \.deep-focus-shell\s*\{[^}]*overflow: hidden;/s,
    );
    expect(css).toMatch(
      /\.planner-modal__child-scope-selector\[data-scope-mode="deep-focus"\] \.deep-focus-list\s*\{[^}]*overflow-y: auto;/s,
    );
  });

  it('cancels without saving', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <ChildScopeOverridePanel
        selectedPack={selectedPack}
        parentScope={scope}
        childScope={scope}
        statusLabel="Using parent scope"
        summary="Orders API"
        onCancel={onCancel}
        onSave={onSave}
        onListRepoTree={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
