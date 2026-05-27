import { ValidationError } from '../core/index.js';
import { readContextPackManifest } from '../context-pack/focusedRepo.js';
import {
  normalizeRepositoryTypesForSelection,
  type ContextPackRepositoryTypes,
  type ContextPackRepositoryRole,
} from './repositoryTypes.js';

export type StandardSelectionRoleFamily = 'repo' | 'focus';

type NormalizedSelection = {
  family: StandardSelectionRoleFamily;
  selectedIds: string[];
  scalarPrimaryId?: string | null;
};

export function deriveFrozenStandardSelectionRoles(options: {
  selectedIds: readonly string[];
  explicitRepositoryTypes?: ContextPackRepositoryTypes;
  manifestRepositoryTypes?: ContextPackRepositoryTypes;
  manifestPrimaryIds?: readonly string[];
  scalarPrimaryId?: string | null;
}): ContextPackRepositoryTypes | undefined {
  const selectedIds = normalizeSelectedIds(options.selectedIds);
  if (selectedIds.length === 0) return undefined;

  const explicit = normalizeRepositoryTypesForSelection(options.explicitRepositoryTypes, selectedIds);
  const manifest = normalizeRepositoryTypesForSelection(options.manifestRepositoryTypes, selectedIds);
  const manifestPrimaryIds = new Set((options.manifestPrimaryIds ?? []).map((id) => id.trim()).filter(Boolean));
  const scalarPrimaryId = options.scalarPrimaryId?.trim() || undefined;
  const hasExplicitEvidence = selectedIds.some((id) => explicit?.[id] !== undefined);
  const hasManifestEvidence = selectedIds.some((id) => manifest?.[id] !== undefined || manifestPrimaryIds.has(id));

  const roles: ContextPackRepositoryTypes = {};
  for (const id of selectedIds) {
    roles[id] = explicit?.[id]
      ?? manifest?.[id]
      ?? (manifestPrimaryIds.has(id) ? 'primary' : undefined)
      ?? (id === scalarPrimaryId ? 'primary' : 'support');
  }

  const hasPrimary = selectedIds.some((id) => roles[id] === 'primary');
  if (!hasPrimary && !hasExplicitEvidence && !hasManifestEvidence) {
    roles[selectedIds[0]!] = 'primary';
  }

  return roles;
}

export async function resolveFrozenStandardSelectionRoles(options: {
  repoRoot: string;
  contextPackDir?: string | null;
  deepFocusEnabled?: boolean;
  selectedRepoIds?: readonly string[];
  selectedFocusIds?: readonly string[];
  repositoryTypes?: ContextPackRepositoryTypes;
  primaryRepoId?: string | null;
  primaryFocusId?: string | null;
}): Promise<ContextPackRepositoryTypes | undefined> {
  if (options.deepFocusEnabled === true) return undefined;

  const selection = normalizeStandardSelection(options);
  if (!selection) return undefined;

  if (hasCompleteExplicitRoles(options.repositoryTypes, selection.selectedIds)) {
    return deriveFrozenStandardSelectionRoles({
      selectedIds: selection.selectedIds,
      explicitRepositoryTypes: options.repositoryTypes,
      scalarPrimaryId: selection.scalarPrimaryId,
    });
  }

  const contextPackDir = options.contextPackDir?.trim();
  if (!contextPackDir) {
    return deriveFrozenStandardSelectionRoles({
      selectedIds: selection.selectedIds,
      explicitRepositoryTypes: options.repositoryTypes,
      scalarPrimaryId: selection.scalarPrimaryId,
    });
  }

  const manifest = await readManifestOrThrow({
    repoRoot: options.repoRoot,
    contextPackDir,
    family: selection.family,
  });
  const manifestRoles = rolesFromManifest(manifest, selection.family);
  return deriveFrozenStandardSelectionRoles({
    selectedIds: selection.selectedIds,
    explicitRepositoryTypes: options.repositoryTypes,
    manifestRepositoryTypes: manifestRoles.repositoryTypes,
    manifestPrimaryIds: manifestRoles.primaryIds,
    scalarPrimaryId: selection.scalarPrimaryId,
  });
}

function normalizeStandardSelection(options: {
  selectedRepoIds?: readonly string[];
  selectedFocusIds?: readonly string[];
  primaryRepoId?: string | null;
  primaryFocusId?: string | null;
}): NormalizedSelection | undefined {
  const selectedRepoIds = normalizeSelectedIds(options.selectedRepoIds ?? []);
  if (selectedRepoIds.length > 0) {
    return { family: 'repo', selectedIds: selectedRepoIds, scalarPrimaryId: options.primaryRepoId };
  }
  const selectedFocusIds = normalizeSelectedIds(options.selectedFocusIds ?? []);
  if (selectedFocusIds.length > 0) {
    return { family: 'focus', selectedIds: selectedFocusIds, scalarPrimaryId: options.primaryFocusId };
  }
  return undefined;
}

function normalizeSelectedIds(selectedIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawId of selectedIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function hasCompleteExplicitRoles(
  repositoryTypes: ContextPackRepositoryTypes | undefined,
  selectedIds: readonly string[],
): boolean {
  const explicit = normalizeRepositoryTypesForSelection(repositoryTypes, selectedIds);
  return explicit !== undefined && Object.keys(explicit).length === selectedIds.length;
}

async function readManifestOrThrow(options: {
  repoRoot: string;
  contextPackDir: string;
  family: StandardSelectionRoleFamily;
}) {
  try {
    const manifest = await readContextPackManifest(options.contextPackDir, options.repoRoot);
    if (manifest) return manifest;
  } catch (cause) {
    throw unresolvedRolesError(options, cause);
  }
  throw unresolvedRolesError(options);
}

function unresolvedRolesError(
  options: { contextPackDir: string; family: StandardSelectionRoleFamily },
  cause?: unknown,
): ValidationError {
  return new ValidationError(
    `Cannot freeze standard Selection Roles for ${options.family} selection because the context pack manifest is unavailable: ${options.contextPackDir}`,
    {
      code: 'CONTEXT_PACK_SELECTION_ROLES_UNRESOLVED',
      category: 'user',
      context: {
        contextPackDir: options.contextPackDir,
        selectedAuthorityFamily: options.family,
      },
      cause,
    },
  );
}

function rolesFromManifest(
  manifest: {
    repositories?: Array<{ repo_id?: string; repository_type?: string }>;
    focusable_areas?: Array<{ focus_id?: string; repository_type?: string }>;
    primary_working_repo_ids?: string[];
    primary_focus_area_ids?: string[];
  },
  family: StandardSelectionRoleFamily,
): {
  repositoryTypes: ContextPackRepositoryTypes;
  primaryIds: string[];
} {
  const repositoryTypes: ContextPackRepositoryTypes = {};
  if (family === 'repo') {
    for (const repo of manifest.repositories ?? []) {
      addManifestRole(repositoryTypes, repo.repo_id, repo.repository_type);
    }
    return { repositoryTypes, primaryIds: manifest.primary_working_repo_ids ?? [] };
  }

  for (const area of manifest.focusable_areas ?? []) {
    addManifestRole(repositoryTypes, area.focus_id, area.repository_type);
  }
  return { repositoryTypes, primaryIds: manifest.primary_focus_area_ids ?? [] };
}

function addManifestRole(
  repositoryTypes: ContextPackRepositoryTypes,
  rawId: string | undefined,
  rawRole: string | undefined,
): void {
  const id = rawId?.trim();
  if (!id || !isSelectionRole(rawRole)) return;
  repositoryTypes[id] = rawRole;
}

function isSelectionRole(value: string | undefined): value is ContextPackRepositoryRole {
  return value === 'primary' || value === 'support';
}
