export type ContextPackSelectionRole = 'primary' | 'support';
export type ContextPackSelectionRoles = Record<string, ContextPackSelectionRole>;

// Historical contract name from focus filters. In distributed packs the keys
// are repo IDs; in monolith packs the keys are focus IDs. Treat this as a
// selected-scope-target role map, not as a repo-only data structure.
export type ContextPackRepositoryRole = ContextPackSelectionRole;
export type ContextPackRepositoryTypes = ContextPackSelectionRoles;

export function isRepositoryTypesRecord(value: unknown): value is ContextPackRepositoryTypes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, role] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim() || (role !== 'primary' && role !== 'support')) return false;
  }
  return true;
}

export function normalizeRepositoryTypesForSelection(
  repositoryTypes: Record<string, ContextPackRepositoryRole> | undefined,
  selectedIds: readonly string[],
): ContextPackRepositoryTypes | undefined {
  if (!repositoryTypes) return undefined;
  const selected = new Set(selectedIds.map((id) => id.trim()).filter(Boolean));
  const normalized: ContextPackRepositoryTypes = {};
  for (const [rawKey, role] of Object.entries(repositoryTypes)) {
    const key = rawKey.trim();
    if (!key || !selected.has(key)) continue;
    normalized[key] = role;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function parseRepositoryTypesJson(value: string): ContextPackRepositoryTypes | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  return isRepositoryTypesRecord(parsed) ? parsed : null;
}

export function stableStringifyRepositoryTypes(repositoryTypes: ContextPackRepositoryTypes): string {
  const sorted: ContextPackRepositoryTypes = {};
  for (const key of Object.keys(repositoryTypes).sort()) {
    sorted[key] = repositoryTypes[key]!;
  }
  return JSON.stringify(sorted);
}

export function deriveStandardSelectionRoles(options: {
  selectedIds: readonly string[];
  repositoryTypes?: ContextPackRepositoryTypes;
  scalarPrimaryId?: string | null;
}): { primaryIds: string[]; supportIds: string[] } {
  const seen = new Set<string>();
  const primaryIds: string[] = [];
  const supportIds: string[] = [];
  for (const rawId of options.selectedIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const role = options.repositoryTypes?.[id]
      ?? (id === options.scalarPrimaryId ? 'primary' : 'support');
    if (role === 'primary') {
      primaryIds.push(id);
    } else {
      supportIds.push(id);
    }
  }
  return { primaryIds, supportIds };
}
