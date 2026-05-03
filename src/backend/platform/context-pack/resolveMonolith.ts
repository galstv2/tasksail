import type { Manifest, ResolvedPrimaryRepo } from './focusedRepo.js';
import { resolveFirstLocalPath } from './focusedRepo.js';

export function resolveMonolithPrimary(
  manifest: Manifest,
  contextPackDir: string,
): ResolvedPrimaryRepo | undefined {
  const repo = manifest.repository ?? manifest.repositories?.[0];
  if (!repo) return undefined;
  const repoId = repo.repo_id ?? 'unknown';
  const resolved = resolveFirstLocalPath(repo, contextPackDir);
  if (!resolved) {
    return undefined;
  }

  const primaryFocusIds = manifest.primary_focus_area_ids ?? [];
  const focusableAreas = manifest.focusable_areas ?? [];
  let primaryFocusRelativePath: string | undefined;

  for (const focusId of primaryFocusIds) {
    const area = focusableAreas.find((candidate) => candidate.focus_id === focusId);
    const relativePath = typeof area?.relative_path === 'string' ? area.relative_path.trim() : '';
    if (relativePath) {
      primaryFocusRelativePath = relativePath;
      break;
    }
  }

  return { repoRoot: resolved, repoId, primaryFocusId: primaryFocusIds[0], primaryFocusRelativePath };
}

export function resolveSelectedMonolithPrimary(
  manifest: Manifest,
  contextPackDir: string,
  selectedFocusIds: string[],
  options: { allowMultiplePrimaries?: boolean } = {},
): ResolvedPrimaryRepo | undefined {
  const repo = manifest.repository ?? manifest.repositories?.[0];
  if (!repo) return undefined;
  const repoId = repo.repo_id ?? 'unknown';
  const resolved = resolveFirstLocalPath(repo, contextPackDir);
  if (!resolved) {
    return undefined;
  }

  const focusableAreas = Array.isArray(manifest.focusable_areas) ? manifest.focusable_areas : [];
  const areaById = new Map(focusableAreas
    .filter((area) => typeof area.focus_id === 'string' && area.focus_id.trim())
    .map((area) => [area.focus_id!.trim(), area]));
  const primaryFocusIds: string[] = [];
  const seen = new Set<string>();
  for (const selectedFocusId of selectedFocusIds) {
    const focusId = selectedFocusId.trim();
    if (!focusId || seen.has(focusId)) {
      continue;
    }
    seen.add(focusId);
    const area = areaById.get(focusId);
    if (area?.repository_type === 'primary') {
      primaryFocusIds.push(focusId);
    }
  }
  if (primaryFocusIds.length === 0 || (!options.allowMultiplePrimaries && primaryFocusIds.length !== 1)) {
    return undefined;
  }

  const focusId = primaryFocusIds[0];
  const primaryArea = focusId ? areaById.get(focusId) : undefined;
  const relativePath = typeof primaryArea?.relative_path === 'string'
    ? primaryArea.relative_path.trim()
    : '';
  if (!focusId) {
    return undefined;
  }
  if (!relativePath) {
    throw new Error(`Selected primary focus area "${focusId}" is missing required relative_path.`);
  }

  return {
    repoRoot: resolved,
    repoId,
    primaryFocusId: focusId,
    primaryFocusRelativePath: relativePath,
  };
}
