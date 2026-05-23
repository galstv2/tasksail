import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlannerModalProps } from './PlannerModal';
import PlannerModal from './PlannerModal';
import type { ContextPackCatalogEntry, PlannerChildTaskExecutionScope, PlannerFocusSnapshot } from '../../shared/desktopContract';
import { createLocalDraft } from '../plannerComposer';

afterEach(cleanup);

const childScopeCss = readFileSync('src/renderer/styles/planner-child-scope.css', 'utf8');

function makeFocusSnapshot(): PlannerFocusSnapshot {
  return {
    version: 1,
    contextPackDir: '/packs/orders',
    contextPackId: 'orders',
    title: 'Parent',
    primaryRepoId: 'orders-api',
    primaryRepoRoot: '/repo/orders-api',
    primaryFocusRelativePath: 'src/orders',
    primaryFocusTargetKind: 'directory',
    primaryFocusTargets: [],
    selectedTestTarget: null,
    supportTargets: [],
    deepFocusEnabled: false,
    contextPackBinding: {
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['orders-api'],
      selectedFocusIds: [],
      deepFocusEnabled: false,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    },
  };
}

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
  }, {
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
  }],
};

const parentScope: PlannerChildTaskExecutionScope = {
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

function makeProps(overrides: Partial<PlannerModalProps> = {}): PlannerModalProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    draft: createLocalDraft({
      title: '',
      summary: '',
      desiredOutcome: '',
      constraints: [],
      acceptanceSignals: [],
      planningNotes: '',
      suggestedPath: 'sequential',
    }),
    composerStage: 'compose',
    onPreview: vi.fn(),
    onConfirm: vi.fn(),
    isFollowUpDraft: false,
    planningEnabled: true,
    contractError: '',
    primaryActionLabel: 'Confirm & Send to Dropbox',
    stageCopy: '',
    messages: [],
    onSendMessage: vi.fn(),
    ...overrides,
  };
}

describe('PlannerModal child scope override affordance', () => {
  it('does not render the child scope button outside valid child-parent mode', () => {
    render(<PlannerModal {...makeProps()} />);
    expect(screen.queryByRole('button', { name: 'Adjust child scope' })).not.toBeInTheDocument();
  });

  it('renders child scope status, warning, and opens the controlled panel', () => {
    const onOpen = vi.fn();
    render(<PlannerModal {...makeProps({
      childTaskMode: true,
      selectedParentTask: {
        taskId: 'TASK-1',
        title: 'Parent task',
        summary: '',
        rootTaskId: 'TASK-1',
        qmdRecordId: 'qmd-1',
        followupReason: '',
        year: '2026',
        archivePath: '/archive/task.md',
        archivedAt: null,
        contextPackName: 'orders',
        plannerFocusSnapshot: makeFocusSnapshot(),
      },
      childScopeStatusLabel: 'Using parent scope',
      childScopeSummary: 'Orders API',
      childScopeWarning: 'Added to child scope: Billing API',
      onOpenChildScopePanel: onOpen,
    })} />);

    expect(screen.getByText('Using parent scope')).toBeInTheDocument();
    expect(screen.getByText('Orders API')).toBeInTheDocument();
    expect(screen.getByText('Added to child scope: Billing API')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust child scope' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('shows separate cards for the adjusted child scope and archived parent scope', () => {
    render(<PlannerModal {...makeProps({
      childTaskMode: true,
      selectedParentTask: {
        taskId: 'TASK-1',
        title: 'Parent task',
        summary: '',
        rootTaskId: 'TASK-1',
        qmdRecordId: 'qmd-1',
        followupReason: '',
        year: '2026',
        archivePath: '/archive/task.md',
        archivedAt: null,
        contextPackName: 'orders',
        plannerFocusSnapshot: makeFocusSnapshot(),
      },
      childScopeStatusLabel: 'Child scope adjusted',
      childScopeSummary: 'Billing API',
      childScopePanelProps: {
        selectedPack,
        parentScope,
        childScope: {
          ...parentScope,
          selectedRepoIds: ['billing-api'],
          repositoryTypes: { 'billing-api': 'primary' },
        },
        statusLabel: 'Child scope adjusted',
        summary: 'Billing API',
        onCancel: vi.fn(),
        onSave: vi.fn(),
        onListRepoTree: vi.fn(),
      },
    })} />);

    expect(screen.getByRole('button', { name: 'Adjusted child scope details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parent task scope details' })).toBeInTheDocument();

    const adjustedCard = document.querySelector<HTMLElement>('.planner-modal__adjusted-scope-card');
    expect(adjustedCard).not.toBeNull();
    expect(adjustedCard).toHaveAttribute('data-mode', 'standard');
    expect(within(adjustedCard!).getByText('Execution')).toBeInTheDocument();
    expect(within(adjustedCard!).getByText('Primary')).toBeInTheDocument();
    expect(within(adjustedCard!).getByText('Billing API')).toBeInTheDocument();
    expect(within(adjustedCard!).queryByText('Orders API')).not.toBeInTheDocument();

    const parentCard = document.querySelector<HTMLElement>('.planner-modal__parent-scope-card');
    expect(parentCard).not.toBeNull();
    expect(parentCard).toHaveAttribute('data-mode', 'standard');
    expect(within(parentCard!).getByText('Archived')).toBeInTheDocument();
    expect(within(parentCard!).getByText('Primary')).toBeInTheDocument();
    expect(within(parentCard!).getByText('Orders API')).toBeInTheDocument();
    expect(within(parentCard!).queryByText('Billing API')).not.toBeInTheDocument();

    expect(screen.getByLabelText('Child task context')).toBeInTheDocument();
    expect(document.querySelector('.planner-modal__child-task-summary')).toBeNull();
  });

  it('shows whole-repo Deep Focus support in the adjusted child scope card', () => {
    render(<PlannerModal {...makeProps({
      childTaskMode: true,
      selectedParentTask: {
        taskId: 'TASK-1',
        title: 'Parent task',
        summary: '',
        rootTaskId: 'TASK-1',
        qmdRecordId: 'qmd-1',
        followupReason: '',
        year: '2026',
        archivePath: '/archive/task.md',
        archivedAt: null,
        contextPackName: 'orders',
        plannerFocusSnapshot: makeFocusSnapshot(),
      },
      childScopeStatusLabel: 'Child scope adjusted',
      childScopeSummary: 'Deep Focus: 1 primary, 1 support',
      childScopePanelProps: {
        selectedPack,
        parentScope,
        childScope: {
          ...parentScope,
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'orders-api',
          selectedFocusTargets: [{
            path: '',
            kind: 'directory',
            repoLocalPath: '/repo/orders-api',
            repoId: 'orders-api',
            role: 'anchor',
            supportTargets: [{
              path: '',
              kind: 'directory',
              repoLocalPath: '/repo/billing-api',
              repoId: 'billing-api',
            }],
          }],
        },
        statusLabel: 'Child scope adjusted',
        summary: 'Deep Focus: 1 primary, 1 support',
        onCancel: vi.fn(),
        onSave: vi.fn(),
        onListRepoTree: vi.fn(),
      },
    })} />);

    const adjustedCard = document.querySelector<HTMLElement>('.planner-modal__adjusted-scope-card');
    expect(adjustedCard).not.toBeNull();
    expect(adjustedCard).toHaveAttribute('data-mode', 'deep-focus');
    expect(within(adjustedCard!).getByText('Primary')).toBeInTheDocument();
    expect(within(adjustedCard!).getByText('Orders API')).toBeInTheDocument();
    expect(within(adjustedCard!).getByText('Support')).toBeInTheDocument();
    expect(within(adjustedCard!).getByText('Orders API: Billing API')).toBeInTheDocument();
    expect(within(adjustedCard!).queryByText('Global: None')).not.toBeInTheDocument();
  });

  it('collapses and restores the parent task controls', () => {
    render(<PlannerModal {...makeProps({
      childTaskMode: true,
      selectedParentTask: {
        taskId: 'TASK-1',
        title: 'Checkout flow refactor',
        summary: '',
        rootTaskId: 'TASK-1',
        qmdRecordId: 'qmd-1',
        followupReason: '',
        year: '2026',
        archivePath: '/archive/task.md',
        archivedAt: null,
        contextPackName: 'orders',
        plannerFocusSnapshot: makeFocusSnapshot(),
      },
      childScopeStatusLabel: 'Using parent scope',
      childScopeSummary: 'Orders API',
    })} />);

    expect(screen.getByText('Orders API')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand parent task controls' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse parent task controls' }));

    const restore = screen.getByRole('button', { name: 'Expand parent task controls' });
    expect(within(restore).getByText('Checkout flow refactor')).toBeInTheDocument();
    expect(screen.queryByText('Orders API')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse parent task controls' })).not.toBeInTheDocument();

    fireEvent.click(restore);

    expect(screen.getByText('Orders API')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand parent task controls' })).not.toBeInTheDocument();
  });

  it('renders child-task context as a full-width band that lets popovers escape', () => {
    expect(childScopeCss).toMatch(
      /\.planner-modal__parent-card\s*\{[^}]*border-bottom:\s*1px solid var\(--ts-border\);/s,
    );
    expect(childScopeCss).not.toMatch(
      /\.planner-modal__parent-card\s*\{[^}]*border-radius:/s,
    );
    expect(childScopeCss).not.toMatch(
      /\.planner-modal__parent-card\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(childScopeCss).toMatch(
      /\.planner-modal__parent-card-scope\s*\{[^}]*border-top:\s*1px solid var\(--ts-border\);/s,
    );
    expect(childScopeCss).toMatch(
      /\.planner-modal__parent-card-scope\s*\{[^}]*flex-wrap:\s*wrap;/s,
    );
    expect(childScopeCss).toMatch(
      /\.planner-modal__scope-summary-popover\s*\{[^}]*position:\s*absolute;/s,
    );
    expect(childScopeCss).toMatch(
      /\.planner-modal__scope-summary-popover\s*\{[^}]*visibility:\s*hidden;/s,
    );
    expect(childScopeCss).toContain(
      '.planner-modal__scope-summary-affordance:hover .planner-modal__scope-summary-popover',
    );
  });
});
