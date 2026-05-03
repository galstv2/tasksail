/**
 * Context pack catalog: listing, search roots, runtime state derivation, inspection.
 */
import { readdir as fsReadDir } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';

import {
  type ContextPackCatalogEntry,
  type ContextPackCatalogSource,
  type ContextPackDeepFocusDerivedRoot,
  type ContextPackDeepFocusTarget,
  type ContextPackPrimaryFocusTarget,
  type ContextPackFocusTargetKind,
  type ContextPackFocusTarget,
  type ContextPackListResponse,
  type WorkspaceScopeMode,
} from '../src/shared/desktopContract';
import { getActiveProvider } from '../../../backend/platform/cli-provider/index.js';
import { REPO_ROOT } from './paths';
import { pathExists, numberOrNull, stringOrNull, repoFs } from './utils';
import { portablePathBasename, readDeepFocusPath, stringArray } from './main.contextPackShared';

const ENV_FILE_PATH = join(REPO_ROOT, '.env');
export const WORKSPACE_SYNC_STATE_PATH = join(
  REPO_ROOT,
  '.platform-state/workspace-context-sync.json',
);
const CONTEXT_PACK_ENV_VARS = getActiveProvider(REPO_ROOT).contextPackEnvVars();
const CONTEXT_PACK_PATHS_ENV = CONTEXT_PACK_ENV_VARS.paths;
const CONTEXT_PACK_SEARCH_ROOTS_ENV = CONTEXT_PACK_ENV_VARS.searchRoots;

type WorkspaceSyncStateSnapshot = {
  activeContextPackDir: string | null;
  activeContextPackId: string | null;
  scopeMode: WorkspaceScopeMode | null;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  derivedWritableRoots?: ContextPackDeepFocusDerivedRoot[];
  derivedReadonlyContextRoots?: ContextPackDeepFocusDerivedRoot[];
  managedFolders: string[];
  attachedManagedFolders: string[];
  missingManagedFolders: string[];
  status: string;
  lastSyncedAt: string | null;
  workspaceFolderCount: number | null;
  workspaceFileCount: number | null;
};

function repositoryTypeOrNull(value: unknown): 'primary' | 'support' | null {
  return value === 'primary' || value === 'support' ? value : null;
}

function resolveFirstLocalPath(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      return resolve(entry);
    }
  }

  return null;
}

function parseDeepFocusTarget(
  value: unknown,
): ContextPackDeepFocusTarget | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const target = value as { path?: unknown; kind?: unknown };
  if (
    typeof target.path !== 'string'
    || (target.kind !== 'directory' && target.kind !== 'file')
  ) {
    return null;
  }
  return {
    path: target.path,
    kind: target.kind,
  };
}

function parseDeepFocusTargetList(
  value: unknown,
): ContextPackDeepFocusTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((target) => parseDeepFocusTarget(target))
     .filter((target): target is ContextPackDeepFocusTarget => target !== null);
}

function parseNestedDeepFocusTarget(
  value: Record<string, unknown>,
  camelKey: 'testTarget' | 'supportTargets',
  snakeKey: 'test_target' | 'support_targets',
): unknown {
  return Object.prototype.hasOwnProperty.call(value, snakeKey)
    ? value[snakeKey]
    : value[camelKey];
}

function parsePrimaryFocusTargetList(
  value: unknown,
): ContextPackPrimaryFocusTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((target): ContextPackPrimaryFocusTarget | null => {
       const parsed = parseDeepFocusTarget(target);
       if (!parsed || typeof target !== 'object' || target === null) {
         return null;
       }
       const rawTarget = target as Record<string, unknown>;
       const role = rawTarget.role;
       const testTarget = parseDeepFocusTarget(
         parseNestedDeepFocusTarget(rawTarget, 'testTarget', 'test_target'),
       );
       const supportTargets = parseDeepFocusTargetList(
         parseNestedDeepFocusTarget(rawTarget, 'supportTargets', 'support_targets'),
       );
       const rawRepoLocalPath = Object.prototype.hasOwnProperty.call(rawTarget, 'repo_local_path')
         ? rawTarget.repo_local_path
         : rawTarget.repoLocalPath;
       const repoLocalPath = typeof rawRepoLocalPath === 'string' && rawRepoLocalPath.length > 0
         ? rawRepoLocalPath
         : undefined;
       const rawRepoId = Object.prototype.hasOwnProperty.call(rawTarget, 'repo_id')
         ? rawTarget.repo_id
         : rawTarget.repoId;
       const repoId = typeof rawRepoId === 'string' && rawRepoId.length > 0
         ? rawRepoId
         : undefined;
       const rawFocusId = Object.prototype.hasOwnProperty.call(rawTarget, 'focus_id')
         ? rawTarget.focus_id
         : rawTarget.focusId;
       const focusId = typeof rawFocusId === 'string' && rawFocusId.length > 0
         ? rawFocusId
         : undefined;
       return {
         ...parsed,
         ...(repoLocalPath ? { repoLocalPath } : {}),
         ...(repoId ? { repoId } : {}),
         ...(focusId ? { focusId } : {}),
         ...(role === 'anchor' || role === 'primary' ? { role } : {}),
        ...(testTarget ? { testTarget } : {}),
         ...(supportTargets.length > 0 ? { supportTargets } : {}),
       };
     })
    .filter((target): target is ContextPackPrimaryFocusTarget => target !== null);
}

function parseDeepFocusDerivedRoot(
  value: unknown,
): ContextPackDeepFocusDerivedRoot | null {
  const target = parseDeepFocusTarget(value);
  if (!target || typeof value !== 'object' || value === null) {
    return null;
  }
  const reason = (value as { reason?: unknown }).reason;
  if (
     reason !== 'selected-primary'
     && reason !== 'primary-focus-parent'
     && reason !== 'test-target'
     && reason !== 'support-target'
     && reason !== 'scoped-test-target'
     && reason !== 'scoped-support-target'
   ) {
     return null;
   }
   const sourceTargets = parsePrimaryFocusTargetList(
     Object.prototype.hasOwnProperty.call(value as Record<string, unknown>, 'source_targets')
       ? (value as Record<string, unknown>).source_targets
       : (value as { sourceTargets?: unknown }).sourceTargets,
   );
    const rawRoot = value as Record<string, unknown>;
    const rawRepoLocalPath = Object.prototype.hasOwnProperty.call(rawRoot, 'repo_local_path')
      ? rawRoot.repo_local_path
      : rawRoot.repoLocalPath;
    const repoLocalPath = typeof rawRepoLocalPath === 'string' && rawRepoLocalPath.length > 0
      ? rawRepoLocalPath
      : undefined;
    return {
      ...target,
      reason,
      ...(repoLocalPath ? { repoLocalPath } : {}),
      ...(sourceTargets.length > 0 ? { sourceTargets } : {}),
    };
}

function parseDeepFocusDerivedRootList(
  value: unknown,
): ContextPackDeepFocusDerivedRoot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((target) => parseDeepFocusDerivedRoot(target))
    .filter((target): target is ContextPackDeepFocusDerivedRoot => target !== null);
}

function parseConfiguredPaths(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => resolve(entry));
}

function dedupeResolvedPaths(paths: readonly string[]): string[] {
  const deduped = new Set<string>();
  for (const path of paths) {
    if (path.trim().length === 0) {
      continue;
    }
    deduped.add(resolve(path));
  }
  return [...deduped];
}

export function getDefaultContextPackSearchRoots(repoRoot: string = REPO_ROOT): string[] {
  return dedupeResolvedPaths([
    resolve(repoRoot, 'contextpacks'),
    resolve(repoRoot, 'context-packs'),
    resolve(repoRoot, '..', 'context-packs'),
  ]);
}

export function resolveContextPackSearchRoots(
  configuredRoots: readonly string[],
  repoRoot: string = REPO_ROOT,
): string[] {
  return dedupeResolvedPaths([
    ...configuredRoots,
    ...getDefaultContextPackSearchRoots(repoRoot),
  ]);
}

async function readEnvAssignment(key: string): Promise<string | null> {
  if (!(await pathExists(ENV_FILE_PATH, repoFs))) {
    return null;
  }

  const content = await repoFs.readFile(ENV_FILE_PATH, 'utf-8');
  const match = content.match(new RegExp(`^[\\t ]*${key}=(.*)$`, 'm'));
  if (!match) {
    return null;
  }

  const value = match[1]?.trim() ?? '';
  return value.replace(/^['"]|['"]$/g, '') || null;
}

function normalizeWorkspaceFolderPath(rawPath: string): string {
  return resolve(REPO_ROOT, rawPath);
}

async function readWorkspaceFolderPaths(): Promise<Set<string>> {
  const workspaceFilePath = join(REPO_ROOT, 'tasksail.code-workspace');
  if (!(await pathExists(workspaceFilePath, repoFs))) {
    return new Set();
  }

  try {
    const payload = JSON.parse(await repoFs.readFile(workspaceFilePath, 'utf-8')) as {
      folders?: unknown;
    };
    const folders = Array.isArray(payload.folders) ? payload.folders : [];
    const paths = new Set<string>();
    for (const folder of folders) {
      if (typeof folder === 'string' && folder.trim().length > 0) {
        paths.add(normalizeWorkspaceFolderPath(folder));
        continue;
      }

      if (
        typeof folder === 'object' &&
        folder !== null &&
        'path' in folder &&
        typeof (folder as { path?: unknown }).path === 'string'
      ) {
        paths.add(normalizeWorkspaceFolderPath(String((folder as { path: string }).path)));
      }
    }
    return paths;
  } catch (error: unknown) {
    console.warn('readWorkspaceFolderPaths: failed to parse workspace file:',
      error instanceof Error ? error.message : error);
    return new Set();
  }
}

export async function readWorkspaceSyncStateSnapshot(): Promise<WorkspaceSyncStateSnapshot> {
  const workspacePaths = await readWorkspaceFolderPaths();
  if (!(await pathExists(WORKSPACE_SYNC_STATE_PATH, repoFs))) {
    return {
      activeContextPackDir: null,
      activeContextPackId: null,
      scopeMode: null,
      selectedRepoIds: [],
      selectedFocusIds: [],
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
      derivedWritableRoots: [],
      derivedReadonlyContextRoots: [],
      managedFolders: [],
      attachedManagedFolders: [],
      missingManagedFolders: [],
      status: 'idle',
      lastSyncedAt: null,
      workspaceFolderCount: null,
      workspaceFileCount: null,
    };
  }

  try {
    const state = JSON.parse(await repoFs.readFile(WORKSPACE_SYNC_STATE_PATH, 'utf-8')) as {
      active_context_pack_dir?: unknown;
      active_context_pack_id?: unknown;
      scope_mode?: unknown;
      selected_repo_ids?: unknown;
      selected_focus_ids?: unknown;
      deep_focus_enabled?: unknown;
      deep_focus_primary_repo_id?: unknown;
      deep_focus_primary_focus_id?: unknown;
      selected_focus_path?: unknown;
      selected_focus_target_kind?: unknown;
      selected_focus_targets?: unknown;
      selected_test_target?: unknown;
      selected_support_targets?: unknown;
      derived_writable_roots?: unknown;
      derived_readonly_context_roots?: unknown;
      managed_folders?: unknown;
      status?: unknown;
      last_synced_at?: unknown;
      workspace_folder_count?: unknown;
      workspace_file_count?: unknown;
    };
    const activeContextPackDir = stringOrNull(state.active_context_pack_dir);
    const managedFolders = stringArray(state.managed_folders).map((path) => resolve(path));
    const attachedManagedFolders = managedFolders.filter((path) => workspacePaths.has(path));
    const missingManagedFolders = managedFolders.filter((path) => !workspacePaths.has(path));
    const deepFocusEnabled = state.deep_focus_enabled === true;
    return {
      activeContextPackDir: activeContextPackDir ? resolve(activeContextPackDir) : null,
      activeContextPackId: stringOrNull(state.active_context_pack_id),
      scopeMode: 'focused',
      selectedRepoIds: stringArray(state.selected_repo_ids),
      selectedFocusIds: stringArray(state.selected_focus_ids),
      deepFocusEnabled,
      deepFocusPrimaryRepoId: stringOrNull(state.deep_focus_primary_repo_id),
      deepFocusPrimaryFocusId: stringOrNull(state.deep_focus_primary_focus_id),
      selectedFocusPath: readDeepFocusPath(state.selected_focus_path),
      selectedFocusTargetKind:
        (state.selected_focus_target_kind === 'directory'
          || state.selected_focus_target_kind === 'file')
          ? state.selected_focus_target_kind
          : null,
      selectedFocusTargets: parsePrimaryFocusTargetList(state.selected_focus_targets),
      selectedTestTarget:
        Object.prototype.hasOwnProperty.call(state, 'selected_test_target')
          ? parseDeepFocusTarget(state.selected_test_target)
          : undefined,
      selectedSupportTargets: parseDeepFocusTargetList(state.selected_support_targets),
      derivedWritableRoots: parseDeepFocusDerivedRootList(state.derived_writable_roots),
      derivedReadonlyContextRoots: parseDeepFocusDerivedRootList(state.derived_readonly_context_roots),
      managedFolders,
      attachedManagedFolders,
      missingManagedFolders,
      status: stringOrNull(state.status) ?? 'idle',
      lastSyncedAt: stringOrNull(state.last_synced_at),
      workspaceFolderCount: numberOrNull(state.workspace_folder_count),
      workspaceFileCount: numberOrNull(state.workspace_file_count),
    };
  } catch (error: unknown) {
    console.warn('readWorkspaceSyncStateSnapshot: failed to parse sync state:',
      error instanceof Error ? error.message : error);
    return {
      activeContextPackDir: null,
      activeContextPackId: null,
      scopeMode: null,
      selectedRepoIds: [],
      selectedFocusIds: [],
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
      derivedWritableRoots: [],
      derivedReadonlyContextRoots: [],
      managedFolders: [],
      attachedManagedFolders: [],
      missingManagedFolders: [],
      status: 'idle',
      lastSyncedAt: null,
      workspaceFolderCount: null,
      workspaceFileCount: null,
    };
  }
}

export function deriveContextPackRuntimeState(
  contextPackDir: string,
  envActiveContextPackDir: string | null,
  syncState: WorkspaceSyncStateSnapshot,
  persistedCounts?: { folderCount: number | null; fileCount: number | null },
): Pick<
  ContextPackCatalogEntry,
  | 'isActive'
  | 'status'
  | 'statusMessage'
  | 'driftDetected'
  | 'restoreAvailable'
  | 'lastSyncedAt'
  | 'lastAppliedScopeMode'
  | 'lastAppliedSelectedRepoIds'
  | 'lastAppliedSelectedFocusIds'
  | 'lastAppliedDeepFocusEnabled'
  | 'lastAppliedDeepFocusPrimaryRepoId'
  | 'lastAppliedDeepFocusPrimaryFocusId'
  | 'lastAppliedSelectedFocusPath'
  | 'lastAppliedSelectedFocusTargetKind'
  | 'lastAppliedSelectedFocusTargets'
  | 'lastAppliedSelectedTestTarget'
  | 'lastAppliedSelectedSupportTargets'
  | 'lastAppliedDerivedWritableRoots'
  | 'lastAppliedDerivedReadonlyContextRoots'
  | 'workspaceFolderCount'
  | 'workspaceFileCount'
> {
  const normalizedContextPackDir = resolve(contextPackDir);
  const stateActiveDir = syncState.activeContextPackDir;
  const envActiveDir = envActiveContextPackDir ? resolve(envActiveContextPackDir) : null;
  const effectiveActiveDir = envActiveDir ?? stateActiveDir;
  const isActive = effectiveActiveDir === normalizedContextPackDir;
  const stateTracksEntry = stateActiveDir === normalizedContextPackDir;
  const driftDetected = stateTracksEntry && syncState.missingManagedFolders.length > 0;

  let status: ContextPackCatalogEntry['status'] = 'inactive';
  let statusMessage: string | null = null;
  if (isActive) {
    if (stateTracksEntry && syncState.status === 'workspace-sync-failed') {
      status = 'workspace-sync-failed';
      statusMessage = 'Workspace sync failed. Try applying again to restore.';
    } else if (stateTracksEntry && syncState.status === 'activation-failed') {
      status = 'activation-failed';
      statusMessage = 'Activation did not complete. Try applying again.';
    } else if (driftDetected || (envActiveDir !== null && !stateTracksEntry)) {
      status = 'active-dirty-workspace';
      statusMessage = driftDetected
        ? 'Workspace folders changed since last apply. Re-apply to reconcile.'
        : 'Active pack changed outside the desktop. Apply to sync.';
    } else {
      status = 'active';
      statusMessage = 'Active and synced.';
    }
  }

  return {
    isActive,
    status,
    statusMessage,
    driftDetected,
    restoreAvailable: stateTracksEntry && status !== 'active',
    lastSyncedAt: stateTracksEntry ? syncState.lastSyncedAt : null,
    lastAppliedScopeMode: stateTracksEntry ? syncState.scopeMode : null,
    lastAppliedSelectedRepoIds: stateTracksEntry ? syncState.selectedRepoIds : [],
    lastAppliedSelectedFocusIds: stateTracksEntry ? syncState.selectedFocusIds : [],
    lastAppliedDeepFocusEnabled: stateTracksEntry ? syncState.deepFocusEnabled : false,
    lastAppliedDeepFocusPrimaryRepoId: stateTracksEntry ? syncState.deepFocusPrimaryRepoId : null,
    lastAppliedDeepFocusPrimaryFocusId: stateTracksEntry ? syncState.deepFocusPrimaryFocusId : null,
    lastAppliedSelectedFocusPath: stateTracksEntry ? syncState.selectedFocusPath : null,
    lastAppliedSelectedFocusTargetKind:
      stateTracksEntry ? syncState.selectedFocusTargetKind : null,
    lastAppliedSelectedFocusTargets:
      stateTracksEntry ? syncState.selectedFocusTargets : [],
    lastAppliedSelectedTestTarget:
      stateTracksEntry ? syncState.selectedTestTarget : undefined,
    lastAppliedSelectedSupportTargets:
      stateTracksEntry ? syncState.selectedSupportTargets : [],
    lastAppliedDerivedWritableRoots:
      stateTracksEntry ? syncState.derivedWritableRoots ?? [] : [],
    lastAppliedDerivedReadonlyContextRoots:
      stateTracksEntry ? syncState.derivedReadonlyContextRoots ?? [] : [],
    workspaceFolderCount: (stateTracksEntry ? syncState.workspaceFolderCount : null)
      ?? persistedCounts?.folderCount ?? null,
    workspaceFileCount: (stateTracksEntry ? syncState.workspaceFileCount : null)
      ?? persistedCounts?.fileCount ?? null,
  };
}

async function readPersistedWorkspaceCounts(
  contextPackDir: string,
): Promise<{ repoCount: number | null; folderCount: number | null; fileCount: number | null }> {
  try {
    const raw = JSON.parse(
      await repoFs.readFile(join(contextPackDir, 'workspace-counts.json'), 'utf-8'),
    ) as Record<string, unknown>;
    return {
      repoCount: numberOrNull(raw.repo_count),
      folderCount: numberOrNull(raw.folder_count),
      fileCount: numberOrNull(raw.file_count),
    };
  } catch {
    return { repoCount: null, folderCount: null, fileCount: null };
  }
}

async function inspectContextPackDir(
  contextPackDir: string,
): Promise<{
  manifestPath: string | null;
  bootstrapReady: boolean;
  contextPackId: string;
  displayName: string;
  estateType: string | null;
  defaultScopeMode: WorkspaceScopeMode | null;
  repoCount: number;
  primaryWorkingRepoIds: string[];
  focusTargets: ContextPackFocusTarget[];
  persistedCounts: { folderCount: number | null; fileCount: number | null };
} | null> {
  const normalizedDir = resolve(contextPackDir);
  const manifestPath = join(normalizedDir, 'qmd/repo-sources.json');
  const bootstrapAnswersPath = join(normalizedDir, 'qmd/bootstrap/bootstrap-answers.json');
  const hasManifest = await pathExists(manifestPath, repoFs);
  const hasBootstrapAnswers = await pathExists(bootstrapAnswersPath, repoFs);

  if (!hasManifest && !hasBootstrapAnswers) {
    return null;
  }

  let contextPackId = portablePathBasename(normalizedDir) || normalizedDir;
  let displayName = contextPackId;
  let estateType: string | null = null;
  let defaultScopeMode: WorkspaceScopeMode | null = 'focused';
  let repoCount = 0;
  let primaryWorkingRepoIds: string[] = [];
  let focusTargets: ContextPackFocusTarget[] = [];
  if (hasManifest) {
    try {
      const manifest = JSON.parse(await repoFs.readFile(manifestPath, 'utf-8')) as {
        context_pack_id?: unknown;
        display_name?: unknown;
        estate_type?: unknown;
        default_scope_mode?: unknown;
        primary_working_repo_ids?: unknown;
        primary_focus_area_ids?: unknown;
        repository?: unknown;
        repositories?: unknown;
        focusable_areas?: unknown;
      };
      contextPackId = stringOrNull(manifest.context_pack_id) ?? contextPackId;
      displayName = stringOrNull(manifest.display_name) ?? contextPackId;
      estateType = stringOrNull(manifest.estate_type);
      defaultScopeMode = 'focused';

      const repositories = Array.isArray(manifest.repositories)
        ? manifest.repositories.filter(
            (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
          )
        : [];
      const monolithRepository = typeof manifest.repository === 'object' && manifest.repository !== null
        ? manifest.repository as Record<string, unknown>
        : null;
      repoCount = repositories.length;
      if (estateType === 'monolith' || estateType === 'monolith-platform') {
        const monolithRepoLocalPath = resolveFirstLocalPath(monolithRepository?.local_paths)
          ?? resolveFirstLocalPath(repositories[0]?.local_paths);
        const focusableAreas = Array.isArray(manifest.focusable_areas)
          ? manifest.focusable_areas.filter(
              (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
            )
          : [];
        const monolithFocusTargets: ContextPackFocusTarget[] = [];
        for (const area of focusableAreas) {
          const focusId = stringOrNull(area.focus_id);
          if (!focusId) continue;

          monolithFocusTargets.push({
            focusId,
            displayName: stringOrNull(area.focus_name) ?? stringOrNull(area.relative_path) ?? focusId,
            kind: 'focus-area',
            repoId: stringOrNull(monolithRepository?.repo_id),
            repoLocalPath: monolithRepoLocalPath,
            serviceName: null, systemLayer: null, repoRole: null,
            repositoryType: repositoryTypeOrNull(area.repository_type),
            relativePath: stringOrNull(area.relative_path),
            focusType: stringOrNull(area.focus_type),
            group: stringOrNull(area.group),
            defaultFocusable: area.default_focusable === true,
            activationPriority: typeof area.activation_priority === 'number' ? area.activation_priority : 0,
            adjacentRepoIds: [],
            adjacentFocusIds: stringArray(area.adjacent_focus_area_ids),
          });
        }
        focusTargets = monolithFocusTargets;
        const knownFocusIds = new Set(focusTargets.map((t) => t.focusId));
        primaryWorkingRepoIds = stringArray(manifest.primary_focus_area_ids).filter((id) => knownFocusIds.has(id));
      } else {
        const distributedFocusTargets: ContextPackFocusTarget[] = [];
        for (const repo of repositories) {
          const repoId = stringOrNull(repo.repo_id);
          if (!repoId) continue;

          distributedFocusTargets.push({
            focusId: repoId,
            displayName: stringOrNull(repo.service_name) ?? stringOrNull(repo.repo_name) ?? repoId,
            kind: 'repository',
            repoId,
            repoLocalPath: resolveFirstLocalPath(repo.local_paths),
            serviceName: stringOrNull(repo.service_name),
            systemLayer: stringOrNull(repo.system_layer),
            repoRole: stringOrNull(repo.repo_role),
            repositoryType: repositoryTypeOrNull(repo.repository_type),
            relativePath: null, focusType: null, group: null,
            defaultFocusable: repo.default_focusable === true,
            activationPriority: typeof repo.activation_priority === 'number' ? repo.activation_priority : 0,
            adjacentRepoIds: stringArray(repo.adjacent_repo_ids),
            adjacentFocusIds: [],
          });
        }
        focusTargets = distributedFocusTargets;
        const knownRepoIds = new Set(
          focusTargets.map((t) => t.repoId).filter((id): id is string => id !== null),
        );
        primaryWorkingRepoIds = stringArray(manifest.primary_working_repo_ids).filter((id) => knownRepoIds.has(id));
      }
      focusTargets.sort((a, b) => {
        if (a.defaultFocusable !== b.defaultFocusable) return a.defaultFocusable ? -1 : 1;
        if (a.activationPriority !== b.activationPriority) return b.activationPriority - a.activationPriority;
        return a.displayName.localeCompare(b.displayName);
      });

    } catch {
      displayName = contextPackId;
    }
  }

  const persistedCounts = await readPersistedWorkspaceCounts(normalizedDir);

  return {
    manifestPath: hasManifest ? manifestPath : null,
    bootstrapReady: hasManifest || hasBootstrapAnswers,
    contextPackId, displayName, estateType, defaultScopeMode,
    repoCount, primaryWorkingRepoIds, focusTargets,
    persistedCounts,
  };
}

async function addContextPackCandidate(
  catalog: Map<string, ContextPackCatalogEntry>,
  contextPackDir: string,
  source: ContextPackCatalogSource,
  envActiveContextPackDir: string | null,
  syncState: WorkspaceSyncStateSnapshot,
): Promise<void> {
  const inspected = await inspectContextPackDir(contextPackDir);
  if (!inspected) return;

  const normalizedDir = resolve(contextPackDir);
  const { persistedCounts } = inspected;
  if (catalog.has(normalizedDir)) {
    const existing = catalog.get(normalizedDir);
    if (existing) {
      Object.assign(existing, deriveContextPackRuntimeState(normalizedDir, envActiveContextPackDir, syncState, persistedCounts));
    }
    return;
  }

  catalog.set(normalizedDir, {
    contextPackId: inspected.contextPackId,
    displayName: inspected.displayName,
    contextPackDir: normalizedDir,
    manifestPath: inspected.manifestPath,
    bootstrapReady: inspected.bootstrapReady,
    source,
    estateType: inspected.estateType,
    defaultScopeMode: inspected.defaultScopeMode,
    repoCount: inspected.repoCount,
    primaryWorkingRepoIds: inspected.primaryWorkingRepoIds,
    focusTargets: inspected.focusTargets,
    ...deriveContextPackRuntimeState(normalizedDir, envActiveContextPackDir, syncState, persistedCounts),
  });
}

export async function listAvailableContextPacks(): Promise<ContextPackListResponse> {
  const configuredPaths = parseConfiguredPaths(process.env[CONTEXT_PACK_PATHS_ENV]);
  const searchRoots = resolveContextPackSearchRoots(
    parseConfiguredPaths(process.env[CONTEXT_PACK_SEARCH_ROOTS_ENV]),
  );
  const envActiveContextPackDir =
    stringOrNull(process.env.ACTIVE_CONTEXT_PACK_DIR) ??
    (await readEnvAssignment('ACTIVE_CONTEXT_PACK_DIR'));
  const syncState = await readWorkspaceSyncStateSnapshot();
  const activeContextPackDir = envActiveContextPackDir ?? syncState.activeContextPackDir;
  const recentContextPackDirs = syncState.activeContextPackDir
    ? [syncState.activeContextPackDir]
    : [];
  const catalog = new Map<string, ContextPackCatalogEntry>();

  for (const path of configuredPaths) {
    await addContextPackCandidate(catalog, path, 'configured-path', envActiveContextPackDir, syncState);
  }

  for (const root of searchRoots) {
    if (!(await pathExists(root, repoFs))) continue;
    await addContextPackCandidate(catalog, root, 'search-root', envActiveContextPackDir, syncState);
    const entries = await fsReadDir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await addContextPackCandidate(catalog, join(root, entry.name), 'search-root', envActiveContextPackDir, syncState);
    }
  }

  if (activeContextPackDir) {
    await addContextPackCandidate(catalog, activeContextPackDir, 'active-env', envActiveContextPackDir, syncState);
  }

  for (const path of recentContextPackDirs) {
    await addContextPackCandidate(catalog, path, 'recent-state', envActiveContextPackDir, syncState);
  }

  const contextPacks = [...catalog.values()].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    action: 'contextPack.list',
    mode: 'read-only',
    message: `Discovered ${contextPacks.length} context pack(s) from approved local sources.`,
    activeContextPackDir: activeContextPackDir ? resolve(activeContextPackDir) : null,
    configuredPaths,
    searchRoots,
    recentContextPackDirs,
    contextPacks,
  };
}
