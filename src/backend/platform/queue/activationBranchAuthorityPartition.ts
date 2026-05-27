import { canonicalRoot } from '../core/index.js';
import type { SelectedMaterializationRoot } from '../context-pack/taskWorktreeSelection.js';
import type { TaskPackSnapshot } from '../context-pack/taskPackSnapshot.js';
import type { TaskContextPackSelection } from './taskJson.js';
import { deriveStandardSelectionRoles } from './repositoryTypes.js';

export interface BranchAuthorityRoot extends SelectedMaterializationRoot {
  authority: 'branch-owned' | 'readonly-context';
  reason:
    | 'standard-primary'
    | 'standard-support'
    | 'legacy-scalar-primary'
    | 'legacy-scalar-support'
    | 'deep-focus-writable'
    | 'deep-focus-readonly'
    | 'monolith-writable'
    | 'monolith-readonly';
}

export interface BranchAuthorityPartition {
  branchOwnedRoots: BranchAuthorityRoot[];
  readonlyContextRoots: BranchAuthorityRoot[];
}

export function partitionSelectedMaterializationRoots(args: {
  taskId: string;
  selection: TaskContextPackSelection;
  selectedRoots: readonly SelectedMaterializationRoot[];
  snapshot: TaskPackSnapshot;
}): BranchAuthorityPartition {
  const isMonolith = args.snapshot.estateType === 'monolith' || args.snapshot.estateType === 'monolith-platform';
  const classified = new Map<string, BranchAuthorityRoot>();
  const order: string[] = [];

  const addRoot = (root: BranchAuthorityRoot): void => {
    const key = canonicalRoot(root.originalRoot);
    const existing = classified.get(key);
    if (!existing) {
      order.push(key);
      classified.set(key, root);
      return;
    }
    if (existing.authority === 'readonly-context' && root.authority === 'branch-owned') {
      classified.set(key, root);
    }
  };

  if (!isMonolith && args.selection.deepFocusEnabled !== true) {
    const roles = deriveStandardSelectionRoles({
      selectedIds: args.selection.selectedRepoIds,
      repositoryTypes: args.selection.repositoryTypes,
      scalarPrimaryId: args.selection.primaryRepoId,
    });
    const primaryIds = new Set(roles.primaryIds);
    const supportIds = new Set(roles.supportIds);
    const usesFrozenRoles = args.selection.repositoryTypes !== undefined;

    for (const root of args.selectedRoots) {
      if (primaryIds.has(root.repoId)) {
        addRoot({
          ...root,
          authority: 'branch-owned',
          reason: usesFrozenRoles ? 'standard-primary' : 'legacy-scalar-primary',
        });
        continue;
      }
      if (supportIds.has(root.repoId)) {
        addRoot({
          ...root,
          authority: 'readonly-context',
          reason: usesFrozenRoles ? 'standard-support' : 'legacy-scalar-support',
        });
        continue;
      }
      throw new Error(
        `activation-branch-authority-unclassified for task "${args.taskId}": ${root.repoId} ${root.originalRoot}`,
      );
    }

    return partitionFromOrder(order, classified);
  }

  const writableRoots = rootMembershipSet(args.snapshot.deepFocus.writableRoots);
  const readonlyRoots = rootMembershipSet(args.snapshot.deepFocus.readonlyContextRoots);
  const branchReason = args.selection.deepFocusEnabled === true ? 'deep-focus-writable' : 'monolith-writable';
  const readonlyReason = args.selection.deepFocusEnabled === true ? 'deep-focus-readonly' : 'monolith-readonly';

  for (const root of args.selectedRoots) {
    const key = canonicalRoot(root.originalRoot);
    if (writableRoots.has(key)) {
      addRoot({
        ...root,
        authority: 'branch-owned',
        reason: branchReason,
      });
      continue;
    }
    if (readonlyRoots.has(key)) {
      addRoot({
        ...root,
        authority: 'readonly-context',
        reason: readonlyReason,
      });
      continue;
    }
    throw new Error(
      `activation-branch-authority-unclassified for task "${args.taskId}": ${root.repoId} ${root.originalRoot}`,
    );
  }

  return partitionFromOrder(order, classified);
}

function partitionFromOrder(
  order: readonly string[],
  classified: ReadonlyMap<string, BranchAuthorityRoot>,
): BranchAuthorityPartition {
  const branchOwnedRoots: BranchAuthorityRoot[] = [];
  const readonlyContextRoots: BranchAuthorityRoot[] = [];
  for (const key of order) {
    const root = classified.get(key);
    if (!root) continue;
    if (root.authority === 'branch-owned') {
      branchOwnedRoots.push(root);
    } else {
      readonlyContextRoots.push(root);
    }
  }
  return { branchOwnedRoots, readonlyContextRoots };
}

function rootMembershipSet(
  roots: readonly { repoLocalPath?: string; path: string }[],
): Set<string> {
  const set = new Set<string>();
  for (const root of roots) {
    const repoRoot = root.repoLocalPath?.trim();
    if (repoRoot) {
      set.add(canonicalRoot(repoRoot));
      continue;
    }
    const rootPath = root.path.trim();
    if (rootPath) {
      set.add(canonicalRoot(rootPath));
    }
  }
  return set;
}
