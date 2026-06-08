import { rename, rm, writeFile } from 'node:fs/promises';
import { resolvePath, createLogger, getErrorMessage } from '../core/index.js';
import {
  buildStandardMonolithPrimaryTargets,
  readContextPackManifest,
  resolveFirstLocalPath,
  type Manifest,
  type ManifestRepo,
} from '../context-pack/focusedRepo.js';
import { resolveDeepFocusSelection } from '../context-pack/deepFocusResolver.js';
import { deriveStandardModeReadonlyRepoRoots } from '../context-pack/standardModeRepoRoots.js';
import { deriveWritableRootsFromFocusedSelection } from '../context-pack/writableRootsDerivation.js';
import type { TaskPackSnapshot } from '../context-pack/taskPackSnapshot.js';
import { resolveTaskPackSnapshotPath } from '../context-pack/taskPackSnapshot.js';
import type { TaskContextPackBinding } from './markdown.js';
import type { TaskContextPackSelection } from './taskJson.js';
import { deriveStandardSelectionRoles } from './repositoryTypes.js';

export interface WriteTaskPackSnapshotOptions {
  repoRoot: string;
  taskId: string;
  contextPackDir: string;
  contextPackId: string;
  binding: TaskContextPackBinding;
  selection: TaskContextPackSelection;
}

export async function writeTaskPackSnapshot(options: WriteTaskPackSnapshotOptions): Promise<TaskPackSnapshot> {
  const manifest = await readContextPackManifest(options.contextPackDir, options.repoRoot);
  if (!manifest) {
    throw new Error(`Cannot write pack-snapshot.json for task "${options.taskId}": context pack manifest is missing or malformed.`);
  }

  const estateType = manifest.estate_type ?? 'distributed-platform';
  const isMonolith = estateType === 'monolith' || estateType === 'monolith-platform';
  const deepFocusEnabled = options.selection.deepFocusEnabled === true;
  const rawPrimaryRepoId = deepFocusEnabled
    ? options.selection.deepFocusPrimaryRepoId ?? firstTargetIdentity(options.selection.selectedFocusTargets, 'repoId') ?? options.selection.selectedRepoIds[0]
    : options.binding.primaryRepoId;
  const selectedFocusIds = collectSelectedFocusIds(options.binding, options.selection, {
    includeDeepFocusPrimary: isMonolith && deepFocusEnabled,
  });
  const rawPrimaryFocusId = deepFocusEnabled
    ? options.selection.deepFocusPrimaryFocusId ?? firstTargetIdentity(options.selection.selectedFocusTargets, 'focusId') ?? options.selection.selectedFocusIds[0]
    : options.binding.primaryFocusId ?? options.selection.primaryFocusId ?? selectedFocusIds[0];
  const primaryRepoId = isMonolith ? undefined : rawPrimaryRepoId;
  const primaryFocusId = isMonolith ? rawPrimaryFocusId : undefined;
  const distributedRoles = !isMonolith && !deepFocusEnabled && options.binding.repositoryTypes
    ? deriveStandardSelectionRoles({
        selectedIds: options.binding.selectedRepoIds,
        repositoryTypes: options.binding.repositoryTypes,
        scalarPrimaryId: options.binding.primaryRepoId,
      })
    : undefined;
  const monolithRoles = isMonolith && !deepFocusEnabled && options.binding.repositoryTypes
    ? deriveStandardSelectionRoles({
        selectedIds: selectedFocusIds,
        repositoryTypes: options.binding.repositoryTypes,
        scalarPrimaryId: options.binding.primaryFocusId ?? options.selection.primaryFocusId,
      })
    : undefined;
  if (distributedRoles && distributedRoles.primaryIds.length === 0) {
    throw new Error(`Cannot write pack-snapshot.json for task "${options.taskId}": Selection Roles must include at least one primary selected repo.`);
  }

  if (isMonolith && rawPrimaryRepoId) {
    throw new Error(`Cannot write pack-snapshot.json for task "${options.taskId}": Primary Repo ID is invalid for monolith context packs.`);
  }
  if (!isMonolith && rawPrimaryFocusId && !rawPrimaryRepoId && !firstTargetIdentity(options.selection.selectedFocusTargets, 'repoId')) {
    throw new Error(`Cannot write pack-snapshot.json for task "${options.taskId}": Primary Focus ID is invalid for distributed context packs.`);
  }

  const effectivePrimaryRepoId = distributedRoles
    ? (distributedRoles.primaryIds.includes(primaryRepoId ?? '') ? primaryRepoId : distributedRoles.primaryIds[0])
    : primaryRepoId;
  const effectivePrimaryFocusId = monolithRoles
    ? (monolithRoles.primaryIds.includes(primaryFocusId ?? '') ? primaryFocusId : monolithRoles.primaryIds[0])
    : primaryFocusId;
  const primary = isMonolith
    ? resolveMonolithPrimary(manifest, options.contextPackDir, effectivePrimaryFocusId, selectedFocusIds, options.taskId)
    : resolveDistributedPrimary(manifest, options.contextPackDir, effectivePrimaryRepoId, options.binding.selectedRepoIds, options.taskId);
  const declaredRepoRoots = collectDeclaredRepoRoots(manifest, options.contextPackDir);
  const support = isMonolith
    ? []
    : collectSupportRepos(manifest, options.contextPackDir, distributedRoles?.supportIds ?? options.binding.selectedRepoIds, primary.repoId);
  const focusAreas = isMonolith
    ? collectFocusAreas(manifest, primary.focusId ?? '')
    : [];
  const standardMonolithPrimaryTargets = isMonolith && !deepFocusEnabled
    ? buildStandardMonolithPrimaryTargets(manifest, monolithRoles?.primaryIds ?? selectedFocusIds, primary.repoRoot)
    : undefined;
  const standardMonolithSupportTargets = isMonolith && !deepFocusEnabled && monolithRoles
    ? buildStandardMonolithSupportTargets(manifest, monolithRoles.supportIds, primary.repoRoot)
    : [];

  const deepFocusSelection = {
    selectedRepoIds: [...options.selection.selectedRepoIds],
    selectedFocusIds: [...options.selection.selectedFocusIds],
    deepFocusEnabled: true as const,
    deepFocusPrimaryRepoId: options.selection.deepFocusPrimaryRepoId ?? null,
    deepFocusPrimaryFocusId: options.selection.deepFocusPrimaryFocusId ?? null,
    selectedFocusPath: options.selection.selectedFocusPath ?? undefined,
    selectedFocusTargetKind: options.selection.selectedFocusTargetKind ?? undefined,
    selectedFocusTargets: options.selection.selectedFocusTargets,
    selectedTestTarget: options.selection.selectedTestTarget,
    selectedSupportTargets: options.selection.selectedSupportTargets,
    source: 'active-task-sidecar' as const,
  };
  const deepFocus = deepFocusEnabled
    ? tryResolveDeepFocusSelection({
        estateType,
        selection: deepFocusSelection,
        primaryRepoRoot: primary.repoRoot,
        declaredRepoRoots,
        legacyPrimaryFocusRelativePath: primary.primaryFocusRelativePath ?? undefined,
      })
    : undefined;
  const deepFocusPrimaryTargets = isMonolith && deepFocusEnabled
    ? attachDefaultRepoLocalPath(deepFocus?.primaryFocusTargets, primary.repoRoot)
    : deepFocus?.primaryFocusTargets;
  const derivedRoots = deriveWritableRootsFromFocusedSelection({
    primaryFocusRelativePath: deepFocus?.primaryFocusRelativePath ?? primary.primaryFocusRelativePath ?? undefined,
    primaryFocusTargetKind: deepFocus?.primaryFocusTargetKind,
    primaryFocusTargets: deepFocusPrimaryTargets ?? standardMonolithPrimaryTargets,
    testTarget: deepFocus?.testTarget,
    supportTargets: deepFocus?.supportTargets,
  });
  const distributedPrimaryWritableRoots = distributedRoles
    ? distributedRoles.primaryIds
        .map((repoId) => resolveDistributedPrimary(manifest, options.contextPackDir, repoId, options.binding.selectedRepoIds, options.taskId))
        .map((repo) => ({
          repoLocalPath: repo.repoRoot,
          path: '',
          kind: 'directory' as const,
          reason: 'selected-primary' as const,
        }))
    : [];
  const monolithSupportRoots = standardMonolithSupportTargets.length > 0
    ? deriveWritableRootsFromFocusedSelection({
        primaryFocusTargets: [],
        supportTargets: standardMonolithSupportTargets,
      }).readonlyContextRoots
    : [];
  const writableRoots = isMonolith && !deepFocusEnabled
    ? derivedRoots.writableRoots.map((root) => (
        root.repoLocalPath ? root : { ...root, repoLocalPath: primary.repoRoot }
      ))
    : derivedRoots.writableRoots;

  const snapshot: TaskPackSnapshot = {
    schemaVersion: 2,
    stagedAt: new Date().toISOString(),
    taskId: options.taskId,
    contextPackDir: resolvePath(options.repoRoot, options.contextPackDir),
    contextPackId: options.contextPackId,
    estateType,
    primary: {
      repoId: isMonolith ? null : primary.repoId,
      focusId: isMonolith ? primary.focusId : null,
      repoRoot: primary.repoRoot,
      primaryFocusRelativePath: primary.primaryFocusRelativePath ?? null,
    },
    support,
    focusAreas,
    selectedFocusIds,
    qmdScopeRoot: readQmdScopeRoot(manifest, options.contextPackId),
    estateRepoIds: collectEstateRepoIds(manifest),
    declaredRepoRoots,
    deepFocus: {
      enabled: deepFocusEnabled,
      primaryFocusTargetKind: deepFocus?.primaryFocusTargetKind ?? options.selection.selectedFocusTargetKind ?? null,
      primaryFocusTargets: deepFocusPrimaryTargets ?? standardMonolithPrimaryTargets ?? options.selection.selectedFocusTargets ?? [],
      selectedTestTarget: deepFocus?.selectedTestTarget ?? options.selection.selectedTestTarget ?? null,
      supportTargets: deepFocus?.supportTargets ?? [],
      writableRoots: [...writableRoots, ...distributedPrimaryWritableRoots],
      readonlyContextRoots: [
        ...derivedRoots.readonlyContextRoots,
        ...monolithSupportRoots,
        ...(deepFocusEnabled
          ? []
          : deriveStandardModeReadonlyRepoRoots({
              primaryRepoId: primary.repoId,
              supportRepos: support,
            })),
      ],
      warnings: deepFocus?.warnings ?? [],
    },
  };

  const snapshotPath = resolveTaskPackSnapshotPath(options.repoRoot, options.taskId);
  await writeJsonAtomic(snapshotPath, snapshot);
  return snapshot;
}

const log = createLogger('platform/queue/packSnapshot');

function tryResolveDeepFocusSelection(
  options: Parameters<typeof resolveDeepFocusSelection>[0],
): ReturnType<typeof resolveDeepFocusSelection> | undefined {
  try {
    return resolveDeepFocusSelection(options);
  } catch (err) {
    // Deep-focus resolution is best-effort (caller falls back to standard
    // targets), but a swallowed failure was a black box — log it so an
    // inconsistent pack is diagnosable.
    log.warn('pack_snapshot.deep_focus.resolution_failed', { error: getErrorMessage(err) });
    return undefined;
  }
}

function resolveDistributedPrimary(
  manifest: Manifest,
  contextPackDir: string,
  primaryRepoId: string | undefined,
  selectedRepoIds: string[],
  taskId: string,
): { repoId: string; repoRoot: string; focusId: null; primaryFocusRelativePath: null } {
  if (!primaryRepoId) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": Primary Repo ID is required for distributed context packs.`);
  }
  if (!selectedRepoIds.includes(primaryRepoId)) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": Primary Repo ID "${primaryRepoId}" is not in Selected Repo IDs.`);
  }
  const repo = manifest.repositories?.find((candidate) => candidate.repo_id === primaryRepoId);
  if (!repo) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": Primary Repo ID "${primaryRepoId}" is not declared in the manifest.`);
  }
  const repoRoot = resolveFirstLocalPath(repo, contextPackDir);
  if (!repoRoot) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": Primary Repo ID "${primaryRepoId}" has no resolvable local_path.`);
  }
  return { repoId: primaryRepoId, repoRoot, focusId: null, primaryFocusRelativePath: null };
}

function resolveMonolithPrimary(
  manifest: Manifest,
  contextPackDir: string,
  primaryFocusId: string | undefined,
  selectedFocusIds: string[],
  taskId: string,
): { repoId: string; repoRoot: string; focusId: string; primaryFocusRelativePath: string } {
  if (!primaryFocusId) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": Primary Focus ID is required for monolith context packs.`);
  }
  if (!selectedFocusIds.includes(primaryFocusId)) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": Primary Focus ID "${primaryFocusId}" is not in Selected Focus IDs.`);
  }
  const area = manifest.focusable_areas?.find((candidate) => candidate.focus_id === primaryFocusId);
  if (!area) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": Primary Focus ID "${primaryFocusId}" is not declared in the manifest.`);
  }
  const relativePath = area.relative_path?.trim();
  if (!relativePath) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": Primary Focus ID "${primaryFocusId}" is missing relative_path.`);
  }
  const repo = manifest.repository ?? manifest.repositories?.[0];
  const repoRoot = repo ? resolveFirstLocalPath(repo, contextPackDir) : undefined;
  if (!repoRoot) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": monolith repository has no resolvable local_path.`);
  }
  const repoId = repo!.repo_id?.trim();
  if (!repoId) {
    throw new Error(`Cannot write pack-snapshot.json for task "${taskId}": monolith repository is missing repo_id.`);
  }
  return { repoId, repoRoot, focusId: primaryFocusId, primaryFocusRelativePath: relativePath };
}

function collectSupportRepos(manifest: Manifest, contextPackDir: string, selectedRepoIds: string[], primaryRepoId: string) {
  const repoById = new Map((manifest.repositories ?? [])
    .filter((repo) => repo.repo_id)
    .map((repo) => [repo.repo_id!, repo] as const));
  return selectedRepoIds
    .filter((repoId) => repoId !== primaryRepoId)
    .map((repoId) => {
      const repo = repoById.get(repoId);
      const repoRoot = repo ? resolveFirstLocalPath(repo, contextPackDir) : undefined;
      return repoRoot ? { repoId, repoRoot } : undefined;
    })
    .filter((repo): repo is { repoId: string; repoRoot: string } => repo !== undefined);
}

function buildStandardMonolithSupportTargets(
  manifest: Manifest,
  supportFocusIds: string[],
  repoRoot: string,
) {
  const support = new Set(supportFocusIds);
  return (manifest.focusable_areas ?? [])
    .filter((area) => area.focus_id && support.has(area.focus_id) && area.relative_path?.trim())
    .map((area) => ({
      path: area.relative_path!.trim(),
      kind: 'directory' as const,
      repoLocalPath: repoRoot,
      focusId: area.focus_id,
      effectiveScope: 'full-directory' as const,
    }));
}

function collectFocusAreas(manifest: Manifest, primaryFocusId: string) {
  return (manifest.focusable_areas ?? [])
    .filter((area) => area.focus_id && area.relative_path)
    .map((area) => ({
      focusId: area.focus_id!,
      relativePath: area.relative_path!,
      isPrimary: area.focus_id === primaryFocusId,
    }));
}

function collectSelectedFocusIds(
  binding: TaskContextPackBinding,
  selection: TaskContextPackSelection,
  options: { includeDeepFocusPrimary?: boolean } = {},
): string[] {
  const merged = [
    ...selection.selectedFocusIds,
    ...binding.selectedFocusIds,
  ];
  if (options.includeDeepFocusPrimary) {
    merged.push(
      selection.deepFocusPrimaryFocusId ?? '',
      binding.deepFocusPrimaryFocusId ?? '',
      selection.primaryFocusId ?? '',
      binding.primaryFocusId ?? '',
      ...collectPrimaryTargetFocusIds(selection.selectedFocusTargets),
      ...collectPrimaryTargetFocusIds(binding.selectedFocusTargets),
    );
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of merged) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function collectPrimaryTargetFocusIds(targets: { focusId?: string }[] | undefined): string[] {
  return (targets ?? []).map((target) => target.focusId ?? '');
}

function attachDefaultRepoLocalPath<T extends { repoLocalPath?: string }>(
  targets: T[] | undefined,
  repoRoot: string,
): T[] | undefined {
  return targets?.map((target) => (
    target.repoLocalPath ? target : { ...target, repoLocalPath: repoRoot }
  ));
}

function collectDeclaredRepoRoots(manifest: Manifest, contextPackDir: string): string[] {
  const repos: ManifestRepo[] = [];
  if (manifest.repository) repos.push(manifest.repository);
  if (manifest.repositories) repos.push(...manifest.repositories);
  const roots = repos
    .map((repo) => resolveFirstLocalPath(repo, contextPackDir))
    .filter((root): root is string => root !== undefined);
  return [...new Set(roots)];
}

function collectEstateRepoIds(manifest: Manifest): string[] {
  const ids = (manifest.repositories ?? [])
    .map((repo) => repo.repo_id?.trim())
    .filter((repoId): repoId is string => Boolean(repoId));
  if (ids.length > 0) return ids;
  const repoId = manifest.repository?.repo_id?.trim();
  return repoId ? [repoId] : [];
}

function readQmdScopeRoot(manifest: Manifest, contextPackId: string): string {
  const raw = (manifest as Manifest & { qmd_scope_root?: unknown }).qmd_scope_root;
  return typeof raw === 'string' && raw.trim()
    ? raw.trim()
    : `qmd/context-packs/${contextPackId}`;
}

function firstTargetIdentity(targets: TaskContextPackSelection['selectedFocusTargets'], field: 'repoId' | 'focusId'): string | undefined {
  return targets?.map((target) => target[field]?.trim()).find(Boolean);
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmpPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    await rename(tmpPath, filePath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
