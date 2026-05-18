import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackListRepoTreeResponse,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import type { CompactSidebarModel } from '../selectors/contextPackSidebarModel';
import { classNames } from '../utils/classNames';
import { DeepFocusInfoTip } from './DeepFocusInfoTip';
import { toTitleCase } from '../utils/toTitleCase';
import SidebarDeepFocusControls, { type DeepFocusCommit } from './SidebarDeepFocusControls';
import { formatRelativeTime, supportsDeepFocus } from './SidebarDeepFocusUtils';

type SidebarScopeControlsProps = {
  selectedPack: ContextPackCatalogEntry | undefined;
  selectedWorkingFocusIds: string[];
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
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
  onManageFocusFilters?: () => void;
  onDeepFocusEditorToggle?: (expanded: boolean) => void;
  editorOpen?: boolean;
  sidebarModel: CompactSidebarModel;
};

function SidebarScopeControls({
  selectedPack,
  selectedWorkingFocusIds,
  deepFocusEnabled,
  deepFocusPrimaryRepoId,
  deepFocusPrimaryFocusId,
  selectedFocusPath,
  selectedFocusTargetKind,
  selectedFocusTargets,
  selectedTestTarget,
  selectedSupportTargets,
  focusHint,
  onSelectWorkingFocus,
  onToggleRepositoryType,
  onCommitDeepFocusSelection,
  onListRepoTree,
  onManageFocusFilters,
  onDeepFocusEditorToggle,
  editorOpen,
  sidebarModel,
}: SidebarScopeControlsProps): JSX.Element | null {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSearchQuery('');
  }, [selectedPack?.contextPackDir]);

  const filteredFocusTargets = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!selectedPack || !query) {
      return selectedPack?.focusTargets ?? [];
    }
    return selectedPack.focusTargets.filter((target) => [
      target.displayName,
      target.focusId,
      target.repoId,
      target.serviceName,
      target.relativePath,
      target.systemLayer,
      target.repoRole,
      target.focusType,
      target.group,
    ].some((value) => (value ?? '').toLocaleLowerCase().includes(query)));
  }, [searchQuery, selectedPack]);

  if (!selectedPack) {
    return null;
  }

  const showDeepFocus = supportsDeepFocus(selectedPack.estateType);

  if (showDeepFocus && deepFocusEnabled) {
    // Deep Focus scope is independent from the regular workspace primary.
    // Seed the editor only from the persisted Deep Focus scalar; multi-primary
    // IDs are derived from selectedFocusTargets inside SidebarDeepFocusControls.
    const fallbackScalarId = selectedPack.estateType === 'distributed-platform'
      ? deepFocusPrimaryRepoId
      : deepFocusPrimaryFocusId;
    const hasDeepFocusScope = selectedFocusPath !== null
      || selectedFocusTargetKind !== null
      || (selectedFocusTargets ?? []).length > 0;
    const deepFocusWorkingFocusIds = fallbackScalarId
      ? [fallbackScalarId]
      : hasDeepFocusScope
        ? selectedWorkingFocusIds
        : [];

    return (
      <SidebarDeepFocusControls
        selectedPack={selectedPack}
        selectedWorkingFocusIds={deepFocusWorkingFocusIds}
        deepFocusPrimaryId={fallbackScalarId}
        deepFocusEnabled={deepFocusEnabled}
        selectedFocusPath={selectedFocusPath}
        selectedFocusTargetKind={selectedFocusTargetKind}
        selectedFocusTargets={selectedFocusTargets}
        selectedTestTarget={selectedTestTarget}
        selectedSupportTargets={selectedSupportTargets}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
        onManageFocusFilters={onManageFocusFilters}
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
            <div className="scope-card__header-top">
              <span className="scope-card__title">Workspace Selection</span>
              <button
                type="button"
                className="sidebar-icon-btn"
                aria-label="Manage focus filters"
                title="Manage focus filters"
                onClick={onManageFocusFilters}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {showDeepFocus ? (
              <div className="deep-focus-toggle-row">
                <span className="deep-focus-toggle-row__label">Deep Focus Mode</span>
                <DeepFocusInfoTip />
                <button
                  type="button"
                  className={classNames('deep-focus-toggle', deepFocusEnabled && 'deep-focus-toggle--active')}
                  aria-label="Toggle Deep Focus"
                  aria-pressed={deepFocusEnabled}
                  onClick={() => {
                    const isDistributed = selectedPack.estateType === 'distributed-platform';
                    // Restore only the saved Deep Focus primary; regular-mode focus is independent.
                    const savedPrimary = isDistributed ? deepFocusPrimaryRepoId : deepFocusPrimaryFocusId;
                    onCommitDeepFocusSelection({
                      deepFocusEnabled: true,
                      deepFocusPrimaryRepoId: isDistributed ? savedPrimary : null,
                      deepFocusPrimaryFocusId: isDistributed ? null : savedPrimary,
                      selectedFocusPath,
                      selectedFocusTargetKind,
                      selectedFocusTargets: selectedFocusTargets ?? [],
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
            <div className="scope-card__search-row">
              <div className="deep-focus-search">
                <svg className="deep-focus-search__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                  <path d="M10.3 10.3 13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="deep-focus-search__input"
                  placeholder={selectedPack.estateType === 'distributed-platform' ? 'Search repositories' : 'Search folders'}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  aria-label={selectedPack.estateType === 'distributed-platform' ? 'Search repositories' : 'Search folders'}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="deep-focus-search__clear"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {selectedPack.focusTargets.length ? (
            <div className="scope-card__focus">
              <span className="scope-card__subtitle">
                {selectedPack.estateType === 'distributed-platform' ? 'Repositories' : 'Folders'}
              </span>
              <div className="scope-focus-list" aria-label="Working focus">
                {filteredFocusTargets.map((target) => {
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
              {filteredFocusTargets.length === 0 ? (
                <div className="scope-card__empty-row">
                  {selectedPack.estateType === 'distributed-platform'
                    ? 'No repositories match.'
                    : 'No folders match.'}
                </div>
              ) : null}
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
