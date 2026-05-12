import { access } from 'node:fs/promises';
import path from 'node:path';

import {
  readContextPackManifest,
  // PackSchemaError is intentionally not caught here — a schema-invalid manifest
  // is a hard operator error, not a soft "manifest missing" fallthrough.
  // readContextPackManifest throws PackSchemaError when required fields are absent;
  // that rejection propagates through Promise.all to the caller of
  // validateChildTaskFocusSnapshot, surfacing the problem rather than silently
  // skipping ID validation as if the manifest were absent.
} from '../../../backend/platform/context-pack/focusedRepo.js';
import type {
  PlannerFocusSnapshot,
  PlannerFocusValidationIssue,
} from '../src/shared/desktopContract';

export {
  PLANNER_FOCUS_VALID_MESSAGE,
  PLANNER_FOCUS_FALLBACK_MESSAGE,
} from '../src/shared/desktopContractPlanner';

type FocusTarget = PlannerFocusSnapshot['primaryFocusTargets'][number];
type IssueCode = PlannerFocusValidationIssue['code'];

export async function validateChildTaskFocusSnapshot(options: {
  repoRoot: string;
  contextPackDir: string;
  snapshot: PlannerFocusSnapshot;
}): Promise<PlannerFocusValidationIssue[]> {
  const { repoRoot, contextPackDir, snapshot } = options;
  const resolvedContextPackDir = path.resolve(repoRoot, contextPackDir);
  const resolvedSnapshotContextPackDir = path.resolve(repoRoot, snapshot.contextPackDir);
  const resolvedBindingContextPackDir = path.resolve(repoRoot, snapshot.contextPackBinding.contextPackDir);
  const resolvedPrimaryRepoRoot = path.resolve(repoRoot, snapshot.primaryRepoRoot);

  const syncIssues: PlannerFocusValidationIssue[] = [];
  if (resolvedSnapshotContextPackDir !== resolvedContextPackDir) {
    syncIssues.push({ code: 'context-pack-mismatch', label: 'Context pack directory', path: resolvedSnapshotContextPackDir });
  }
  if (resolvedBindingContextPackDir !== resolvedContextPackDir) {
    syncIssues.push({ code: 'context-pack-binding-mismatch', label: 'Context pack binding directory', path: resolvedBindingContextPackDir });
  }
  if (bindingFocusMismatch(snapshot)) {
    syncIssues.push({ code: 'context-pack-binding-mismatch', label: 'Context pack binding focus state', path: resolvedBindingContextPackDir });
  }

  const pathChecks: Array<Promise<PlannerFocusValidationIssue | null>> = [
    checkExists(resolvedContextPackDir, 'context-pack-missing', 'Context pack directory', resolvedContextPackDir),
    checkExists(resolvedPrimaryRepoRoot, 'primary-repo-missing', 'Primary repo root', snapshot.primaryRepoRoot),
  ];

  if (snapshot.primaryFocusRelativePath !== null) {
    pathChecks.push(checkPath(resolvedPrimaryRepoRoot, snapshot.primaryFocusRelativePath, 'primary-focus-path-missing', 'Primary focus path'));
  }
  for (const target of snapshot.primaryFocusTargets) {
    const targetRepoRoot = resolveTargetRepoRoot(repoRoot, resolvedPrimaryRepoRoot, target);
    pathChecks.push(checkPath(targetRepoRoot, target.path, 'primary-focus-target-missing', 'Primary focus target'));
    if (target.testTarget) {
      pathChecks.push(checkPath(targetRepoRoot, target.testTarget.path, 'scoped-test-target-missing', 'Scoped test target'));
    }
    for (const supportTarget of target.supportTargets ?? []) {
      pathChecks.push(checkPath(targetRepoRoot, supportTarget.path, 'scoped-support-target-missing', 'Scoped support target'));
    }
  }
  if (snapshot.selectedTestTarget) {
    pathChecks.push(checkPath(resolvedPrimaryRepoRoot, snapshot.selectedTestTarget.path, 'selected-test-target-missing', 'Selected test target'));
  }
  for (const supportTarget of snapshot.supportTargets) {
    pathChecks.push(checkPath(resolvedPrimaryRepoRoot, supportTarget.path, 'support-target-missing', 'Support target'));
  }

  const [pathResults, manifest] = await Promise.all([
    Promise.all(pathChecks),
    readContextPackManifest(resolvedContextPackDir, repoRoot),
  ]);

  const fsIssues = pathResults.filter((issue): issue is PlannerFocusValidationIssue => issue !== null);

  const idIssues: PlannerFocusValidationIssue[] = [];
  if (manifest) {
    const repoIds = new Set([
      manifest.repository?.repo_id,
      ...(manifest.repositories ?? []).map((repo) => repo.repo_id),
    ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
    const focusIds = new Set((manifest.focusable_areas ?? [])
      .map((focus) => focus.focus_id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
    for (const repoId of snapshot.contextPackBinding.selectedRepoIds) {
      if (!repoIds.has(repoId)) {
        idIssues.push({ code: 'selected-repo-id-missing', label: 'Selected repo ID', id: repoId });
      }
    }
    for (const focusId of snapshot.contextPackBinding.selectedFocusIds) {
      if (!focusIds.has(focusId)) {
        idIssues.push({ code: 'selected-focus-id-missing', label: 'Selected focus ID', id: focusId });
      }
    }
  }

  return [...syncIssues, ...fsIssues, ...idIssues];
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function checkExists(
  resolvedPath: string,
  code: IssueCode,
  label: string,
  reportedPath: string,
): Promise<PlannerFocusValidationIssue | null> {
  return (await exists(resolvedPath)) ? null : { code, label, path: reportedPath };
}

async function checkPath(
  repoRoot: string,
  relativePath: string,
  code: IssueCode,
  label: string,
): Promise<PlannerFocusValidationIssue | null> {
  const resolvedTargetPath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, resolvedTargetPath);
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || !await exists(resolvedTargetPath)
  ) {
    return { code, label, path: resolvedTargetPath };
  }
  return null;
}

function resolveTargetRepoRoot(repoRoot: string, primaryRepoRoot: string, target: FocusTarget): string {
  return typeof target.repoLocalPath === 'string' && target.repoLocalPath.trim()
    ? path.resolve(repoRoot, target.repoLocalPath)
    : primaryRepoRoot;
}

function bindingFocusMismatch(snapshot: PlannerFocusSnapshot): boolean {
  const binding = snapshot.contextPackBinding;
  return snapshot.primaryFocusRelativePath !== binding.selectedFocusPath
    || snapshot.primaryFocusTargetKind !== binding.selectedFocusTargetKind
    || normalizeJson(snapshot.primaryFocusTargets) !== normalizeJson(binding.selectedFocusTargets)
    || normalizeJson(snapshot.selectedTestTarget ?? null) !== normalizeJson(binding.selectedTestTarget ?? null)
    || normalizeJson(snapshot.supportTargets) !== normalizeJson(binding.selectedSupportTargets);
}

function normalizeJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
