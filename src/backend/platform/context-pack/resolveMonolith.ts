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
): ResolvedPrimaryRepo | undefined {
  const repo = manifest.repository ?? manifest.repositories?.[0];
  if (!repo) return undefined;
  const repoId = repo.repo_id ?? 'unknown';
  const resolved = resolveFirstLocalPath(repo, contextPackDir);
  if (!resolved) {
    return undefined;
  }

  const selectedSet = new Set(selectedFocusIds);
  const focusableAreas = Array.isArray(manifest.focusable_areas) ? manifest.focusable_areas : [];
  const primaryAreas = focusableAreas.filter((area) =>
    area.focus_id &&
    selectedSet.has(area.focus_id) &&
    area.repository_type === 'primary',
  );
  if (primaryAreas.length !== 1) {
    return undefined;
  }

  const primaryArea = primaryAreas[0];
  const focusId = primaryArea?.focus_id?.trim();
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
