import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import ContextPackSidebarExpanded from './ContextPackSidebarExpanded';
import type { ContextPackCatalogEntry } from '../../shared/desktopContract';

function basePack(overrides: Partial<ContextPackCatalogEntry> = {}): ContextPackCatalogEntry {
  return {
    contextPackId: 'pack-1',
    displayName: 'Test Pack',
    contextPackDir: '/packs/test',
    manifestPath: null,
    bootstrapReady: true,
    source: 'configured-path',
    isActive: true,
    estateType: 'monolith',
    defaultScopeMode: null,
    repoCount: 1,
    primaryWorkingRepoIds: [],
    focusTargets: [],
    status: 'active',
    ...overrides,
  };
}

const noop = vi.fn();

function renderSidebar(packs: ContextPackCatalogEntry[]) {
  return render(
    <ContextPackSidebarExpanded
      contextPacks={packs}
      activeContextPackDir={packs.find((p) => p.isActive)?.contextPackDir ?? null}
      selectedContextPackDir={packs[0]?.contextPackDir ?? ''}
      selectedRepoIds={[]}
      selectedFocusIds={[]}
      deepFocusEnabled={false}
      selectedFocusPath={null}
      selectedFocusTargetKind={null}
      selectedTestTarget={null}
      selectedSupportTargets={[]}
      actionPending={null}
      message=""
      error=""
      lastResult={null}
      lastReseedResult={null}
      onToggleCollapse={noop}
      onSelectContextPack={noop}
      onSelectWorkingFocus={noop}
      onRefreshCatalog={noop}
      onOpenCreateModal={noop}
      onReseedContextPack={noop}
      onPreviewSwitch={noop}
      onApplySwitch={noop}
      onClearActive={noop}
      onCommitDeepFocusSelection={noop}
      onListRepoTree={async () => null}
      onOpenPlannerModal={noop}
      showMultiPrimaryWarning={false}
      onDismissMultiPrimaryWarning={noop}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('ContextPackSidebarExpanded recovery hints', () => {
  it('shows recovery hint when activation-failed and no restore available', () => {
    const pack = basePack({
      status: 'activation-failed',
      restoreAvailable: false,
    });
    renderSidebar([pack]);

    const hint = screen.getByTestId('context-pack-recovery-hint');
    expect(hint.textContent).toContain('clearing the active pack');
    expect(hint.textContent).toContain('re-applying');
  });

  it('does not show recovery hint when activation-failed but restore is available', () => {
    const pack = basePack({
      status: 'activation-failed',
      restoreAvailable: true,
    });
    renderSidebar([pack]);

    expect(screen.queryByTestId('context-pack-recovery-hint')).toBeNull();
  });

  it('does not show recovery hint when status is active', () => {
    renderSidebar([basePack({ status: 'active' })]);
    expect(screen.queryByTestId('context-pack-recovery-hint')).toBeNull();
  });

  it('does not show recovery hint for workspace-sync-failed', () => {
    renderSidebar([basePack({ status: 'workspace-sync-failed', restoreAvailable: true })]);
    expect(screen.queryByTestId('context-pack-recovery-hint')).toBeNull();
  });

  it('shows status message alongside recovery hint when both present', () => {
    const pack = basePack({
      status: 'activation-failed',
      restoreAvailable: false,
      statusMessage: 'Validation script exited with code 1.',
    });
    renderSidebar([pack]);

    expect(screen.getByTestId('context-pack-status-message').textContent).toContain(
      'Validation script exited with code 1',
    );
    expect(screen.getByTestId('context-pack-recovery-hint')).toBeTruthy();
  });
});
