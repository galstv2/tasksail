import { classNames } from '../utils/classNames';
import type { ContextPackSidebarProps } from './ContextPackSidebar';
import { RefreshIcon } from './creation-steps/icons';

type ContextPackSidebarCompactProps = Pick<
  ContextPackSidebarProps,
  | 'contextPacks'
  | 'activeContextPackDir'
  | 'selectedContextPackDir'
  | 'actionPending'
  | 'onToggleCollapse'
  | 'onSelectContextPack'
  | 'onRefreshCatalog'
  | 'onOpenCreateModal'
  | 'onReseedContextPack'
  | 'onPreviewSwitch'
  | 'onApplySwitch'
  | 'onClearActive'
  | 'onOpenPlannerModal'
>;

function ContextPackSidebarCompact({
  contextPacks,
  activeContextPackDir,
  selectedContextPackDir,
  actionPending,
  onToggleCollapse,
  onSelectContextPack,
  onRefreshCatalog,
  onOpenCreateModal,
  onReseedContextPack,
  onPreviewSwitch,
  onApplySwitch,
  onClearActive,
  onOpenPlannerModal,
}: ContextPackSidebarCompactProps): JSX.Element {
  const hasSelection = selectedContextPackDir.length > 0;
  const hasActiveContextPack = Boolean(activeContextPackDir);
  const isBusy = actionPending !== null;

  return (
    <aside className="panel context-pack-sidebar context-pack-sidebar--collapsed" aria-label="Context pack sidebar">
      <nav className="sidebar-icons" aria-label="Context pack actions">
        <button type="button" className="sidebar-icon-btn" onClick={onToggleCollapse} aria-label="Expand sidebar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
        <div
          className={classNames(
            'sidebar-status-indicator',
            hasActiveContextPack
              ? 'sidebar-status-indicator--active'
              : 'sidebar-status-indicator--inactive',
          )}
          aria-label={
            hasActiveContextPack
              ? 'Context pack active'
              : 'No active context pack'
          }
          title={
            hasActiveContextPack
              ? 'Context pack active'
              : 'No active context pack'
          }
        >
          <span aria-hidden="true">{hasActiveContextPack ? '✓' : '!'}</span>
        </div>
        {contextPacks.map((pack) => (
          <button
            key={pack.contextPackDir}
            type="button"
            className={classNames('sidebar-icon-btn', pack.isActive && 'sidebar-icon--active')}
            onClick={() => onSelectContextPack(pack.contextPackDir)}
            aria-label={pack.displayName}
            title={pack.displayName}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4l6-2 6 2v8l-6 2-6-2V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M8 6v8M2 4l6 2 6-2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
          </button>
        ))}
        <div className="sidebar-icons__divider" />
        <button type="button" className="sidebar-icon-btn" onClick={() => void onRefreshCatalog()} aria-label="Refresh packs" title="Refresh">
          <RefreshIcon />
        </button>
        <button type="button" className="sidebar-icon-btn" onClick={onOpenCreateModal} aria-label="Create pack" title="Create">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </nav>

      <div className="sidebar-collapsed-footer" aria-label="Collapsed context pack controls">
        <button
          type="button"
          className="sidebar-collapsed-action sidebar-collapsed-action--primary"
          disabled={!hasSelection || isBusy}
          onClick={() => void onApplySwitch()}
          aria-label="Apply pack"
          title="Apply"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button
          type="button"
          className="sidebar-collapsed-action"
          disabled={!hasSelection || isBusy}
          onClick={() => void onPreviewSwitch()}
          aria-label="Preview pack"
          title="Preview"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><circle cx="8" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.4"/></svg>
        </button>
        <button
          type="button"
          className="sidebar-collapsed-action"
          disabled={!hasSelection || isBusy}
          onClick={() => void onReseedContextPack()}
          aria-label="Reseed pack"
          title="Reseed"
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="sidebar-collapsed-action"
          disabled={!hasActiveContextPack || isBusy}
          onClick={() => void onClearActive()}
          aria-label="Clear pack"
          title="Clear"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
        <button
          type="button"
          className="sidebar-collapsed-action"
          disabled={!hasActiveContextPack || isBusy}
          onClick={onOpenPlannerModal}
          aria-label="Plan"
          title="Plan"
          data-testid="planner-open-btn"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 7h8M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      </div>
    </aside>
  );
}

export default ContextPackSidebarCompact;
