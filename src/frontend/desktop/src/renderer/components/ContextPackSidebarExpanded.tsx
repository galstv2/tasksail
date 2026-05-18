import { useEffect, useState } from 'react';

import { buildCompactSidebarModel } from '../selectors/contextPackSidebarModel';
import { classNames } from '../utils/classNames';
import type { ContextPackSidebarProps } from './ContextPackSidebar';
import { RefreshIcon } from './creation-steps/icons';
import ContextPackDeleteConfirmModal from './ContextPackDeleteConfirmModal';
import FocusFilterModal from './FocusFilterModal';
import SidebarPackSelector from './SidebarPackSelector';
import SidebarScopeControls from './SidebarScopeControls';

type ContextPackSidebarExpandedProps = Omit<ContextPackSidebarProps, 'collapsed'>;

function ContextPackSidebarExpanded({
  contextPacks,
  activeContextPackDir,
  selectedContextPackDir,
  repoRoot,
  selectedRepoIds,
  selectedFocusIds,
  deepFocusEnabled,
  deepFocusPrimaryRepoId,
  deepFocusPrimaryFocusId,
  selectedFocusPath,
  selectedFocusTargetKind,
  selectedFocusTargets,
  selectedTestTarget,
  selectedSupportTargets,
  focusFilters = [],
  focusFilterPending = false,
  focusFilterError = '',
  actionPending,
  message,
  error,
  onToggleCollapse,
  onSelectContextPack,
  onSelectWorkingFocus,
  onRefreshCatalog,
  onOpenCreateModal,
  onCommitDeepFocusSelection,
  onListRepoTree,
  onReseedContextPack,
  onPreviewSwitch,
  onApplySwitch,
  onClearActive,
  onDeleteContextPack,
  deleteBlockedByActiveTask = false,
  onCreateFocusFilter,
  onApplyFocusFilter,
  onDeleteFocusFilter,
  showMultiPrimaryWarning,
  onDismissMultiPrimaryWarning,
  bootstrapEmptyConfirmPending,
  onConfirmActivateAnyway,
  onConfirmPopulateAndSeed,
  onToggleRepositoryType,
  onOpenPlannerModal,
}: ContextPackSidebarExpandedProps): JSX.Element {
  const [deepFocusExpanded, setDeepFocusExpanded] = useState(false);
  const [deepFocusClosing, setDeepFocusClosing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [focusFilterModalOpen, setFocusFilterModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const activePack = contextPacks.find((entry) => entry.isActive);
  const selectedPack = contextPacks.find(
    (entry) => entry.contextPackDir === selectedContextPackDir,
  );
  const isDistributed = selectedPack?.estateType === 'distributed-platform';
  const baseWorkingFocusIds = isDistributed ? selectedRepoIds : selectedFocusIds;
  const deepFocusOverride = deepFocusEnabled
    ? (isDistributed ? deepFocusPrimaryRepoId : deepFocusPrimaryFocusId)
    : null;
  const selectedWorkingFocusIds = deepFocusOverride
    ? [deepFocusOverride]
    : baseWorkingFocusIds;
  const hasSelection = Boolean(selectedPack);
  const selectedPackIsActive = selectedPack?.isActive === true;
  const selectedPackIsInactive = Boolean(selectedPack) && !selectedPackIsActive;
  const isBusy = actionPending !== null;
  const deleteDisabled = isBusy || deleteBlockedByActiveTask;
  const deleteTitle = deleteBlockedByActiveTask
    ? 'Complete or fail active tasks before deleting a context pack.'
    : 'Delete context pack';
  const sidebarModel = buildCompactSidebarModel({
    contextPacks,
    activeContextPackDir,
    selectedContextPackDir,
    selectedRepoIds,
    selectedFocusIds,
    lastResult: null,
    lastReseedResult: null,
  });

  useEffect(() => {
    setDeepFocusExpanded(false);
    setDeepFocusClosing(false);
    setEditorOpen(false);
    setFocusFilterModalOpen(false);
    setDeleteModalOpen(false);
  }, [selectedContextPackDir]);

  useEffect(() => {
    if (deepFocusExpanded) {
      setDeepFocusClosing(false);
      return;
    }
    if (!deepFocusClosing) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDeepFocusClosing(false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [deepFocusClosing, deepFocusExpanded]);

  const handleDeepFocusEditorToggle = (expanded: boolean) => {
    setEditorOpen(expanded);
    if (expanded) {
      setDeepFocusClosing(false);
      setDeepFocusExpanded(true);
      return;
    }
    setDeepFocusExpanded((wasExpanded) => {
      if (wasExpanded) {
        setDeepFocusClosing(true);
      }
      return false;
    });
  };

  const backdropActive = deepFocusExpanded || deepFocusClosing;

  return (
    <>
      {backdropActive ? (
        <button
          type="button"
          className={classNames(
            'deep-focus-backdrop',
            deepFocusExpanded && 'deep-focus-backdrop--visible',
            deepFocusClosing && !deepFocusExpanded && 'deep-focus-backdrop--closing',
          )}
          aria-label="Cancel Deep Focus editing"
          disabled={deepFocusClosing && !deepFocusExpanded}
          onClick={() => handleDeepFocusEditorToggle(false)}
        />
      ) : null}
      <aside
      className={classNames(
        'panel',
        'context-pack-sidebar',
        deepFocusExpanded && 'deep-focus-sidebar--expanded',
        deepFocusClosing && 'deep-focus-sidebar--closing',
      )}
      aria-label="Context pack sidebar"
    >
      {/* ── Sticky header ──────────────────────────── */}
      <div className="sidebar-header">
        <div className="sidebar-header__left">
          <button type="button" className="sidebar-toggle" onClick={onToggleCollapse} aria-label="Collapse sidebar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <h2>Context packs</h2>
        </div>
        <div className="sidebar-header__right">
          <button
            type="button"
            className="sidebar-icon-btn"
            disabled={isBusy}
            onClick={() => void onRefreshCatalog()}
            aria-label="Refresh packs"
            title="Refresh"
          >
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="sidebar-icon-btn sidebar-icon-btn--accent"
            disabled={isBusy}
            aria-label="Create context pack"
            onClick={() => onOpenCreateModal()}
            title="Create"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      {/* ── Active state indicator ─────────────────── */}
      <div className="sidebar-active-bar" data-testid="context-pack-active-state">
        <span className={classNames('sidebar-active-bar__dot', `sidebar-active-bar__dot--${sidebarModel.activeStatusTone}`)} />
        <span className="sidebar-active-bar__label">{sidebarModel.activeLocation}</span>
      </div>

      {activePack?.statusMessage ? (
        <div className="sidebar-section sidebar-status-banner">
          <p className="sidebar-meta sidebar-meta--warn" data-testid="context-pack-status-message">
            {activePack.statusMessage}
          </p>
        </div>
      ) : null}

      {activePack?.status === 'activation-failed' && !activePack.restoreAvailable ? (
        <div className="sidebar-section sidebar-status-banner">
          <p className="sidebar-meta sidebar-meta--hint" data-testid="context-pack-recovery-hint">
            Try ejecting the active pack and re-applying, or check pack configuration.
          </p>
        </div>
      ) : null}

      {/* ── Context pack selector ──────────────────── */}
      <SidebarPackSelector
        contextPacks={contextPacks}
        selectedContextPackDir={selectedContextPackDir}
        isBusy={isBusy}
        onSelectContextPack={onSelectContextPack}
        onOpenCreateModal={onOpenCreateModal}
        repoRoot={repoRoot}
      />

      {/* ── Scrollable detail area ─────────────────── */}
      <div className="sidebar-scroll-region">
        {hasSelection ? (
          <SidebarScopeControls
            selectedPack={selectedPack}
            selectedWorkingFocusIds={selectedWorkingFocusIds}
            deepFocusEnabled={deepFocusEnabled ?? false}
            deepFocusPrimaryRepoId={deepFocusPrimaryRepoId ?? null}
            deepFocusPrimaryFocusId={deepFocusPrimaryFocusId ?? null}
            selectedFocusPath={selectedFocusPath ?? null}
            selectedFocusTargetKind={selectedFocusTargetKind ?? null}
            selectedFocusTargets={selectedFocusTargets ?? []}
            selectedTestTarget={selectedTestTarget ?? null}
            selectedSupportTargets={selectedSupportTargets ?? []}
            focusHint={sidebarModel.focusHint}
            onSelectWorkingFocus={onSelectWorkingFocus}
            onToggleRepositoryType={onToggleRepositoryType}
            onCommitDeepFocusSelection={onCommitDeepFocusSelection}
            onListRepoTree={onListRepoTree}
            onManageFocusFilters={() => setFocusFilterModalOpen(true)}
            onDeepFocusEditorToggle={handleDeepFocusEditorToggle}
            editorOpen={editorOpen}
            sidebarModel={sidebarModel}
          />
        ) : null}
      </div>

      {/* ── Sticky footer actions ──────────────────── */}
      <div className={classNames('sidebar-footer', deepFocusExpanded && 'sidebar-footer--hidden')}>
        {error ? (
          <p className="sidebar-meta sidebar-meta--error" data-testid="context-pack-error">
            {error}
          </p>
        ) : null}
        <p className="sidebar-footer__message-hidden" data-testid="context-pack-message">
          {message}
        </p>

        <div className="sidebar-actions">
          <div className="sidebar-actions__primary">
            <button
              type="button"
              className="action-button action-button--primary"
              disabled={!hasSelection || isBusy}
              onClick={() => void onApplySwitch()}
              aria-label="Apply pack"
            >
              {actionPending === 'apply' ? 'Applying\u2026' : 'Apply'}
            </button>
            <button
              type="button"
              className="action-button"
              disabled={!hasSelection || isBusy}
              onClick={() => void onPreviewSwitch()}
              aria-label="Preview pack"
            >
              {actionPending === 'preview' ? 'Previewing\u2026' : 'Preview'}
            </button>
          </div>
          <div className="sidebar-actions__toolbar">
            <button
              type="button"
              className="sidebar-toolbar-btn"
              disabled={!hasSelection || isBusy}
              onClick={() => void onReseedContextPack()}
              aria-label="Reseed pack"
              title="Re-index context pack memory"
            >
              <RefreshIcon size={13} />
              <span>{actionPending === 'reseed' ? 'Reseeding\u2026' : 'Reseed'}</span>
            </button>
            {selectedPackIsActive ? (
              <button
                type="button"
                className="sidebar-toolbar-btn"
                disabled={isBusy}
                onClick={() => void onClearActive()}
                aria-label="Clear pack"
                title="Clear active context pack"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 3L3 9h10L8 3z" fill="currentColor"/><rect x="3" y="11" width="10" height="1.5" rx="0.5" fill="currentColor"/></svg>
                <span>Eject</span>
              </button>
            ) : null}
            {selectedPackIsInactive ? (
              <button
                type="button"
                className="sidebar-toolbar-btn sidebar-toolbar-btn--danger"
                disabled={deleteDisabled}
                onClick={() => setDeleteModalOpen(true)}
                aria-label="Delete context pack"
                title={deleteTitle}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M5 4V3h6v1M3.5 5h9M5 6.5l.4 6h5.2l.4-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span>Delete</span>
              </button>
            ) : null}
            {selectedPack?.restoreAvailable ? (
              <button
                type="button"
                className="sidebar-toolbar-btn"
                disabled={!hasSelection || isBusy}
                onClick={() => void onApplySwitch()}
                aria-label={selectedPack.status === 'workspace-sync-failed' ? 'Retry sync' : 'Reconcile pack'}
                title="Restore last approved workspace layout"
                data-testid="context-pack-restore-hint"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1 1 1.8 4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M2 12.5V8.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span>{selectedPack.status === 'workspace-sync-failed' ? 'Retry' : 'Restore'}</span>
              </button>
            ) : null}
          </div>

          {/* ── Plan action (prominent, below toolbar) ─── */}
          <div className="sidebar-plan-divider">
            <button
              type="button"
              className="sidebar-plan-btn"
              disabled={!hasSelection || isBusy}
              onClick={onOpenPlannerModal}
              title="Open planner"
              data-testid="planner-open-btn"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 7h8M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              <span>Plan with Lily</span>
            </button>
          </div>
        </div>
      </div>
      {showMultiPrimaryWarning && (
        <div className="context-pack-modal__overlay" role="presentation" onClick={onDismissMultiPrimaryWarning}>
          <div className="context-pack-warning-modal" role="alertdialog" aria-modal="true" aria-label="Primary selection required" onClick={(e) => e.stopPropagation()}>
            <p className="context-pack-warning-modal__title">Primary Selection Required</p>
            <p className="context-pack-warning-modal__body">
              Select at least one Primary in your working focus before applying.
            </p>
            <button type="button" className="action-button" onClick={onDismissMultiPrimaryWarning}>
              OK
            </button>
          </div>
        </div>
      )}
      {bootstrapEmptyConfirmPending && (
        <div className="context-pack-modal__overlay" role="presentation">
          <div
            className="context-pack-warning-modal"
            role="alertdialog"
            aria-modal="true"
            aria-label="Pack needs population"
            onClick={(e) => e.stopPropagation()}
            data-testid="bootstrap-empty-confirm"
          >
            <p className="context-pack-warning-modal__title">Pack needs population</p>
            <p className="context-pack-warning-modal__body">
              {selectedPack?.packSeedStateInfo?.reason
                ? `This pack hasn't been seeded yet (${selectedPack.packSeedStateInfo.reason}). `
                : 'This pack hasn\'t been seeded yet. '}
              Activating now will hand agents an empty memory tree.
            </p>
            <div className="context-pack-warning-modal__actions">
              <button
                type="button"
                className="action-button"
                onClick={() => void onConfirmActivateAnyway()}
                data-testid="bootstrap-empty-activate-anyway"
              >
                Activate anyway
              </button>
              <button
                type="button"
                className="action-button action-button--primary"
                onClick={() => void onConfirmPopulateAndSeed()}
                data-testid="bootstrap-empty-populate-and-seed"
              >
                Populate and seed now
              </button>
            </div>
          </div>
        </div>
      )}
      <FocusFilterModal
        isOpen={focusFilterModalOpen && Boolean(selectedPack)}
        selectedPack={selectedPack}
        filters={focusFilters}
        currentSelection={{
          selectedRepoIds,
          selectedFocusIds,
          repositoryTypes: Object.fromEntries(
            (selectedPack?.focusTargets ?? [])
              .filter((target) =>
                (selectedRepoIds.includes(target.focusId) || selectedFocusIds.includes(target.focusId)) &&
                target.repositoryType,
              )
              .map((target) => [target.focusId, target.repositoryType!]),
          ),
          deepFocusEnabled: deepFocusEnabled ?? false,
          deepFocusPrimaryRepoId: deepFocusPrimaryRepoId ?? null,
          deepFocusPrimaryFocusId: deepFocusPrimaryFocusId ?? null,
          selectedFocusPath: selectedFocusPath ?? null,
          selectedFocusTargetKind: selectedFocusTargetKind ?? null,
          selectedFocusTargets: selectedFocusTargets ?? [],
          selectedTestTarget,
          selectedSupportTargets: selectedSupportTargets ?? [],
        }}
        pending={focusFilterPending}
        error={focusFilterError}
        onClose={() => setFocusFilterModalOpen(false)}
        onSave={(name) => onCreateFocusFilter?.(name) ?? Promise.resolve(false)}
        onApply={async (filterId): Promise<boolean> => {
          if (!onApplyFocusFilter) return false;
          const applied = await onApplyFocusFilter(filterId);
          if (applied) {
            // Mirror clicking the sidebar Apply button so the just-loaded
            // selection is persisted via client.applyContextPackSwitch.
            await onApplySwitch();
          }
          return applied;
        }}
        onDelete={(filterId) => onDeleteFocusFilter?.(filterId)}
      />
      <ContextPackDeleteConfirmModal
        isOpen={deleteModalOpen && Boolean(selectedPack)}
        selectedPack={selectedPack}
        repoRoot={repoRoot}
        pending={isBusy || deletePending || deleteBlockedByActiveTask}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={async () => {
          if (!selectedPack || !onDeleteContextPack || deleteBlockedByActiveTask) return;
          setDeletePending(true);
          try {
            const deleted = await onDeleteContextPack(selectedPack.contextPackDir);
            if (deleted) {
              setDeleteModalOpen(false);
              setFocusFilterModalOpen(false);
            }
          } finally {
            setDeletePending(false);
          }
        }}
      />
      </aside>
    </>
  );
}

export default ContextPackSidebarExpanded;
