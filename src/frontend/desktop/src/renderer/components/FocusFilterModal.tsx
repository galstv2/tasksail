import { useMemo, useState } from 'react';

import type {
  ContextPackCatalogEntry,
  ContextPackFocusFilter,
  ContextPackFocusFilterSelection,
} from '../../shared/desktopContract';
import {
  hasSaveableSelection,
  selectionFingerprint,
} from '../../shared/contextPackFocusFilterUtils';
import ModalShell, { ModalShellEscHint } from './ModalShell';
import { classNames } from '../utils/classNames';
import FocusSelectionSummaryCard from './FocusSelectionSummaryCard';

type FocusFilterModalProps = {
  isOpen: boolean;
  selectedPack: ContextPackCatalogEntry | undefined;
  filters: ContextPackFocusFilter[];
  currentSelection: ContextPackFocusFilterSelection;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<boolean>;
  onApply: (filterId: string) => boolean | Promise<boolean>;
  onDelete: (filterId: string) => void | Promise<void>;
};

export default function FocusFilterModal({
  isOpen,
  selectedPack,
  filters,
  currentSelection,
  pending,
  error,
  onClose,
  onSave,
  onApply,
  onDelete,
}: FocusFilterModalProps): JSX.Element {
  const [name, setName] = useState('');
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(null);
  const trimmedName = name.trim();
  const duplicateName = useMemo(() =>
    filters.some((filter) => filter.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase()),
  [filters, trimmedName]);
  const duplicateFilter = useMemo(() => {
    const currentFingerprint = selectionFingerprint(currentSelection);
    return filters.find(
      (filter) => selectionFingerprint(filter.selection) === currentFingerprint,
    ) ?? null;
  }, [filters, currentSelection]);
  const duplicateSelection = duplicateFilter !== null;
  const selectedFilter = filters.find((filter) => filter.id === selectedFilterId) ?? null;
  const hasSelectionToSave = hasSaveableSelection(currentSelection);
  const saveDisabled = pending
    || trimmedName.length === 0
    || trimmedName.length > 48
    || duplicateName
    || duplicateSelection
    || !hasSelectionToSave;
  const saveValidationMessage = duplicateName
    ? 'A filter with that name already exists.'
    : !hasSelectionToSave
      ? 'Select at least one repository, folder, or Deep Focus target before creating a filter.'
      : duplicateFilter
        ? `Already saved as “${duplicateFilter.name}”.`
        : null;
  const applyDisabled = pending || !selectedFilter;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Focus Filters"
      subtitle={selectedPack?.displayName ?? 'No context pack selected'}
      ariaLabel="Focus Filters"
      maxWidth="680px"
      footer={(
        <>
          <ModalShellEscHint />
          <button type="button" className="action-button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="action-button action-button--primary"
            onClick={() => {
              if (!selectedFilter) return;
              void Promise.resolve(onApply(selectedFilter.id)).then((ok) => {
                if (ok) onClose();
              });
            }}
            disabled={applyDisabled}
          >
            Apply filter
          </button>
        </>
      )}
    >
      <div className="focus-filter-modal">
        <section className="focus-filter-modal__section focus-filter-modal__section--save">
          <p className="focus-filter-modal__label">Create a focus filter from this selection</p>
          <FocusSelectionSummaryCard
            selectedPack={selectedPack}
            selection={currentSelection}
            title="Current workspace selection"
            flag="Not saved"
            draft
          />
          <div className="focus-filter-modal__save-row">
            <input
              type="text"
              value={name}
              maxLength={48}
              onChange={(event) => setName(event.target.value)}
              placeholder="Filter name"
              aria-label="Filter name"
            />
            <button
              type="button"
              className="action-button focus-filter-modal__save-button"
              disabled={saveDisabled}
              onClick={() => {
                // Clear the input only after a confirmed success so an IPC
                // failure does not wipe what the operator typed.
                void onSave(trimmedName).then((ok) => {
                  if (ok) setName('');
                });
              }}
            >
              Create filter
            </button>
          </div>
          {saveValidationMessage ? (
            <p className="focus-filter-modal__error">{saveValidationMessage}</p>
          ) : null}
        </section>

        <section className="focus-filter-modal__section focus-filter-modal__section--list">
          <p className="focus-filter-modal__label">Saved filters</p>
          {filters.length === 0 ? (
            <p className="focus-filter-modal__empty">No focus filters saved.</p>
          ) : (
            <div className="focus-filter-modal__list">
              {filters.map((filter) => (
                <div
                  key={filter.id}
                  className={classNames(
                    'focus-filter-modal__row',
                    selectedFilterId === filter.id && 'focus-filter-modal__row--selected',
                  )}
                  data-mode={filter.selection.deepFocusEnabled ? 'deep-focus' : 'standard'}
                >
                  <button
                    type="button"
                    className="focus-filter-modal__row-select"
                    onClick={() => setSelectedFilterId(filter.id)}
                  >
                    <FocusSelectionSummaryCard
                      selectedPack={selectedPack}
                      selection={filter.selection}
                      title={filter.name}
                      flag={filter.selection.deepFocusEnabled ? 'Deep Focus' : undefined}
                      contentOnly
                    />
                  </button>
                  <button
                    type="button"
                    className="focus-filter-modal__delete"
                    aria-label={`Delete focus filter ${filter.name}`}
                    onClick={() => {
                      void onDelete(filter.id);
                      if (selectedFilterId === filter.id) setSelectedFilterId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        {error ? <p className="focus-filter-modal__error">{error}</p> : null}
      </div>
    </ModalShell>
  );
}
