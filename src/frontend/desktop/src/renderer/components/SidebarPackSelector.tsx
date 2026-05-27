import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

import type { ContextPackCatalogEntry } from '../../shared/desktopContract';
import type { OpenContextPackCreationModal } from '../contextPackCreationTypes';
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
  onOpenCreateModal: OpenContextPackCreationModal;
  repoRoot?: string;
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
  repoRoot,
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
    const canUseRepo = Boolean(repoRoot?.trim());
    return (
      <div className="sidebar-section sidebar-pack-selector">
        <div className="sidebar-empty sidebar-empty--onboarding">
          <p className="sidebar-meta">No context packs discovered yet.</p>
          <p className="sidebar-meta">
            Context packs bind this workspace to the repositories, focus areas,
            and QMD state an agent should use.
          </p>
          <button
            type="button"
            className="action-button"
            disabled={isBusy}
            aria-label="Create Context Pack"
            onClick={() => onOpenCreateModal({ kind: 'fresh' })}
          >
            Create your first pack
          </button>
          <button
            type="button"
            className="action-button action-button--secondary"
            disabled={isBusy || !canUseRepo}
            title={canUseRepo ? 'Use the current repository as the discovery root' : 'No repository root is available'}
            onClick={() => {
              if (repoRoot) {
                onOpenCreateModal({ kind: 'prefill-from-repo', repoRoot });
              }
            }}
          >
            Use this repository
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
              const isBootstrapEmpty = entry.packSeedStateInfo?.state === 'bootstrap-empty';
              const isReseeding = entry.packSeedStateInfo?.inProgress === true;
              const isNeedsReview =
                isBootstrapEmpty && entry.packSeedStateInfo?.reason === 'new-flow-needs-review';
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
                  {/* Reseeding wins over bootstrap-empty: an in-progress reseed is the more recent state. */}
                  {isReseeding ? (
                    <span className="ts-select__status ts-select__status--warning" title="This pack is currently being reseeded.">
                      Reseeding...
                    </span>
                  ) : isBootstrapEmpty && (
                    <span
                      className="ts-select__status ts-select__status--warning"
                      title={
                        isNeedsReview
                          ? 'Review the generated plan before seeding this pack.'
                          : "This pack hasn't been seeded yet. Populate the underlying repos and run a reseed."
                      }
                    >
                      {isNeedsReview ? 'needs review' : 'needs population'}
                    </span>
                  )}
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
