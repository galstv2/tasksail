/**
 * §B1 Worktree CWD injection.
 *
 * When a task has a `.task.json` sidecar listing repoBindings, every agent
 * process must launch with CWD inside the per-task worktreeRoot — not the
 * originalRoot. This module reads the sidecar once and produces a canonical
 * originalRoot → worktreeRoot substitution map. The map is then applied to:
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
  const bindings = sidecar.contextPackBinding.repoBindings;
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
  };
  if (focused.testTarget) {
    next.testTarget = {
      ...focused.testTarget,
      resolvedPath: rewritePath(focused.testTarget.resolvedPath, bindingMap),
    };
  }
  return next;
}

export function applyWorktreeInjectionToAllowedDirs(
  allowedDirs: readonly string[],
  bindingMap: WorktreeBindingMap,
): string[] {
  if (!bindingMap.applied) return [...allowedDirs];
  return allowedDirs.map((dir) => rewritePath(dir, bindingMap));
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

async function safeRealpath(p: string): Promise<string> {
  try {
    return await fsp.realpath(p);
  } catch {
    return p;
  }
}
