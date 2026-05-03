import type { Manifest, ManifestRepo, ResolvedPrimaryRepo } from './focusedRepo.js';
import { resolveFirstLocalPath } from './focusedRepo.js';

export function resolveDistributedPrimary(
  manifest: Manifest,
  contextPackDir: string,
): ResolvedPrimaryRepo | undefined {
  const repositories = manifest.repositories;
  if (!Array.isArray(repositories) || repositories.length === 0) {
    return undefined;
  }

  const primaryIds = manifest.primary_working_repo_ids ?? [];
  const repoById = new Map<string, ManifestRepo>();
  for (const repo of repositories) {
    if (repo.repo_id) repoById.set(repo.repo_id, repo);
  }

  // Try primary_working_repo_ids first.
  for (const id of primaryIds) {
    const repo = repoById.get(id);
    if (!repo) continue;
    const resolved = resolveFirstLocalPath(repo, contextPackDir);
    if (resolved) return { repoRoot: resolved, repoId: id };
  }

  // Fall pmck to ranking: default_focusable desc, activation_priority desc.
  const ranked = [...repositories].sort((a, b) => {
    const aFocusable = a.default_focusable ? 0 : 1;
    const bFocusable = b.default_focusable ? 0 : 1;
    if (aFocusable !== bFocusable) return aFocusable - bFocusable;
    return (b.activation_priority ?? 0) - (a.activation_priority ?? 0);
  });

  for (const repo of ranked) {
    const repoId = repo.repo_id ?? 'unknown';
    const resolved = resolveFirstLocalPath(repo, contextPackDir);
    if (resolved) return { repoRoot: resolved, repoId };
  }

  return undefined;
}

export function resolveSelectedDistributedPrimary(
  manifest: Manifest,
  contextPackDir: string,
  selectedRepoIds: string[],
  options: { allowMultiplePrimaries?: boolean } = {},
): ResolvedPrimaryRepo | undefined {
  const repositories = Array.isArray(manifest.repositories) ? manifest.repositories : [];
  const repoById = new Map<string, ManifestRepo>();
  for (const repo of repositories) {
    const repoId = repo.repo_id?.trim();
    if (repoId) {
      repoById.set(repoId, repo);
    }
  }

  const primaryIds: string[] = [];
  const seen = new Set<string>();
  for (const selectedRepoId of selectedRepoIds) {
    const repoId = selectedRepoId.trim();
    if (!repoId || seen.has(repoId)) {
      continue;
    }
    seen.add(repoId);
    const repo = repoById.get(repoId);
    if (repo?.repository_type === 'primary') {
      primaryIds.push(repoId);
    }
  }

  if (primaryIds.length === 0 || (!options.allowMultiplePrimaries && primaryIds.length !== 1)) {
    return undefined;
  }

  const repoId = primaryIds[0];
  const primaryRepo = repoId ? repoById.get(repoId) : undefined;
  if (!repoId) {
    return undefined;
  }
  if (!primaryRepo) {
    return undefined;
  }

  const resolved = resolveFirstLocalPath(primaryRepo, contextPackDir);
  if (!resolved) {
    return undefined;
  }

  return { repoRoot: resolved, repoId };
}

export function collectSelectedDistributedReferenceRepos(
  manifest: Manifest,
  contextPackDir: string,
  selectedRepoIds: string[],
  primary: ResolvedPrimaryRepo,
): { repoRoots: string[]; repoIds: string[] } {
  const repositories = Array.isArray(manifest.repositories) ? manifest.repositories : [];
  const repoById = new Map<string, ManifestRepo>();
  for (const repo of repositories) {
    if (repo.repo_id) {
      repoById.set(repo.repo_id, repo);
    }
  }

  const repoRoots: string[] = [];
  const repoIds: string[] = [];
  const seenRoots = new Set<string>();
  const seenIds = new Set<string>();
  const addReferenceRepo = (repoId: string, repoRoot: string): void => {
    if (seenIds.has(repoId) || seenRoots.has(repoRoot)) {
      return;
    }
    seenIds.add(repoId);
    seenRoots.add(repoRoot);
    repoIds.push(repoId);
    repoRoots.push(repoRoot);
  };

  addReferenceRepo(primary.repoId, primary.repoRoot);

  for (const repoId of selectedRepoIds) {
    const repo = repoById.get(repoId);
    if (!repo) {
      continue;
    }
    const resolvedRoot = resolveFirstLocalPath(repo, contextPackDir);
    if (!resolvedRoot) {
      continue;
    }
    addReferenceRepo(repoId, resolvedRoot);
  }

  return { repoRoots, repoIds };
}
