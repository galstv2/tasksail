import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusFilterSelection,
  ContextPackFocusFilterRepositoryType,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
  PlannerChildTaskExecutionScope,
  PlannerFocusSnapshot,
  PlannerLilyPlanningReloadScope,
} from '../shared/desktopContract';
import type { CompactSidebarModel } from './selectors/contextPackSidebarModel';
import { buildCompactSidebarModel, buildFocusHint, formatFocusLabel } from './selectors/contextPackSidebarModel';

const CHILD_SCOPE_DELTA_LIMIT = 2;
export const CHILD_SCOPE_PRIMARY_REQUIRED_TITLE = 'Primary Selection Required';
export const CHILD_SCOPE_PRIMARY_REQUIRED_BODY = 'Select at least one Primary in your working focus before applying.';
export const CHILD_SCOPE_PRIMARY_REQUIRED_MESSAGE = `${CHILD_SCOPE_PRIMARY_REQUIRED_TITLE}\n${CHILD_SCOPE_PRIMARY_REQUIRED_BODY}`;

export function childScopeFromFocusSnapshot(
  snapshot: PlannerFocusSnapshot,
): PlannerChildTaskExecutionScope {
  const binding = snapshot.contextPackBinding;
  return {
    contextPackDir: binding.contextPackDir,
    contextPackId: binding.contextPackId,
    scopeMode: binding.scopeMode,
    selectedRepoIds: [...binding.selectedRepoIds],
    selectedFocusIds: [...binding.selectedFocusIds],
    repositoryTypes: standardRepositoryTypesFromBinding(binding, snapshot),
    deepFocusEnabled: binding.deepFocusEnabled,
    deepFocusPrimaryRepoId: binding.deepFocusPrimaryRepoId ?? null,
    deepFocusPrimaryFocusId: binding.deepFocusPrimaryFocusId ?? null,
    selectedFocusPath: binding.selectedFocusPath ?? null,
    selectedFocusTargetKind: binding.selectedFocusTargetKind ?? null,
    selectedFocusTargets: (binding.selectedFocusTargets ?? []).map(clonePrimaryTarget),
    selectedTestTarget: binding.selectedTestTarget ? cloneDeepTarget(binding.selectedTestTarget) : null,
    selectedSupportTargets: (binding.selectedSupportTargets ?? []).map(cloneDeepTarget),
  };
}

export function cloneChildScope(
  scope: PlannerChildTaskExecutionScope,
): PlannerChildTaskExecutionScope {
  return {
    ...scope,
    selectedRepoIds: [...scope.selectedRepoIds],
    selectedFocusIds: [...scope.selectedFocusIds],
    repositoryTypes: scope.repositoryTypes ? { ...scope.repositoryTypes } : undefined,
    selectedFocusTargets: scope.selectedFocusTargets.map(clonePrimaryTarget),
    selectedTestTarget: scope.selectedTestTarget ? cloneDeepTarget(scope.selectedTestTarget) : null,
    selectedSupportTargets: scope.selectedSupportTargets.map(cloneDeepTarget),
  };
}

export function childScopeToFocusFilterSelection(
  scope: PlannerChildTaskExecutionScope,
): ContextPackFocusFilterSelection {
  return {
    selectedRepoIds: [...scope.selectedRepoIds],
    selectedFocusIds: [...scope.selectedFocusIds],
    repositoryTypes: scope.repositoryTypes ? { ...scope.repositoryTypes } : undefined,
    deepFocusEnabled: scope.deepFocusEnabled,
    deepFocusPrimaryRepoId: scope.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: scope.deepFocusPrimaryFocusId,
    selectedFocusPath: scope.selectedFocusPath,
    selectedFocusTargetKind: scope.selectedFocusTargetKind,
    selectedFocusTargets: scope.selectedFocusTargets.map(clonePrimaryTarget),
    selectedTestTarget: scope.selectedTestTarget ? cloneDeepTarget(scope.selectedTestTarget) : null,
    selectedSupportTargets: scope.selectedSupportTargets.map(cloneDeepTarget),
  };
}

export function areChildScopesEqual(
  left: PlannerChildTaskExecutionScope | null | undefined,
  right: PlannerChildTaskExecutionScope | null | undefined,
): boolean {
  return JSON.stringify(normalizeChildScopeForComparison(left))
    === JSON.stringify(normalizeChildScopeForComparison(right));
}

export function selectedWorkingFocusIdsForScope(
  selectedPack: ContextPackCatalogEntry,
  scope: PlannerChildTaskExecutionScope,
): string[] {
  return selectedPack.estateType === 'distributed-platform'
    ? scope.selectedRepoIds
    : scope.selectedFocusIds;
}

export function validateChildScopePrimarySelection(
  selectedPack: ContextPackCatalogEntry,
  scope: PlannerChildTaskExecutionScope,
): string | null {
  if (scope.deepFocusEnabled) {
    return scope.selectedFocusTargets.length > 0 ? null : CHILD_SCOPE_PRIMARY_REQUIRED_MESSAGE;
  }

  const selectedIds = selectedWorkingFocusIdsForScope(selectedPack, scope);
  const hasPrimary = selectedIds.some((focusId) => {
    const role = scope.repositoryTypes?.[focusId]
      ?? selectedPack.focusTargets.find((target) => target.focusId === focusId)?.repositoryType
      ?? 'support';
    return role === 'primary';
  });
  return hasPrimary ? null : CHILD_SCOPE_PRIMARY_REQUIRED_MESSAGE;
}

export function buildChildScopeStandardRolePack(
  selectedPack: ContextPackCatalogEntry,
  scope: PlannerChildTaskExecutionScope,
): ContextPackCatalogEntry {
  const selectedIds = selectedWorkingFocusIdsForScope(selectedPack, scope);
  const selected = new Set(selectedIds);
  return {
    ...selectedPack,
    focusTargets: selectedPack.focusTargets.map((target) => {
      const repositoryType = scope.repositoryTypes?.[target.focusId]
        ?? (selected.has(target.focusId) ? target.repositoryType ?? 'support' : target.repositoryType);
      return target.repositoryType === repositoryType ? target : { ...target, repositoryType };
    }),
  };
}

export function updateStandardChildScope(
  selectedPack: ContextPackCatalogEntry,
  scope: PlannerChildTaskExecutionScope,
  focusId: string,
): PlannerChildTaskExecutionScope {
  const next = cloneChildScope(scope);
  const key = selectedPack.estateType === 'distributed-platform' ? 'selectedRepoIds' : 'selectedFocusIds';
  const wasSelected = next[key].includes(focusId);
  next[key] = toggleId(next[key], focusId);
  const repositoryTypes = { ...(next.repositoryTypes ?? {}) };
  if (!wasSelected && repositoryTypes[focusId] === undefined) {
    repositoryTypes[focusId] = selectedPack.focusTargets.find((target) => target.focusId === focusId)?.repositoryType ?? 'support';
  }
  next.repositoryTypes = Object.keys(repositoryTypes).length > 0 ? repositoryTypes : undefined;
  return next;
}

export function updateStandardChildScopeRole(
  selectedPack: ContextPackCatalogEntry,
  scope: PlannerChildTaskExecutionScope,
  focusId: string,
  repositoryType: 'primary' | 'support',
): PlannerChildTaskExecutionScope {
  const next = cloneChildScope(scope);
  const key = selectedPack.estateType === 'distributed-platform' ? 'selectedRepoIds' : 'selectedFocusIds';
  const selectedIds = next[key];
  if (!selectedIds.includes(focusId)) {
    return next;
  }
  next.repositoryTypes = {
    ...(next.repositoryTypes ?? {}),
    [focusId]: repositoryType,
  };
  return next;
}

export function updateChildScopeDeepFocus(
  selectedPack: ContextPackCatalogEntry,
  scope: PlannerChildTaskExecutionScope,
  selection: {
    deepFocusEnabled: boolean;
    deepFocusPrimaryRepoId: string | null;
    deepFocusPrimaryFocusId: string | null;
    selectedFocusPath: string | null;
    selectedFocusTargetKind: ContextPackFocusTargetKind | null;
    selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
    selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
    selectedSupportTargets: ContextPackDeepFocusTarget[];
  },
): PlannerChildTaskExecutionScope {
  return {
    ...cloneChildScope(scope),
    deepFocusEnabled: selection.deepFocusEnabled,
    deepFocusPrimaryRepoId: selectedPack.estateType === 'distributed-platform'
      ? selection.deepFocusPrimaryRepoId
      : null,
    deepFocusPrimaryFocusId: selectedPack.estateType === 'distributed-platform'
      ? null
      : selection.deepFocusPrimaryFocusId,
    selectedFocusPath: selection.selectedFocusPath,
    selectedFocusTargetKind: selection.selectedFocusTargetKind,
    selectedFocusTargets: (selection.selectedFocusTargets ?? []).map(clonePrimaryTarget),
    selectedTestTarget: selection.selectedTestTarget ? cloneDeepTarget(selection.selectedTestTarget) : null,
    selectedSupportTargets: selection.selectedSupportTargets.map(cloneDeepTarget),
  };
}

export function buildChildScopeSidebarModel(
  selectedPack: ContextPackCatalogEntry,
  scope: PlannerChildTaskExecutionScope,
): CompactSidebarModel {
  return buildCompactSidebarModel({
    contextPacks: [selectedPack],
    activeContextPackDir: selectedPack.contextPackDir,
    selectedContextPackDir: selectedPack.contextPackDir,
    selectedRepoIds: scope.selectedRepoIds,
    selectedFocusIds: scope.selectedFocusIds,
    lastResult: null,
    lastReseedResult: null,
  });
}

export function buildChildScopeSummary(
  selectedPack: ContextPackCatalogEntry | undefined,
  scope: PlannerChildTaskExecutionScope | null,
): string | undefined {
  if (!selectedPack || !scope) return undefined;
  if (scope.deepFocusEnabled) {
    const primaryCount = scope.selectedFocusTargets.length;
    const supportCount = scope.selectedSupportTargets.length;
    return `Deep Focus: ${primaryCount} primary, ${supportCount} support${scope.selectedTestTarget ? ', test target selected' : ''}`;
  }
  const ids = selectedWorkingFocusIdsForScope(selectedPack, scope);
  const labels = selectedPack.focusTargets
    .filter((target) => ids.includes(target.focusId))
    .map(formatFocusLabel);
  return labels.length ? labels.join(', ') : 'No working focus selected';
}

export function buildLilyPlanningReloadScope(
  parentScope: PlannerChildTaskExecutionScope,
  childScope: PlannerChildTaskExecutionScope,
  selectedPack?: ContextPackCatalogEntry,
): PlannerLilyPlanningReloadScope {
  assertSameContextPack(parentScope, childScope);
  return {
    ...cloneChildScope(childScope),
    schemaVersion: 1,
    purpose: 'lily-planning-read-context',
    selectedRepoIds: unionIds(childScope.selectedRepoIds, parentScope.selectedRepoIds),
    selectedFocusIds: unionIds(childScope.selectedFocusIds, parentScope.selectedFocusIds),
    repositoryTypes: buildReloadRepositoryTypes(parentScope, childScope),
    selectedSupportTargets: buildReadOnlySupportTargets(parentScope, childScope, selectedPack),
  };
}

export function deriveChildScopeAbsentParentWarning(
  parentScope: PlannerChildTaskExecutionScope | null,
  childScope: PlannerChildTaskExecutionScope | null,
  selectedPack?: ContextPackCatalogEntry,
): string | null {
  if (!parentScope || !childScope || parentScope.contextPackDir !== childScope.contextPackDir || parentScope.contextPackId !== childScope.contextPackId) {
    return null;
  }
  const childAdded = scopeAddedLabels(childScope, parentScope, selectedPack);
  const parentOnly = scopeAddedLabels(parentScope, childScope, selectedPack);
  const parts = [
    childAdded.length > 0 ? `Added to child scope: ${summarizeDeltaLabels(childAdded)}` : null,
    parentOnly.length > 0 ? `Parent read-only: ${summarizeDeltaLabels(parentOnly)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function childScopeFocusHint(selectedPack: ContextPackCatalogEntry | undefined): string | null {
  return buildFocusHint({ selectedPack });
}

function assertSameContextPack(parentScope: PlannerChildTaskExecutionScope, childScope: PlannerChildTaskExecutionScope): void {
  if (parentScope.contextPackDir !== childScope.contextPackDir || parentScope.contextPackId !== childScope.contextPackId) {
    throw new Error('Child scope must stay in the selected parent\'s context pack.');
  }
}

function normalizeChildScopeForComparison(
  scope: PlannerChildTaskExecutionScope | null | undefined,
) {
  if (!scope) return null;
  const selectedIds = new Set([...scope.selectedRepoIds, ...scope.selectedFocusIds]);
  const repositoryTypes = Object.fromEntries(
    Object.entries(scope.repositoryTypes ?? {})
      .filter(([id]) => selectedIds.has(id))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    contextPackDir: scope.contextPackDir,
    contextPackId: scope.contextPackId,
    scopeMode: scope.scopeMode,
    selectedRepoIds: sortedUnique(scope.selectedRepoIds),
    selectedFocusIds: sortedUnique(scope.selectedFocusIds),
    repositoryTypes: Object.keys(repositoryTypes).length > 0 ? repositoryTypes : undefined,
    deepFocusEnabled: scope.deepFocusEnabled,
    deepFocusPrimaryRepoId: scope.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: scope.deepFocusPrimaryFocusId,
    selectedFocusPath: normalizeNullablePath(scope.selectedFocusPath),
    selectedFocusTargetKind: scope.selectedFocusTargetKind,
    selectedFocusTargets: scope.selectedFocusTargets.map(normalizePrimaryTarget).sort(compareJson),
    selectedTestTarget: scope.selectedTestTarget ? normalizeDeepTarget(scope.selectedTestTarget) : null,
    selectedSupportTargets: scope.selectedSupportTargets.map(normalizeDeepTarget).sort(compareJson),
  };
}

function normalizePrimaryTarget(target: ContextPackPrimaryFocusTarget) {
  return {
    ...normalizeDeepTarget(target),
    role: target.role ?? undefined,
    testTarget: target.testTarget ? normalizeDeepTarget(target.testTarget) : undefined,
    supportTargets: target.supportTargets?.map(normalizeDeepTarget).sort(compareJson) ?? undefined,
  };
}

function normalizeDeepTarget(target: ContextPackDeepFocusTarget | ContextPackPrimaryFocusTarget) {
  return {
    path: normalizeTargetPath(target.path),
    kind: target.kind,
    repoLocalPath: normalizeNullablePath(target.repoLocalPath),
    repoId: target.repoId?.trim() || undefined,
    focusId: target.focusId?.trim() || undefined,
  };
}

function normalizeNullablePath(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return normalizeTargetPath(value);
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function compareJson(left: unknown, right: unknown): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function standardRepositoryTypesFromBinding(
  binding: PlannerFocusSnapshot['contextPackBinding'],
  snapshot: PlannerFocusSnapshot,
): Record<string, ContextPackFocusFilterRepositoryType> | undefined {
  if (binding.deepFocusEnabled) {
    return undefined;
  }
  const entries = new Map<string, ContextPackFocusFilterRepositoryType>();
  for (const id of binding.selectedRepoIds) {
    entries.set(id, id === binding.primaryRepoId || id === snapshot.primaryRepoId ? 'primary' : 'support');
  }
  for (const id of binding.selectedFocusIds) {
    entries.set(id, id === binding.primaryFocusId ? 'primary' : 'support');
  }
  return entries.size > 0 ? Object.fromEntries(entries) : undefined;
}

function buildReloadRepositoryTypes(
  parentScope: PlannerChildTaskExecutionScope,
  childScope: PlannerChildTaskExecutionScope,
): Record<string, ContextPackFocusFilterRepositoryType> | undefined {
  const entries = new Map<string, ContextPackFocusFilterRepositoryType>();
  for (const id of [...childScope.selectedRepoIds, ...childScope.selectedFocusIds]) {
    entries.set(id, childScope.repositoryTypes?.[id] ?? 'support');
  }
  for (const id of [...parentScope.selectedRepoIds, ...parentScope.selectedFocusIds]) {
    if (!entries.has(id)) {
      entries.set(id, 'support');
    }
  }
  return entries.size > 0 ? Object.fromEntries(entries) : undefined;
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

function unionIds(childIds: string[], parentIds: string[]): string[] {
  const seen = new Set(childIds);
  return [...childIds, ...parentIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  })];
}

function buildReadOnlySupportTargets(
  parentScope: PlannerChildTaskExecutionScope,
  childScope: PlannerChildTaskExecutionScope,
  selectedPack?: ContextPackCatalogEntry,
): ContextPackDeepFocusTarget[] {
  const support = childScope.selectedSupportTargets.map((target) => hydrateSupportTarget(target, selectedPack));
  const childKeys = new Set([
    ...childScope.selectedFocusTargets.map(targetKey),
    ...support.map(targetKey),
    ...(childScope.selectedTestTarget ? [targetKey(childScope.selectedTestTarget)] : []),
  ]);
  const appendParent = (target: ContextPackDeepFocusTarget): void => {
    const key = targetKey(target);
    if (childKeys.has(key) || support.some((existing) => targetKey(existing) === key)) return;
    support.push(hydrateSupportTarget(target, selectedPack));
  };
  parentScope.selectedFocusTargets.forEach((target) => appendParent(toSupportTarget(target, selectedPack)));
  parentScope.selectedSupportTargets.forEach(appendParent);
  if (parentScope.selectedTestTarget && !childScope.selectedTestTarget) {
    appendParent(parentScope.selectedTestTarget);
  }
  return support;
}

function parentDeepTargets(scope: PlannerChildTaskExecutionScope): ContextPackDeepFocusTarget[] {
  const targets: ContextPackDeepFocusTarget[] = [];
  for (const primaryTarget of scope.selectedFocusTargets) {
    targets.push(toSupportTarget(primaryTarget));
    if (primaryTarget.testTarget) targets.push(primaryTarget.testTarget);
    for (const supportTarget of primaryTarget.supportTargets ?? []) {
      targets.push(supportTarget);
    }
  }
  if (scope.selectedTestTarget) targets.push(scope.selectedTestTarget);
  targets.push(...scope.selectedSupportTargets);
  return targets;
}

function scopeAddedLabels(
  candidateScope: PlannerChildTaskExecutionScope,
  baselineScope: PlannerChildTaskExecutionScope,
  selectedPack?: ContextPackCatalogEntry,
): string[] {
  return candidateScope.deepFocusEnabled || baselineScope.deepFocusEnabled
    ? addedDeepFocusLabels(candidateScope, baselineScope, selectedPack)
    : addedStandardLabels(candidateScope, baselineScope, selectedPack);
}

function addedStandardLabels(
  candidateScope: PlannerChildTaskExecutionScope,
  baselineScope: PlannerChildTaskExecutionScope,
  selectedPack?: ContextPackCatalogEntry,
): string[] {
  const candidateIds = selectedPack?.estateType === 'monolith'
    ? candidateScope.selectedFocusIds
    : candidateScope.selectedRepoIds;
  const baselineIds = new Set(selectedPack?.estateType === 'monolith'
    ? baselineScope.selectedFocusIds
    : baselineScope.selectedRepoIds);
  return uniqueLabels(candidateIds
    .filter((id) => !baselineIds.has(id))
    .map((id) => focusTargetLabel(id, selectedPack)));
}

function addedDeepFocusLabels(
  candidateScope: PlannerChildTaskExecutionScope,
  baselineScope: PlannerChildTaskExecutionScope,
  selectedPack?: ContextPackCatalogEntry,
): string[] {
  const baselineKeys = new Set(parentDeepTargets(baselineScope).map(targetKey));
  return uniqueLabels(parentDeepTargets(candidateScope)
    .filter((target) => !baselineKeys.has(targetKey(target)))
    .map((target) => deepFocusTargetLabel(target, selectedPack)));
}

function focusTargetLabel(id: string, selectedPack?: ContextPackCatalogEntry): string {
  const target = selectedPack?.focusTargets.find((entry) => entry.focusId === id || entry.repoId === id);
  return target ? formatFocusLabel(target) : id;
}

function deepFocusTargetLabel(
  target: ContextPackDeepFocusTarget | ContextPackPrimaryFocusTarget,
  selectedPack?: ContextPackCatalogEntry,
): string {
  if (target.path) {
    return basenameOfPath(target.path);
  }
  if (target.focusId || target.repoId) {
    const label = focusTargetLabel(target.focusId ?? target.repoId!, selectedPack);
    if (label !== (target.focusId ?? target.repoId)) return label;
  }
  if (!target.path && target.repoLocalPath) {
    return basenameOfPath(target.repoLocalPath);
  }
  return basenameOfPath(target.path);
}

function basenameOfPath(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

function summarizeDeltaLabels(labels: string[]): string {
  if (labels.length <= CHILD_SCOPE_DELTA_LIMIT) return labels.join(', ');
  return `${labels.slice(0, CHILD_SCOPE_DELTA_LIMIT).join(', ')} +${labels.length - CHILD_SCOPE_DELTA_LIMIT}`;
}

function targetKey(target: ContextPackDeepFocusTarget | ContextPackPrimaryFocusTarget): string {
  return `${target.repoId?.trim() ?? ''}::${target.focusId?.trim() ?? ''}::${target.kind}::${normalizeTargetPath(target.path)}`;
}

function normalizeTargetPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

function toSupportTarget(target: ContextPackPrimaryFocusTarget, selectedPack?: ContextPackCatalogEntry): ContextPackDeepFocusTarget {
  return hydrateSupportTarget({
    path: target.path,
    kind: target.kind,
    repoLocalPath: target.repoLocalPath,
    repoId: target.repoId,
    focusId: target.focusId,
  }, selectedPack);
}

function hydrateSupportTarget(
  target: ContextPackDeepFocusTarget,
  selectedPack?: ContextPackCatalogEntry,
): ContextPackDeepFocusTarget {
  const next = cloneDeepTarget(target);
  if (next.repoLocalPath?.trim() || !selectedPack) {
    return next;
  }
  const catalogTarget = selectedPack.focusTargets.find((candidate) =>
    (next.focusId?.trim() && candidate.focusId === next.focusId)
    || (next.repoId?.trim() && candidate.repoId === next.repoId));
  return catalogTarget?.repoLocalPath ? { ...next, repoLocalPath: catalogTarget.repoLocalPath } : next;
}

function cloneDeepTarget(target: ContextPackDeepFocusTarget): ContextPackDeepFocusTarget {
  return { ...target };
}

function clonePrimaryTarget(target: ContextPackPrimaryFocusTarget): ContextPackPrimaryFocusTarget {
  return {
    ...target,
    testTarget: target.testTarget ? cloneDeepTarget(target.testTarget) : target.testTarget,
    supportTargets: target.supportTargets?.map(cloneDeepTarget),
  };
}
