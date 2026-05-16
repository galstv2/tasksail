import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

import type { DesktopShellClient } from '../services/desktopShellClient';
import { ToastProvider } from '../contexts/ToastContext';
import { useContextPackSelection } from './useContextPackSelection';
import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import {
  createMockClient,
  createListContextPacksResponse,
  createReseedResponse,
  createSwitchResponse,
} from '../../test';

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

export const ordersEstatePack: ContextPackCatalogEntry = {
  contextPackId: 'orders-estate',
  displayName: 'Orders Estate',
  contextPackDir: '/tmp/context-packs/orders-estate',
  manifestPath: '/tmp/context-packs/orders-estate/qmd/repo-sources.json',
  bootstrapReady: true,
  source: 'active-env',
  isActive: true,
  estateType: 'distributed-platform',
  defaultScopeMode: 'focused',
  repoCount: 2,
  primaryWorkingRepoIds: ['orders-api'],
  focusTargets: [
    {
      focusId: 'orders-api',
      displayName: 'Orders API',
      kind: 'repository',
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
      kind: 'repository',
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
};

export const billingEstatePack: ContextPackCatalogEntry = {
  contextPackId: 'billing-estate',
  displayName: 'Billing Estate',
  contextPackDir: '/tmp/context-packs/billing-estate',
  manifestPath: '/tmp/context-packs/billing-estate/qmd/repo-sources.json',
  bootstrapReady: true,
  source: 'search-root',
  isActive: false,
  estateType: 'distributed-platform',
  defaultScopeMode: 'focused',
  repoCount: 1,
  primaryWorkingRepoIds: ['billing-api'],
  focusTargets: [
    {
      focusId: 'billing-api',
      displayName: 'Billing API',
      kind: 'repository',
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
};

export function createClient(
  overrides?: Partial<DesktopShellClient>,
): DesktopShellClient {
  return createMockClient({
    reseedContextPack: vi.fn().mockResolvedValue({
      ok: true,
      response: createReseedResponse({
        message:
          'Context-pack reseed completed through the approved repo-context seed seam. Conventions memo generation remains only-if-missing.',
        commandPath: 'scripts/python/repo-context-app.py',
        result: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          overallStatus: 'seeded',
          reportPath:
            '/tmp/context-packs/orders-estate/qmd/context-pack-seed-report.json',
          seededRepoCount: 2,
          blockedRepoCount: 0,
          conventionsSummaryStatus: 'available',
          conventionsPolicy: 'only-if-missing',
          workspaceFolderCount: null,
          workspaceFileCount: null,
        },
      }),
    }),
    listContextPacks: vi.fn().mockResolvedValue({
      ok: true,
      response: createListContextPacksResponse(
        [ordersEstatePack, billingEstatePack],
        {
          message: 'Discovered 2 context pack(s) from approved local sources.',
          activeContextPackDir: '/tmp/context-packs/orders-estate',
          recentContextPackDirs: ['/tmp/context-packs/orders-estate'],
        },
      ),
    }),
    previewContextPackSwitch: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        ...createSwitchResponse('contextPack.previewSwitch', 'preview', {
          contextPackId: 'orders-estate',
          contextPackDir: '/tmp/context-packs/orders-estate',
          workspaceFile: '/repo/tasksail.code-workspace',
          stateFile: '/repo/.platform-state/workspace-context-sync.json',
          selectedRepoIds: ['orders-api'],
          warnings: ['orders-web is missing on disk'],
          foldersToAdd: ['/tmp/context-packs/orders-estate'],
          managedFolders: ['/tmp/context-packs/orders-estate'],
          targetFolders: ['/tmp/context-packs/orders-estate'],
        }),
        message: 'Context-pack workspace preview completed through the approved wrapper seam.',
        commandPath: 'src/backend/scripts/python/sync-context-pack-workspace.py',
      },
    }),
    applyContextPackSwitch: vi.fn().mockResolvedValue({
      ok: false,
      action: 'contextPack.applySwitch',
      error: 'Activation failed.',
      contextPackResult: {
        ok: false,
        wrapperAction: 'apply',
        stage: 'activation',
        status: 'error',
        activation: {
          performed: true,
          exitCode: 1,
          output: 'activation failed',
        },
        envStateCleared: false,
        error: 'Activation failed.',
        contextPackId: null,
        contextPackDir: '/tmp/context-packs/orders-estate',
        workspaceFile: null,
        stateFile: null,
        scopeMode: 'focused',
        selectedRepoIds: ['orders-api'],
        selectedFocusIds: [],
        warnings: [],
        foldersToAdd: [],
        foldersToRemove: [],
        managedFolders: [],
        targetFolders: [],
        lastSyncedAt: null,
      },
    }),
    clearActiveContextPack: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        ...createSwitchResponse('contextPack.clearActive', 'cleared', {
          wrapperAction: 'clear',
          status: 'cleared',
          envStateCleared: true,
          contextPackId: null,
          contextPackDir: null,
          workspaceFile: '/repo/tasksail.code-workspace',
          stateFile: '/repo/.platform-state/workspace-context-sync.json',
          scopeMode: null,
          foldersToRemove: ['/tmp/context-packs/orders-estate'],
          lastSyncedAt: '2026-03-08T11:00:00Z',
        }),
        message: 'Active context-pack workspace state cleared through the approved wrapper seam.',
        commandPath: 'src/backend/scripts/python/sync-context-pack-workspace.py',
      },
    }),
    ...overrides,
  });
}

export function ContextPackSelectionContent({
  client,
}: {
  client: DesktopShellClient;
}): JSX.Element {
  const { contextPackSidebarProps, contextPackCreationModalProps } = useContextPackSelection(client);

  return (
    <section>
      <div data-testid="selected-pack">
        {contextPackSidebarProps.selectedContextPackDir || 'none'}
      </div>
      <div data-testid="active-pack">
        {contextPackSidebarProps.activeContextPackDir || 'none'}
      </div>
      <div data-testid="selected-repo-ids">
        {contextPackSidebarProps.selectedRepoIds.join(',') || 'none'}
      </div>
      <div data-testid="selected-focus-ids">
        {contextPackSidebarProps.selectedFocusIds.join(',') || 'none'}
      </div>
      <div data-testid="deep-focus-enabled">
        {contextPackSidebarProps.deepFocusEnabled ? 'true' : 'false'}
      </div>
      <div data-testid="selected-focus-path">
        {contextPackSidebarProps.selectedFocusPath ?? 'none'}
      </div>
      <div data-testid="selected-focus-target-kind">
        {contextPackSidebarProps.selectedFocusTargetKind ?? 'none'}
      </div>
      <div data-testid="selected-test-target">
        {contextPackSidebarProps.selectedTestTarget === undefined
          ? 'unset'
          : contextPackSidebarProps.selectedTestTarget
            ? `${contextPackSidebarProps.selectedTestTarget.path}:${contextPackSidebarProps.selectedTestTarget.kind}`
            : 'none'}
      </div>
      <div data-testid="selected-support-targets">
        {contextPackSidebarProps.selectedSupportTargets?.map((target) => `${target.path}:${target.kind}`).join(',')
          || 'none'}
      </div>
      <div data-testid="message">{contextPackSidebarProps.message}</div>
      <div data-testid="error">{contextPackSidebarProps.error || 'no-error'}</div>
      <div data-testid="result-stage">
        {contextPackSidebarProps.lastResult?.stage || 'no-result'}
      </div>
      <div data-testid="result-status">
        {contextPackSidebarProps.lastResult?.status || 'no-result'}
      </div>
      <div data-testid="warning-count">
        {contextPackSidebarProps.lastResult?.warnings.length ?? 0}
      </div>
      <div data-testid="reseed-status">
        {contextPackSidebarProps.lastReseedResult?.overallStatus || 'no-reseed'}
      </div>
      <div data-testid="reseed-report-path">
        {contextPackSidebarProps.lastReseedResult?.reportPath || 'no-report'}
      </div>
      <div data-testid="create-modal-open">
        {contextPackCreationModalProps.isOpen ? 'open' : 'closed'}
      </div>
      <div data-testid="create-modal-step">{contextPackCreationModalProps.step}</div>
      <div data-testid="create-modal-pack-dir">
        {contextPackCreationModalProps.draft.contextPackDir || 'none'}
      </div>
      <div data-testid="create-modal-discovery-root">
        {contextPackCreationModalProps.draft.discoveryRoot || 'none'}
      </div>
      <button
        type="button"
        onClick={() =>
          contextPackSidebarProps.onSelectContextPack(
            '/tmp/context-packs/billing-estate',
          )
        }
      >
        Select billing
      </button>
      <button
        type="button"
        onClick={() => contextPackSidebarProps.onSelectWorkingFocus('orders-web')}
      >
        Select orders web focus
      </button>
      <button
        type="button"
        onClick={() =>
          contextPackSidebarProps.onSelectWorkingFocus('services-identity')
        }
      >
        Select identity focus
      </button>
      <button
        type="button"
        onClick={() =>
          contextPackSidebarProps.onCommitDeepFocusSelection({
            deepFocusEnabled: true,
            deepFocusPrimaryRepoId: 'orders-api',
            deepFocusPrimaryFocusId: null,
            selectedFocusPath: 'src/features/orders',
            selectedFocusTargetKind: 'directory',
            selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
            selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
          })
        }
      >
        Commit deep focus
      </button>
      <button
        type="button"
        onClick={() =>
          contextPackSidebarProps.onCommitDeepFocusSelection({
            deepFocusEnabled: true,
            deepFocusPrimaryRepoId: 'orders-api',
            deepFocusPrimaryFocusId: null,
            selectedFocusPath: 'src/features/orders',
            selectedFocusTargetKind: 'directory',
            selectedTestTarget: null,
            selectedSupportTargets: [],
          })
        }
      >
        Commit deep focus no tests
      </button>
      <button
        type="button"
        onClick={() =>
          contextPackSidebarProps.onCommitDeepFocusSelection({
            deepFocusEnabled: false,
            deepFocusPrimaryRepoId: null,
            deepFocusPrimaryFocusId: null,
            selectedFocusPath: null,
            selectedFocusTargetKind: null,
            selectedTestTarget: undefined,
            selectedSupportTargets: [],
          })
        }
      >
        Clear deep focus
      </button>
      <button
        type="button"
        onClick={() => contextPackSidebarProps.onToggleRepositoryType?.('orders-api', 'primary')}
      >
        Toggle repository type
      </button>
      <button
        type="button"
        onClick={() => void contextPackSidebarProps.onReseedContextPack()}
      >
        Run reseed
      </button>
      <button
        type="button"
        onClick={() => void contextPackSidebarProps.onPreviewSwitch()}
      >
        Run preview
      </button>
      <button
        type="button"
        onClick={() => void contextPackSidebarProps.onApplySwitch()}
      >
        Run apply
      </button>
      <button
        type="button"
        onClick={() => void contextPackSidebarProps.onClearActive()}
      >
        Run clear
      </button>
      <button
        type="button"
        onClick={() => void contextPackCreationModalProps.onOpen()}
      >
        Open create modal
      </button>
      <button
        type="button"
        onClick={() => void contextPackCreationModalProps.onBrowseDiscoveryRoot()}
      >
        Browse discovery root
      </button>
      <button
        type="button"
        onClick={() => void contextPackCreationModalProps.onBrowseContextPackDir()}
      >
        Browse destination
      </button>
      <button
        type="button"
        onClick={() => void contextPackCreationModalProps.onDiscoverPrefill()}
      >
        Run discovery prefill
      </button>
      <button
        type="button"
        onClick={() => void contextPackCreationModalProps.onNext()}
      >
        Create next
      </button>
      <button
        type="button"
        onClick={() => void contextPackCreationModalProps.onCreate()}
      >
        Run create pack
      </button>
    </section>
  );
}

export function ContextPackSelectionHarness({ client }: { client: DesktopShellClient }): JSX.Element {
  return (
    <ToastProvider>
      <ContextPackSelectionContent client={client} />
    </ToastProvider>
  );
}

export { render, vi };
export { act, fireEvent, screen, waitFor } from '@testing-library/react';
export { describe, expect, it } from 'vitest';
