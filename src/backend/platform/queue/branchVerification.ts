/**
 * §B5 Post-completion branch verification.
 *
 * Runs between Step 0 (commitTaskSnapshot) and Step 2 (archival) in
 * completePendingItem. For every repoBinding declared in `.task.json`,
 * verifies:
 *   1. `refs/heads/<worktreeBranch>` exists in the originalRoot's `.git`.
 *   2. `git rev-list --count <baseCommitSha>..<worktreeBranch>` ≥ 1 — i.e.
 *      the task branch advanced past its baseline.
 *
 * If any binding fails either check, returns `ok: false` with a structured
 * failure list. The caller MUST throw on failure (no try/catch); the thrown
 * error routes through `moveFailedItemToErrorItems` which sets
 * `outcome='failed'` and retains the branch for operator post-mortem.
 *
 * Sidecar absence (legacy/recovery path) is treated as `ok: true` — there is
 * nothing to verify and the existing pre-worktree completion paths must
 * continue to work.
 *
 * Retry-suffixed taskIds (`<slug>-retryN`) are handled correctly because the
 * verification reads the retry's own `.task.json`; the sidecar's
 * `worktreeBranch` is the authoritative branch name regardless of the
 * task-slug shape.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readTaskJsonSafe } from './taskJson.js';

const execFileP = promisify(execFile);

export type BranchVerificationFailureReason =
  | 'branch-missing'
  | 'no-commits-beyond-base'
  | 'git-error';

export interface BranchVerificationFailure {
  originalRoot: string;
  branch: string;
  reason: BranchVerificationFailureReason;
  detail: string;
}

export interface BranchVerificationResult {
  ok: boolean;
  failures: BranchVerificationFailure[];
}

export async function verifyTaskBranches(
  repoRoot: string,
  taskId: string,
): Promise<BranchVerificationResult> {
  // Audit B: readTaskJsonSafe is sync and takes (taskId, repoRoot?) — NOT
  // (repoRoot, taskId). Audit A: bindings live at contextPackBinding.repoBindings.
  const sidecar = readTaskJsonSafe(taskId, repoRoot);
  if (sidecar === null) {
    return { ok: true, failures: [] };
  }
  const bindings = sidecar.contextPackBinding.repoBindings;
  if (bindings.length === 0) {
    return { ok: true, failures: [] };
  }

  const failures: BranchVerificationFailure[] = [];

  for (const binding of bindings) {
    // Check 1: branch ref exists in the originalRoot's .git.
    try {
      await execFileP('git', [
        '-C', binding.originalRoot,
        'rev-parse', '--verify', `refs/heads/${binding.worktreeBranch}`,
      ]);
    } catch (err) {
      failures.push({
        originalRoot: binding.originalRoot,
        branch: binding.worktreeBranch,
        reason: 'branch-missing',
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Check 2: branch has at least one commit beyond baseCommitSha.
    try {
      const { stdout } = await execFileP('git', [
        '-C', binding.originalRoot,
        'rev-list', '--count',
        `${binding.baseCommitSha}..${binding.worktreeBranch}`,
      ]);
      const count = Number(stdout.trim());
      if (!Number.isFinite(count) || count < 1) {
        failures.push({
          originalRoot: binding.originalRoot,
          branch: binding.worktreeBranch,
          reason: 'no-commits-beyond-base',
          detail: `rev-list count: ${stdout.trim()}`,
        });
      }
    } catch (err) {
      failures.push({
        originalRoot: binding.originalRoot,
        branch: binding.worktreeBranch,
        reason: 'git-error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: failures.length === 0, failures };
}
