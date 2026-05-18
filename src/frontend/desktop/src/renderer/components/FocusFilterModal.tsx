import { useMemo, useState } from 'react';

import type {
  ContextPackCatalogEntry,
  ContextPackFocusFilter,
  ContextPackFocusFilterSelection,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import ModalShell, { ModalShellEscHint } from './ModalShell';
import { classNames } from '../utils/classNames';

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

type NormalizedSelectionValue =
  | string
  | number
  | boolean
  | null
  | NormalizedSelectionValue[]
  | { [key: string]: NormalizedSelectionValue };

function normalizeSelectionValue(value: unknown): NormalizedSelectionValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSelectionValue(item))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeSelectionValue(entryValue)]),
    );
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return null;
}

function selectionFingerprint(selection: ContextPackFocusFilterSelection): string {
  return JSON.stringify(normalizeSelectionValue(selection));
}

function basenameOf(path: string | null | undefined): string {
  if (!path) return 'Not set';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function targetLabel(
  selectedPack: ContextPackCatalogEntry | undefined,
  id: string | null | undefined,
): string {
  if (!id) return 'Not set';
  const target = selectedPack?.focusTargets.find((entry) =>
    entry.focusId === id || entry.repoId === id);
  return target?.displayName || id;
}

function primaryTargetLabel(
  target: ContextPackPrimaryFocusTarget,
  selectedPack: ContextPackCatalogEntry | undefined,
): string {
  if (target.repoId || target.focusId) {
    const resolved = targetLabel(selectedPack, target.repoId ?? target.focusId);
    if (resolved !== 'Not set') return resolved;
  }
  return basenameOf(target.path);
}

function summarizeValues(values: string[]): string {
  const visible = values.filter(Boolean);
  if (visible.length === 0) return 'None';
  if (visible.length <= 2) return visible.join(', ');
  return `${visible[0]}, ${visible[1]} +${visible.length - 2}`;
}

function standardFilterGroups(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): Array<{ label: string; value: string; tone: 'primary' | 'support' }> {
  const ids = selectedPack?.estateType === 'distributed-platform'
    ? selection.selectedRepoIds
    : selection.selectedFocusIds;
  const grouped = ids.reduce<{ primary: string[]; support: string[] }>((acc, id) => {
    const target = selectedPack?.focusTargets.find((entry) => entry.focusId === id || entry.repoId === id);
    const role = selection.repositoryTypes?.[id] ?? target?.repositoryType ?? 'primary';
    const bucket = role === 'support' ? acc.support : acc.primary;
    bucket.push(target?.displayName || id);
    return acc;
  }, { primary: [], support: [] });

  return [
    { label: 'Primary', value: summarizeValues(grouped.primary), tone: 'primary' },
    { label: 'Support', value: summarizeValues(grouped.support), tone: 'support' },
  ];
}

function deepFocusFilterGroups(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): Array<{ label: string; value: string; tone: 'primary' | 'test' | 'support' }> {
  const primaryValues = selection.selectedFocusTargets.length > 0
    ? selection.selectedFocusTargets.map((target) => primaryTargetLabel(target, selectedPack))
    : [targetLabel(selectedPack, selection.deepFocusPrimaryRepoId ?? selection.deepFocusPrimaryFocusId)];
  const scopedTestValues = selection.selectedFocusTargets
    .filter((target) => Boolean(target.testTarget))
    .map((target) => `${primaryTargetLabel(target, selectedPack)}: ${basenameOf(target.testTarget?.path)}`);
  const scopedSupportValues = selection.selectedFocusTargets.flatMap((target) =>
    (target.supportTargets ?? []).map((support) =>
      `${primaryTargetLabel(target, selectedPack)}: ${basenameOf(support.path)}`));
  const testValues = [
    ...(selection.selectedTestTarget ? [`Global: ${basenameOf(selection.selectedTestTarget.path)}`] : []),
    ...scopedTestValues,
  ];
  const supportValues = [
    ...selection.selectedSupportTargets.map((target) => `Global: ${basenameOf(target.path)}`),
    ...scopedSupportValues,
  ];

  return [
    { label: 'Primary', value: summarizeValues(primaryValues), tone: 'primary' },
    { label: 'Test', value: summarizeValues(testValues), tone: 'test' },
    { label: 'Support', value: summarizeValues(supportValues), tone: 'support' },
  ];
}

function filterDetailGroups(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): Array<{ label: string; value: string; tone: 'primary' | 'support' | 'test' }> {
  return selection.deepFocusEnabled
    ? deepFocusFilterGroups(selection, selectedPack)
    : standardFilterGroups(selection, selectedPack);
}

function selectionSummary(
  selection: ContextPackFocusFilterSelection,
  selectedPack: ContextPackCatalogEntry | undefined,
): string {
  if (selection.deepFocusEnabled) {
    const primary = selection.selectedFocusTargets.length
      || selection.deepFocusPrimaryRepoId
      || selection.deepFocusPrimaryFocusId
      ? 'Primary set'
      : 'Primary —';
    const test = selection.selectedTestTarget ? 'Test set' : 'Test —';
    const supportCount = selection.selectedSupportTargets.length;
    return `Deep Focus · ${primary} · ${test} · Support ${supportCount}`;
  }
  const noun = selectedPack?.estateType === 'distributed-platform' ? 'repositories' : 'folders';
  const count = selectedPack?.estateType === 'distributed-platform'
    ? selection.selectedRepoIds.length
    : selection.selectedFocusIds.length;
  return `Regular · ${count} ${noun}`;
}

function hasSaveableSelection(selection: ContextPackFocusFilterSelection): boolean {
  if (selection.deepFocusEnabled) {
    return selection.selectedFocusTargets.length > 0
      || Boolean(selection.deepFocusPrimaryRepoId)
      || Boolean(selection.deepFocusPrimaryFocusId)
      || Boolean(selection.selectedTestTarget)
      || selection.selectedSupportTargets.length > 0;
  }
  return selection.selectedRepoIds.length > 0 || selection.selectedFocusIds.length > 0;
}

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
  const currentFingerprint = selectionFingerprint(currentSelection);
  const duplicateFilter = filters.find(
    (filter) => selectionFingerprint(filter.selection) === currentFingerprint,
  ) ?? null;
  const duplicateSelection = duplicateFilter !== null;
  const selectedFilter = filters.find((filter) => filter.id === selectedFilterId) ?? null;
  const saveDisabled = pending
    || trimmedName.length === 0
    || trimmedName.length > 48
    || duplicateName
    || duplicateSelection
    || !hasSaveableSelection(currentSelection);
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
          <p className="focus-filter-modal__label">Save current selection</p>
          <p className="focus-filter-modal__summary">
            {selectionSummary(currentSelection, selectedPack)}
          </p>
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
              Save
            </button>
          </div>
          {duplicateName ? (
            <p className="focus-filter-modal__error">A filter with that name already exists.</p>
          ) : duplicateFilter ? (
            <p className="focus-filter-modal__error">{`Already saved as “${duplicateFilter.name}”.`}</p>
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
                    <span className="focus-filter-modal__row-header">
                      <span className="focus-filter-modal__row-name">{filter.name}</span>
                      {filter.selection.deepFocusEnabled ? (
                        <span className="focus-filter-modal__row-flag">Deep Focus</span>
                      ) : null}
                    </span>
                    <span className="focus-filter-modal__row-details">
                      {filterDetailGroups(filter.selection, selectedPack).map((group) => {
                        const isEmpty = group.value === 'None';
                        return (
                          <span
                            key={`${group.label}:${group.value}`}
                            className={classNames(
                              'focus-filter-modal__row-detail',
                              `focus-filter-modal__row-detail--${group.tone}`,
                              isEmpty && 'focus-filter-modal__row-detail--empty',
                            )}
                          >
                            <span className="focus-filter-modal__row-detail-label">{group.label}</span>
                            <span className="focus-filter-modal__row-detail-value">
                              {isEmpty ? '—' : group.value}
                            </span>
                          </span>
                        );
                      })}
                    </span>
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
