import {
  normalizeActivationRepoRoot,
  type ActivationBranchCandidatePlan,
} from './branchChainActivation.js';
import {
  readTaskJsonSafe,
  resolveTaskJsonPath,
  type TaskRepoBinding,
} from './taskJson.js';
import { createLogger } from '../core/index.js';
import { pathIdentityKey } from '../core/paths.js';

const log = createLogger('platform/queue/activeBranchConflictGuard');

/**
 * Build the conflict map key from a normalized repo root and a branch name.
 * Only the repo-root path is identity-folded (Windows drive/segment casing);
 * the branch name stays case-sensitive. The NUL separator avoids collisions
 * between root and branch text.
 */
function conflictMapKey(originalRoot: string, worktreeBranch: string): string {
  return `${pathIdentityKey(originalRoot)}\0${worktreeBranch}`;
}

export interface BranchConflictKey {
  originalRoot: string;
  worktreeBranch: string;
}

export interface ActiveBranchOwner {
  taskId: string;
  sidecarPath: string;
  bindings: TaskRepoBinding[];
}

export interface ActivationBranchConflict {
  candidateTaskId: string;
  conflictingTaskId: string;
  originalRoot: string;
  repoLabel: string;
  worktreeBranch: string;
}

export type ActivationBranchConflictResult =
  | { blocked: false; conflicts: []; unreadableActiveTaskIds: string[] }
  | { blocked: true; conflicts: ActivationBranchConflict[]; unreadableActiveTaskIds: string[] };

export function normalizeBranchConflictKey(input: {
  originalRoot: string;
  worktreeBranch: string;
}): BranchConflictKey {
  const worktreeBranch = input.worktreeBranch.trim();
  if (!worktreeBranch) {
    throw new Error('activation-branch-conflict-key-invalid: worktreeBranch is empty');
  }
  return {
    originalRoot: normalizeActivationRepoRoot(input.originalRoot),
    worktreeBranch,
  };
}

export function collectActiveBranchOwners(args: {
  repoRoot: string;
  activeTaskIds: readonly string[];
  candidateTaskId: string;
}): { owners: ActiveBranchOwner[]; unreadableActiveTaskIds: string[] } {
  const owners: ActiveBranchOwner[] = [];
  const unreadableActiveTaskIds: string[] = [];

  for (const activeTaskId of args.activeTaskIds) {
    if (activeTaskId === args.candidateTaskId || activeTaskId.endsWith('.completing')) {
      continue;
    }
    const sidecarPath = resolveTaskJsonPath(activeTaskId, args.repoRoot);
    const sidecar = readTaskJsonSafe(activeTaskId, args.repoRoot);
    if (!sidecar) {
      unreadableActiveTaskIds.push(activeTaskId);
      log.warn('activation_branch_conflict.active_sidecar_unreadable', {
        taskId: activeTaskId,
        sidecarPath,
      });
      continue;
    }
    owners.push({
      taskId: activeTaskId,
      sidecarPath,
      bindings: sidecar.contextPackBinding.repoBindings,
    });
  }

  return { owners, unreadableActiveTaskIds };
}

export function findActivationBranchConflicts(args: {
  repoRoot: string;
  candidateTaskId: string;
  activeTaskIds: readonly string[];
  activationBranchCandidatePlans: readonly ActivationBranchCandidatePlan[];
}): ActivationBranchConflictResult {
  const { owners, unreadableActiveTaskIds } = collectActiveBranchOwners(args);
  const activeKeys = new Map<string, ActiveBranchOwner[]>();

  for (const owner of owners) {
    for (const binding of owner.bindings) {
      const key = normalizeBranchConflictKey({
        originalRoot: binding.originalRoot,
        worktreeBranch: binding.worktreeBranch,
      });
      const mapKey = conflictMapKey(key.originalRoot, key.worktreeBranch);
      const existing = activeKeys.get(mapKey);
      if (existing) {
        existing.push(owner);
      } else {
        activeKeys.set(mapKey, [owner]);
      }
    }
  }

  const conflicts: ActivationBranchConflict[] = [];
  for (const plan of args.activationBranchCandidatePlans) {
    const key = normalizeBranchConflictKey({
      originalRoot: plan.originalRoot,
      worktreeBranch: plan.worktreeBranch,
    });
    const matchingOwners = activeKeys.get(conflictMapKey(key.originalRoot, key.worktreeBranch)) ?? [];
    for (const owner of matchingOwners) {
      conflicts.push({
        candidateTaskId: args.candidateTaskId,
        conflictingTaskId: owner.taskId,
        originalRoot: key.originalRoot,
        repoLabel: plan.repoLabel,
        worktreeBranch: key.worktreeBranch,
      });
    }
  }

  conflicts.sort((a, b) =>
    a.originalRoot.localeCompare(b.originalRoot)
    || a.worktreeBranch.localeCompare(b.worktreeBranch)
    || a.conflictingTaskId.localeCompare(b.conflictingTaskId)
  );

  if (conflicts.length === 0) {
    return { blocked: false, conflicts: [], unreadableActiveTaskIds };
  }
  return { blocked: true, conflicts, unreadableActiveTaskIds };
}
