import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { readTextFile, safeJsonParse, resolvePath } from '../core/index.js';
import type { RepositoryType } from './types.js';

/** Result of resolving focused repos for targeting and confinement metadata. */
export interface FocusedRepoResult {
  /**
   * Absolute path to the primary repo root selected as Dalton's write boundary.
   * Consumers may use this as the launch CWD when they still start inside the
   * focused repo, but Dalton now launches from the platform repo root and uses
   * this value as the explicit primary implementation boundary instead.
   */
  primaryRepoRoot: string;
  /**
   * Resolver-dependent visible repo roots.
   *
   * - resolveFocusedRepoRoot(): workspace-visible manifest-declared roots
   * - resolveSelectedPrimaryRepoRoot(): activated reference repo roots for the
   *   current task selection
   *
   * Dalton may read from these repos for reference/research use, but writes
   * remain confined to the explicit primary boundary above.
   */
  visibleRepoRoots: string[];
  /** All manifest-declared repo roots for the active context pack. */
  declaredRepoRoots: string[];
  /** Estate type from the manifest. */
  estateType: string;
  /** The repo_id of the primary repo. */
  primaryRepoId: string;
  /** The focus_id of the selected primary focus area, when monolith-scoped. */
  primaryFocusId?: string;
  /** Relative path to the monolith primary focus area, when declared. */
  primaryFocusRelativePath?: string;
  /**
   * Activated reference repo ids represented by this boundary, including the
   * primary repo id when distributed selection is in effect.
   */
  selectedRepoIds: string[];
  /** Activated focus ids represented by this boundary. */
  selectedFocusIds: string[];
  /** Where the boundary authority came from. */
  authoritySource: AuthoritySource;
}

export type AuthoritySource = 'manifest-primary' | 'active-task-sidecar' | 'workspace-sync-state';

interface ResolvedPrimaryRepo {
  repoRoot: string;
  repoId: string;
  primaryFocusId?: string;
  primaryFocusRelativePath?: string;
}

interface ManifestRepo {
  repo_id?: string;
  local_paths?: string[];
  default_focusable?: boolean;
  activation_priority?: number;
  service_name?: string;
  repo_name?: string;
  repository_type?: RepositoryType;
}

interface Manifest {
  estate_type?: string;
  primary_working_repo_ids?: string[];
  primary_focus_area_ids?: string[];
  focusable_areas?: ManifestFocusableArea[];
  repositories?: ManifestRepo[];
  repository?: ManifestRepo & { local_paths?: string[] };
}

interface ManifestFocusableArea {
  focus_id?: string;
  relative_path?: string;
  repository_type?: RepositoryType;
}

interface WorkspaceFile {
  folders?: Array<{ path?: string }>;
}

interface AuthoritativeSelection {
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  source: Exclude<AuthoritySource, 'manifest-primary'>;
}

const WORKSPACE_FILENAME = 'tasksail.code-workspace';

/**
 * Read the VS Code workspace file and return all external repo folder paths.
 *
 * External folders are any folder entry whose path is not "." (the platform
 * repo itself). Existing paths are canonicalized and deduplicated so callers
 * can safely compare them against manifest-declared repo roots.
 */
export async function resolveWorkspaceRepoRoots(
  repoRoot: string,
): Promise<string[]> {
  const workspacePath = path.join(repoRoot, WORKSPACE_FILENAME);
  const content = await readTextFile(workspacePath);
  if (content === undefined) {
    return [];
  }

  const workspace = safeJsonParse<WorkspaceFile>(content, workspacePath);
  if (!workspace?.folders || !Array.isArray(workspace.folders)) {
    return [];
  }

  const externalPaths: string[] = [];
  const seen = new Set<string>();
  for (const folder of workspace.folders) {
    const folderPath = folder?.path;
    if (typeof folderPath !== 'string' || !folderPath.trim()) continue;
    if (folderPath === '.') continue; // skip the platform repo itself

    const resolved = resolveExistingPath(folderPath, repoRoot);
    if (!resolved || seen.has(resolved)) {
      continue;
    }

    seen.add(resolved);
    externalPaths.push(resolved);
  }

  return externalPaths;
}

/**
 * Resolve focused repo information for targeting and confinement metadata.
 *
 * 1. Reads the workspace file for visible external repos, then filters them to
 *    manifest-declared repo roots before they can widen agent confinement.
 * 2. Resolves the primary repo from the manifest as the primary focused target.
 *    Some agents may still launch inside that repo, while Dalton now launches
 *    from the platform repo root and consumes the result as advisory metadata.
 *
 * Returns undefined if the manifest is missing/malformed or the primary repo
 * path does not exist on disk.
 */
export async function resolveFocusedRepoRoot(
  contextPackDir: string,
  repoRoot: string,
): Promise<FocusedRepoResult | undefined> {
  // Resolve relative context pack dirs against repoRoot so callers (e.g. the
  // Electron main process) don't silently fail when CWD != repoRoot.
  const resolvedPackDir = resolvePath(repoRoot, contextPackDir);
  const manifestPath = path.join(resolvedPackDir, 'qmd', 'repo-sources.json');
  const content = await readTextFile(manifestPath);
  if (content === undefined) {
    return undefined;
  }

  const manifest = safeJsonParse<Manifest>(content, manifestPath);
  if (!manifest) {
    return undefined;
  }

  const estateType = manifest.estate_type ?? 'distributed-platform';

  // Resolve the primary repo for focused targeting metadata and optional
  // focused-repo launches used by non-Dalton agents.
  const primary = estateType === 'monolith' || estateType === 'monolith-platform'
    ? resolveMonolithPrimary(manifest, resolvedPackDir)
    : resolveDistributedPrimary(manifest, resolvedPackDir);

  if (!primary) {
    return undefined;
  }

  // Resolve all manifest-declared repo roots so the workspace file cannot add
  // undeclared confinement roots.
  const declaredRoots = collectDeclaredRepoRoots(manifest, resolvedPackDir);
  const declaredRootSet = new Set(declaredRoots);

  // Resolve all visible workspace repos for --add-dir.
  const workspaceRoots = await resolveWorkspaceRepoRoots(repoRoot);

  // Merge: ensure the primary repo is always included, plus all workspace
  // repos that are also declared in the manifest (avoid duplicates).
  const seen = new Set<string>();
  const visibleRoots: string[] = [];

  seen.add(primary.repoRoot);
  visibleRoots.push(primary.repoRoot);

  for (const root of workspaceRoots) {
    if (declaredRootSet.has(root) && !seen.has(root)) {
      seen.add(root);
      visibleRoots.push(root);
    }
  }

  return {
    primaryRepoRoot: primary.repoRoot,
    visibleRepoRoots: visibleRoots,
    declaredRepoRoots: declaredRoots,
    estateType,
    primaryRepoId: primary.repoId,
    primaryFocusId: primary.primaryFocusId,
    primaryFocusRelativePath: primary.primaryFocusRelativePath,
    selectedRepoIds: [primary.repoId],
    selectedFocusIds: primary.primaryFocusId ? [primary.primaryFocusId] : [],
    authoritySource: 'manifest-primary',
  };
}

/**
 * Resolve the single selected primary boundary for Dalton.
 *
  * Unlike resolveFocusedRepoRoot(), this function does not widen scope to every
  * workspace-visible repo. It reads the authoritative active task selection
  * first, then returns the selected primary write boundary plus the narrower
  * activated reference repo set for that selection.
 */
export async function resolveSelectedPrimaryRepoRoot(
  contextPackDir: string,
  repoRoot: string,
): Promise<FocusedRepoResult | undefined> {
  const resolvedPackDir = resolvePath(repoRoot, contextPackDir);
  const manifestPath = path.join(resolvedPackDir, 'qmd', 'repo-sources.json');
  const [content, selection] = await Promise.all([
    readTextFile(manifestPath),
    resolveAuthoritativeSelection(resolvedPackDir, repoRoot),
  ]);
  if (content === undefined || !selection) {
    return undefined;
  }

  const manifest = safeJsonParse<Manifest>(content, manifestPath);
  if (!manifest) {
    return undefined;
  }

  const estateType = manifest.estate_type ?? 'distributed-platform';
  const declaredRoots = collectDeclaredRepoRoots(manifest, resolvedPackDir);
  const primary = estateType === 'monolith' || estateType === 'monolith-platform'
    ? resolveSelectedMonolithPrimary(manifest, resolvedPackDir, selection.selectedFocusIds)
    : resolveSelectedDistributedPrimary(manifest, resolvedPackDir, selection.selectedRepoIds);

  if (!primary) {
    return undefined;
  }

  const activatedReference = estateType === 'monolith' || estateType === 'monolith-platform'
    ? {
        repoRoots: [primary.repoRoot],
        repoIds: [primary.repoId],
      }
    : collectSelectedDistributedReferenceRepos(manifest, resolvedPackDir, selection.selectedRepoIds, primary);

  return {
    primaryRepoRoot: primary.repoRoot,
    visibleRepoRoots: activatedReference.repoRoots,
    declaredRepoRoots: declaredRoots,
    estateType,
    primaryRepoId: primary.repoId,
    primaryFocusId: primary.primaryFocusId,
    primaryFocusRelativePath: primary.primaryFocusRelativePath,
    selectedRepoIds: activatedReference.repoIds,
    selectedFocusIds: selection.selectedFocusIds.length > 0
      ? selection.selectedFocusIds
      : primary.primaryFocusId
        ? [primary.primaryFocusId]
        : [],
    authoritySource: selection.source,
  };
}

function resolveMonolithPrimary(
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

function resolveDistributedPrimary(
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

function resolveSelectedMonolithPrimary(
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

function resolveSelectedDistributedPrimary(
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

function collectSelectedDistributedReferenceRepos(
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

function resolveFirstLocalPath(
  repo: ManifestRepo,
  contextPackDir: string,
): string | undefined {
  const localPaths = repo.local_paths;
  if (!Array.isArray(localPaths) || localPaths.length === 0) {
    return undefined;
  }

  for (const rawPath of localPaths) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
    const candidate = resolveExistingPath(rawPath, contextPackDir);
    if (candidate) return candidate;
  }

  return undefined;
}

function collectDeclaredRepoRoots(manifest: Manifest, contextPackDir: string): string[] {
  const repos: ManifestRepo[] = [];
  if (manifest.repository) {
    repos.push(manifest.repository);
  }
  if (Array.isArray(manifest.repositories)) {
    repos.push(...manifest.repositories);
  }

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const repo of repos) {
    const localPaths = repo.local_paths;
    if (!Array.isArray(localPaths)) {
      continue;
    }
    for (const rawPath of localPaths) {
      if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
      const resolved = resolveExistingPath(rawPath, contextPackDir);
      if (!resolved || seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      roots.push(resolved);
    }
  }
  return roots;
}

async function resolveAuthoritativeSelection(
  resolvedPackDir: string,
  repoRoot: string,
): Promise<AuthoritativeSelection | undefined> {
  const sidecarSelection = await readTaskSelectionSidecar(resolvedPackDir, repoRoot);
  if (sidecarSelection) {
    return sidecarSelection;
  }
  return readWorkspaceSyncSelection(resolvedPackDir, repoRoot);
}

interface SelectionFileDescriptor {
  filePath: string;
  contextPackDirField: string;
  repoIdsField: string;
  focusIdsField: string;
  source: Exclude<AuthoritySource, 'manifest-primary'>;
}

async function readSelectionFile(
  descriptor: SelectionFileDescriptor,
  resolvedPackDir: string,
  repoRoot: string,
): Promise<AuthoritativeSelection | undefined> {
  const content = await readTextFile(descriptor.filePath);
  if (content === undefined) {
    return undefined;
  }

  const parsed = safeJsonParse<Record<string, unknown>>(content, descriptor.filePath);
  const rawContextPackDir = typeof parsed?.[descriptor.contextPackDirField] === 'string'
    ? (parsed[descriptor.contextPackDirField] as string).trim()
    : '';
  if (!rawContextPackDir) {
    return undefined;
  }

  const resolvedContextPackDir = resolvePath(repoRoot, rawContextPackDir);
  if (resolvedContextPackDir !== resolvedPackDir) {
    return undefined;
  }

  return {
    selectedRepoIds: toStringArray(parsed?.[descriptor.repoIdsField]),
    selectedFocusIds: toStringArray(parsed?.[descriptor.focusIdsField]),
    source: descriptor.source,
  };
}

function readTaskSelectionSidecar(
  resolvedPackDir: string,
  repoRoot: string,
): Promise<AuthoritativeSelection | undefined> {
  return readSelectionFile({
    filePath: path.join(repoRoot, '.platform-state', 'queue', 'active-context-pack.json'),
    contextPackDirField: 'contextPackDir',
    repoIdsField: 'selectedRepoIds',
    focusIdsField: 'selectedFocusIds',
    source: 'active-task-sidecar',
  }, resolvedPackDir, repoRoot);
}

function readWorkspaceSyncSelection(
  resolvedPackDir: string,
  repoRoot: string,
): Promise<AuthoritativeSelection | undefined> {
  return readSelectionFile({
    filePath: path.join(repoRoot, '.platform-state', 'workspace-context-sync.json'),
    contextPackDirField: 'active_context_pack_dir',
    repoIdsField: 'selected_repo_ids',
    focusIdsField: 'selected_focus_ids',
    source: 'workspace-sync-state',
  }, resolvedPackDir, repoRoot);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveExistingPath(rawPath: string, pmseDir: string): string | undefined {
  const candidate = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(pmseDir, rawPath);
  if (!existsSync(candidate)) {
    return undefined;
  }
  try {
    return realpathSync(candidate);
  } catch {
    return undefined;
  }
}
