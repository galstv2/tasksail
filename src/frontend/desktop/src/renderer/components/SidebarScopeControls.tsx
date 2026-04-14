import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackListRepoTreeResponse,
} from '../../shared/desktopContract';
import type { CompactSidebarModel } from '../selectors/contextPackSidebarModel';
import { classNames } from '../utils/classNames';
import { toTitleCase } from '../utils/toTitleCase';
import SidebarDeepFocusControls, { type DeepFocusCommit } from './SidebarDeepFocusControls';
import { formatRelativeTime, supportsDeepFocus } from './SidebarDeepFocusUtils';

type SidebarScopeControlsProps = {
  selectedPack: ContextPackCatalogEntry | undefined;
  selectedWorkingFocusIds: string[];
  deepFocusEnabled: boolean;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  focusHint: string | null;
  onSelectWorkingFocus: (focusId: string) => void;
  onToggleRepositoryType?: (repoId: string, currentType: 'primary' | 'support') => void;
  onCommitDeepFocusSelection: (selection: DeepFocusCommit) => void;
  onListRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<ContextPackListRepoTreeResponse | null>;
  onDeepFocusEditorToggle?: (expanded: boolean) => void;
  editorOpen?: boolean;
  sidebarModel: CompactSidebarModel;
};

function SidebarScopeControls({
  selectedPack,
  selectedWorkingFocusIds,
  deepFocusEnabled,
  selectedFocusPath,
  selectedFocusTargetKind,
  selectedTestTarget,
  selectedSupportTargets,
  focusHint,
  onSelectWorkingFocus,
  onToggleRepositoryType,
  onCommitDeepFocusSelection,
  onListRepoTree,
  onDeepFocusEditorToggle,
  editorOpen,
  sidebarModel,
}: SidebarScopeControlsProps): JSX.Element | null {
  if (!selectedPack) {
    return null;
  }

  const showDeepFocus = supportsDeepFocus(selectedPack.estateType);

  if (showDeepFocus && deepFocusEnabled) {
    return (
      <SidebarDeepFocusControls
        selectedPack={selectedPack}
        selectedWorkingFocusIds={selectedWorkingFocusIds}
        deepFocusEnabled={deepFocusEnabled}
        selectedFocusPath={selectedFocusPath}
        selectedFocusTargetKind={selectedFocusTargetKind}
        selectedTestTarget={selectedTestTarget}
        selectedSupportTargets={selectedSupportTargets}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
        onDeepFocusEditorToggle={onDeepFocusEditorToggle}
        editorOpen={editorOpen}
      />
    );
  }

  return (
    <>
      <div className="sidebar-section">
        <div className="scope-card">
          <div className="scope-card__header">
            <span className="scope-card__title">Workspace Selection</span>
            {showDeepFocus ? (
              <div className="deep-focus-toggle-row">
                <span className="deep-focus-toggle-row__label">Deep Focus Mode</span>
                <button
                  type="button"
                  className={classNames('deep-focus-toggle', deepFocusEnabled && 'deep-focus-toggle--active')}
                  aria-label="Toggle Deep Focus"
                  aria-pressed={deepFocusEnabled}
                   onClick={() => {
                     const nextFocusId = selectedWorkingFocusIds[0] ?? selectedPack.focusTargets[0]?.focusId ?? null;
                     onCommitDeepFocusSelection({
                       deepFocusEnabled: true,
                       deepFocusPrimaryRepoId: selectedPack.estateType === 'distributed-platform' ? (nextFocusId ?? null) : null,
                       deepFocusPrimaryFocusId: selectedPack.estateType === 'distributed-platform' ? null : (nextFocusId ?? null),
                       selectedFocusPath,
                       selectedFocusTargetKind,
                       selectedTestTarget,
                       selectedSupportTargets,
                     });
                   }}
                >
                  <span className="deep-focus-toggle__knob" />
                </button>
              </div>
            ) : null}
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
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
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
