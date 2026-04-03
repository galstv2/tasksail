import { buildCompactSidebarModel } from '../selectors/contextPackSidebarModel';
import { classNames } from '../utils/classNames';
import type { ContextPackSidebarProps } from './ContextPackSidebar';
import SidebarPackSelector from './SidebarPackSelector';
import SidebarScopeControls from './SidebarScopeControls';

type ContextPackSidebarExpandedProps = Omit<ContextPackSidebarProps, 'collapsed'>;

function ContextPackSidebarExpanded({
  contextPacks,
  activeContextPackDir,
  selectedContextPackDir,
  selectedRepoIds,
  selectedFocusIds,
  actionPending,
  message,
  error,
  onToggleCollapse,
  onSelectContextPack,
  onSelectWorkingFocus,
  onRefreshCatalog,
  onOpenCreateModal,
  onReseedContextPack,
  onPreviewSwitch,
  onApplySwitch,
  onClearActive,
  showMultiPrimaryWarning,
  onDismissMultiPrimaryWarning,
  onToggleRepositoryType,
  onOpenReinforcement,
  onOpenPlannerModal,
}: ContextPackSidebarExpandedProps): JSX.Element {
  const activePack = contextPacks.find((entry) => entry.isActive);
  const selectedPack = contextPacks.find(
    (entry) => entry.contextPackDir === selectedContextPackDir,
  );
  const selectedWorkingFocusIds =
    selectedPack?.estateType === 'distributed-platform'
      ? selectedRepoIds
      : selectedFocusIds;
  const hasSelection = selectedContextPackDir.length > 0;
  const hasActiveContextPack = Boolean(activeContextPackDir);
  const isBusy = actionPending !== null;
  const sidebarModel = buildCompactSidebarModel({
    contextPacks,
    activeContextPackDir,
    selectedContextPackDir,
    selectedRepoIds,
    selectedFocusIds,
    lastResult: null,
    lastReseedResult: null,
  });

  return (
    <aside className="panel context-pack-sidebar" aria-label="Context pack sidebar">
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
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            type="button"
            className="sidebar-icon-btn sidebar-icon-btn--accent"
            disabled={isBusy}
            aria-label="Create context pack"
            onClick={onOpenCreateModal}
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
            Try clearing the active pack and re-applying, or check pack configuration.
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
      />

      {/* ── Scrollable detail area ─────────────────── */}
      <div className="sidebar-scroll-region">
        {hasSelection ? (
          <SidebarScopeControls
            selectedPack={selectedPack}
            selectedWorkingFocusIds={selectedWorkingFocusIds}
            focusHint={sidebarModel.focusHint}
            onSelectWorkingFocus={onSelectWorkingFocus}
            onToggleRepositoryType={onToggleRepositoryType}
            sidebarModel={sidebarModel}
          />
        ) : null}
      </div>

      {/* ── Sticky footer actions ──────────────────── */}
      <div className="sidebar-footer">
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
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8a5 5 0 0 1 9.5-1.5M13 8a5 5 0 0 1-9.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M12 3v3.5h-3.5M4 13v-3.5h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span>{actionPending === 'reseed' ? 'Reseeding\u2026' : 'Reseed'}</span>
            </button>
            <button
              type="button"
              className="sidebar-toolbar-btn"
              disabled={!hasActiveContextPack || isBusy}
              onClick={() => void onClearActive()}
              aria-label="Clear pack"
              title="Remove active context pack"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              <span>Clear</span>
            </button>
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
            <button
              type="button"
              className="sidebar-toolbar-btn"
              disabled={!hasActiveContextPack || isBusy}
              onClick={onOpenReinforcement}
              aria-label="Reinforcement"
              title="Review rewards and realignment"
              data-testid="reinforcement-open-btn"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1l2 4h4l-3.2 2.8L12 13 8 10.2 4 13l1.2-5.2L2 5h4l2-4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
              <span>Review</span>
            </button>
          </div>

          {/* ── Plan action (prominent, below toolbar) ─── */}
          <div className="sidebar-plan-divider">
            <button
              type="button"
              className="sidebar-plan-btn"
              disabled={!hasActiveContextPack || isBusy}
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
              Exactly one Primary must be selected in your working focus before applying.
            </p>
            <button type="button" className="action-button" onClick={onDismissMultiPrimaryWarning}>
              OK
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

export default ContextPackSidebarExpanded;
