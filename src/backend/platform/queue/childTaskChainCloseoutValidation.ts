import { execFile } from 'node:child_process';

import { normalizeRepoRoot, type PreparedChildTaskChainCloseout } from './childTaskChainCloseout.js';
import type { TaskRepoBinding } from './taskJson.js';

export const CHILD_CHAIN_AUTO_MERGE_SKIP_MESSAGE = 'Auto-merge skipped for child task chain: chain branches are manually integrated by the operator.';

export interface ChildTaskChainCloseoutPolicy {
  isChainedChild: boolean;
  platformAutoMergeEnabled: boolean;
  effectiveAutoMergeEnabled: boolean;
  emitChildChainAutoMergeSkip: boolean;
  autoMergeDetailOverride: string | null;
}

export function buildChildTaskChainCloseoutPolicy(args: {
  childChainCloseout: PreparedChildTaskChainCloseout | null;
  platformAutoMergeEnabled: boolean;
}): ChildTaskChainCloseoutPolicy {
  const isChainedChild = args.childChainCloseout !== null;
  const emitChildChainAutoMergeSkip = isChainedChild && args.platformAutoMergeEnabled;
  return {
    isChainedChild,
    platformAutoMergeEnabled: args.platformAutoMergeEnabled,
    effectiveAutoMergeEnabled: isChainedChild ? false : args.platformAutoMergeEnabled,
    emitChildChainAutoMergeSkip,
    autoMergeDetailOverride: emitChildChainAutoMergeSkip ? CHILD_CHAIN_AUTO_MERGE_SKIP_MESSAGE : null,
  };
}

export async function verifyChildChainSourceBranchesExist(args: {
  taskId: string;
  prepared: PreparedChildTaskChainCloseout;
  repoBindings: readonly TaskRepoBinding[];
  execFileAsync?: typeof execFile;
}): Promise<void> {
  const normalizedBindings = args.repoBindings.map((binding) => ({
    binding,
    normalizedRoot: normalizeRepoRoot(binding.originalRoot),
  }));
  for (const repo of args.prepared.branchChain.repos) {
    const normalizedRepoRoot = normalizeRepoRoot(repo.repoRoot);
    const matches = normalizedBindings.filter((entry) => entry.normalizedRoot === normalizedRepoRoot);
    if (matches.length !== 1) {
      throw new Error(
        `child-task-chain-closeout-source-branch-mismatch for task "${args.taskId}": ` +
        `${normalizedRepoRoot} expected ${repo.chainSourceBranch} matched ${matches.length} repo bindings`,
      );
    }
    const [{ binding }] = matches;
    if (binding.worktreeBranch !== repo.chainSourceBranch) {
      throw new Error(
        `child-task-chain-closeout-source-branch-mismatch for task "${args.taskId}": ` +
        `${normalizedRepoRoot} expected ${repo.chainSourceBranch} but .task.json has ${binding.worktreeBranch}`,
      );
    }
    try {
      await runGit(args.execFileAsync ?? execFile, [
        '-C',
        normalizedRepoRoot,
        'rev-parse',
        '--verify',
        `refs/heads/${repo.chainSourceBranch}`,
      ]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Completion blocked: child task chain source branch ${repo.chainSourceBranch} is missing in ${normalizedRepoRoot}. ` +
        `Restore the chain branch or resolve the child task manually. ` +
        `child-task-chain-closeout-source-branch-missing for task "${args.taskId}": ` +
        `${normalizedRepoRoot} ${repo.chainSourceBranch} ${reason}`,
      );
    }
  }
}

function runGit(command: typeof execFile, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    command('git', args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
