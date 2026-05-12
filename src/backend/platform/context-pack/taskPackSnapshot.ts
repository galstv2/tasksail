import { readTextFile, safeJsonParse, resolvePath } from '../core/index.js';
import type {
  FocusTarget,
  FocusTargetKind,
  NormalizedSupportTarget,
  PrimaryFocusTarget,
  ReadonlyContextRoot,
  WritableRoot,
} from './deepFocusNormalization.js';

export interface TaskPackSnapshot {
  schemaVersion: 2;
  stagedAt: string;
  taskId: string;
  contextPackDir: string;
  contextPackId: string;
  estateType: string;
  primary: {
    repoId: string | null;
    focusId: string | null;
    repoRoot: string;
    primaryFocusRelativePath: string | null;
  };
  support: ReadonlyArray<{ repoId: string; repoRoot: string }>;
  focusAreas: ReadonlyArray<{ focusId: string; relativePath: string; isPrimary: boolean }>;
  selectedFocusIds: ReadonlyArray<string>;
  qmdScopeRoot: string;
  estateRepoIds: ReadonlyArray<string>;
  declaredRepoRoots: ReadonlyArray<string>;
  deepFocus: {
    enabled: boolean;
    primaryFocusTargetKind: FocusTargetKind | null;
    primaryFocusTargets: PrimaryFocusTarget[];
    selectedTestTarget: FocusTarget | null;
    supportTargets: NormalizedSupportTarget[];
    writableRoots: WritableRoot[];
    readonlyContextRoots: ReadonlyContextRoot[];
    warnings: string[];
  };
}

export function resolveTaskPackSnapshotPath(repoRoot: string, taskId: string): string {
  return resolvePath(repoRoot, `AgentWorkSpace/tasks/${taskId}/pack-snapshot.json`);
}

export async function loadTaskPackSnapshot(repoRoot: string, taskId: string): Promise<TaskPackSnapshot> {
  const snapshotPath = resolveTaskPackSnapshotPath(repoRoot, taskId);
  const content = await readTextFile(snapshotPath);
  if (content === undefined) {
    throw new Error(`Missing pack-snapshot.json for task "${taskId}" at "${snapshotPath}". Re-activate or re-create the task.`);
  }
  const parsed = safeJsonParse<unknown>(content, snapshotPath);
  if (!isTaskPackSnapshot(parsed)) {
    throw new Error(`Malformed pack-snapshot.json for task "${taskId}" at "${snapshotPath}". Re-activate or re-create the task.`);
  }
  return parsed;
}

/**
 * Throw if the snapshot was written for a different context pack than the
 * caller is asking about. This is a stale-binding guard: a task's snapshot is
 * frozen at activation, so a mid-pipeline pack switch would otherwise silently
 * resolve against the wrong pack.
 */
export function assertSnapshotMatchesContextPack(
  snapshot: TaskPackSnapshot,
  contextPackDir: string,
  repoRoot: string,
  taskId: string,
): void {
  const requested = resolvePath(repoRoot, contextPackDir);
  if (snapshot.contextPackDir !== requested) {
    throw new Error(
      `pack-snapshot.json for task "${taskId}" targets a different context pack (${snapshot.contextPackDir}) ` +
      `than requested (${requested}). Re-activate or re-create the task.`,
    );
  }
}

function isTaskPackSnapshot(value: unknown): value is TaskPackSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'schemaVersion',
    'stagedAt',
    'taskId',
    'contextPackDir',
    'contextPackId',
    'estateType',
    'primary',
    'support',
    'focusAreas',
    'selectedFocusIds',
    'qmdScopeRoot',
    'estateRepoIds',
    'declaredRepoRoots',
    'deepFocus',
  ];
  if (!hasExactKeys(candidate, expectedKeys)) return false;
  if (candidate.schemaVersion !== 2) return false;
  if (!isString(candidate.stagedAt) || !isString(candidate.taskId) || !isString(candidate.contextPackDir)) return false;
  if (!isString(candidate.contextPackId) || !isString(candidate.estateType) || !isString(candidate.qmdScopeRoot)) return false;
  if (!isStringArray(candidate.estateRepoIds) || !isStringArray(candidate.declaredRepoRoots)) return false;
  if (!isPrimary(candidate.primary)) return false;
  if (!isRepoList(candidate.support)) return false;
  if (!Array.isArray(candidate.focusAreas) || !candidate.focusAreas.every(isFocusArea)) return false;
  if (!isStringArray(candidate.selectedFocusIds)) return false;
  return isDeepFocus(candidate.deepFocus);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isPrimary(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const primary = value as Record<string, unknown>;
  return hasExactKeys(primary, ['repoId', 'focusId', 'repoRoot', 'primaryFocusRelativePath'])
    && isStringOrNull(primary.repoId)
    && isStringOrNull(primary.focusId)
    && isString(primary.repoRoot)
    && isStringOrNull(primary.primaryFocusRelativePath);
}

function isRepoList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const repo = item as Record<string, unknown>;
    return hasExactKeys(repo, ['repoId', 'repoRoot']) && isString(repo.repoId) && isString(repo.repoRoot);
  });
}

function isFocusArea(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const area = value as Record<string, unknown>;
  return hasExactKeys(area, ['focusId', 'relativePath', 'isPrimary'])
    && isString(area.focusId)
    && isString(area.relativePath)
    && typeof area.isPrimary === 'boolean';
}

function isDeepFocus(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const deepFocus = value as Record<string, unknown>;
  return hasExactKeys(deepFocus, [
    'enabled',
    'primaryFocusTargetKind',
    'primaryFocusTargets',
    'selectedTestTarget',
    'supportTargets',
    'writableRoots',
    'readonlyContextRoots',
    'warnings',
  ])
    && typeof deepFocus.enabled === 'boolean'
    && (deepFocus.primaryFocusTargetKind === null || deepFocus.primaryFocusTargetKind === 'directory' || deepFocus.primaryFocusTargetKind === 'file')
    && Array.isArray(deepFocus.primaryFocusTargets)
    && (deepFocus.selectedTestTarget === null || typeof deepFocus.selectedTestTarget === 'object')
    && Array.isArray(deepFocus.supportTargets)
    && Array.isArray(deepFocus.writableRoots)
    && Array.isArray(deepFocus.readonlyContextRoots)
    && isStringArray(deepFocus.warnings);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}
