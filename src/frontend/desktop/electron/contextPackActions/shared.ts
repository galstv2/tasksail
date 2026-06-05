/**
 * Shared helpers for contextPackActions modules.
 *
 * Contains: script runners, local script-path constants, deep-focus
 * normalization helpers (used by workspace.ts and deepFocusSelections.ts),
 * and estate-type guards (used by discovery.ts and create.ts).
 *
 * Only helpers used by at least two sibling modules live here.
 */
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  ContextPackEstateType,
  ContextPackDiscoveryMode,
  ContextPackPrimaryFocusTarget,
} from '../../src/shared/desktopContract';
import {
  normalizeRelativePath,
  normalizePrimaryFocusTargets,
  normalizeSupportTargets,
  validateTestTarget,
  type FocusTarget,
} from '../../../../backend/platform/context-pack/deepFocusNormalization';
import { REPO_ROOT } from '../paths';
import {
  REPO_CONTEXT_PYTHON_BIN,
  type ScriptResult,
  type ContextPackWorkspaceScriptRunner,
  type ContextPackReseedRunner,
  type PythonScriptRunner,
} from '../main.contextPackShared';

export { type FocusTarget };

export const execFileAsync = promisify(execFile);

// Script path constants used within contextPackActions only.
export const UPDATE_PACK_MANIFEST_SCRIPT_PATH = join(
  REPO_ROOT,
  'src/backend/scripts/python/update-pack-manifest.py',
);
export const RUN_PACK_PREFLIGHT_SCRIPT_PATH = join(
  REPO_ROOT,
  'src/backend/scripts/python/run-pack-preflight.py',
);

// Script runners

export async function runContextPackWorkspaceScript(args: string[]): Promise<ScriptResult> {
  const { stdout, stderr } = await execFileAsync(
    REPO_CONTEXT_PYTHON_BIN,
    [join(REPO_ROOT, 'src/backend/scripts/python/sync-context-pack-workspace.py'), ...args],
    { cwd: REPO_ROOT },
  );
  return { stdout, stderr };
}

export async function runContextPackReseedCommand(args: string[]): Promise<ScriptResult> {
  const { stdout, stderr } = await execFileAsync(REPO_CONTEXT_PYTHON_BIN, args, { cwd: REPO_ROOT });
  return { stdout, stderr };
}

export async function runPythonScriptCommand(
  args: string[],
  options?: { stdin?: string },
): Promise<ScriptResult> {
  if (!options?.stdin) {
    const { stdout, stderr } = await execFileAsync(REPO_CONTEXT_PYTHON_BIN, args, { cwd: REPO_ROOT });
    return { stdout, stderr };
  }
  return new Promise((resolve, reject) => {
    const child = spawn(REPO_CONTEXT_PYTHON_BIN, args, { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    // The child can exit before consuming all of stdin; the resulting EPIPE is
    // emitted on the stdin stream (not on `child`), and without a handler it
    // becomes an uncaughtException that exits the whole app. EPIPE is expected
    // here — the child's own close/error events decide success — so only a
    // non-EPIPE stdin error is treated as a real failure. Mirrors the pattern
    // in main.contextPackTree.ts.
    child.stdin.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
        settle(() => reject(err));
      }
    });
    child.stdin.write(options.stdin!);
    child.stdin.end();
    child.on('close', () => settle(() => resolve({ stdout, stderr })));
    child.on('error', (err) => settle(() => reject(err)));
  });
}

// Re-export runner types for convenience.
export type { ContextPackWorkspaceScriptRunner, ContextPackReseedRunner, PythonScriptRunner };

// Estate-type guards used by create.ts and discovery.ts

export const CONTEXT_PACK_ESTATE_TYPES: readonly ContextPackEstateType[] = [
  'distributed',
  'distributed-platform',
  'monolith',
  'monolith-platform',
];

export const CONTEXT_PACK_DISCOVERY_MODES: readonly ContextPackDiscoveryMode[] = [
  'auto',
  ...CONTEXT_PACK_ESTATE_TYPES,
];

export function isContextPackEstateType(value: unknown): value is ContextPackEstateType {
  return typeof value === 'string' && CONTEXT_PACK_ESTATE_TYPES.includes(value as ContextPackEstateType);
}

export function isContextPackDiscoveryMode(value: unknown): value is ContextPackDiscoveryMode {
  return typeof value === 'string' && CONTEXT_PACK_DISCOVERY_MODES.includes(value as ContextPackDiscoveryMode);
}

// Deep-focus normalization helpers used by workspace.ts and deepFocusSelections.ts

export function normalizeDeepFocusTarget(target: FocusTarget): FocusTarget {
  return {
    path: normalizeRelativePath(target.path),
    kind: target.kind,
    ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
    ...(target.repoId ? { repoId: target.repoId } : {}),
    ...(target.focusId ? { focusId: target.focusId } : {}),
  };
}

export function cloneFocusTarget(target: FocusTarget | null | undefined): FocusTarget | null | undefined {
  if (target === null) return null;
  if (target === undefined) return undefined;
  return normalizeDeepFocusTarget(target);
}

export function clonePrimaryFocusTarget(
  target: ContextPackPrimaryFocusTarget,
): ContextPackPrimaryFocusTarget {
  const testTarget = cloneFocusTarget(target.testTarget);
  return {
    path: normalizeRelativePath(target.path),
    kind: target.kind,
    ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
    ...(target.repoId ? { repoId: target.repoId } : {}),
    ...(target.focusId ? { focusId: target.focusId } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(testTarget !== undefined ? { testTarget } : {}),
    ...(target.supportTargets && target.supportTargets.length > 0
      ? { supportTargets: target.supportTargets.map(normalizeDeepFocusTarget) }
      : {}),
  };
}

export function mirrorSinglePrimaryScopedFields(
  selectedFocusTargets: ContextPackPrimaryFocusTarget[],
  selectedTestTarget: FocusTarget | null | undefined,
  selectedSupportTargets: FocusTarget[],
): {
  selectedTestTarget: FocusTarget | null | undefined;
  selectedSupportTargets: FocusTarget[];
} {
  if (selectedFocusTargets.length !== 1) {
    return { selectedTestTarget, selectedSupportTargets };
  }
  const [primary] = selectedFocusTargets;
  return {
    selectedTestTarget:
      selectedTestTarget === undefined && primary?.testTarget !== undefined
        ? cloneFocusTarget(primary.testTarget)
        : selectedTestTarget,
    selectedSupportTargets:
      selectedSupportTargets.length === 0 && primary?.supportTargets && primary.supportTargets.length > 0
        ? primary.supportTargets.map(normalizeDeepFocusTarget)
        : selectedSupportTargets,
  };
}

export function toWorkspaceSyncTarget(target: FocusTarget): Record<string, unknown> {
  return {
    path: target.path,
    kind: target.kind,
    ...(target.repoLocalPath ? { repo_local_path: target.repoLocalPath } : {}),
    ...(target.repoId ? { repo_id: target.repoId } : {}),
    ...(target.focusId ? { focus_id: target.focusId } : {}),
  };
}

export function toWorkspaceSyncPrimaryTarget(target: ContextPackPrimaryFocusTarget): Record<string, unknown> {
  const testTarget = cloneFocusTarget(target.testTarget);
  return {
    path: target.path,
    kind: target.kind,
    ...(target.repoLocalPath ? { repo_local_path: target.repoLocalPath } : {}),
    ...(target.repoId ? { repo_id: target.repoId } : {}),
    ...(target.focusId ? { focus_id: target.focusId } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(testTarget !== undefined && testTarget !== null ? { test_target: toWorkspaceSyncTarget(testTarget) } : {}),
    ...(testTarget === null ? { test_target: null } : {}),
    ...(target.supportTargets && target.supportTargets.length > 0
      ? { support_targets: target.supportTargets.map(toWorkspaceSyncTarget) }
      : {}),
  };
}

// Re-export deepFocusNormalization for workspace.ts (avoids duplicate import paths).
export { normalizeRelativePath, normalizePrimaryFocusTargets, normalizeSupportTargets, validateTestTarget };
