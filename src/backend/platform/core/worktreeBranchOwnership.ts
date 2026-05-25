import { existsSync, readdirSync, rmSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { TaskRepoBinding } from '../queue/taskJson.js';
import {
  type ChildTaskChainsState,
  readChildTaskChains,
} from '../queue/childTaskChains.js';
import { normalizeBranchConflictKey, collectActiveBranchOwners } from '../queue/activeBranchConflictGuard.js';
import { resolveQueuePaths } from '../queue/paths.js';
import { withOriginLock } from './worktreeMaterialization.js';
import { emitTaskProgressEvent } from './taskProgressEvents.js';
import { createLogger } from './logger.js';

const execFile = promisify(execFileCb);
const log = createLogger('platform/core/worktreeBranchOwnership');

export interface ResolvedTaskBranchOwnership {
  ownership: 'task-owned' | 'chain-owned';
  source: 'sidecar' | 'legacy-task-branch' | 'legacy-child-chain-state';
  rootTaskId: string | null;
  taskId: string;
}

export interface ChainOwnedRollbackReport {
  taskId: string;
  status: 'completed' | 'preflight-failed' | 'partial-failed';
  rolledBackBindings: number;
  failedBinding: { repoRoot: string; repoLabel?: string; branch: string; worktreeRoot: string } | null;
  errorMessage: string | null;
}

export interface OwnershipFinalizeReport {
  chainRollbackReport: ChainOwnedRollbackReport | null;
  skipNextActivation: boolean;
  preserveTaskState: boolean;
}

interface ResolvedBinding {
  binding: TaskRepoBinding;
  ownership: ResolvedTaskBranchOwnership;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function bindingIdentity(binding: TaskRepoBinding): ChainOwnedRollbackReport['failedBinding'] {
  return {
    repoRoot: binding.originalRoot,
    branch: binding.worktreeBranch,
    worktreeRoot: binding.worktreeRoot,
  };
}

async function normalizeRepoRoot(input: string): Promise<string> {
  try {
    return await realpath(input);
  } catch {
    return path.resolve(input);
  }
}

export async function resolveTaskRepoBindingBranchOwnership(args: {
  repoRoot: string;
  taskId: string;
  binding: TaskRepoBinding;
  childChainState?: ChildTaskChainsState;
}): Promise<ResolvedTaskBranchOwnership> {
  const { taskId, binding } = args;
  if (binding.branchOwnership === 'task-owned') {
    if (binding.branchChainRootTaskId || binding.branchChainTaskId) {
      throw new Error(`task-branch-ownership-unresolved: contradictory task-owned metadata for ${taskId}`);
    }
    return { ownership: 'task-owned', source: 'sidecar', rootTaskId: null, taskId };
  }
  if (binding.branchOwnership === 'chain-owned') {
    if (!binding.branchChainRootTaskId || binding.branchChainTaskId !== taskId) {
      throw new Error(`task-branch-ownership-unresolved: incomplete chain-owned metadata for ${taskId}`);
    }
    return {
      ownership: 'chain-owned',
      source: 'sidecar',
      rootTaskId: binding.branchChainRootTaskId,
      taskId,
    };
  }
  if (binding.branchOwnership !== undefined) {
    throw new Error(`task-branch-ownership-unresolved: invalid ownership metadata for ${taskId}`);
  }

  if (binding.worktreeBranch === `task/${taskId}`) {
    return { ownership: 'task-owned', source: 'legacy-task-branch', rootTaskId: null, taskId };
  }

  const state = args.childChainState ?? await readChildTaskChains(args.repoRoot);
  const task = state.tasks[taskId];
  if (task?.branchChain) {
    const normalizedBindingRoot = await normalizeRepoRoot(binding.originalRoot);
    const matches = task.branchChain.repos.filter((repo) =>
      path.resolve(repo.repoRoot) === normalizedBindingRoot
      || path.resolve(repo.repoRoot) === path.resolve(binding.originalRoot)
    ).filter((repo) => repo.chainSourceBranch === binding.worktreeBranch);
    if (matches.length === 1) {
      return {
        ownership: 'chain-owned',
        source: 'legacy-child-chain-state',
        rootTaskId: task.rootTaskId,
        taskId,
      };
    }
  }

  throw new Error(`task-branch-ownership-unresolved: no ownership evidence for ${taskId}`);
}

async function resolveBindings(args: {
  repoRoot: string;
  taskId: string;
  bindings: readonly TaskRepoBinding[];
}): Promise<ResolvedBinding[]> {
  let childChainState: ChildTaskChainsState | undefined;
  const resolved: ResolvedBinding[] = [];
  for (const binding of args.bindings) {
    if (binding.branchOwnership === undefined && binding.worktreeBranch !== `task/${args.taskId}` && childChainState === undefined) {
      childChainState = await readChildTaskChains(args.repoRoot);
    }
    resolved.push({
      binding,
      ownership: await resolveTaskRepoBindingBranchOwnership({
        repoRoot: args.repoRoot,
        taskId: args.taskId,
        binding,
        childChainState,
      }),
    });
  }
  return resolved;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function preflightChainBinding(repoRoot: string, taskId: string, binding: TaskRepoBinding): Promise<void> {
  if (!binding.baseCommitSha.trim()) {
    throw new Error('chain-rollback-preflight-failed: baseCommitSha missing');
  }
  if (!binding.worktreeBranch.trim()) {
    throw new Error('chain-rollback-preflight-failed: worktreeBranch missing');
  }
  if (!existsSync(binding.originalRoot)) {
    throw new Error('chain-rollback-preflight-failed: originalRoot missing');
  }
  if (!existsSync(binding.worktreeRoot)) {
    throw new Error('chain-rollback-preflight-failed: worktreeRoot missing');
  }
  await runGit(binding.originalRoot, ['rev-parse', '--is-inside-work-tree']);
  await runGit(binding.worktreeRoot, ['rev-parse', '--is-inside-work-tree']);
  await runGit(binding.originalRoot, ['cat-file', '-e', `${binding.baseCommitSha}^{commit}`]);
  await runGit(binding.originalRoot, ['show-ref', '--verify', `refs/heads/${binding.worktreeBranch}`]);
  await runGit(binding.originalRoot, ['merge-base', '--is-ancestor', binding.baseCommitSha, `refs/heads/${binding.worktreeBranch}`]);
  const currentBranch = await runGit(binding.worktreeRoot, ['branch', '--show-current']);
  if (currentBranch !== binding.worktreeBranch) {
    throw new Error(`chain-rollback-preflight-failed: worktree on ${currentBranch || '<detached>'}`);
  }

  const activeItemsDir = resolveQueuePaths(repoRoot).activeItemsDir;
  let activeTaskIds: string[] = [];
  try {
    activeTaskIds = readdirSync(activeItemsDir).filter((entry) => !entry.endsWith('.completing'));
  } catch {
    activeTaskIds = [];
  }
  const targetKey = normalizeBranchConflictKey({
    originalRoot: binding.originalRoot,
    worktreeBranch: binding.worktreeBranch,
  });
  const { owners } = collectActiveBranchOwners({ repoRoot, activeTaskIds, candidateTaskId: taskId });
  for (const owner of owners) {
    for (const peerBinding of owner.bindings) {
      const peerKey = normalizeBranchConflictKey({
        originalRoot: peerBinding.originalRoot,
        worktreeBranch: peerBinding.worktreeBranch,
      });
      if (peerKey.originalRoot === targetKey.originalRoot && peerKey.worktreeBranch === targetKey.worktreeBranch) {
        throw new Error(`chain-rollback-preflight-failed: peer active task ${owner.taskId} owns branch`);
      }
    }
  }
}

async function removeTaskOwnedBindingHard(binding: TaskRepoBinding): Promise<void> {
  try {
    await execFile('git', ['-C', binding.originalRoot, 'worktree', 'remove', '--force', binding.worktreeRoot]);
  } catch {
    // Already removed out-of-band.
  }
  await execFile('git', ['-C', binding.originalRoot, 'worktree', 'prune']).catch((err: unknown) => {
    log.warn('worktree.prune.failed', {
      originalRoot: binding.originalRoot,
      error: errorMessage(err),
    });
  });
  await execFile('git', ['-C', binding.originalRoot, 'branch', '-D', binding.worktreeBranch]).catch((err: unknown) => {
    log.warn('worktree.branch_delete.failed', {
      branch: binding.worktreeBranch,
      error: errorMessage(err),
    });
  });
}

async function removeChainOwnedWorktree(args: {
  repoRoot: string;
  taskId: string;
  binding: TaskRepoBinding;
  retainFailedWorktree?: boolean;
}): Promise<void> {
  const { repoRoot, taskId, binding } = args;
  await withOriginLock(binding.originalRoot, async () => {
    await execFile('git', ['-C', binding.originalRoot, 'worktree', 'remove', '--force', binding.worktreeRoot]).catch(() => {});
    await execFile('git', ['-C', binding.originalRoot, 'worktree', 'prune']).catch(() => {});
  });
  const extra = {
    taskId,
    repoRoot: binding.originalRoot,
    branch: binding.worktreeBranch,
    worktreeRoot: binding.worktreeRoot,
    reason: 'chain-owned',
    ...(args.retainFailedWorktree === undefined ? {} : { retainFailedWorktree: args.retainFailedWorktree }),
  };
  await emitTaskProgressEvent({
    logger: log.child({ taskId }),
    repoRoot,
    taskId,
    event: { type: 'child_chain_failure_branch.branch_delete_skipped', input: extra },
  });
}

async function rollbackChainOwnedBindings(args: {
  repoRoot: string;
  taskId: string;
  bindings: readonly TaskRepoBinding[];
  retainFailedWorktree: boolean;
}): Promise<ChainOwnedRollbackReport> {
  for (const binding of args.bindings) {
    try {
      await preflightChainBinding(args.repoRoot, args.taskId, binding);
    } catch (err) {
      const report: ChainOwnedRollbackReport = {
        taskId: args.taskId,
        status: 'preflight-failed',
        rolledBackBindings: 0,
        failedBinding: bindingIdentity(binding),
        errorMessage: errorMessage(err),
      };
      await emitRollbackReport(args.repoRoot, report, args.retainFailedWorktree);
      return report;
    }
  }

  let rolledBack = 0;
  for (const binding of args.bindings) {
    try {
      await withOriginLock(binding.originalRoot, async () => {
        await execFile('git', [
          '-C', binding.worktreeRoot,
          'reset',
          args.retainFailedWorktree ? '--mixed' : '--hard',
          binding.baseCommitSha,
        ]);
        if (!args.retainFailedWorktree) {
          await execFile('git', ['-C', binding.originalRoot, 'worktree', 'remove', '--force', binding.worktreeRoot]);
          await execFile('git', ['-C', binding.originalRoot, 'worktree', 'prune']);
        }
      });
      rolledBack += 1;
    } catch (err) {
      const report: ChainOwnedRollbackReport = {
        taskId: args.taskId,
        status: 'partial-failed',
        rolledBackBindings: rolledBack,
        failedBinding: bindingIdentity(binding),
        errorMessage: errorMessage(err),
      };
      await emitRollbackReport(args.repoRoot, report, args.retainFailedWorktree);
      return report;
    }
  }

  const report: ChainOwnedRollbackReport = {
    taskId: args.taskId,
    status: 'completed',
    rolledBackBindings: rolledBack,
    failedBinding: null,
    errorMessage: null,
  };
  await emitRollbackReport(args.repoRoot, report, args.retainFailedWorktree);
  return report;
}

async function emitRollbackReport(
  repoRoot: string,
  report: ChainOwnedRollbackReport,
  retainFailedWorktree: boolean,
): Promise<void> {
  const extra = {
    status: report.status,
    rolledBackBindings: report.rolledBackBindings,
    failedBinding: report.failedBinding,
    error: report.errorMessage,
    retainFailedWorktree,
  };
  if (report.status === 'completed') {
    await emitTaskProgressEvent({
      logger: log.child({ taskId: report.taskId }),
      repoRoot,
      taskId: report.taskId,
      event: { type: 'child_chain_failure_branch.rollback_completed', input: extra },
    });
    return;
  }
  await emitTaskProgressEvent({
    logger: log.child({ taskId: report.taskId }),
    repoRoot,
    taskId: report.taskId,
    event: {
      type: report.status === 'preflight-failed'
        ? 'child_chain_failure_branch.rollback_preflight_failed'
        : 'child_chain_failure_branch.rollback_failed',
      input: extra,
    },
  });
}

export async function finalizeFailedTaskBindingsWithOwnership(args: {
  repoRoot: string;
  taskId: string;
  bindings: readonly TaskRepoBinding[];
  retainFailedWorktree: boolean;
}): Promise<OwnershipFinalizeReport> {
  const resolved = await resolveBindings(args);
  const taskOwned = resolved.filter((item) => item.ownership.ownership === 'task-owned').map((item) => item.binding);
  const chainOwned = resolved.filter((item) => item.ownership.ownership === 'chain-owned').map((item) => item.binding);

  let chainRollbackReport: ChainOwnedRollbackReport | null = null;
  if (chainOwned.length > 0) {
    chainRollbackReport = await rollbackChainOwnedBindings({
      repoRoot: args.repoRoot,
      taskId: args.taskId,
      bindings: chainOwned,
      retainFailedWorktree: args.retainFailedWorktree,
    });
    if (chainRollbackReport.status !== 'completed') {
      return { chainRollbackReport, skipNextActivation: true, preserveTaskState: true };
    }
  }

  if (!args.retainFailedWorktree) {
    for (const binding of taskOwned) {
      await removeTaskOwnedBindingHard(binding);
    }
  }
  return { chainRollbackReport, skipNextActivation: false, preserveTaskState: false };
}

export async function discardTaskBindingsWithOwnership(args: {
  repoRoot: string;
  taskId: string;
  bindings: readonly TaskRepoBinding[];
}): Promise<void> {
  const resolved = await resolveBindings(args);
  for (const item of resolved) {
    if (item.ownership.ownership === 'chain-owned') {
      await removeChainOwnedWorktree({
        repoRoot: args.repoRoot,
        taskId: args.taskId,
        binding: item.binding,
      });
    } else {
      await removeTaskOwnedBindingHard(item.binding);
    }
  }
}

export async function isChildChainSourceBranchProtected(args: {
  repoRoot: string;
  branch: string;
  state?: ChildTaskChainsState;
}): Promise<{ protected: boolean; unreadable: boolean }> {
  let state = args.state;
  if (!state) {
    try {
      state = await readChildTaskChains(args.repoRoot);
    } catch {
      return { protected: false, unreadable: true };
    }
  }
  const normalizedRoot = await normalizeRepoRoot(args.repoRoot);
  for (const task of Object.values(state.tasks)) {
    const branchChainRepos = task.branchChain?.repos ?? [];
    const handoffs = task.completedBranchHandoffs ?? [];
    const referenced = [
      ...branchChainRepos.map((repo) => ({ repoRoot: repo.repoRoot, chainSourceBranch: repo.chainSourceBranch })),
      ...handoffs.map((handoff) => ({ repoRoot: handoff.repoRoot, chainSourceBranch: handoff.chainSourceBranch })),
    ];
    for (const ref of referenced) {
      if (ref.chainSourceBranch !== args.branch) continue;
      const refRoot = await normalizeRepoRoot(ref.repoRoot);
      if (refRoot === normalizedRoot) {
        return { protected: true, unreadable: false };
      }
    }
  }
  return { protected: false, unreadable: false };
}

export function removeTaskWorkspaceAndRuntime(repoRoot: string, taskId: string): void {
  rmSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId), { recursive: true, force: true });
  rmSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId), { recursive: true, force: true });
}
