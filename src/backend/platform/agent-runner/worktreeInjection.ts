/**
 * §B1 Worktree CWD injection.
 *
 * When a task has a `.task.json` sidecar listing branch-owned repoBindings or
 * readonlyContextBindings, every agent process must launch with CWD inside the
 * per-task worktreeRoot — not the originalRoot. This module reads the sidecar
 * once and produces a canonical originalRoot → worktreeRoot substitution map.
 * The map is then applied to:
 *   - `FocusedRepoResult` path fields
 *   - autonomy `allowedDirs` entries (defense-in-depth)
 *
 * Both rewrite functions are PURE: they return new objects/arrays. Callers
 * MUST reassign. When no sidecar exists (legacy/recovery), `applied` is false
 * and rewrite functions return the inputs unchanged so today's behavior is
 * preserved.
 *
 * Path-prefix substitution is `path === orig || path.startsWith(orig + sep)`
 * — never raw `startsWith(orig)`. This defeats the `/repo/foo` vs
 * `/repo/foobar` false-positive (spec risk 5.6).
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';
import { readTaskJsonSafe } from '../queue/taskJson.js';

export interface WorktreeBindingMap {
  /** Canonical originalRoot → canonical worktreeRoot. */
  readonly substitutions: ReadonlyMap<string, string>;
  readonly applied: boolean;
}

const EMPTY_BINDING_MAP: WorktreeBindingMap = {
  substitutions: new Map(),
  applied: false,
};

export async function buildWorktreeBindingMap(
  taskId: string | null | undefined,
  repoRoot: string,
): Promise<WorktreeBindingMap> {
  if (!taskId) return EMPTY_BINDING_MAP;
  const sidecar = readTaskJsonSafe(taskId, repoRoot);
  if (!sidecar) return EMPTY_BINDING_MAP;
  const bindings = [
    ...sidecar.contextPackBinding.repoBindings,
    ...(sidecar.contextPackBinding.readonlyContextBindings ?? []),
  ];
  if (bindings.length === 0) return EMPTY_BINDING_MAP;

  const substitutions = new Map<string, string>();
  for (const binding of bindings) {
    const origCanonical = await safeRealpath(binding.originalRoot);
    const wtCanonical = await safeRealpath(binding.worktreeRoot);
    substitutions.set(origCanonical, wtCanonical);
  }
  return { substitutions, applied: substitutions.size > 0 };
}

export function applyWorktreeInjectionToFocused(
  focused: FocusedRepoResult,
  bindingMap: WorktreeBindingMap,
): FocusedRepoResult {
  if (!bindingMap.applied) return focused;
  const next: FocusedRepoResult = {
    ...focused,
    primaryRepoRoot: rewritePath(focused.primaryRepoRoot, bindingMap),
    visibleRepoRoots: focused.visibleRepoRoots.map((r) => rewritePath(r, bindingMap)),
    declaredRepoRoots: focused.declaredRepoRoots.map((r) => rewritePath(r, bindingMap)),
    primaryFocusTargets: rewritePrimaryFocusTargets(focused.primaryFocusTargets, bindingMap),
    writableRoots: rewriteRepoLocalRoots(focused.writableRoots, bindingMap),
    readonlyContextRoots: rewriteRepoLocalRoots(focused.readonlyContextRoots, bindingMap),
  };
  if (focused.testTarget) {
    next.testTarget = {
      ...focused.testTarget,
      resolvedPath: rewritePath(focused.testTarget.resolvedPath, bindingMap),
    };
  }
  return next;
}

function rewritePrimaryFocusTargets<T extends { repoLocalPath?: string }>(
  targets: readonly T[] | undefined,
  bindingMap: WorktreeBindingMap,
): T[] | undefined {
  return targets?.map((target) => rewriteRepoLocalPath(target, bindingMap));
}

function rewriteRepoLocalRoots<
  T extends { repoLocalPath?: string; sourceTargets?: Array<{ repoLocalPath?: string }> },
>(
  roots: readonly T[] | undefined,
  bindingMap: WorktreeBindingMap,
): T[] | undefined {
  return roots?.map((root) => ({
    ...rewriteRepoLocalPath(root, bindingMap),
    sourceTargets: rewritePrimaryFocusTargets(root.sourceTargets, bindingMap),
  }));
}

function rewriteRepoLocalPath<T extends { repoLocalPath?: string }>(
  value: T,
  bindingMap: WorktreeBindingMap,
): T {
  return value.repoLocalPath
    ? { ...value, repoLocalPath: rewritePath(value.repoLocalPath, bindingMap) }
    : { ...value };
}

export function applyWorktreeInjectionToAllowedDirs(
  allowedDirs: readonly string[],
  bindingMap: WorktreeBindingMap,
  options: { preservePrefixes?: readonly string[] } = {},
): string[] {
  if (!bindingMap.applied) return [...allowedDirs];
  const preservePrefixes = (options.preservePrefixes ?? []).filter((dir) => dir.trim().length > 0);
  return allowedDirs.map((dir) => (
    preservePrefixes.some((prefix) => pathMatchesPrefix(dir, prefix))
      ? dir
      : rewritePath(dir, bindingMap)
  ));
}

export function rewritePath(input: string, bindingMap: WorktreeBindingMap): string {
  for (const [orig, wt] of bindingMap.substitutions) {
    if (input === orig) return wt;
    if (input.startsWith(orig + path.sep)) {
      return wt + input.slice(orig.length);
    }
  }
  return input;
}

function pathMatchesPrefix(input: string, prefix: string): boolean {
  return input === prefix || input.startsWith(prefix + path.sep);
}

async function safeRealpath(p: string): Promise<string> {
  try {
    return await fsp.realpath(p);
  } catch {
    return p;
  }
}
