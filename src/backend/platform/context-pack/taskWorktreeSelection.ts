import path from 'node:path';
import { existsSync } from 'node:fs';
import { canonicalRoot, createLogger, isPathWithinBoundary, resolvePath } from '../core/index.js';
import { pathIdentityKey } from '../core/paths.js';
import {
  readContextPackManifest,
  resolveFirstLocalPath,
  type Manifest,
  type ManifestRepo,
} from './focusedRepo.js';
import {
  resolveExistingManifestGitRoot,
  resolveExistingManifestLocalPath,
} from './localPaths.js';
import type {
  TaskContextPackBinding,
  TaskContextPackTarget,
} from '../queue/markdown.js';
import { deriveStandardSelectionRoles } from '../queue/repositoryTypes.js';
import type { TaskPackSnapshot } from './taskPackSnapshot.js';
import type { TaskRepoBinding } from '../queue/taskJson.js';

const log = createLogger('platform/context-pack/taskWorktreeSelection');

/**
 * Identity key for repo/worktree roots: canonicalize (symlink-resolve) first,
 * then case-fold for Windows so drive/segment casing does not produce a false
 * map-key miss. Comparison key only — never persisted or displayed.
 */
function rootIdentityKey(root: string): string {
  return pathIdentityKey(canonicalRoot(root));
}

export type SelectedMaterializationRole = 'primary' | 'support';

export type SelectedMaterializationRoot = {
  repoId: string;
  role: SelectedMaterializationRole;
  originalRoot: string;
  gitRoot: string;
};

export async function resolveSelectedMaterializationRoots(options: {
  repoRoot: string;
  contextPackDir: string;
  binding: TaskContextPackBinding;
  taskId: string;
}): Promise<SelectedMaterializationRoot[]> {
  const contextPackDir = resolvePath(options.repoRoot, options.contextPackDir);
  const manifest = await readContextPackManifest(contextPackDir, options.repoRoot);
  if (!manifest) {
    throw new Error(`Unable to resolve selected materialization roots for task "${options.taskId}": context pack manifest is missing or malformed.`);
  }

  const roots: SelectedMaterializationRoot[] = [];
  const seen = new Set<string>();
  const addRoot = (root: SelectedMaterializationRoot): void => {
    const key = rootIdentityKey(root.originalRoot);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(root);
  };

  const repos = allManifestRepos(manifest);
  const repoById = new Map<string, ManifestRepo>();
  for (const repo of repos) {
    const repoId = repo.repo_id?.trim();
    if (repoId) repoById.set(repoId, repo);
  }
  const isMonolith = manifest.estate_type === 'monolith' || manifest.estate_type === 'monolith-platform';
  const monolithRepoId = isMonolith
    ? (manifest.repository ?? manifest.repositories?.[0])?.repo_id?.trim()
    : undefined;

  if (options.binding.deepFocusEnabled === true) {
    const addTarget = (target: TaskContextPackTarget | undefined | null, role: SelectedMaterializationRole, indexLabel: string): void => {
      if (!target) return;
      const root = rootFromTarget({
        target,
        role,
        indexLabel,
        repoById,
        contextPackDir,
        taskId: options.taskId,
        monolithRepoId,
      });
      if (root) addRoot(root);
    };
    for (const [index, target] of (options.binding.selectedFocusTargets ?? []).entries()) {
      addTarget(target, 'primary', `selectedFocusTargets[${index}]`);
      for (const [supportIndex, support] of (target.supportTargets ?? []).entries()) {
        addTarget(support, 'support', `selectedFocusTargets[${index}].supportTargets[${supportIndex}]`);
      }
      addTarget(target.testTarget, 'support', `selectedFocusTargets[${index}].testTarget`);
    }
    for (const [index, target] of (options.binding.selectedSupportTargets ?? []).entries()) {
      addTarget(target, 'support', `selectedSupportTargets[${index}]`);
    }
    addTarget(options.binding.selectedTestTarget, 'support', 'selectedTestTarget');
    if (roots.length === 0) {
      const fallbackPrimaryRepoId = options.binding.deepFocusPrimaryRepoId
        ?? options.binding.selectedRepoIds[0];
      const fallbackRepoIds = [
        fallbackPrimaryRepoId,
        ...options.binding.selectedRepoIds,
      ].filter((repoId): repoId is string => typeof repoId === 'string' && repoId.trim().length > 0);
      for (const repoId of fallbackRepoIds) {
        addRoot(resolveRepoRoot({
          repoId,
          role: repoId === fallbackPrimaryRepoId ? 'primary' : 'support',
          repoById,
          contextPackDir,
          taskId: options.taskId,
        }));
      }
      if (roots.length === 0) {
        const monolithRepo = manifest.repository ?? manifest.repositories?.[0];
        const repoId = monolithRepo?.repo_id?.trim();
        const hasMonolithFocusSelection = options.binding.selectedFocusIds.length > 0
          || Boolean(options.binding.deepFocusPrimaryFocusId?.trim())
          || Boolean(options.binding.primaryFocusId?.trim());
        if (monolithRepo && repoId && hasMonolithFocusSelection) {
          addRoot(resolveRepoRoot({
            repoId,
            role: 'primary',
            repoById,
            contextPackDir,
            taskId: options.taskId,
          }));
        }
      }
    }
  } else {
    const roleMap = deriveStandardSelectionRoles({
      selectedIds: options.binding.selectedRepoIds,
      repositoryTypes: options.binding.repositoryTypes,
      scalarPrimaryId: options.binding.primaryRepoId,
    });
    let selectedRepoIds = [...roleMap.primaryIds, ...roleMap.supportIds];
    if (selectedRepoIds.length === 0 && options.binding.selectedFocusIds.length > 0) {
      const monolithRepoId = (manifest.repository ?? manifest.repositories?.[0])?.repo_id?.trim();
      if (monolithRepoId) {
        selectedRepoIds = [monolithRepoId];
      }
    }
    for (const repoId of selectedRepoIds) {
      const role = roleMap.primaryIds.includes(repoId) ? 'primary' : 'support';
      addRoot(resolveRepoRoot({
        repoId,
        role,
        repoById,
        contextPackDir,
        taskId: options.taskId,
      }));
    }
  }

  if (roots.length === 0) {
    throw new Error(`Unable to resolve selected materialization roots for task "${options.taskId}": no selected repo roots were resolved.`);
  }

  log.debug('context_pack.selected_materialization_roots.resolved', {
    taskId: options.taskId,
    contextPackId: options.binding.contextPackId,
    selectedRepoIds: roots.map((root) => root.repoId),
    rootCount: roots.length,
  });
  return roots;
}

export function assertTaskWorktreeBindingsCoverSnapshot(options: {
  taskId: string;
  snapshot: TaskPackSnapshot;
  repoBindings: readonly TaskRepoBinding[];
  phase: 'activation' | 'agent-launch' | 'qa-diff';
}): void {
  const bindingsByRoot = new Map<string, number>();
  options.repoBindings.forEach((binding, index) => {
    bindingsByRoot.set(rootIdentityKey(binding.originalRoot), index);
  });

  const sourceRoots = collectSnapshotBranchOwnedRepoRoots(options.snapshot);
  for (const root of sourceRoots) {
    const key = rootIdentityKey(root);
    const covered = bindingsByRoot.has(key)
      || [...bindingsByRoot.keys()].some((bindingRoot) => isPathWithinBoundary(bindingRoot, key));
    if (!covered) {
      log.error('context_pack.task_worktree_binding_coverage.failed', {
        taskId: options.taskId,
        phase: options.phase,
        missingRoot: root,
      });
      throw new Error(
        `Task worktree bindings for task "${options.taskId}" do not cover selected source root during ${options.phase}: ${root}`,
      );
    }
  }

  log.debug('context_pack.task_worktree_binding_coverage.passed', {
    taskId: options.taskId,
    phase: options.phase,
    bindingCount: options.repoBindings.length,
    sourceRootCount: sourceRoots.length,
  });
}

function collectSnapshotBranchOwnedRepoRoots(snapshot: TaskPackSnapshot): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const addRoot = (value: string | null | undefined): void => {
    const root = value?.trim();
    if (!root) return;
    const key = rootIdentityKey(root);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(root);
  };

  addRoot(snapshot.primary.repoRoot);
  for (const root of snapshot.deepFocus.writableRoots) {
    addRoot(root.repoLocalPath ?? root.path);
  }

  return roots;
}

function rootFromTarget(options: {
  target: TaskContextPackTarget;
  role: SelectedMaterializationRole;
  indexLabel: string;
  repoById: ReadonlyMap<string, ManifestRepo>;
  contextPackDir: string;
  taskId: string;
  monolithRepoId: string | undefined;
}): SelectedMaterializationRoot | null {
  const repoId = options.target.repoId?.trim();
  const selectedRoot = options.target.repoLocalPath?.trim();
  if (selectedRoot) {
    if (!existsSync(selectedRoot)) {
      throw new Error(
        `activation-selected-repo-missing: ${options.indexLabel}.repoLocalPath "${selectedRoot}" does not exist for task "${options.taskId}"`,
      );
    }
    const originalRoot = canonicalRoot(selectedRoot);
    return {
      repoId: repoId ?? repoIdFromRoot(originalRoot),
      role: options.role,
      originalRoot,
      gitRoot: repoId && options.repoById.has(repoId)
        ? resolveGitRootForRepo(options.repoById.get(repoId)!, options.contextPackDir, originalRoot, options.taskId, repoId)
        : originalRoot,
    };
  }
  if (repoId) {
    return resolveRepoRoot({
      repoId,
      role: options.role,
      repoById: options.repoById,
      contextPackDir: options.contextPackDir,
      taskId: options.taskId,
    });
  }
  if (options.target.focusId?.trim() && options.monolithRepoId) {
    return resolveRepoRoot({
      repoId: options.monolithRepoId,
      role: options.role,
      repoById: options.repoById,
      contextPackDir: options.contextPackDir,
      taskId: options.taskId,
    });
  }
  return null;
}

function resolveRepoRoot(options: {
  repoId: string;
  role: SelectedMaterializationRole;
  repoById: ReadonlyMap<string, ManifestRepo>;
  contextPackDir: string;
  taskId: string;
}): SelectedMaterializationRoot {
  const repo = options.repoById.get(options.repoId);
  if (!repo) {
    throw new Error(`Unable to resolve selected materialization root for task "${options.taskId}": selected repo ID "${options.repoId}" is not declared in the manifest.`);
  }
  const originalRoot = resolveFirstLocalPath(repo, options.contextPackDir);
  if (!originalRoot) {
    throw new Error(`Unable to resolve selected materialization root for task "${options.taskId}": selected repo ID "${options.repoId}" has no resolvable local_path.`);
  }
  return {
    repoId: options.repoId,
    role: options.role,
    originalRoot,
    gitRoot: resolveGitRootForRepo(repo, options.contextPackDir, originalRoot, options.taskId, options.repoId),
  };
}

function resolveGitRootForRepo(
  repo: ManifestRepo,
  contextPackDir: string,
  originalRoot: string,
  taskId: string,
  repoId: string,
): string {
  for (const rawPath of repo.local_paths ?? []) {
    const localRoot = resolveExistingManifestLocalPath(rawPath, contextPackDir);
    if (localRoot && rootIdentityKey(localRoot) === rootIdentityKey(originalRoot)) {
      const gitRoot = resolveExistingManifestGitRoot(rawPath, contextPackDir);
      return gitRoot ?? localRoot;
    }
  }
  throw new Error(`Unable to resolve selected materialization root for task "${taskId}": selected repo ID "${repoId}" has no resolvable git root.`);
}

function allManifestRepos(manifest: Manifest): ManifestRepo[] {
  return [
    ...(manifest.repository ? [manifest.repository] : []),
    ...(Array.isArray(manifest.repositories) ? manifest.repositories : []),
  ];
}

function repoIdFromRoot(root: string): string {
  return path.basename(root) || 'selected-repo';
}
