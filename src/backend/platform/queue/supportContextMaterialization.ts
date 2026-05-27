import { existsSync } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../core/logger.js';
import { materializeWorktreeDeps, withOriginLock } from '../core/worktreeMaterialization.js';
import type { TaskReadonlyContextBinding } from './taskJson.js';

const defaultExecFileAsync = promisify(execFileCb);
const log = createLogger('platform/queue/supportContextMaterialization');

export type ReadonlyContextSource =
  | 'standard-support'
  | 'deep-focus-readonly-context'
  | 'monolith-readonly-context'
  | 'branch-chain-readonly-context';

export interface ReadonlyContextMaterializationPlan {
  taskId: string;
  repoId: string;
  repoLabel: string;
  originalRoot: string;
  gitRoot: string;
  worktreeRoot: string;
  source: ReadonlyContextSource;
}

export interface ReadonlyContextMaterializationResult {
  binding: TaskReadonlyContextBinding;
  materialization: { cloned: string[]; skipped: string[] };
}

export async function materializeReadonlyContextWorktree(args: {
  repoRoot: string;
  plan: ReadonlyContextMaterializationPlan;
  pathsToClone: readonly string[];
  execFileAsync?: typeof defaultExecFileAsync;
}): Promise<ReadonlyContextMaterializationResult> {
  const execFileAsync = args.execFileAsync ?? defaultExecFileAsync;
  const { plan } = args;
  const startedAt = Date.now();
  let baseCommitSha = '';

  if (!existsSync(plan.gitRoot)) {
    throw new Error(`readonly-context-origin-missing for task "${plan.taskId}": ${plan.gitRoot}`);
  }

  try {
    const result = await withOriginLock(plan.gitRoot, async () => {
      await execFileAsync('git', ['-C', plan.gitRoot, 'rev-parse', '--is-inside-work-tree']);
      const { stdout } = await execFileAsync('git', ['-C', plan.gitRoot, 'rev-parse', 'HEAD^{}']);
      baseCommitSha = stdout.trim();
      if (!baseCommitSha) {
        throw new Error(`readonly-context-base-unresolved for task "${plan.taskId}": ${plan.gitRoot}`);
      }

      try {
        await execFileAsync('git', [
          '-C', plan.gitRoot,
          'worktree', 'add',
          '--detach',
          plan.worktreeRoot,
          baseCommitSha,
        ]);
        const materialization = await materializeWorktreeDeps(
          plan.gitRoot,
          plan.worktreeRoot,
          [...args.pathsToClone],
          { taskId: plan.taskId, repoLabel: plan.repoLabel },
        );
        return {
          binding: {
            originalRoot: plan.originalRoot,
            worktreeRoot: plan.worktreeRoot,
            baseCommitSha,
            repoId: plan.repoId,
            role: 'support' as const,
          },
          materialization: {
            cloned: materialization.cloned,
            skipped: materialization.skipped,
          },
        };
      } catch (err) {
        await removeDetachedReadonlyWorktreeNoLock({
          originalRoot: plan.gitRoot,
          worktreeRoot: plan.worktreeRoot,
          execFileAsync,
        }).catch((cleanupErr: unknown) => {
          // Partial-creation rollback is best-effort: surface the cleanup failure
          // separately so an orphan worktree dir does not vanish from the logs.
          log.warn('readonly_context.worktree.partial_creation_cleanup_failed', {
            taskId: plan.taskId,
            repoId: plan.repoId,
            worktreeRoot: plan.worktreeRoot,
            error: errorMessage(cleanupErr),
          });
        });
        throw err;
      }
    });

    log.info('readonly_context.worktree.materialized', {
      taskId: plan.taskId,
      repoId: plan.repoId,
      repoLabel: plan.repoLabel,
      originalRoot: plan.originalRoot,
      worktreeRoot: plan.worktreeRoot,
      baseCommitSha,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: 'success',
      source: plan.source,
    });
    return result;
  } catch (err) {
    log.info('readonly_context.worktree.materialized', {
      taskId: plan.taskId,
      repoId: plan.repoId,
      repoLabel: plan.repoLabel,
      originalRoot: plan.originalRoot,
      worktreeRoot: plan.worktreeRoot,
      baseCommitSha,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: 'failed',
      source: plan.source,
      error: errorMessage(err),
    });
    throw err;
  }
}

export async function removeReadonlyContextWorktree(args: {
  repoRoot: string;
  taskId: string;
  binding: TaskReadonlyContextBinding;
  source?: ReadonlyContextSource;
  repoLabel?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}): Promise<void> {
  const execFileAsync = args.execFileAsync ?? defaultExecFileAsync;
  const source = args.source ?? 'standard-support';
  const startedAt = Date.now();
  try {
    await withOriginLock(args.binding.originalRoot, async () => {
      await removeDetachedReadonlyWorktreeNoLock({
        originalRoot: args.binding.originalRoot,
        worktreeRoot: args.binding.worktreeRoot,
        execFileAsync,
      });
    });
    log.info('readonly_context.worktree.cleanup.completed', {
      taskId: args.taskId,
      repoId: args.binding.repoId,
      repoLabel: args.repoLabel ?? args.binding.repoId,
      originalRoot: args.binding.originalRoot,
      worktreeRoot: args.binding.worktreeRoot,
      baseCommitSha: args.binding.baseCommitSha,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: 'success',
      source,
    });
  } catch (err) {
    log.warn('readonly_context.worktree.cleanup.failed', {
      taskId: args.taskId,
      repoId: args.binding.repoId,
      repoLabel: args.repoLabel ?? args.binding.repoId,
      originalRoot: args.binding.originalRoot,
      worktreeRoot: args.binding.worktreeRoot,
      baseCommitSha: args.binding.baseCommitSha,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: 'failed',
      source,
      error: errorMessage(err),
    });
    throw err;
  }
}

async function removeDetachedReadonlyWorktreeNoLock(args: {
  originalRoot: string;
  worktreeRoot: string;
  execFileAsync: typeof defaultExecFileAsync;
}): Promise<void> {
  let removeError: unknown = null;
  try {
    await args.execFileAsync('git', [
      '-C', args.originalRoot,
      'worktree', 'remove',
      '--force',
      args.worktreeRoot,
    ]);
  } catch (err) {
    if (!isAlreadyRemovedWorktreeError(err)) {
      removeError = err;
    }
  }
  try {
    await args.execFileAsync('git', ['-C', args.originalRoot, 'worktree', 'prune']);
  } catch (err) {
    if (removeError) {
      throw removeError;
    }
    throw err;
  }
  if (removeError) {
    throw removeError;
  }
}

function errorMessage(err: unknown): string {
  const message = rawErrorMessage(err);
  if (/cannot remove a locked working tree/iu.test(message)) {
    return 'git worktree remove failed: locked working tree';
  }
  if (/is not a working tree/iu.test(message)) {
    return 'git worktree remove skipped: not a working tree';
  }
  if (/no such file or directory/iu.test(message)) {
    return 'git worktree remove skipped: path missing';
  }
  return message.split(/\r?\n/u)[0]?.replace(/^Command failed: .*/u, 'git command failed').slice(0, 500)
    ?? 'unknown error';
}

function isAlreadyRemovedWorktreeError(err: unknown): boolean {
  const message = rawErrorMessage(err).toLowerCase();
  return message.includes('is not a working tree') ||
    message.includes('not a git repository') ||
    message.includes('no such file or directory');
}

function rawErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
