import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

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

type TooltipPosition = { top: number; left: number; flipped: boolean };
type TooltipState = { label: string; pos: TooltipPosition };

const TOOLTIP_GAP = 8;
const TOOLTIP_VIEWPORT_PAD = 10;
const TOOLTIP_MAX_WIDTH = 260;
const TOOLTIP_ESTIMATED_HEIGHT = 32;
const TOOLTIP_HOVER_DELAY_MS = 450;

function placeTooltip(rect: DOMRect): TooltipPosition {
  const spaceBelow = window.innerHeight - rect.bottom - TOOLTIP_VIEWPORT_PAD;
  const flipped = spaceBelow < TOOLTIP_ESTIMATED_HEIGHT + TOOLTIP_GAP;
  const top = flipped
    ? rect.top - TOOLTIP_ESTIMATED_HEIGHT - TOOLTIP_GAP
    : rect.bottom + TOOLTIP_GAP;
  const idealLeft = rect.left + rect.width / 2 - TOOLTIP_MAX_WIDTH / 2;
  const left = Math.max(
    TOOLTIP_VIEWPORT_PAD,
    Math.min(idealLeft, window.innerWidth - TOOLTIP_MAX_WIDTH - TOOLTIP_VIEWPORT_PAD),
  );
  return { top, left, flipped };
}

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
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const tooltipTimerRef = useRef<number | null>(null);

  const clearTooltipTimer = useCallback(() => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTooltipTimer(), [clearTooltipTimer]);

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

  const showTooltipIfTruncated = useCallback(
    (event: MouseEvent<HTMLElement>, label: string, measureSelector?: string) => {
      const host = event.currentTarget;
      const measured = measureSelector
        ? host.querySelector<HTMLElement>(measureSelector)
        : host;
      if (!measured) return;
      if (measured.scrollWidth <= measured.clientWidth) return;
      const rect = host.getBoundingClientRect();
      clearTooltipTimer();
      tooltipTimerRef.current = window.setTimeout(() => {
        tooltipTimerRef.current = null;
        setTooltip({ label, pos: placeTooltip(rect) });
      }, TOOLTIP_HOVER_DELAY_MS);
    },
    [clearTooltipTimer],
  );

  const hideTooltip = useCallback(() => {
    clearTooltipTimer();
    setTooltip(null);
  }, [clearTooltipTimer]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: globalThis.MouseEvent): void {
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

  useEffect(() => {
    if (!dropdownOpen) {
      clearTooltipTimer();
      setTooltip(null);
    }
  }, [dropdownOpen, clearTooltipTimer]);

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

  const triggerLabel = selectedPack?.displayName;

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
            <svg className="ts-select__pack-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path d="M2 4l6-2 6 2v8l-6 2-6-2V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M8 6v8M2 4l6 2 6-2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span
              className="ts-select__value"
              onMouseEnter={triggerLabel ? (event) => showTooltipIfTruncated(event, triggerLabel) : undefined}
              onMouseLeave={triggerLabel ? hideTooltip : undefined}
            >
              {triggerLabel ?? 'Select a pack'}
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
          <svg className={classNames('ts-select__chevron', dropdownOpen && 'ts-select__chevron--open')} width="11" height="11" viewBox="0 0 16 16" fill="none">
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
                  onMouseEnter={(event) => showTooltipIfTruncated(event, entry.displayName, '.ts-select__option-name')}
                  onMouseLeave={hideTooltip}
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
      {tooltip
        ? createPortal(
            <span
              className={classNames('ts-tooltip', tooltip.pos.flipped && 'ts-tooltip--above')}
              style={{
                top: tooltip.pos.top,
                left: tooltip.pos.left,
                maxWidth: TOOLTIP_MAX_WIDTH,
              }}
              role="tooltip"
            >
              {tooltip.label}
            </span>,
            document.body,
          )
        : null}
    </div>
  );
}

export default SidebarPackSelector;
