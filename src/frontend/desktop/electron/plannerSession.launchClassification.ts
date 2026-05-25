import path from 'node:path';

import type {
  PlannerChildTaskLineage,
  PlannerFocusSnapshot,
  PlannerParentBranchViewStatus,
} from '../src/shared/desktopContract';

export type PlannerLaunchRootSource =
  | 'platform-allowlist'
  | 'parent-pinned-worktree'
  | 'live-override'
  | 'live-baseline-no-parent';

export type PlannerLaunchRootClassification = {
  root: string;
  source: PlannerLaunchRootSource;
  parentWorktreeRepoLabel?: string;
};

export type PlannerLaunchClassificationInputs = {
  allowedRoots: readonly string[];
  platformAllowlist: readonly string[];
  parentBranchViewBindings: readonly { worktreeRoot: string; repoLabel: string }[] | undefined;
  hasParentBranchViewSession: boolean;
};

export type PlannerLaunchClassificationLogPayload = {
  sessionId: string | undefined;
  contextPackDir: string;
  rootCount: number;
  parentBranchView: 'created' | 'not-requested' | 'skipped-missing-handoffs' | 'none';
  estateTypeHint: 'distributed-platform' | 'monolith' | 'unknown';
  classifications: PlannerLaunchRootClassification[];
};

export type PlannerLaunchClassificationLogInputs = {
  sessionId: string | undefined;
  contextPackDir: string;
  allowedRoots: string[];
  platformAllowlist: string[];
  parentBranchViewStatus: PlannerParentBranchViewStatus | undefined;
  parentBranchViewBindings: readonly { worktreeRoot: string; repoLabel: string }[] | undefined;
  childTaskLineage: PlannerChildTaskLineage | undefined;
  childTaskFocusSnapshot: PlannerFocusSnapshot | undefined;
};

export function classifyPlannerLaunchAllowedRoots(
  inputs: PlannerLaunchClassificationInputs,
): PlannerLaunchRootClassification[] {
  return inputs.allowedRoots.map((root) => {
    if (inputs.platformAllowlist.some((allowedRoot) => pathMatchesRoot(root, allowedRoot))) {
      return { root, source: 'platform-allowlist' };
    }
    const binding = inputs.parentBranchViewBindings?.find((candidate) => pathMatchesRoot(root, candidate.worktreeRoot));
    if (binding) {
      return { root, source: 'parent-pinned-worktree', parentWorktreeRepoLabel: binding.repoLabel };
    }
    return {
      root,
      source: inputs.hasParentBranchViewSession ? 'live-override' : 'live-baseline-no-parent',
    };
  });
}

export function buildPlannerLaunchClassificationLogPayload(
  inputs: PlannerLaunchClassificationLogInputs,
): PlannerLaunchClassificationLogPayload {
  const hasParentBranchViewSession = Boolean(inputs.parentBranchViewBindings);
  return {
    sessionId: inputs.sessionId,
    contextPackDir: inputs.contextPackDir,
    rootCount: inputs.allowedRoots.length,
    parentBranchView: parentBranchViewMode(inputs.parentBranchViewStatus, hasParentBranchViewSession, inputs.childTaskLineage),
    estateTypeHint: estateTypeHint(inputs.childTaskFocusSnapshot),
    classifications: classifyPlannerLaunchAllowedRoots({
      allowedRoots: inputs.allowedRoots,
      platformAllowlist: inputs.platformAllowlist,
      parentBranchViewBindings: inputs.parentBranchViewBindings,
      hasParentBranchViewSession,
    }),
  };
}

function parentBranchViewMode(
  status: PlannerParentBranchViewStatus | undefined,
  hasSession: boolean,
  lineage: PlannerChildTaskLineage | undefined,
): PlannerLaunchClassificationLogPayload['parentBranchView'] {
  if (hasSession) return 'created';
  if (status?.mode === 'skipped-missing-handoffs') return 'skipped-missing-handoffs';
  if (lineage) return 'not-requested';
  return 'none';
}

function estateTypeHint(snapshot: PlannerFocusSnapshot | undefined): PlannerLaunchClassificationLogPayload['estateTypeHint'] {
  const binding = snapshot?.contextPackBinding;
  if (!binding) return 'unknown';
  if (
    binding.selectedRepoIds.length > 0
    || Boolean(binding.primaryRepoId)
    || Boolean(binding.deepFocusPrimaryRepoId)
    || binding.selectedFocusTargets.some((target) => Boolean(target.repoId))
  ) {
    return 'distributed-platform';
  }
  if (
    binding.selectedFocusIds.length > 0
    || Boolean(binding.primaryFocusId)
    || Boolean(binding.deepFocusPrimaryFocusId)
    || binding.selectedFocusTargets.some((target) => Boolean(target.focusId))
  ) {
    return 'monolith';
  }
  return 'unknown';
}

function pathMatchesRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
}
