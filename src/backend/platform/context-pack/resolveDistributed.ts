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
): ResolvedPrimaryRepo | undefined {
  const repositories = Array.isArray(manifest.repositories) ? manifest.repositories : [];
  const selectedSet = new Set(selectedRepoIds);
  const primaryRepos = repositories.filter((repo) =>
    repo.repo_id &&
    selectedSet.has(repo.repo_id) &&
    repo.repository_type === 'primary',
  );
  if (primaryRepos.length !== 1) {
    return undefined;
  }

  const primaryRepo = primaryRepos[0];
  const repoId = primaryRepo.repo_id?.trim();
  if (!repoId) {
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
