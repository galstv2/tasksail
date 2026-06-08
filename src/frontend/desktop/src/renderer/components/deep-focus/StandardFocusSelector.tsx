import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
} from '../../../shared/desktopContract';
import type { CompactSidebarModel } from '../../selectors/contextPackSidebarModel';
import { isDistributedEstateMode } from '../../contextPack/contextPackModeUtils';
import { classNames } from '../../utils/classNames';
import { toTitleCase } from '../../utils/toTitleCase';
import { DeepFocusInfoTip } from './DeepFocusInfoTip';
import { FocusFiltersIcon } from './FocusFiltersIcon';
import type { DeepFocusCommit } from './SidebarDeepFocusControls.types';
import { formatRelativeTime } from './SidebarDeepFocusUtils';

export type StandardFocusSelectorProps = {
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
  sidebarModel: CompactSidebarModel;
  supportsDeepFocus: boolean;
  onSelectWorkingFocus: (focusId: string) => void;
  onToggleRepositoryType?: (repoId: string, currentType: 'primary' | 'support') => void;
  onCommitDeepFocusSelection: (selection: DeepFocusCommit) => void;
  onManageFocusFilters?: () => void;
  showFocusFilterButton?: boolean;
};

function StandardFocusSelector({
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
  sidebarModel,
  supportsDeepFocus,
  onSelectWorkingFocus,
  onToggleRepositoryType,
  onCommitDeepFocusSelection,
  onManageFocusFilters,
  showFocusFilterButton = true,
}: StandardFocusSelectorProps): JSX.Element | null {
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

  const isDistributed = isDistributedEstateMode(selectedPack.estateType);

  return (
    <>
      <div className="sidebar-section">
        <div className="scope-card">
          <div className="scope-card__header">
            <div className="scope-card__header-top">
              <span className="scope-card__title">Workspace Selection</span>
              {showFocusFilterButton ? (
                <button
                  type="button"
                  className="sidebar-icon-btn"
                  aria-label="Manage focus filters"
                  title="Manage focus filters"
                  onClick={onManageFocusFilters}
                >
                  <FocusFiltersIcon />
                </button>
              ) : null}
            </div>
            {supportsDeepFocus ? (
              <div className="deep-focus-toggle-row">
                <span className="deep-focus-toggle-row__label">Deep Focus Mode</span>
                <DeepFocusInfoTip />
                <button
                  type="button"
                  className={classNames('deep-focus-toggle', deepFocusEnabled && 'deep-focus-toggle--active')}
                  aria-label="Toggle Deep Focus"
                  aria-pressed={deepFocusEnabled}
                  onClick={() => {
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
                  placeholder={isDistributed ? 'Search repositories' : 'Search folders'}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  aria-label={isDistributed ? 'Search repositories' : 'Search folders'}
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
                {isDistributed ? 'Repositories' : 'Folders'}
              </span>
              <div className="scope-focus-list" aria-label="Working focus">
                {filteredFocusTargets.map((target) => {
                  const inputId = `working-focus-${target.focusId}`;
                  const isChecked = selectedWorkingFocusIds.includes(target.focusId);
                  const focusRowTitle = target.relativePath
                    ? `${target.displayName} — ${target.relativePath}`
                    : target.displayName;
                  const showRelativePath = !isDistributed && !!target.relativePath;
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
                  {isDistributed
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

export default StandardFocusSelector;
