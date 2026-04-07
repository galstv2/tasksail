import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';
import { toTitleCase } from '../utils/toTitleCase';
import type { CompactSidebarModel } from '../selectors/contextPackSidebarModel';

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type SidebarScopeControlsProps = {
  selectedPack: ContextPackCatalogEntry | undefined;
  selectedWorkingFocusIds: string[];
  focusHint: string | null;
  onSelectWorkingFocus: (focusId: string) => void;
  onToggleRepositoryType?: (repoId: string, currentType: 'primary' | 'support') => void;
  sidebarModel: CompactSidebarModel;
};

function SidebarScopeControls({
  selectedPack,
  selectedWorkingFocusIds,
  focusHint,
  onSelectWorkingFocus,
  onToggleRepositoryType,
  sidebarModel,
}: SidebarScopeControlsProps): JSX.Element | null {
  if (!selectedPack) {
    return null;
  }

  return (
    <>
      <div className="sidebar-section">
        <div className="scope-card">
          <div className="scope-card__header">
            <span className="scope-card__title">Workspace Focus</span>
          </div>

          {selectedPack.focusTargets.length ? (
            <div className="scope-card__focus">
              <span className="scope-card__subtitle">
                {selectedPack.estateType === 'distributed-platform' ? 'Repositories' : 'Folders'}
              </span>
              <div className="scope-focus-list" aria-label="Working focus">
                {selectedPack.focusTargets.map((target) => {
                  const inputId = `working-focus-${target.focusId}`;
                  const isChecked = selectedWorkingFocusIds.includes(target.focusId);
                  const focusRowTitle = target.relativePath
                    ? `${target.displayName} — ${target.relativePath}`
                    : target.displayName;
                  const showRelativePath =
                    selectedPack.estateType !== 'distributed-platform' && !!target.relativePath;
                  return (
                    <label
                      key={target.focusId}
                      htmlFor={inputId}
                      className={classNames('scope-focus-row', isChecked && 'scope-focus-row--checked')}
                      title={focusRowTitle}
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onSelectWorkingFocus(target.focusId)}
                      />
                      <span className="scope-focus-row__name">{target.displayName}</span>
                      {showRelativePath ? (
                        <span className="scope-focus-row__path" title={target.relativePath ?? undefined}>
                          {target.relativePath}
                        </span>
                      ) : null}
                      {(target.repositoryType || target.systemLayer) ? (
                        <span className="scope-focus-row__badges">
                          {target.repositoryType ? (
                            <button
                              type="button"
                              className={classNames(
                                'scope-focus-row__type',
                                target.repositoryType === 'primary' && 'scope-focus-row__type--primary',
                                onToggleRepositoryType && 'scope-focus-row__type--clickable',
                              )}
                              title={`Click to change to ${target.repositoryType === 'primary' ? 'Support' : 'Primary'}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onToggleRepositoryType?.(target.focusId, target.repositoryType!);
                              }}
                            >
                              {target.repositoryType === 'primary' ? 'Primary' : 'Support'}
                            </button>
                          ) : null}
                          {target.systemLayer ? (
                            <span className="scope-focus-row__layer">{toTitleCase(target.systemLayer)}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
              {focusHint ? (
                <span className="sidebar-meta scope-card__hint">{focusHint}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Selection detail */}
      <div className="sidebar-section sidebar-selection-detail" data-testid="context-pack-selection-summary">
        {sidebarModel.selectedPackSummary.length > 0 ? (
          <div className="sidebar-detail-row" aria-label="Selected context pack summary">
            {sidebarModel.selectedPackSummary.map((chip) => (
              <span key={chip.label} className="sidebar-detail-tag">
                {chip.label}
              </span>
            ))}
          </div>
        ) : null}
        {sidebarModel.selectedWorkingFocusSummary ? (
          <p className="sidebar-meta">Focus: {sidebarModel.selectedWorkingFocusSummary}</p>
        ) : null}
        {selectedPack.lastSyncedAt ? (
          <p className="sidebar-meta" title={selectedPack.lastSyncedAt}>
            Synced {formatRelativeTime(selectedPack.lastSyncedAt)}
          </p>
        ) : null}
      </div>
    </>
  );
}

export default SidebarScopeControls;
