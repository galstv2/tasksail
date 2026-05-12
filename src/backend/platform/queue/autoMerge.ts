import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { TaskRepoBinding } from './taskJson.js';

const execFile = promisify(execFileCb);

export type AutoMergeStatus =
  | 'disabled'
  | 'applied'
  | 'skipped-target-dirty'
  | 'skipped-detached-head'
  | 'skipped-source-missing'
  | 'skipped-merge-conflict'
  | 'skipped-merge-not-needed'
  | 'failed-abort';

export interface AutoMergeBindingResult {
  originalRoot: string;
  repoLabel: string;
  targetBranch: string | null;
  sourceBranch: string;
  status: AutoMergeStatus;
  detail: string;
}

export interface AutoMergeResult {
  enabled: boolean;
  applied: boolean;
  results: AutoMergeBindingResult[];
}

interface PreparedBinding {
  binding: TaskRepoBinding;
  repoLabel: string;
  targetBranch: string;
}

interface StartedStage {
  prepared: PreparedBinding;
  applyDetail: string;
}

export async function stageAutoMergeCloseout(options: {
  enabled: boolean;
  bindings: TaskRepoBinding[];
}): Promise<AutoMergeResult> {
  if (!options.enabled) {
    return {
      enabled: false,
      applied: false,
      results: options.bindings.map((binding) => resultFor(binding, null, 'disabled', 'Auto-merge is disabled.')),
    };
  }

  const prepared: PreparedBinding[] = [];
  const targetBranches = new Map<string, string | null>();
  let firstSkip: SkippedPreconditionResult | null = null;
  for (const binding of options.bindings) {
    const precondition = await evaluatePreconditions(binding);
    targetBranches.set(bindingKey(binding), precondition.targetBranch);
    if (precondition.status !== 'applied') {
      firstSkip ??= precondition;
      continue;
    }
    prepared.push({
      binding,
      repoLabel: repoLabel(binding),
      targetBranch: precondition.targetBranch,
    });
  }
  if (firstSkip !== null) {
    return skippedForAll(options.bindings, firstSkip.status, firstSkip.detail, targetBranches);
  }

  const started: StartedStage[] = [];
  const results: AutoMergeBindingResult[] = [];
  for (const item of prepared) {
    let apply: Awaited<ReturnType<typeof stageBranchPatch>>;
    try {
      apply = await stageBranchPatch(item);
    } catch (err) {
      const applyDetail = commandDetail(err);
      await rollbackFailedAndStarted({ failed: item, applyDetail, started });
      return skippedForAll(
        options.bindings,
        'skipped-merge-conflict',
        `Auto-merge staging failed and was rolled back; leaving source branch for manual review. ${applyDetail}`.trim(),
        targetBranches,
      );
    }

    const staged = await git(item.binding.originalRoot, ['diff', '--cached', '--name-only']);
    if (staged.stdout.trim() === '') {
      const failures = await rollbackStagedApplyAndCheckClean(item, apply.output);
      if (failures.length > 0) {
        throw new Error(`Completion blocked: auto-merge staging no-op cleanup failed. ${failures.join(' ')}`);
      }
      results.push(resultFor(
        item.binding,
        item.targetBranch,
        'skipped-merge-not-needed',
        'Auto-merge staging produced no staged changes; leaving source branch for manual review.',
      ));
      continue;
    }
    started.push({ prepared: item, applyDetail: apply.output });
    results.push(resultFor(
      item.binding,
      item.targetBranch,
      'applied',
      'Applied task branch patch to the target index; changes are staged for operator review.',
    ));
  }

  return {
    enabled: true,
    applied: results.some((result) => result.status === 'applied'),
    results,
  };
}

type PreconditionResult =
  | { status: 'applied'; targetBranch: string; detail: string }
  | {
    status: Exclude<AutoMergeStatus, 'disabled' | 'applied' | 'failed-abort'>;
    targetBranch: string | null;
    detail: string;
  };
type SkippedPreconditionResult = Exclude<PreconditionResult, { status: 'applied' }>;

async function evaluatePreconditions(binding: TaskRepoBinding): Promise<PreconditionResult> {
  if (!existsSync(binding.originalRoot)) {
    return { status: 'skipped-source-missing', targetBranch: null, detail: 'Original repo path does not exist.' };
  }

  const inside = await gitSafe(binding.originalRoot, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { status: 'skipped-source-missing', targetBranch: null, detail: 'Original repo path is not a git worktree.' };
  }

  const head = await gitSafe(binding.originalRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!head.ok) {
    return { status: 'skipped-source-missing', targetBranch: null, detail: commandDetail(head.error) };
  }
  const targetBranch = head.stdout.trim();
  if (targetBranch === 'HEAD') {
    return { status: 'skipped-detached-head', targetBranch: null, detail: 'Target repo is on detached HEAD.' };
  }
  if (targetBranch === binding.worktreeBranch) {
    return {
      status: 'skipped-merge-not-needed',
      targetBranch,
      detail: 'Target branch is already the source task branch.',
    };
  }

  const inProgress = await hasInProgressOperation(binding.originalRoot);
  if (inProgress) {
    return { status: 'skipped-target-dirty', targetBranch, detail: 'Target repo already has a merge, rebase, or cherry-pick in progress.' };
  }

  const status = await gitSafe(binding.originalRoot, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (!status.ok) {
    return { status: 'skipped-source-missing', targetBranch, detail: commandDetail(status.error) };
  }
  if (status.stdout.trim() !== '') {
    return { status: 'skipped-target-dirty', targetBranch, detail: 'Target branch has tracked or untracked changes.' };
  }

  const source = await gitSafe(binding.originalRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${binding.worktreeBranch}`]);
  if (!source.ok) {
    return { status: 'skipped-source-missing', targetBranch, detail: `Source branch ${binding.worktreeBranch} does not exist.` };
  }

  return { status: 'applied', targetBranch, detail: 'Preconditions passed.' };
}

async function hasInProgressOperation(repoRoot: string): Promise<boolean> {
  return (await hasGitState(repoRoot, [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REBASE_HEAD',
    path.join('rebase-merge', 'head-name'),
    path.join('rebase-apply', 'head-name'),
  ]));
}

async function hasGitState(repoRoot: string, entries: string[]): Promise<boolean> {
  const gitDir = await gitSafe(repoRoot, ['rev-parse', '--git-dir']);
  if (!gitDir.ok) return true;
  const resolvedGitDir = path.isAbsolute(gitDir.stdout.trim())
    ? gitDir.stdout.trim()
    : path.join(repoRoot, gitDir.stdout.trim());
  return entries.some((entry) => existsSync(path.join(resolvedGitDir, entry)));
}

async function rollbackFailedAndStarted(options: {
  failed: PreparedBinding;
  applyDetail: string;
  started: StartedStage[];
}): Promise<void> {
  const failures: string[] = [];
  failures.push(...await rollbackStagedApplyAndCheckClean(options.failed, options.applyDetail));

  for (const started of [...options.started].reverse()) {
    failures.push(...await rollbackStagedApplyAndCheckClean(started.prepared, started.applyDetail));
  }

  if (failures.length > 0) {
    throw new Error(`Completion blocked: auto-merge staging rollback failed. ${failures.join(' ')}`);
  }
}

async function rollbackStagedApplyAndCheckClean(item: PreparedBinding, detail: string): Promise<string[]> {
  const failures: string[] = [];
  const reset = await gitSafe(item.binding.originalRoot, ['reset', '--hard', 'HEAD']);
  if (!reset.ok) {
    failures.push(formatRollbackFailure(item, detail, commandDetail(reset.error)));
  }
  const cleanUntracked = await gitSafe(item.binding.originalRoot, ['clean', '-fd']);
  if (!cleanUntracked.ok) {
    failures.push(formatRollbackFailure(item, detail, commandDetail(cleanUntracked.error)));
  }

  const clean = await gitSafe(item.binding.originalRoot, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (!clean.ok || clean.stdout.trim() !== '') {
    failures.push(formatRollbackFailure(
      item,
      detail,
      clean.ok ? 'Repo is still dirty after staging rollback.' : commandDetail(clean.error),
    ));
  }
  return failures;
}

function skippedForAll(
  bindings: TaskRepoBinding[],
  status: Exclude<AutoMergeStatus, 'disabled' | 'applied' | 'failed-abort'>,
  detail: string,
  targetBranches: Map<string, string | null>,
): AutoMergeResult {
  return {
    enabled: true,
    applied: false,
    results: bindings.map((binding) => resultFor(
      binding,
      targetBranches.get(bindingKey(binding)) ?? null,
      status,
      detail,
    )),
  };
}

function bindingKey(binding: TaskRepoBinding): string {
  return `${binding.originalRoot}\0${binding.worktreeBranch}`;
}

function resultFor(
  binding: TaskRepoBinding,
  targetBranch: string | null,
  status: AutoMergeStatus,
  detail: string,
): AutoMergeBindingResult {
  return {
    originalRoot: binding.originalRoot,
    repoLabel: repoLabel(binding),
    targetBranch,
    sourceBranch: binding.worktreeBranch,
    status,
    detail,
  };
}

function repoLabel(binding: TaskRepoBinding): string {
  return path.basename(binding.originalRoot);
}

async function git(repoRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; output: string }> {
  const { stdout, stderr } = await execFile('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' });
  return { stdout, stderr, output: [stdout, stderr].filter(Boolean).join('\n').trim() };
}

async function gitBuffer(repoRoot: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFile('git', ['-C', repoRoot, ...args], {
    encoding: 'buffer',
    maxBuffer: 100 * 1024 * 1024,
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

async function stageBranchPatch(item: PreparedBinding): Promise<{ stdout: string; stderr: string; output: string }> {
  const patch = await gitBuffer(item.binding.originalRoot, [
    'diff',
    '--binary',
    `${item.binding.baseCommitSha}..${item.binding.worktreeBranch}`,
  ]);
  if (patch.length === 0) {
    return { stdout: '', stderr: '', output: '' };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'tasksail-auto-merge-'));
  const patchPath = path.join(tempDir, 'task-branch.patch');
  try {
    await writeFile(patchPath, patch);
    return await git(item.binding.originalRoot, ['apply', '--index', '--3way', patchPath]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function gitSafe(
  repoRoot: string,
  args: string[],
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; error: unknown; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await git(repoRoot, args);
    return { ok: true, stdout, stderr };
  } catch (error) {
    const maybe = error as { stdout?: unknown; stderr?: unknown };
    return {
      ok: false,
      error,
      stdout: typeof maybe.stdout === 'string' ? maybe.stdout : '',
      stderr: typeof maybe.stderr === 'string' ? maybe.stderr : '',
    };
  }
}

function commandDetail(error: unknown): string {
  const maybe = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  return [
    typeof maybe.stderr === 'string' ? maybe.stderr.trim() : '',
    typeof maybe.stdout === 'string' ? maybe.stdout.trim() : '',
    typeof maybe.message === 'string' ? maybe.message.trim() : '',
  ].filter(Boolean).join('\n').trim();
}

function formatRollbackFailure(item: PreparedBinding, applyDetail: string, rollbackDetail: string): string {
  return (
    `repo=${item.binding.originalRoot} source=${item.binding.worktreeBranch} ` +
    `target=${item.targetBranch} apply_failure=${JSON.stringify(applyDetail)} ` +
    `rollback_failure=${JSON.stringify(rollbackDetail)}`
  );
}
