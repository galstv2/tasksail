import path from 'node:path';
import { readTextFile, safeJsonParse, resolvePath } from '../core/index.js';
import { readTaskJsonSafe } from '../queue/taskJson.js';
import type {
  FocusTarget,
  FocusTargetKind,
  PrimaryFocusTarget,
} from './deepFocusNormalization.js';
import type { Manifest, ManifestFocusableArea, ManifestRepo } from './focusedRepo.js';
import { resolveFirstLocalPath } from './focusedRepo.js';

/** Source that produced an {@link AuthoritativeSelection}. */
export type AuthoritySource = 'manifest-primary' | 'active-task-sidecar' | 'workspace-sync-state';

/** Normalized active selection, after deciding which selection file to trust. */
export interface AuthoritativeSelection {
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  deepFocusEnabled?: boolean;
  deepFocusPrimaryRepoId?: string | null;
  deepFocusPrimaryFocusId?: string | null;
  selectedFocusPath?: string;
  selectedFocusTargetKind?: FocusTargetKind;
  selectedFocusTargets?: PrimaryFocusTarget[];
  selectedTestTarget?: FocusTarget | null;
  selectedSupportTargets?: FocusTarget[];
  source: Exclude<AuthoritySource, 'manifest-primary'>;
}

export interface DeepFocusOverlayPayload {
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: FocusTargetKind | null;
  selectedFocusTargets: PrimaryFocusTarget[] | undefined;
  selectedTestTarget: FocusTarget | null | undefined;
  selectedSupportTargets: FocusTarget[] | undefined;
}

/**
 * Resolve the active selection from the highest-priority source available.
 *
 * Precedence: explicit task-id sidecar (when provided) → workspace-sync state,
 * optionally overlaid with the user's draft Deep Focus
 * selection so a fresh dropbox task picks up unsaved choices.
 */
export async function resolveAuthoritativeSelection(
  resolvedPackDir: string,
  repoRoot: string,
  options?: { taskId?: string },
): Promise<AuthoritativeSelection | undefined> {
  const taskSelection = options?.taskId
    ? await readTaskJsonSelection(options.taskId, repoRoot, resolvedPackDir)
    : undefined;
  if (options?.taskId && !taskSelection) {
    throw new Error(`No authoritative .task.json context-pack selection for task "${options.taskId}". Re-activate or re-create the task.`);
  }
  if (taskSelection) {
    return taskSelection;
  }
  const workspaceSelection = await readWorkspaceSyncSelection(resolvedPackDir, repoRoot);
  if (!workspaceSelection) {
    return undefined;
  }
  const overlay = await readDeepFocusOverlay(resolvedPackDir, repoRoot);
  if (!overlay) {
    return workspaceSelection;
  }
  return {
    ...workspaceSelection,
    deepFocusEnabled: overlay.deepFocusEnabled,
    deepFocusPrimaryRepoId: overlay.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: overlay.deepFocusPrimaryFocusId,
    selectedFocusPath: overlay.selectedFocusPath ?? undefined,
    selectedFocusTargetKind: overlay.selectedFocusTargetKind ?? undefined,
    selectedFocusTargets: overlay.selectedFocusTargets,
    selectedTestTarget: overlay.selectedTestTarget,
    selectedSupportTargets: overlay.selectedSupportTargets,
  };
}

/**
 * Read the user's draft Deep Focus selection for a given context pack from
 * `.platform-state/deep-focus-selections.json`. Returns undefined when the file
 * is absent, the entry is missing, or `deepFocusEnabled` is not true. Used to
 * overlay UI-side selections onto the last-applied workspace sync state so a
 * user does not need to click "Apply" before submitting a new dropbox task.
 */
export async function readDeepFocusOverlay(
  resolvedPackDir: string,
  repoRoot: string,
): Promise<DeepFocusOverlayPayload | undefined> {
  const filePath = path.join(repoRoot, '.platform-state', 'deep-focus-selections.json');
  const content = await readTextFile(filePath);
  if (content === undefined) {
    return undefined;
  }
  const parsed = safeJsonParse<Record<string, unknown>>(content, filePath);
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== 'object') continue;
    const canonicalKey = resolvePath(repoRoot, key);
    if (canonicalKey !== resolvedPackDir) continue;

    const overlay = value as Record<string, unknown>;
    if (overlay.deepFocusEnabled !== true) {
      return undefined;
    }
    const hydrated = await hydrateLegacyPrimariesInAuthoritativeSelection({
      selectedRepoIds: [],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: toOptionalString(overlay.deepFocusPrimaryRepoId) ?? null,
      deepFocusPrimaryFocusId: toOptionalString(overlay.deepFocusPrimaryFocusId) ?? null,
      selectedFocusTargets: toPrimaryFocusTargetArray(overlay.selectedFocusTargets),
      source: 'workspace-sync-state',
    }, resolvedPackDir);
    return {
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: hydrated.deepFocusPrimaryRepoId ?? null,
      deepFocusPrimaryFocusId: hydrated.deepFocusPrimaryFocusId ?? null,
      selectedFocusPath: toOptionalString(overlay.selectedFocusPath) ?? null,
      selectedFocusTargetKind: toFocusTargetKind(overlay.selectedFocusTargetKind) ?? null,
      selectedFocusTargets: hydrated.selectedFocusTargets,
      selectedTestTarget: overlay.selectedTestTarget === null
        ? null
        : toFocusTarget(overlay.selectedTestTarget),
      selectedSupportTargets: toFocusTargetArray(overlay.selectedSupportTargets),
    };
  }
  return undefined;
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
  primaryTargetsField?: string;
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

  const result: AuthoritativeSelection = {
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
    selectedFocusTargets: descriptor.primaryTargetsField
      ? deepFocusEnabled === true
        ? readDeepFocusOptionalPrimaryFocusTargetArray(parsed?.[descriptor.primaryTargetsField], descriptor.primaryTargetsField)
        : toPrimaryFocusTargetArray(parsed?.[descriptor.primaryTargetsField])
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
  return hydrateLegacyPrimariesInAuthoritativeSelection(result, resolvedPackDir);
}

export async function hydrateLegacyPrimariesInAuthoritativeSelection(
  sel: AuthoritativeSelection,
  resolvedPackDir: string,
): Promise<AuthoritativeSelection> {
  const targets = sel.selectedFocusTargets;
  if (!targets || targets.length === 0) return sel;

  const scalarRepoId = sel.deepFocusPrimaryRepoId && sel.deepFocusPrimaryRepoId.length > 0
    ? sel.deepFocusPrimaryRepoId
    : sel.selectedRepoIds.length === 1
      ? sel.selectedRepoIds[0]
    : null;
  const scalarFocusId = sel.deepFocusPrimaryFocusId && sel.deepFocusPrimaryFocusId.length > 0
    ? sel.deepFocusPrimaryFocusId
    : sel.selectedFocusIds.length === 1
      ? sel.selectedFocusIds[0]
    : null;

  const existingIdentityField = scalarRepoId ? 'repoId' : scalarFocusId ? 'focusId' : undefined;
  const allHaveRequiredIdentity = targets.every((target) =>
    hasText(target.repoLocalPath)
      && (!existingIdentityField || hasText(target[existingIdentityField])),
  );
  if (allHaveRequiredIdentity) {
    return { ...sel, selectedFocusTargets: targets.map((target) => ({ ...target })) };
  }

  if (scalarRepoId) {
    const distributedRepo = await resolveManifestRepoById(resolvedPackDir, scalarRepoId);
    if (distributedRepo) {
      return {
        ...sel,
        selectedFocusTargets: targets.map((target) => ({
          ...target,
          repoLocalPath: target.repoLocalPath || distributedRepo.repoLocalPath,
          repoId: target.repoId || scalarRepoId,
        })),
      };
    }
  }

  if (scalarFocusId) {
    const monolithRepo = await resolveManifestRepoByFocusId(resolvedPackDir, scalarFocusId);
    if (monolithRepo) {
      return {
        ...sel,
        selectedFocusTargets: targets.map((target) => ({
          ...target,
          repoLocalPath: target.repoLocalPath || monolithRepo.repoLocalPath,
          focusId: target.focusId || scalarFocusId,
        })),
      };
    }
  }

  console.warn(
    '[deep-focus] discarded malformed legacy primaries:',
    'could not resolve primary scalar through manifest.',
  );
  return {
    ...sel,
    selectedFocusTargets: [],
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
  };
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

async function readManifest(resolvedPackDir: string): Promise<Manifest | undefined> {
  const manifestPath = path.join(resolvedPackDir, 'qmd', 'repo-sources.json');
  const content = await readTextFile(manifestPath);
  if (content === undefined) {
    return undefined;
  }
  return safeJsonParse<Manifest>(content, manifestPath) ?? undefined;
}

async function resolveManifestRepoById(
  resolvedPackDir: string,
  repoId: string,
): Promise<{ repoLocalPath: string; repo: ManifestRepo } | undefined> {
  const manifest = await readManifest(resolvedPackDir);
  const repos = Array.isArray(manifest?.repositories) ? manifest.repositories : [];
  const repo = repos.find((candidate) => candidate.repo_id === repoId);
  if (!repo) {
    return undefined;
  }
  const repoLocalPath = resolveFirstLocalPath(repo, resolvedPackDir);
  return repoLocalPath ? { repoLocalPath, repo } : undefined;
}

async function resolveManifestRepoByFocusId(
  resolvedPackDir: string,
  focusId: string,
): Promise<{ repoLocalPath: string; area: ManifestFocusableArea } | undefined> {
  const manifest = await readManifest(resolvedPackDir);
  const area = Array.isArray(manifest?.focusable_areas)
    ? manifest.focusable_areas.find((candidate) => candidate.focus_id === focusId)
    : undefined;
  if (!manifest || !area) {
    return undefined;
  }
  const repo = manifest.repository ?? manifest.repositories?.[0];
  if (!repo) {
    return undefined;
  }
  const repoLocalPath = resolveFirstLocalPath(repo, resolvedPackDir);
  return repoLocalPath ? { repoLocalPath, area } : undefined;
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
    primaryTargetsField: 'selected_focus_targets',
    testTargetField: 'selected_test_target',
    supportTargetsField: 'selected_support_targets',
    source: 'workspace-sync-state',
  }, resolvedPackDir, repoRoot);
}

async function readTaskJsonSelection(
  taskId: string,
  repoRoot: string,
  resolvedPackDir: string,
): Promise<AuthoritativeSelection | undefined> {
  const taskJson = readTaskJsonSafe(taskId, repoRoot);
  const selection = taskJson?.contextPackBinding.selection;
  if (!selection) {
    return undefined;
  }
  const selectionContextPackDir = selection.contextPackDir
    ? resolvePath(repoRoot, selection.contextPackDir)
    : '';
  if (selectionContextPackDir !== resolvedPackDir) {
    return undefined;
  }
  const rawSelection = selection as typeof selection & Record<string, unknown>;
  // Promote the explicit primary id to the head of its list when present, so
  // downstream code that treats selectedRepoIds[0] / selectedFocusIds[0] as
  // the primary stays consistent with the binding.
  const authoritativeSelection: AuthoritativeSelection = {
    selectedRepoIds: hoistPrimaryToHead(selection.selectedRepoIds, selection.primaryRepoId),
    selectedFocusIds: hoistPrimaryToHead(selection.selectedFocusIds, selection.primaryFocusId),
    deepFocusEnabled: selection.deepFocusEnabled,
    deepFocusPrimaryRepoId: toOptionalString(rawSelection.deepFocusPrimaryRepoId) ?? null,
    deepFocusPrimaryFocusId: toOptionalString(rawSelection.deepFocusPrimaryFocusId) ?? null,
    selectedFocusPath: selection.selectedFocusPath ?? undefined,
    selectedFocusTargetKind: selection.selectedFocusTargetKind ?? undefined,
    selectedFocusTargets: selection.selectedFocusTargets?.map((target) => ({ ...target })),
    selectedTestTarget: selection.selectedTestTarget === null
      ? null
      : selection.selectedTestTarget
        ? { ...selection.selectedTestTarget }
        : undefined,
    selectedSupportTargets: selection.selectedSupportTargets?.map((target) => ({ ...target })),
    source: 'active-task-sidecar',
  };
  return hydrateLegacyPrimariesInAuthoritativeSelection(authoritativeSelection, resolvedPackDir);
}

function hoistPrimaryToHead(ids: readonly string[] | undefined, primary: string | undefined): string[] {
  const list = ids ?? [];
  if (!primary) {
    return [...list];
  }
  return [primary, ...list.filter((id) => id !== primary)];
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

export function toPrimaryFocusTarget(value: unknown): PrimaryFocusTarget | undefined {
  const target = toFocusTarget(value);
  if (!target || !value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const role = candidate.role;
  if (role !== undefined && role !== 'anchor' && role !== 'primary') {
    return undefined;
  }
  // Read repoLocalPath / repoId / focusId from either snake_case
  // (workspace-context-sync.json, Python-side) or camelCase (selections file
  // / task sidecar, frontend-side).
  const rawRepoLocalPath = Object.prototype.hasOwnProperty.call(candidate, 'repo_local_path')
    ? candidate.repo_local_path
    : candidate.repoLocalPath;
  const repoLocalPath = typeof rawRepoLocalPath === 'string' && rawRepoLocalPath.length > 0
    ? rawRepoLocalPath
    : undefined;
  const rawRepoId = Object.prototype.hasOwnProperty.call(candidate, 'repo_id')
    ? candidate.repo_id
    : candidate.repoId;
  const repoId = typeof rawRepoId === 'string' && rawRepoId.length > 0
    ? rawRepoId
    : undefined;
  const rawFocusId = Object.prototype.hasOwnProperty.call(candidate, 'focus_id')
    ? candidate.focus_id
    : candidate.focusId;
  const focusId = typeof rawFocusId === 'string' && rawFocusId.length > 0
    ? rawFocusId
    : undefined;
  const rawTestTarget = Object.prototype.hasOwnProperty.call(candidate, 'test_target')
    ? candidate.test_target
    : candidate.testTarget;
  const testTarget = rawTestTarget === null ? null : toFocusTarget(rawTestTarget);
  const rawSupportTargets = Object.prototype.hasOwnProperty.call(candidate, 'support_targets')
    ? candidate.support_targets
    : candidate.supportTargets;
  const supportTargets = toFocusTargetArray(rawSupportTargets);
  return {
    ...target,
    ...(repoLocalPath ? { repoLocalPath } : {}),
    ...(repoId ? { repoId } : {}),
    ...(focusId ? { focusId } : {}),
    ...(role ? { role } : {}),
    ...(testTarget ? { testTarget } : {}),
    ...(supportTargets ? { supportTargets } : {}),
  };
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

function toPrimaryFocusTargetArray(value: unknown): PrimaryFocusTarget[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const targets: PrimaryFocusTarget[] = [];
  for (const item of value) {
    const target = toPrimaryFocusTarget(item);
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

function readDeepFocusOptionalPrimaryFocusTargetArray(value: unknown, fieldName: string): PrimaryFocusTarget[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const targets = toPrimaryFocusTargetArray(value);
  if (!targets) {
    throw new Error(`Deep Focus field "${fieldName}" must be an array of { path, kind, role? } objects.`);
  }
  return targets;
}
