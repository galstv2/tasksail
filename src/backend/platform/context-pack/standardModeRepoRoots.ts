import type { ReadonlyContextRoot } from './deepFocusNormalization.js';

/**
 * Derive read-only context roots for standard repo-selection mode.
 * Returns one whole-repo ReadonlyContextRoot per non-primary support repo.
 */
export function deriveStandardModeReadonlyRepoRoots(options: {
  primaryRepoId: string | undefined;
  supportRepos: readonly { repoId: string; repoRoot: string }[];
}): ReadonlyContextRoot[] {
  const primary = (options.primaryRepoId ?? '').trim();
  if (!primary) return [];

  const seen = new Set<string>();
  const roots: ReadonlyContextRoot[] = [];
  for (const repo of options.supportRepos) {
    const repoId = repo.repoId?.trim();
    const repoRoot = repo.repoRoot?.trim();
    if (!repoId || !repoRoot || repoId === primary || seen.has(repoId)) {
      continue;
    }
    seen.add(repoId);
    roots.push({
      repoLocalPath: repoRoot,
      path: '',
      kind: 'directory',
      reason: 'support-repo',
    });
  }

  return roots;
}
