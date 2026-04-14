import path from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { readTextFile, safeJsonParse, resolvePath } from '../core/index.js';
import type { RepositoryType } from './types.js';
import {
  hasTraversal,
  isStrictAncestor,
  normalizeRelativePath,
  normalizeSupportTargets,
  validateTestTarget,
  type FocusTarget,
  type FocusTargetKind,
  type NormalizedSupportTarget,
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
  /** Whether Deep Focus mode was active when this boundary was resolved. */
  deepFocusEnabled?: boolean;
  /** 'directory' or 'file' — determines confinement strategy. */
  primaryFocusTargetKind?: FocusTargetKind;
  /** Optional second write boundary for test files. */
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

export type AuthoritySource = 'manifest-primary' | 'active-task-sidecar' | 'workspace-sync-state';

export interface ResolvedPrimaryRepo {
  repoRoot: string;
  repoId: string;
  primaryFocusId?: string;
  primaryFocusRelativePath?: string;
}

export interface ManifestRepo {
  repo_id?: string;
  local_paths?: string[];
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
  repository?: ManifestRepo & { local_paths?: string[] };
}

export interface ManifestFocusableArea {
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
  deepFocusEnabled?: boolean;
  deepFocusPrimaryRepoId?: string | null;
  deepFocusPrimaryFocusId?: string | null;
  selectedFocusPath?: string;
  selectedFocusTargetKind?: FocusTargetKind;
  selectedTestTarget?: FocusTarget | null;
  selectedSupportTargets?: FocusTarget[];
  source: Exclude<AuthoritySource, 'manifest-primary'>;
}

interface ResolvedDeepFocusSelection {
  deepFocusEnabled: true;
  primaryFocusRelativePath: string;
  primaryFocusTargetKind?: FocusTargetKind;
  selectedTestTarget?: FocusTarget | null;
  testTarget?: {
    path: string;
    kind: FocusTargetKind;
    resolvedPath: string;
  };
  supportTargets?: NormalizedSupportTarget[];
  warnings?: string[];
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
  // When deep focus is enabled and the dedicated ID field is set, resolve from
  // it. When the field is null/missing (backward-compat with older state files),
  // fall through to the regular-mode arrays via the ?? below.
  const deepFocusPrimaryIds = selection.deepFocusEnabled === true
    ? (estateType === 'monolith' || estateType === 'monolith-platform'
        ? (selection.deepFocusPrimaryFocusId ? [selection.deepFocusPrimaryFocusId] : undefined)
        : (selection.deepFocusPrimaryRepoId ? [selection.deepFocusPrimaryRepoId] : undefined))
    : undefined;

  const primary = estateType === 'monolith' || estateType === 'monolith-platform'
    ? resolveSelectedMonolithPrimary(manifest, resolvedPackDir, deepFocusPrimaryIds ?? selection.selectedFocusIds)
    : resolveSelectedDistributedPrimary(manifest, resolvedPackDir, deepFocusPrimaryIds ?? selection.selectedRepoIds);

  if (!primary) {
    return undefined;
  }

  const activatedReference = estateType === 'monolith' || estateType === 'monolith-platform'
    ? {
        repoRoots: [primary.repoRoot],
        repoIds: [primary.repoId],
      }
    : collectSelectedDistributedReferenceRepos(manifest, resolvedPackDir, selection.selectedRepoIds, primary);
  const deepFocus = selection.deepFocusEnabled === true
    ? resolveDeepFocusSelection({
        estateType,
        selection,
        primaryRepoRoot: primary.repoRoot,
        legacyPrimaryFocusRelativePath: primary.primaryFocusRelativePath,
      })
    : undefined;

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
    selectedTestTarget: deepFocus?.selectedTestTarget,
    testTarget: deepFocus?.testTarget,
    supportTargets: deepFocus?.supportTargets,
    warnings: deepFocus?.warnings,
    selectedRepoIds: activatedReference.repoIds,
    selectedFocusIds: selection.selectedFocusIds.length > 0
      ? selection.selectedFocusIds
      : primary.primaryFocusId
        ? [primary.primaryFocusId]
        : [],
    authoritySource: selection.source,
  };
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
  deepFocusEnabledField?: string;
  deepFocusPrimaryRepoIdField?: string;
  deepFocusPrimaryFocusIdField?: string;
  focusPathField?: string;
  focusTargetKindField?: string;
  testTargetField?: string;
  supportTargetsField?: string;
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
  const deepFocusEnabled = descriptor.deepFocusEnabledField
    ? parsed?.[descriptor.deepFocusEnabledField] === true
    : undefined;
  const deepFocusPrimaryRepoId = descriptor.deepFocusPrimaryRepoIdField
    ? toOptionalString(parsed?.[descriptor.deepFocusPrimaryRepoIdField]) ?? null
    : null;
  const deepFocusPrimaryFocusId = descriptor.deepFocusPrimaryFocusIdField
    ? toOptionalString(parsed?.[descriptor.deepFocusPrimaryFocusIdField]) ?? null
    : null;

  return {
    selectedRepoIds: toStringArray(parsed?.[descriptor.repoIdsField]),
    selectedFocusIds: toStringArray(parsed?.[descriptor.focusIdsField]),
    deepFocusEnabled,
    deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId,
    selectedFocusPath: descriptor.focusPathField
      ? deepFocusEnabled === true
        ? readDeepFocusOptionalString(parsed?.[descriptor.focusPathField], descriptor.focusPathField)
        : toOptionalString(parsed?.[descriptor.focusPathField])
      : undefined,
    selectedFocusTargetKind: descriptor.focusTargetKindField
      ? deepFocusEnabled === true
        ? readDeepFocusOptionalFocusTargetKind(parsed?.[descriptor.focusTargetKindField], descriptor.focusTargetKindField)
        : toFocusTargetKind(parsed?.[descriptor.focusTargetKindField])
      : undefined,
    selectedTestTarget: descriptor.testTargetField
      ? deepFocusEnabled === true
        ? readDeepFocusOptionalFocusTarget(parsed?.[descriptor.testTargetField], descriptor.testTargetField)
        : toFocusTarget(parsed?.[descriptor.testTargetField])
      : undefined,
    selectedSupportTargets: descriptor.supportTargetsField
      ? deepFocusEnabled === true
        ? readDeepFocusOptionalFocusTargetArray(parsed?.[descriptor.supportTargetsField], descriptor.supportTargetsField)
        : toFocusTargetArray(parsed?.[descriptor.supportTargetsField])
      : undefined,
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
    deepFocusEnabledField: 'deepFocusEnabled',
    deepFocusPrimaryRepoIdField: 'deepFocusPrimaryRepoId',
    deepFocusPrimaryFocusIdField: 'deepFocusPrimaryFocusId',
    focusPathField: 'selectedFocusPath',
    focusTargetKindField: 'selectedFocusTargetKind',
    testTargetField: 'selectedTestTarget',
    supportTargetsField: 'selectedSupportTargets',
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
    deepFocusEnabledField: 'deep_focus_enabled',
    deepFocusPrimaryRepoIdField: 'deep_focus_primary_repo_id',
    deepFocusPrimaryFocusIdField: 'deep_focus_primary_focus_id',
    focusPathField: 'selected_focus_path',
    focusTargetKindField: 'selected_focus_target_kind',
    testTargetField: 'selected_test_target',
    supportTargetsField: 'selected_support_targets',
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

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim();
}

function toFocusTargetKind(value: unknown): FocusTargetKind | undefined {
  return value === 'directory' || value === 'file' ? value : undefined;
}

function toFocusTarget(value: unknown): FocusTarget | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const targetPath = toOptionalString(candidate.path);
  const kind = toFocusTargetKind(candidate.kind);
  if (targetPath === undefined || !kind) {
    return undefined;
  }
  return { path: targetPath, kind };
}

function toFocusTargetArray(value: unknown): FocusTarget[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const targets: FocusTarget[] = [];
  for (const item of value) {
    const target = toFocusTarget(item);
    if (!target) {
      return undefined;
    }
    targets.push(target);
  }
  return targets;
}

function readDeepFocusOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Deep Focus field "${fieldName}" must be a string when deepFocusEnabled is true.`);
  }
  return value.trim();
}

function readDeepFocusOptionalFocusTargetKind(
  value: unknown,
  fieldName: string,
): FocusTargetKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const kind = toFocusTargetKind(value);
  if (!kind) {
    throw new Error(`Deep Focus field "${fieldName}" must be "directory" or "file".`);
  }
  return kind;
}

function readDeepFocusOptionalFocusTarget(value: unknown, fieldName: string): FocusTarget | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const target = toFocusTarget(value);
  if (!target) {
    throw new Error(`Deep Focus field "${fieldName}" must be an object with string path and kind.`);
  }
  return target;
}

function readDeepFocusOptionalFocusTargetArray(value: unknown, fieldName: string): FocusTarget[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const targets = toFocusTargetArray(value);
  if (!targets) {
    throw new Error(`Deep Focus field "${fieldName}" must be an array of { path, kind } objects.`);
  }
  return targets;
}

function resolveDeepFocusSelection(options: {
  selection: AuthoritativeSelection;
  estateType?: string;
  primaryRepoRoot: string;
  legacyPrimaryFocusRelativePath?: string;
}): ResolvedDeepFocusSelection {
  const canonicalRoot = realpathSync(options.primaryRepoRoot);
  const primaryTarget = resolvePrimaryDeepFocusTarget({ ...options, canonicalRoot });
  const validatedTestTarget = resolveValidatedTestTarget(
    options.primaryRepoRoot,
    primaryTarget,
    options.selection.selectedTestTarget,
    canonicalRoot,
  );
  const supportTargets = resolveValidatedSupportTargets(
    options.primaryRepoRoot,
    primaryTarget,
    validatedTestTarget?.rawTarget,
    options.selection.selectedSupportTargets ?? [],
    canonicalRoot,
  );
  const warnings = collectDeepFocusWarnings(primaryTarget, validatedTestTarget?.rawTarget);

  return {
    deepFocusEnabled: true,
    primaryFocusRelativePath: primaryTarget.path,
    primaryFocusTargetKind: primaryTarget.kind,
    selectedTestTarget: validatedTestTarget?.rawTarget ?? (options.selection.selectedTestTarget === null ? null : undefined),
    testTarget: dedupeResolvedTestTarget(primaryTarget, validatedTestTarget),
    supportTargets: supportTargets.length > 0 ? supportTargets : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function resolvePrimaryDeepFocusTarget(options: {
  selection: AuthoritativeSelection;
  estateType?: string;
  primaryRepoRoot: string;
  legacyPrimaryFocusRelativePath?: string;
  canonicalRoot?: string;
}): { path: string; kind?: FocusTargetKind } {
  const explicitPath = options.selection.selectedFocusPath;
  const explicitKind = options.selection.selectedFocusTargetKind;
  if (explicitPath !== undefined) {
    const normalizedExplicitPath = normalizeDeepFocusRelativePath(
      explicitPath,
      'Primary Deep Focus target',
    );
    if (!normalizedExplicitPath) {
      if (explicitKind === 'file') {
        throw new Error('Deep Focus repo-root selection cannot use file target kind.');
      }
      validateResolvedTargetKind(
        options.primaryRepoRoot,
        '',
        'directory',
        'Primary Deep Focus target',
        options.canonicalRoot,
      );
      return {
        path: '',
        kind: undefined,
      };
    }
    if (!explicitKind) {
      throw new Error('Deep Focus selection is missing required selectedFocusTargetKind metadata.');
    }
    const resolved = resolveExistingFocusTarget(
      options.primaryRepoRoot,
      { path: normalizedExplicitPath, kind: explicitKind },
      'Primary Deep Focus target',
      options.canonicalRoot,
    );
    if (
      isMonolithEstateType(options.estateType)
      && options.legacyPrimaryFocusRelativePath
      && !doesTargetCover(options.legacyPrimaryFocusRelativePath, 'directory', resolved.path)
    ) {
      throw new Error(
        `Primary Deep Focus target "${explicitPath}" must stay within the selected monolith focus area "${options.legacyPrimaryFocusRelativePath}".`,
      );
    }
    return resolved;
  }

  if (options.legacyPrimaryFocusRelativePath) {
    return resolveExistingFocusTarget(
      options.primaryRepoRoot,
      { path: options.legacyPrimaryFocusRelativePath, kind: 'directory' },
      'Primary Deep Focus target',
      options.canonicalRoot,
    );
  }

  if (explicitKind === 'file') {
    throw new Error('Deep Focus repo-root selection cannot use file target kind.');
  }

  validateResolvedTargetKind(
    options.primaryRepoRoot,
    '',
    'directory',
    'Primary Deep Focus target',
    options.canonicalRoot,
  );
  return {
    path: '',
    kind: undefined,
  };
}

function isMonolithEstateType(estateType: string | undefined): boolean {
  return estateType === 'monolith' || estateType === 'monolith-platform';
}

function resolveValidatedTestTarget(
  primaryRepoRoot: string,
  primaryTarget: { path: string; kind?: FocusTargetKind },
  rawTestTarget?: FocusTarget | null,
  canonicalRoot?: string,
): { rawTarget: FocusTarget; resolvedPath: string } | undefined {
  if (!rawTestTarget) {
    return undefined;
  }

  const validation = validateTestTarget({
    primaryPath: primaryTarget.path,
    primaryKind: primaryTarget.kind ?? 'directory',
    testTarget: rawTestTarget,
  });
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const resolved = resolveExistingFocusTarget(primaryRepoRoot, rawTestTarget, 'Deep Focus test target', canonicalRoot);
  return { rawTarget: { path: resolved.path, kind: resolved.kind ?? rawTestTarget.kind }, resolvedPath: resolved.resolvedPath };
}

function dedupeResolvedTestTarget(
  primaryTarget: { path: string; kind?: FocusTargetKind },
  testTarget?: { rawTarget: FocusTarget; resolvedPath: string },
): { path: string; kind: FocusTargetKind; resolvedPath: string } | undefined {
  if (!testTarget) {
    return undefined;
  }

  const primaryKind = primaryTarget.kind ?? 'directory';
  if (doesTargetCover(primaryTarget.path, primaryKind, testTarget.rawTarget.path)) {
    return undefined;
  }

  return {
    path: testTarget.rawTarget.path,
    kind: testTarget.rawTarget.kind,
    resolvedPath: testTarget.resolvedPath,
  };
}

export function collectFocusedRepoTargetDirectoryRoots(
  focused?: Pick<
    FocusedRepoResult,
    'primaryRepoRoot' | 'primaryFocusRelativePath' | 'primaryFocusTargetKind' | 'selectedTestTarget' | 'testTarget' | 'supportTargets'
  >,
): string[] {
  if (!focused) {
    return [];
  }

  const roots: string[] = [];
  const seen = new Set<string>();

  const addTargetDirectory = (target?: { path: string; kind: FocusTargetKind } | null): void => {
    if (!target) {
      return;
    }

    const targetPath = normalizeRelativePath(target.path);
    const directoryRelativePath = target.kind === 'file'
      ? normalizeParentRelativePath(targetPath)
      : targetPath;
    const resolvedRoot = directoryRelativePath
      ? path.resolve(focused.primaryRepoRoot, directoryRelativePath)
      : focused.primaryRepoRoot;

    if (seen.has(resolvedRoot)) {
      return;
    }
    seen.add(resolvedRoot);
    roots.push(resolvedRoot);
  };

  addTargetDirectory({
    path: focused.primaryFocusRelativePath ?? '',
    kind: focused.primaryFocusTargetKind ?? 'directory',
  });
  addTargetDirectory(focused.selectedTestTarget ?? focused.testTarget ?? null);
  for (const supportTarget of focused.supportTargets ?? []) {
    addTargetDirectory(supportTarget);
  }

  return roots;
}

function resolveValidatedSupportTargets(
  primaryRepoRoot: string,
  primaryTarget: { path: string; kind?: FocusTargetKind },
  rawTestTarget: FocusTarget | undefined,
  rawSupportTargets: FocusTarget[],
  canonicalRoot?: string,
): NormalizedSupportTarget[] {
  const validatedTargets = rawSupportTargets.map((target) => {
    const resolved = resolveExistingFocusTarget(primaryRepoRoot, target, 'Deep Focus support target', canonicalRoot);
    return { path: resolved.path, kind: resolved.kind ?? target.kind };
  });

  return normalizeSupportTargets({
    primaryPath: primaryTarget.path,
    primaryKind: primaryTarget.kind ?? 'directory',
    testTarget: rawTestTarget,
    rawTargets: validatedTargets,
  });
}

function resolveExistingFocusTarget(
  primaryRepoRoot: string,
  target: FocusTarget,
  label: string,
  canonicalRoot?: string,
): { path: string; kind?: FocusTargetKind; resolvedPath: string } {
  const normalizedPath = validateResolvedTargetKind(primaryRepoRoot, target.path, target.kind, label, canonicalRoot);
  return {
    path: normalizedPath,
    kind: target.kind,
    resolvedPath: normalizedPath ? path.resolve(primaryRepoRoot, normalizedPath) : primaryRepoRoot,
  };
}

function validateResolvedTargetKind(
  primaryRepoRoot: string,
  rawPath: string,
  kind: FocusTargetKind,
  label: string,
  canonicalRoot?: string,
): string {
  const normalizedPath = normalizeDeepFocusRelativePath(rawPath, label);
  const resolvedPath = normalizedPath ? path.resolve(primaryRepoRoot, normalizedPath) : primaryRepoRoot;
  ensureResolvedWithinRoot(primaryRepoRoot, rawPath, resolvedPath, label, canonicalRoot);

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(resolvedPath);
  } catch {
    throw new Error(formatInvalidFocusPathError(label, rawPath, 'does not exist on disk.'));
  }

  if (kind === 'directory' && !stats.isDirectory()) {
    throw new Error(`${label} "${rawPath}" must resolve to a directory.`);
  }
  if (kind === 'file' && !stats.isFile()) {
    throw new Error(`${label} "${rawPath}" must resolve to a file.`);
  }

  return normalizedPath;
}

function normalizeDeepFocusRelativePath(rawPath: string, label: string): string {
  if (typeof rawPath !== 'string') {
    throw new Error(`${label} path must be a string.`);
  }

  const trimmed = rawPath.trim();
  const normalizedPath = normalizeRelativePath(trimmed);

  if (normalizedPath.startsWith('/')) {
    throw new Error(formatInvalidFocusPathError(label, rawPath, 'path must be relative, not absolute.'));
  }
  if (hasTraversal(normalizedPath)) {
    throw new Error(formatInvalidFocusPathError(label, rawPath, 'path must not contain ".." traversal segments.'));
  }

  return normalizedPath;
}

function normalizeParentRelativePath(relativePath: string): string {
  const parentRelativePath = path.posix.dirname(relativePath);
  return parentRelativePath === '.' ? '' : normalizeRelativePath(parentRelativePath);
}

function ensureResolvedWithinRoot(
  primaryRepoRoot: string,
  rawPath: string,
  resolvedPath: string,
  label: string,
  preComputedCanonicalRoot?: string,
): void {
  const canonicalRoot = preComputedCanonicalRoot ?? realpathSync(primaryRepoRoot);
  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync(resolvedPath);
  } catch {
    throw new Error(
      formatInvalidFocusPathError(
        label,
        rawPath,
        `resolved path "${resolvedPath}" does not exist on disk.`,
      ),
    );
  }

  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(
      formatInvalidFocusPathError(
        label,
        rawPath,
        `resolved path "${canonicalTarget}" must stay within the selected primary repo root "${canonicalRoot}".`,
      ),
    );
  }
}

function formatInvalidFocusPathError(label: string, rawPath: string, reason: string): string {
  return `${label} "${rawPath}" is invalid: ${reason}`;
}

function collectDeepFocusWarnings(
  primaryTarget: { path: string; kind?: FocusTargetKind },
  rawTestTarget?: FocusTarget,
): string[] {
  if (!rawTestTarget || rawTestTarget.kind !== 'directory') {
    return [];
  }

  const primaryPath = normalizeRelativePath(primaryTarget.path);
  const testPath = normalizeRelativePath(rawTestTarget.path);
  if (!primaryPath || !isStrictAncestor(testPath, primaryPath)) {
    return [];
  }

  return [
    `Deep Focus test target "${rawTestTarget.path}" is an ancestor of the primary target "${primaryTarget.path}" and broadens the writable scope.`,
  ];
}

function doesTargetCover(
  boundaryPath: string,
  boundaryKind: FocusTargetKind,
  candidatePath: string,
): boolean {
  if (boundaryKind === 'file') {
    return candidatePath === boundaryPath;
  }
  if (!boundaryPath) {
    return true;
  }
  return candidatePath === boundaryPath || candidatePath.startsWith(`${boundaryPath}/`);
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
