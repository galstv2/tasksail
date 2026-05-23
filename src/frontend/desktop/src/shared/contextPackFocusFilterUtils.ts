import type { ContextPackFocusFilterSelection } from './desktopContract';

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

export function selectionFingerprint(selection: ContextPackFocusFilterSelection): string {
  return JSON.stringify(normalizeSelectionValue(selection));
}

export function hasSaveableSelection(selection: ContextPackFocusFilterSelection): boolean {
  if (selection.deepFocusEnabled) {
    return selection.selectedFocusTargets.length > 0
      || Boolean(selection.deepFocusPrimaryRepoId)
      || Boolean(selection.deepFocusPrimaryFocusId)
      || Boolean(selection.selectedTestTarget)
      || selection.selectedSupportTargets.length > 0;
  }
  return selection.selectedRepoIds.length > 0 || selection.selectedFocusIds.length > 0;
}
