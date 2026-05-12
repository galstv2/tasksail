import path from 'node:path';
import { readTextFile, safeJsonParse, resolvePath } from '../core/index.js';
import { assertManifest } from './packSchemas.runtime.js';
import type { RepositoryType } from './types.js';
import {
  normalizeParentRelativePath,
  normalizeRelativePath,
  type FocusTarget,
  type FocusTargetKind,
  type NormalizedSupportTarget,
  type PrimaryFocusTarget,
  type ReadonlyContextRoot,
  type WritableRoot,
} from './deepFocusNormalization.js';
import {
  resolveDistributedPrimary,
  resolveSelectedDistributedPrimary,
  collectSelectedDistributedReferenceRepos,
} from './resolveDistributed.js';
import {
  resolveMonolithPrimary,
  resolveSelectedMonolithPrimary,
} from './resolveMonolith.js';
import { deriveWritableRootsFromFocusedSelection } from './writableRootsDerivation.js';
import { deriveStandardModeReadonlyRepoRoots } from './standardModeRepoRoots.js';
import {
  resolveAuthoritativeSelection,
  type AuthoritativeSelection,
  type AuthoritySource,
} from './authoritativeSelectionReader.js';
import { resolveDeepFocusSelection } from './deepFocusResolver.js';
import {
  assertSnapshotMatchesContextPack,
  loadTaskPackSnapshot,
  type TaskPackSnapshot,
} from './taskPackSnapshot.js';
import {
  resolveExistingManifestLocalPath,
  type ManifestLocalPathInput,
} from './localPaths.js';

export { deriveWritableRootsFromFocusedSelection, getEffectiveScopeForPrimary } from './writableRootsDerivation.js';
export { readDeepFocusOverlay } from './authoritativeSelectionReader.js';
export type { AuthoritySource, DeepFocusOverlayPayload } from './authoritativeSelectionReader.js';
export { PackSchemaError } from './packSchemas.runtime.js';

/** Result of resolving focused repos for targeting and confinement metadata. */
export interface FocusedRepoResult {
  /**
   * Absolute path to the selected primary repo root.
   * Consumers may use this as the launch CWD when they still start inside the
   * focused repo, but Dalton now launches from the platform repo root and uses
   * this value as the base for explicit writable/read-only roots instead.
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
   * remain confined to writableRoots when present.
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
  /** Whether Deep Focus mode was active when this boundary was resolved. */
  deepFocusEnabled?: boolean;
  /** 'directory' or 'file' — determines confinement strategy. */
  primaryFocusTargetKind?: FocusTargetKind;
  /** Ordered normalized Deep Focus primary targets. The anchor also populates scalar fields. */
  primaryFocusTargets?: PrimaryFocusTarget[];
  /** Optional selected test target; writableRoots carries write authority. */
  testTarget?: {
    path: string;
    kind: FocusTargetKind;
    /** Absolute path resolved from primaryRepoRoot + path. */
    resolvedPath: string;
  };
  /** Raw Deep Focus test target selection, including explicit null opt-out. */
  selectedTestTarget?: FocusTarget | null;
  /** Normalized path-scoped support targets with resolved effective scopes. */
  supportTargets?: NormalizedSupportTarget[];
  /** Repo-relative roots where implementation changes are authorized. */
  writableRoots?: WritableRoot[];
  /** Repo-relative Deep Focus context roots that must remain read-only. */
  readonlyContextRoots?: ReadonlyContextRoot[];
  /** Advisory warnings surfaced during Deep Focus resolution. */
  warnings?: string[];
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

export interface ResolvedPrimaryRepo {
  repoRoot: string;
  repoId: string;
  primaryFocusId?: string;
  primaryFocusRelativePath?: string;
}

export interface ManifestRepo {
  repo_id?: string;
  local_paths?: ManifestLocalPathInput[];
  default_focusable?: boolean;
  activation_priority?: number;
  service_name?: string;
  repo_name?: string;
  repository_type?: RepositoryType;
}

export interface Manifest {
  estate_type?: string;
  primary_working_repo_ids?: string[];
  primary_focus_area_ids?: string[];
  focusable_areas?: ManifestFocusableArea[];
  repositories?: ManifestRepo[];
  repository?: ManifestRepo & { local_paths?: ManifestLocalPathInput[] };
}

export interface ManifestFocusableArea {
  focus_id?: string;
  relative_path?: string;
  repository_type?: RepositoryType;
}

/**
 * Read and parse the context pack manifest at `<contextPackDir>/qmd/repo-sources.json`.
 *
 * Resolves `contextPackDir` against `repoRoot` so callers don't silently fail
 * when CWD != repoRoot. Returns `undefined` if the manifest is missing or
 * contains invalid JSON. Throws `PackSchemaError` on schema violation (required
 * fields missing); callers that previously relied on "never throws" must be
 * updated to handle this case.
 */
export async function readContextPackManifest(
  contextPackDir: string,
  repoRoot: string,
): Promise<Manifest | undefined> {
  const resolvedPackDir = resolvePath(repoRoot, contextPackDir);
  const manifestPath = path.join(resolvedPackDir, 'qmd', 'repo-sources.json');
  const content = await readTextFile(manifestPath);
  if (content === undefined) return undefined;
  const parsed = safeJsonParse<Manifest>(content, manifestPath) ?? undefined;
  if (parsed === undefined) return undefined;
  assertManifest(parsed, manifestPath);
  return parsed;
}

/**
 * Resolve focused repo information for targeting and confinement metadata.
 *
 * No-task callers see only the manifest primary repo. Task-scoped callers
 * (with `taskId`) see the pack-snapshot's visible roots.
 *
 * Returns undefined if the manifest is missing/unparseable or the primary repo
 * path does not exist on disk. Throws `PackSchemaError` if the manifest exists
 * but fails schema validation — that error propagates rather than being silently
 * treated as "missing."
 */
export async function resolveFocusedRepoRoot(
  contextPackDir: string,
  repoRoot: string,
  options?: { taskId?: string },
): Promise<FocusedRepoResult | undefined> {
  if (options?.taskId) {
    const snapshot = await loadTaskPackSnapshot(repoRoot, options.taskId);
    assertSnapshotMatchesContextPack(snapshot, contextPackDir, repoRoot, options.taskId);
    return reconstructFocusedRepoResult(snapshot, 'active-task-sidecar');
  }

  const resolvedPackDir = resolvePath(repoRoot, contextPackDir);
  const manifest = await readContextPackManifest(resolvedPackDir, repoRoot);
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

  return {
    primaryRepoRoot: primary.repoRoot,
    visibleRepoRoots: [primary.repoRoot],
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
  options?: { taskId?: string },
): Promise<FocusedRepoResult | undefined> {
  if (options?.taskId) {
    const snapshot = await loadTaskPackSnapshot(repoRoot, options.taskId);
    assertSnapshotMatchesContextPack(snapshot, contextPackDir, repoRoot, options.taskId);
    return reconstructFocusedRepoResult(snapshot, 'active-task-sidecar');
  }

  const resolvedPackDir = resolvePath(repoRoot, contextPackDir);
  const manifestPath = path.join(resolvedPackDir, 'qmd', 'repo-sources.json');
  const [content, selection] = await Promise.all([
    readTextFile(manifestPath),
    resolveAuthoritativeSelection(resolvedPackDir, repoRoot, options),
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
  const isMonolith = estateType === 'monolith' || estateType === 'monolith-platform';
  const deepFocusPrimaryIds = selection.deepFocusEnabled === true
    ? (isMonolith
        ? collectDeepFocusPrimaryIds(
            selection.selectedFocusTargets,
            'focusId',
            selection.deepFocusPrimaryFocusId,
          )
        : collectDeepFocusPrimaryIds(
            selection.selectedFocusTargets,
            'repoId',
            selection.deepFocusPrimaryRepoId,
          ))
    : undefined;

  const primary = isMonolith
    ? resolveSelectedMonolithPrimary(
        manifest,
        resolvedPackDir,
        deepFocusPrimaryIds ?? selection.selectedFocusIds,
        { allowMultiplePrimaries: selection.deepFocusEnabled === true },
      )
    : resolveSelectedDistributedPrimary(
        manifest,
        resolvedPackDir,
        deepFocusPrimaryIds ?? selection.selectedRepoIds,
        { allowMultiplePrimaries: selection.deepFocusEnabled === true },
      );

  if (!primary) {
    return undefined;
  }

  const activatedReference = isMonolith
    ? {
        repoRoots: [primary.repoRoot],
        repoIds: [primary.repoId],
      }
    : collectSelectedDistributedReferenceRepos(
        manifest,
        resolvedPackDir,
        deepFocusPrimaryIds ?? selection.selectedRepoIds,
        primary,
      );
  const deepFocus = selection.deepFocusEnabled === true
      ? resolveDeepFocusSelection({
          estateType,
          selection,
          primaryRepoRoot: primary.repoRoot,
          declaredRepoRoots: declaredRoots,
          legacyPrimaryFocusRelativePath: primary.primaryFocusRelativePath,
        })
    : undefined;
  const primaryFocusTargets = deepFocus?.primaryFocusTargets
    ? attachPrimaryTargetIdentities(deepFocus.primaryFocusTargets, selection.selectedFocusTargets)
    : undefined;
  const derivedRoots = deriveWritableRootsFromFocusedSelection({
    primaryFocusRelativePath: deepFocus?.primaryFocusRelativePath ?? primary.primaryFocusRelativePath,
    primaryFocusTargetKind: deepFocus?.primaryFocusTargetKind,
    primaryFocusTargets: (primaryFocusTargets?.length ?? 0) > 0
      ? primaryFocusTargets
      : undefined,
    testTarget: deepFocus?.testTarget,
    supportTargets: deepFocus?.supportTargets,
  });
  const readonlyContextRoots = [
    ...derivedRoots.readonlyContextRoots,
    ...(selection.deepFocusEnabled !== true
      ? deriveStandardModeReadonlyRepoRoots({
          primaryRepoId: primary.repoId,
          supportRepos: activatedReference.repoIds.map((repoId, index) => ({
            repoId,
            repoRoot: activatedReference.repoRoots[index] ?? '',
          })),
        })
      : []),
  ];

  return {
    primaryRepoRoot: primary.repoRoot,
    visibleRepoRoots: activatedReference.repoRoots,
    declaredRepoRoots: declaredRoots,
    estateType,
    primaryRepoId: primary.repoId,
    primaryFocusId: primary.primaryFocusId,
    primaryFocusRelativePath: deepFocus?.primaryFocusRelativePath ?? primary.primaryFocusRelativePath,
    deepFocusEnabled: deepFocus?.deepFocusEnabled,
    primaryFocusTargetKind: deepFocus?.primaryFocusTargetKind,
    primaryFocusTargets,
    selectedTestTarget: deepFocus?.selectedTestTarget,
    testTarget: deepFocus?.testTarget,
    supportTargets: deepFocus?.supportTargets,
    writableRoots: derivedRoots.writableRoots,
    readonlyContextRoots,
    warnings: deepFocus?.warnings,
    selectedRepoIds: activatedReference.repoIds,
    selectedFocusIds: (deepFocusPrimaryIds ?? selection.selectedFocusIds).length > 0
      ? (deepFocusPrimaryIds ?? selection.selectedFocusIds)
      : primary.primaryFocusId
        ? [primary.primaryFocusId]
        : [],
    authoritySource: selection.source,
  };
}

function attachPrimaryTargetIdentities(
  resolvedTargets: PrimaryFocusTarget[],
  rawTargets: PrimaryFocusTarget[] | undefined,
): PrimaryFocusTarget[] {
  if (!rawTargets || rawTargets.length === 0) {
    return resolvedTargets;
  }
  return resolvedTargets.map((target, index) => {
    const rawTarget = rawTargets[index];
    if (!rawTarget) {
      return target;
    }
    return {
      ...target,
      ...(rawTarget.repoLocalPath ? { repoLocalPath: rawTarget.repoLocalPath } : {}),
      ...(rawTarget.repoId ? { repoId: rawTarget.repoId } : {}),
      ...(rawTarget.focusId ? { focusId: rawTarget.focusId } : {}),
    };
  });
}

function resolvePrimaryRepoIdForResult(snapshot: TaskPackSnapshot): string {
  const candidate = snapshot.primary.repoId ?? snapshot.estateRepoIds[0];
  if (!candidate) {
    throw new Error(
      `pack-snapshot.json for task "${snapshot.taskId}" is missing both primary.repoId and estateRepoIds. ` +
      'Re-activate or re-create the task.',
    );
  }
  return candidate;
}

function reconstructFocusedRepoResult(
  snapshot: TaskPackSnapshot,
  authoritySource: AuthoritySource,
): FocusedRepoResult {
  const selectedRepoIds: string[] = snapshot.primary.repoId
    ? [snapshot.primary.repoId, ...snapshot.support.map((repo) => repo.repoId)]
    : [...snapshot.estateRepoIds];
  const selectedFocusIds: string[] = [...snapshot.selectedFocusIds];
  return {
    primaryRepoRoot: snapshot.primary.repoRoot,
    visibleRepoRoots: [snapshot.primary.repoRoot, ...snapshot.support.map((repo) => repo.repoRoot)],
    declaredRepoRoots: [...snapshot.declaredRepoRoots],
    estateType: snapshot.estateType,
    primaryRepoId: resolvePrimaryRepoIdForResult(snapshot),
    primaryFocusId: snapshot.primary.focusId ?? undefined,
    primaryFocusRelativePath: (snapshot.deepFocus.enabled
      ? snapshot.deepFocus.primaryFocusTargets[0]?.path
      : undefined) ?? snapshot.primary.primaryFocusRelativePath ?? undefined,
    deepFocusEnabled: snapshot.deepFocus.enabled || undefined,
    primaryFocusTargetKind: snapshot.deepFocus.primaryFocusTargetKind ?? undefined,
    primaryFocusTargets: snapshot.deepFocus.primaryFocusTargets.length > 0
      ? snapshot.deepFocus.primaryFocusTargets.map((target) => ({ ...target }))
      : undefined,
    selectedTestTarget: snapshot.deepFocus.selectedTestTarget,
    supportTargets: snapshot.deepFocus.supportTargets.map((target) => ({ ...target })),
    writableRoots: snapshot.deepFocus.writableRoots.map((root) => ({ ...root })),
    readonlyContextRoots: snapshot.deepFocus.readonlyContextRoots.map((root) => ({ ...root })),
    warnings: [...snapshot.deepFocus.warnings],
    selectedRepoIds,
    selectedFocusIds,
    authoritySource,
  };
}

/**
 * Explain why {@link resolveSelectedPrimaryRepoRoot} returned undefined.
 *
 * The resolver returns undefined to keep its hot path simple, but that hides
 * the specific precondition that failed. Dalton-launch errors call this helper
 * to surface a one-line cause (manifest missing, no authoritative selection,
 * selectedRepoIds contains multiple primaries, primary repo has no resolvable
 * local_path, etc.) for operators reading logs.
 *
 * Never throws. Always returns a non-empty string.
 */
export async function explainSelectedPrimaryBoundaryFailure(
  contextPackDir: string,
  repoRoot: string,
  options?: { taskId?: string },
): Promise<string> {
  if (options?.taskId) {
    try {
      const snapshot = await loadTaskPackSnapshot(repoRoot, options.taskId);
      assertSnapshotMatchesContextPack(snapshot, contextPackDir, repoRoot, options.taskId);
      const primaryIdentity = snapshot.primary.repoId ?? snapshot.primary.focusId ?? '<unknown>';
      return `pack-snapshot.json for task "${options.taskId}" exists and targets primary "${primaryIdentity}", but the resolver returned undefined.`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  const resolvedPackDir = resolvePath(repoRoot, contextPackDir);
  const manifestPath = path.join(resolvedPackDir, 'qmd', 'repo-sources.json');
  const [content, selection] = await Promise.all([
    readTextFile(manifestPath),
    resolveAuthoritativeSelection(resolvedPackDir, repoRoot).catch(() => undefined),
  ]);

  if (content === undefined) {
    return `manifest is missing at "${manifestPath}".`;
  }
  const manifest = safeJsonParse<Manifest>(content, manifestPath);
  if (!manifest) {
    return `manifest at "${manifestPath}" is unparseable.`;
  }
  if (!selection) {
    return (
      'no authoritative active selection found — with a task ID, the task .task.json selection is checked; ' +
      'without a task ID, workspace sync and Deep Focus overlay state are checked.'
    );
  }

  const estateType = manifest.estate_type ?? 'distributed-platform';
  if (estateType === 'monolith' || estateType === 'monolith-platform') {
    return explainMonolithSelectionFailure(manifest, selection);
  }
  return explainDistributedSelectionFailure(manifest, resolvedPackDir, selection);
}

function collectDeepFocusPrimaryIds(
  targets: PrimaryFocusTarget[] | undefined,
  identityField: 'repoId' | 'focusId',
  scalarFallback?: string | null,
): string[] | undefined {
  if (targets && targets.length > 0) {
    const ids = orderedPrimaryTargets(targets)
      .map((target) => target[identityField]?.trim())
      .filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      return uniqueOrdered(ids);
    }
  }

  const scalar = scalarFallback?.trim();
  return scalar ? [scalar] : undefined;
}

function orderedPrimaryTargets(targets: PrimaryFocusTarget[]): PrimaryFocusTarget[] {
  const anchorIndex = targets.findIndex((target) => target.role === 'anchor');
  if (anchorIndex <= 0) {
    return targets;
  }
  return [targets[anchorIndex]!, ...targets.slice(0, anchorIndex), ...targets.slice(anchorIndex + 1)];
}

function uniqueOrdered(ids: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function explainDistributedSelectionFailure(
  manifest: Manifest,
  resolvedPackDir: string,
  selection: AuthoritativeSelection,
): string {
  const repositories = Array.isArray(manifest.repositories) ? manifest.repositories : [];
  const sourceLabel = `source: ${selection.source}`;
  const candidateIds = selection.deepFocusEnabled === true
    ? collectDeepFocusPrimaryIds(
        selection.selectedFocusTargets,
        'repoId',
        selection.deepFocusPrimaryRepoId,
      ) ?? selection.selectedRepoIds
    : selection.selectedRepoIds;

  if (candidateIds.length === 0) {
    return `authoritative selection (${sourceLabel}) has empty selectedRepoIds.`;
  }
  const repoById = new Map(repositories
    .filter((repo) => typeof repo.repo_id === 'string' && repo.repo_id.trim())
    .map((repo) => [repo.repo_id!.trim(), repo]));
  const primaryRepos = candidateIds
    .map((repoId) => repoById.get(repoId))
    .filter((repo): repo is ManifestRepo => repo?.repository_type === 'primary');
  if (primaryRepos.length === 0) {
    return (
      `selectedRepoIds [${candidateIds.join(', ')}] (${sourceLabel}) ` +
      'contains no repos with repository_type=primary in the manifest — exactly one required.'
    );
  }
  if (primaryRepos.length > 1) {
    const ids = primaryRepos.map((repo) => repo.repo_id ?? '<missing>').join(', ');
    if (selection.deepFocusEnabled === true) {
      const unresolvedIds = candidateIds.filter((repoId) => {
        const repo = repoById.get(repoId);
        return repo?.repository_type !== 'primary' || !resolveFirstLocalPath(repo, resolvedPackDir);
      });
      return (
        `Deep Focus selected primary repo ids [${candidateIds.join(', ')}] (${sourceLabel}) ` +
        `include ${primaryRepos.length} manifest primary repos [${ids}] in anchor-first order` +
        (unresolvedIds.length > 0
          ? `; unresolved primary ids: [${unresolvedIds.join(', ')}].`
          : '.')
      );
    }
    return (
      `selectedRepoIds [${candidateIds.join(', ')}] (${sourceLabel}) ` +
      `contains ${primaryRepos.length} repos with repository_type=primary [${ids}] — exactly one required.`
    );
  }
  const primaryRepo = primaryRepos[0];
  const repoId = primaryRepo.repo_id?.trim();
  if (!repoId) {
    return 'the selected primary repo has an empty repo_id.';
  }
  const resolved = resolveFirstLocalPath(primaryRepo, resolvedPackDir);
  if (!resolved) {
    const candidateCount = Array.isArray(primaryRepo.local_paths) ? primaryRepo.local_paths.length : 0;
    return (
      `selected primary repo "${repoId}" has no resolvable local_path on disk ` +
      `(checked ${candidateCount} candidate path(s)).`
    );
  }
  return (
    `selected primary repo "${repoId}" resolved to "${resolved}", but the resolver returned undefined — ` +
    'this likely indicates a logic bug.'
  );
}

function explainMonolithSelectionFailure(
  manifest: Manifest,
  selection: AuthoritativeSelection,
): string {
  const repo = manifest.repository ?? manifest.repositories?.[0];
  if (!repo) {
    return 'monolith manifest has no repository entry.';
  }
  const sourceLabel = `source: ${selection.source}`;
  const candidateIds = selection.deepFocusEnabled === true
    ? collectDeepFocusPrimaryIds(
        selection.selectedFocusTargets,
        'focusId',
        selection.deepFocusPrimaryFocusId,
      ) ?? selection.selectedFocusIds
    : selection.selectedFocusIds;
  if (candidateIds.length === 0) {
    return `authoritative selection (${sourceLabel}) has empty selectedFocusIds.`;
  }
  const candidateSet = new Set(candidateIds);
  const focusableAreas = Array.isArray(manifest.focusable_areas) ? manifest.focusable_areas : [];
  const primaryAreas = focusableAreas.filter((area) =>
    area.focus_id && candidateSet.has(area.focus_id) && area.repository_type === 'primary',
  );
  if (primaryAreas.length === 0) {
    return (
      `selectedFocusIds [${candidateIds.join(', ')}] (${sourceLabel}) ` +
      'contains no focusable_areas with repository_type=primary in the manifest — exactly one required.'
    );
  }
  if (primaryAreas.length > 1) {
    const ids = primaryAreas.map((area) => area.focus_id ?? '<missing>').join(', ');
    return (
      `selectedFocusIds [${candidateIds.join(', ')}] (${sourceLabel}) ` +
      `contains ${primaryAreas.length} focusable_areas with repository_type=primary [${ids}] — exactly one required.`
    );
  }
  return (
    `selected primary focus area "${primaryAreas[0].focus_id}" matches but the resolver returned undefined — ` +
    'this likely indicates a logic bug.'
  );
}

export function resolveFirstLocalPath(
  repo: ManifestRepo,
  contextPackDir: string,
): string | undefined {
  const localPaths = repo.local_paths;
  if (!Array.isArray(localPaths) || localPaths.length === 0) {
    return undefined;
  }

  for (const rawPath of localPaths) {
    const candidate = resolveExistingManifestLocalPath(rawPath, contextPackDir);
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
      const resolved = resolveExistingManifestLocalPath(rawPath, contextPackDir);
      if (!resolved || seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      roots.push(resolved);
    }
  }
  return roots;
}

/**
 * Collect directory roots for planner context visibility. Dalton write authority
 * is expressed by writableRoots/readonlyContextRoots instead.
 */
export function collectFocusedRepoTargetDirectoryRoots(
  focused?: Pick<
    FocusedRepoResult,
    'primaryRepoRoot' | 'primaryFocusRelativePath' | 'primaryFocusTargetKind' | 'primaryFocusTargets' | 'selectedTestTarget' | 'testTarget' | 'supportTargets'
  >,
): string[] {
  if (!focused) {
    return [];
  }

  const roots: string[] = [];
  const seen = new Set<string>();

  const addTargetDirectory = (
    target?: { path: string; kind: FocusTargetKind } | null,
    repoRoot?: string,
  ): void => {
    if (!target) {
      return;
    }

    const targetRepoRoot = repoRoot || focused.primaryRepoRoot;
    const targetPath = normalizeRelativePath(target.path);
    const directoryRelativePath = target.kind === 'file'
      ? normalizeParentRelativePath(targetPath)
      : targetPath;
    const resolvedRoot = directoryRelativePath
      ? path.resolve(targetRepoRoot, directoryRelativePath)
      : targetRepoRoot;

    if (seen.has(resolvedRoot)) {
      return;
    }
    seen.add(resolvedRoot);
    roots.push(resolvedRoot);
  };

  const primaryTargets: PrimaryFocusTarget[] = focused.primaryFocusTargets?.length
    ? focused.primaryFocusTargets
    : [{ path: focused.primaryFocusRelativePath ?? '', kind: focused.primaryFocusTargetKind ?? 'directory' }];
  for (const target of primaryTargets) {
    const targetRepoRoot = target.repoLocalPath || focused.primaryRepoRoot;
    addTargetDirectory(target, targetRepoRoot);
    addTargetDirectory(target.testTarget ?? null, targetRepoRoot);
    for (const supportTarget of target.supportTargets ?? []) {
      addTargetDirectory(supportTarget, targetRepoRoot);
    }
  }
  addTargetDirectory(focused.selectedTestTarget ?? focused.testTarget ?? null);
  for (const supportTarget of focused.supportTargets ?? []) {
    addTargetDirectory(supportTarget);
  }

  return roots;
}
