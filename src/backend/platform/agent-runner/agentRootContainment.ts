import path from 'node:path';
import { canonicalRoot, isPathWithinBoundary } from '../core/index.js';
import type { FocusedRepoResult } from '../context-pack/focusedRepo.js';
import type { TaskPackSnapshot } from '../context-pack/taskPackSnapshot.js';
import { readTaskJsonSafe, type TaskReadonlyContextBinding, type TaskRepoBinding } from '../queue/taskJson.js';
import type { ExternalMcpLaunchContext } from './pythonHelpers.js';

export type AgentRootContainmentSurface = {
  focused?: FocusedRepoResult;
  allowedDirs: readonly string[];
  agentCwd: string;
  env: Record<string, string>;
  mcpLaunchContext?: ExternalMcpLaunchContext;
};

export type AgentRepoBinding = {
  repoId: string;
  role: 'primary';
  worktreeRoot: string;
  branch: string;
};

type TaskVisibleBinding = Pick<TaskRepoBinding, 'originalRoot' | 'worktreeRoot'>;

export function projectAgentRepoBindings(options: {
  repoBindings: readonly TaskRepoBinding[];
  snapshot?: TaskPackSnapshot;
}): AgentRepoBinding[] {
  const idsByRoot = new Map<string, string>();
  if (options.snapshot) {
    if (options.snapshot.primary.repoId) {
      idsByRoot.set(canonicalRoot(options.snapshot.primary.repoRoot), options.snapshot.primary.repoId);
    }
    for (const repo of options.snapshot.support) {
      idsByRoot.set(canonicalRoot(repo.repoRoot), repo.repoId);
    }
  }

  return options.repoBindings.map((binding, index) => {
    const identity = idsByRoot.get(canonicalRoot(binding.originalRoot));
    const fallbackRepoId = path.basename(binding.worktreeRoot) || `repo-${index + 1}`;
    return {
      repoId: identity ?? fallbackRepoId,
      role: 'primary',
      worktreeRoot: binding.worktreeRoot,
      branch: binding.worktreeBranch,
    };
  });
}

export function assertNoOriginalTargetRootsInAgentLaunch(options: {
  taskId: string;
  surface: AgentRootContainmentSurface;
  repoBindings: readonly TaskRepoBinding[];
  readonlyContextBindings?: readonly TaskReadonlyContextBinding[];
  platformRepoRoot: string;
  contextPackDir?: string;
  agentId: string;
}): void {
  const platformAllowedRoots = platformOwnedAllowedRoots(options);
  const taskVisibleBindings = collectTaskVisibleBindings(options);
  for (const [bindingIndex, binding] of taskVisibleBindings.entries()) {
    const originalRoot = canonicalRoot(binding.originalRoot);
    const label = bindingLabel(binding, bindingIndex);
    checkPath({
      taskId: options.taskId,
      agentId: options.agentId,
      field: 'agentCwd',
      value: options.surface.agentCwd,
      originalRoot,
      platformAllowedRoots,
      label,
      bindingIndex,
    });
    options.surface.allowedDirs.forEach((dir, index) => checkPath({
      taskId: options.taskId,
      agentId: options.agentId,
      field: `allowedDirs[${index}]`,
      value: dir,
      originalRoot,
      platformAllowedRoots,
      label,
      bindingIndex,
    }));
    for (const [field, value] of collectFocusedPaths(options.surface.focused)) {
      checkPath({ taskId: options.taskId, agentId: options.agentId, field, value, originalRoot, platformAllowedRoots, label, bindingIndex });
    }
    for (const [envKey, value] of Object.entries(options.surface.env)) {
      checkText({
        taskId: options.taskId,
        agentId: options.agentId,
        field: `env.${envKey}`,
        value,
        originalRoot,
        platformAllowedRoots,
        label,
        bindingIndex,
      });
    }
    if (options.surface.mcpLaunchContext) {
      checkText({
        taskId: options.taskId,
        agentId: options.agentId,
        field: 'mcpLaunchContext',
        value: JSON.stringify(options.surface.mcpLaunchContext),
        originalRoot,
        platformAllowedRoots,
        label,
        bindingIndex,
      });
    }
  }
}

export function assertNoOriginalTargetRootsInTaskArtifacts(options: {
  taskId: string;
  agentId: string;
  repoBindings: readonly TaskRepoBinding[];
  readonlyContextBindings?: readonly TaskReadonlyContextBinding[];
  platformRepoRoot: string;
  contextPackDir?: string;
  artifacts: readonly { path: string; category: 'implementation-spec' | 'implementation-step'; content: string }[];
}): void {
  const platformAllowedRoots = platformOwnedAllowedRoots(options);
  const taskVisibleBindings = collectTaskVisibleBindings(options);
  for (const artifact of options.artifacts) {
    for (const [bindingIndex, binding] of taskVisibleBindings.entries()) {
      if (!textContainsRoot(artifact.content, canonicalRoot(binding.originalRoot), platformAllowedRoots)) continue;
      throw new Error(
        `Agent artifact containment failed for task "${options.taskId}" agent "${options.agentId}": ` +
        `${artifact.category} artifact "${artifact.path}" contains selected original root for binding ${bindingIndex} (${bindingLabel(binding, bindingIndex)}).`,
      );
    }
  }
}

function collectFocusedPaths(focused: FocusedRepoResult | undefined): Array<[string, string]> {
  if (!focused) return [];
  const paths: Array<[string, string]> = [
    ['focused.primaryRepoRoot', focused.primaryRepoRoot],
    ...focused.visibleRepoRoots.map((root, index) => [`focused.visibleRepoRoots[${index}]`, root] as [string, string]),
    ...focused.declaredRepoRoots.map((root, index) => [`focused.declaredRepoRoots[${index}]`, root] as [string, string]),
  ];
  focused.writableRoots?.forEach((root, index) => {
    if (root.repoLocalPath) paths.push([`focused.writableRoots[${index}].repoLocalPath`, root.repoLocalPath]);
  });
  focused.readonlyContextRoots?.forEach((root, index) => {
    if (root.repoLocalPath) paths.push([`focused.readonlyContextRoots[${index}].repoLocalPath`, root.repoLocalPath]);
  });
  focused.primaryFocusTargets?.forEach((target, index) => {
    if (target.repoLocalPath) paths.push([`focused.primaryFocusTargets[${index}].repoLocalPath`, target.repoLocalPath]);
  });
  focused.supportTargets?.forEach((target, index) => {
    if (target.repoLocalPath) paths.push([`focused.supportTargets[${index}].repoLocalPath`, target.repoLocalPath]);
  });
  if (focused.testTarget?.resolvedPath) {
    paths.push(['focused.testTarget.resolvedPath', focused.testTarget.resolvedPath]);
  }
  return paths;
}

function collectTaskVisibleBindings(options: {
  taskId: string;
  platformRepoRoot: string;
  repoBindings: readonly TaskRepoBinding[];
  readonlyContextBindings?: readonly TaskReadonlyContextBinding[];
}): TaskVisibleBinding[] {
  const readonlyContextBindings = options.readonlyContextBindings
    ?? readTaskJsonSafe(options.taskId, options.platformRepoRoot)?.contextPackBinding.readonlyContextBindings
    ?? [];
  return [
    ...options.repoBindings,
    ...readonlyContextBindings,
  ];
}

function checkPath(args: {
  taskId: string;
  agentId: string;
  field: string;
  value: string;
  originalRoot: string;
  platformAllowedRoots: readonly string[];
  label: string;
  bindingIndex: number;
}): void {
  if (!pathMatchesRoot(args.value, args.originalRoot)) return;
  if (args.platformAllowedRoots.some((root) => pathMatchesRoot(args.value, root))) return;
  throw new Error(
    `Agent launch containment failed for task "${args.taskId}" agent "${args.agentId}": ` +
    `${args.field} contains selected original root for binding ${args.bindingIndex} (${args.label}).`,
  );
}

function checkText(args: Parameters<typeof checkPath>[0]): void {
  if (!textContainsRoot(args.value, args.originalRoot, args.platformAllowedRoots)) return;
  throw new Error(
    `Agent launch containment failed for task "${args.taskId}" agent "${args.agentId}": ` +
    `${args.field} contains selected original root for binding ${args.bindingIndex} (${args.label}).`,
  );
}

function pathMatchesRoot(value: string, root: string): boolean {
  return isPathWithinBoundary(root, canonicalRoot(value));
}

function textContainsRoot(value: string, root: string, allowedRoots: readonly string[]): boolean {
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const index = value.indexOf(root, searchFrom);
    if (index === -1) return false;
    searchFrom = index + root.length;
    if (!isRootOccurrence(value, index, root)) continue;
    if (allowedRoots.some((allowedRoot) => isAllowedRootOccurrence(value, index, allowedRoot))) continue;
    return true;
  }
  return false;
}

function isRootOccurrence(value: string, index: number, root: string): boolean {
  return hasPathBoundaryBefore(value, index) && hasPathBoundaryAfter(value, index + root.length);
}

function isAllowedRootOccurrence(value: string, index: number, allowedRoot: string): boolean {
  return value.startsWith(allowedRoot, index) && hasPathBoundaryAfter(value, index + allowedRoot.length);
}

function hasPathBoundaryBefore(value: string, index: number): boolean {
  if (index === 0) return true;
  const previous = value[index - 1] ?? '';
  return !/[A-Za-z0-9._/-]/.test(previous);
}

function hasPathBoundaryAfter(value: string, index: number): boolean {
  if (index >= value.length) return true;
  const next = value[index] ?? '';
  if (next === '.') {
    const following = value[index + 1] ?? '';
    return following === '' || !/[A-Za-z0-9_/-]/.test(following);
  }
  return next === path.sep || !/[A-Za-z0-9._-]/.test(next);
}

function bindingLabel(binding: TaskVisibleBinding, index: number): string {
  return path.basename(binding.worktreeRoot) || `binding-${index}`;
}

function platformOwnedAllowedRoots(options: {
  taskId: string;
  platformRepoRoot: string;
  contextPackDir?: string;
}): string[] {
  const platformRoot = canonicalRoot(options.platformRepoRoot);
  const roots = [
    path.join(platformRoot, 'AgentWorkSpace', 'tasks', options.taskId),
    path.join(platformRoot, 'AgentWorkSpace', 'templates'),
    path.join(platformRoot, 'AgentWorkSpace', 'qmd'),
    path.join(platformRoot, '.platform-state', 'runtime', 'tasks', options.taskId),
  ];
  if (options.contextPackDir && pathMatchesRoot(options.contextPackDir, platformRoot)) {
    roots.push(canonicalRoot(options.contextPackDir));
  }
  return roots;
}
