import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import {
  existingBranchPreconditionsPass,
  preconditionsPass,
} from '../core/worktreeMaterialization.js';
import {
  extractBranchChainBinding,
  type TaskBranchChainBinding,
  type TaskBranchChainRepo,
} from './markdown.js';

const defaultExecFile = promisify(execFileCb);

export interface ActivationMaterializationOrigin {
  contextRoot: string;
  gitRoot: string;
}

export interface ActivationBranchPlan {
  mode: 'standard' | 'chained';
  originalRoot: string;
  contextRoot: string;
  repoLabel: string;
  worktreePath: string;
  worktreeRootForBinding: string;
  worktreeBranch: string;
  baseCommitSha: string;
  addWorktree: boolean;
  createBranch: boolean;
  branchChainRepo: TaskBranchChainRepo | null;
}

export interface ActivationBranchCandidatePlan {
  mode: 'standard' | 'chained';
  originalRoot: string;
  contextRoot: string;
  repoLabel: string;
  worktreePath: string;
  worktreeRootForBinding: string;
  worktreeBranch: string;
  addWorktree: boolean;
  createBranch: boolean;
  branchChainRepo: TaskBranchChainRepo | null;
}

export interface ActivationRollbackBinding {
  repoBinding: {
    originalRoot: string;
    worktreeRoot: string;
    worktreeBranch: string;
    baseCommitSha: string;
    branchOwnership?: 'task-owned' | 'chain-owned';
    branchChainRootTaskId?: string;
    branchChainTaskId?: string;
  };
  createdBranch: boolean;
}

export interface BuildActivationBranchPlansArgs {
  taskId: string;
  branchChainBinding: TaskBranchChainBinding | null;
  materializationOrigins: readonly ActivationMaterializationOrigin[];
  repoLabels: readonly string[];
  repoRoot: string;
  resolveWorktreePath?: (taskId: string, repoLabel: string) => string;
  execFileAsync?: typeof defaultExecFile;
}

export function resolveTaskBranchChainForActivation(
  content: string,
  taskId: string,
  taskKind: string,
  lineage: { parentTaskId: string; rootTaskId: string },
): TaskBranchChainBinding | null {
  if (taskKind !== 'child-task') return null;

  const result = extractBranchChainBinding(content);
  if (result.kind === 'absent') return null;
  if (result.kind === 'invalid') {
    throw new Error(`activation-branch-chain-invalid for task "${taskId}": ${result.reason}`);
  }

  const binding = result.binding;
  const mismatches: string[] = [];
  if (binding.rootTaskId !== lineage.rootTaskId) {
    mismatches.push(`rootTaskId ${binding.rootTaskId} does not match ${lineage.rootTaskId}`);
  }
  if (binding.parentTaskId !== lineage.parentTaskId) {
    mismatches.push(`parentTaskId ${binding.parentTaskId} does not match ${lineage.parentTaskId}`);
  }
  if (binding.depth < 1) {
    mismatches.push('depth must be at least 1');
  }
  if (binding.repos.length === 0) {
    mismatches.push('repos must not be empty');
  }
  if (mismatches.length > 0) {
    throw new Error(`activation-branch-chain-mismatch for task "${taskId}": ${mismatches.join('; ')}`);
  }
  return binding;
}

export function normalizeActivationRepoRoot(input: string): string {
  try {
    return existsSync(input) ? realpathSync(input) : path.resolve(input);
  } catch {
    return path.resolve(input);
  }
}

export function matchBranchChainRepoForRoot(
  binding: TaskBranchChainBinding,
  gitRoot: string,
): TaskBranchChainRepo | null {
  const normalizedGitRoot = normalizeActivationRepoRoot(gitRoot);
  return binding.repos.find((repo) =>
    normalizeActivationRepoRoot(repo.repoRoot) === normalizedGitRoot
  ) ?? null;
}

export function assertEveryMaterializedRepoHasBranchChainEntry(
  taskId: string,
  binding: TaskBranchChainBinding,
  materializationOrigins: readonly ActivationMaterializationOrigin[],
): void {
  for (const origin of materializationOrigins) {
    const normalizedGitRoot = normalizeActivationRepoRoot(origin.gitRoot);
    const matches = binding.repos.filter((repo) =>
      normalizeActivationRepoRoot(repo.repoRoot) === normalizedGitRoot
    );
    if (matches.length === 0) {
      throw new Error(
        `activation-branch-chain-repo-missing for task "${taskId}": ${normalizedGitRoot}`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `activation-branch-chain-repo-ambiguous for task "${taskId}": ${normalizedGitRoot}`,
      );
    }
  }
}

export async function buildActivationBranchCandidatePlans(
  args: BuildActivationBranchPlansArgs,
): Promise<ActivationBranchCandidatePlan[]> {
  const resolveWorktreePath = args.resolveWorktreePath
    ?? ((taskId, repoLabel) => path.join(args.repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', repoLabel));

  if (!args.branchChainBinding) {
    return args.materializationOrigins.map((origin, index) => {
      const repoLabel = args.repoLabels[index]!;
      const worktreePath = resolveWorktreePath(args.taskId, repoLabel);
      const worktreeBranch = `task/${args.taskId}`;

      return {
        mode: 'standard',
        originalRoot: origin.gitRoot,
        contextRoot: origin.contextRoot,
        repoLabel,
        worktreePath,
        worktreeRootForBinding: worktreePath,
        worktreeBranch,
        addWorktree: true,
        createBranch: true,
        branchChainRepo: null,
      };
    });
  }

  assertEveryMaterializedRepoHasBranchChainEntry(args.taskId, args.branchChainBinding, args.materializationOrigins);

  const plans: ActivationBranchCandidatePlan[] = [];
  for (let index = 0; index < args.materializationOrigins.length; index += 1) {
    const origin = args.materializationOrigins[index]!;
    const repoLabel = args.repoLabels[index]!;
    const branchChainRepo = matchBranchChainRepoForRoot(args.branchChainBinding, origin.gitRoot)!;
    const worktreePath = resolveWorktreePath(args.taskId, repoLabel);
    const worktreeBranch = branchChainRepo.chainSourceBranch;

    plans.push({
      mode: 'chained',
      originalRoot: origin.gitRoot,
      contextRoot: origin.contextRoot,
      repoLabel,
      worktreePath,
      worktreeRootForBinding: worktreePath,
      worktreeBranch,
      addWorktree: true,
      createBranch: false,
      branchChainRepo,
    });
  }

  return plans;
}

export async function finalizeActivationBranchPlans(
  args: BuildActivationBranchPlansArgs & {
    candidatePlans: readonly ActivationBranchCandidatePlan[];
  },
): Promise<ActivationBranchPlan[]> {
  const execFileAsync = args.execFileAsync ?? defaultExecFile;
  const plans: ActivationBranchPlan[] = [];

  for (const candidate of args.candidatePlans) {
    if (candidate.mode === 'standard') {
      let baseCommitSha = '';
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: candidate.originalRoot });
        baseCommitSha = stdout.trim();
      } catch {
        // Preserve empty-repo/non-git compatibility. preconditionsPass reports the fallback.
      }

      const pre = await preconditionsPass(candidate.originalRoot, args.taskId, candidate.worktreePath);
      if (!pre.ok) {
        if (pre.reason === 'empty-origin-repo') {
          plans.push({
            ...candidate,
            worktreeRootForBinding: candidate.originalRoot,
            baseCommitSha,
            addWorktree: false,
            createBranch: false,
          });
          continue;
        }
        throw new Error(`activation-precondition-failed: ${pre.reason}: ${pre.detail ?? ''}`);
      }

      plans.push({
        ...candidate,
        baseCommitSha,
      });
      continue;
    }

    let baseCommitSha: string;
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', candidate.originalRoot,
        'rev-parse',
        `refs/heads/${candidate.worktreeBranch}^{}`,
      ]);
      baseCommitSha = stdout.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`activation-branch-chain-base-unresolved for task "${args.taskId}": ${candidate.worktreeBranch}: ${message}`);
    }

    const pre = await existingBranchPreconditionsPass(candidate.originalRoot, candidate.worktreeBranch, candidate.worktreePath);
    if (!pre.ok) {
      throw new Error(
        `activation-branch-chain-precondition-failed for task "${args.taskId}": ${pre.reason}: ${pre.detail ?? ''}`,
      );
    }

    plans.push({
      ...candidate,
      baseCommitSha,
    });
  }

  return plans;
}

export async function buildActivationBranchPlans(
  args: BuildActivationBranchPlansArgs,
): Promise<ActivationBranchPlan[]> {
  const candidatePlans = await buildActivationBranchCandidatePlans(args);
  return finalizeActivationBranchPlans({ ...args, candidatePlans });
}
