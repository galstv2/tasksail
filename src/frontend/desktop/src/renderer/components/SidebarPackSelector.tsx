import { useCallback, useEffect, useRef, useState } from 'react';

import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import {
  formatRuntimeStatus,
  mapRuntimeStatusTone,
} from '../selectors/contextPackSidebarModel';
import { classNames } from '../utils/classNames';

type SidebarPackSelectorProps = {
  contextPacks: ContextPackCatalogEntry[];
  selectedContextPackDir: string;
  isBusy: boolean;
  onSelectContextPack: (contextPackDir: string) => void;
  onOpenCreateModal: () => void;
};

function statusToneClass(entry: ContextPackCatalogEntry): string {
  if (entry.isActive) return `ts-select__status--${mapRuntimeStatusTone(entry.status)}`;
  if (entry.bootstrapReady) return 'ts-select__status--completed';
  return 'ts-select__status--blocked';
}

function SidebarPackSelector({
  contextPacks,
  selectedContextPackDir,
  isBusy,
  onSelectContextPack,
  onOpenCreateModal,
}: SidebarPackSelectorProps): JSX.Element {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedPack = contextPacks.find(
    (entry) => entry.contextPackDir === selectedContextPackDir,
  );

  const toggleDropdown = useCallback(() => setDropdownOpen((o) => !o), []);

  const selectPack = useCallback(
    (dir: string) => {
      onSelectContextPack(dir);
      setDropdownOpen(false);
    },
    [onSelectContextPack],
  );

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [dropdownOpen]);

  if (contextPacks.length === 0) {
    return (
      <div className="sidebar-section sidebar-pack-selector">
        <div className="sidebar-empty">
          <p className="sidebar-meta">No context packs discovered yet.</p>
          <button
            type="button"
            className="action-button"
            disabled={isBusy}
            aria-label="Create context pack"
            onClick={onOpenCreateModal}
          >
            Create context pack
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-section sidebar-pack-selector">
      <div className="ts-select" ref={dropdownRef} data-open={dropdownOpen || undefined}>
        <button
          type="button"
          className="ts-select__trigger"
          onClick={toggleDropdown}
          aria-haspopup="listbox"
          aria-expanded={dropdownOpen}
          aria-label="Select context pack"
        >
          <span className="ts-select__trigger-content">
            <svg className="ts-select__pack-icon" width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 4l6-2 6 2v8l-6 2-6-2V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M8 6v8M2 4l6 2 6-2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span className="ts-select__value">
              {selectedPack?.displayName ?? 'Select a pack'}
            </span>
            {selectedPack && (
              <span className={classNames('ts-select__status', statusToneClass(selectedPack))}>
                {selectedPack.isActive
                  ? formatRuntimeStatus(selectedPack.status)
                  : selectedPack.bootstrapReady
                    ? 'ready'
                    : 'incomplete'}
              </span>
            )}
          </span>
          <svg className={classNames('ts-select__chevron', dropdownOpen && 'ts-select__chevron--open')} width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {dropdownOpen && (
          <div className="ts-select__menu" role="listbox" aria-label="Context packs">
            {contextPacks.map((entry) => {
              const isSelected = entry.contextPackDir === selectedContextPackDir;
              const statusLabel = entry.isActive
                ? formatRuntimeStatus(entry.status)
                : entry.bootstrapReady
                  ? 'ready'
                  : 'incomplete';
              return (
                <button
                  key={entry.contextPackDir}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={classNames('ts-select__option', isSelected && 'ts-select__option--selected')}
                  onClick={() => selectPack(entry.contextPackDir)}
                >
                  <span className="ts-select__option-name">{entry.displayName}</span>
                  <span className={classNames('ts-select__status', statusToneClass(entry))}>
                    {statusLabel}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SidebarPackSelector;
