import { execFile as execFileCb } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { FocusedRepoResult } from '../../../backend/platform/context-pack/focusedRepo.js';
import { withOriginLock } from '../../../backend/platform/core/worktreeMaterialization.js';
import type {
  ArchivedTaskBranchHandoff,
  PlannerParentBranchViewRequest,
  PlannerParentBranchViewStatus,
} from '../src/shared/desktopContract';
import { PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE } from '../src/shared/desktopContract';
import { createLogger } from './log/logger';
import { REPO_ROOT } from './paths';

const execFileAsync = promisify(execFileCb);
const log = createLogger('electron/plannerParentBranchView');
const GIT_TIMEOUT_MS = 45_000;
const RUNTIME_ROOT = path.join(REPO_ROOT, '.platform-state', 'runtime', 'planner-parent-branch-views');

export type PlannerParentBranchViewBinding = {
  repoRoot: string;
  repoLabel: string;
  sourceBranch: string;
  headCommitSha: string;
  worktreeRoot: string;
  elapsedMs: number;
  // 'creating' is persisted before `git worktree add` so crash recovery can
  // clean a worktree that exists on disk without a completed manifest entry.
  status: 'creating' | 'created';
};

export type PlannerParentBranchViewManifest = {
  schemaVersion: 1;
  plannerSessionId: string;
  parentTaskId: string;
  contextPackDir: string;
  createdAt: string;
  bindings: PlannerParentBranchViewBinding[];
};

export type PlannerParentBranchViewSession = {
  plannerSessionId: string;
  parentTaskId: string;
  sessionDir: string;
  manifest: PlannerParentBranchViewManifest;
};

type CreateArgs = {
  plannerSessionId: string;
  focused: FocusedRepoResult | undefined;
  request: PlannerParentBranchViewRequest | undefined;
  now?: () => Date;
  execFile?: typeof execFileAsync;
};

export async function createPlannerParentBranchViewSession(args: CreateArgs): Promise<{
  focused: FocusedRepoResult | undefined;
  status?: PlannerParentBranchViewStatus;
  session?: PlannerParentBranchViewSession;
}> {
  const { plannerSessionId, focused, request } = args;
  if (!request) {
    return { focused, status: { mode: 'not-requested', message: 'Parent branch view was not requested.', worktreeCount: 0 } };
  }
  if (request.branchChainAvailability.status === 'missing-branch-handoffs') {
    return {
      focused,
      status: {
        mode: 'skipped-missing-handoffs',
        message: PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE,
        warning: PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE,
        worktreeCount: 0,
      },
    };
  }
  if (request.branchChainAvailability.status === 'invalid-branch-handoffs') {
    throw new Error('Parent branch view failed: archived parent branch handoffs are invalid.');
  }
  const handoffs = request.branchHandoffs ?? [];
  if (!focused || handoffs.length === 0) {
    throw new Error('Parent branch view failed: archived parent branch handoffs are invalid.');
  }

  const normalized = await normalizeHandoffs(handoffs);
  const byRoot = new Map<string, NormalizedHandoff>();
  for (const handoff of normalized) {
    if (byRoot.has(handoff.normalizedRepoRoot)) {
      throw new Error(`Parent branch view failed: archived parent has duplicate branch handoffs for repo ${handoff.normalizedRepoRoot}.`);
    }
    byRoot.set(handoff.normalizedRepoRoot, handoff);
  }

  const focusedRoots = [...new Set(collectFocusedRoots(focused))];
  const matched = new Map<string, NormalizedHandoff>();
  for (const root of focusedRoots) {
    const normalizedRoot = await normalizeRepoRoot(root);
    const match = findContainingHandoff(normalizedRoot, normalized);
    if (match) {
      matched.set(match.normalizedRepoRoot, match);
    }
  }
  if (matched.size === 0) {
    throw new Error('Parent branch view failed: branch handoff repo does not match the selected parent scope.');
  }

  const sessionDir = path.join(RUNTIME_ROOT, plannerSessionId);
  const manifest: PlannerParentBranchViewManifest = {
    schemaVersion: 1,
    plannerSessionId,
    parentTaskId: request.parentTaskId,
    contextPackDir: request.contextPackDir,
    createdAt: (args.now ?? (() => new Date()))().toISOString(),
    bindings: [],
  };
  const execFile = args.execFile ?? execFileAsync;
  try {
    await mkdir(sessionDir, { recursive: true });
    const usedLabels = new Set<string>();
    for (const handoff of matched.values()) {
      const repoLabel = uniqueSanitizedRepoLabel(handoff.repoLabel, handoff.headCommitSha, usedLabels);
      const worktreeRoot = path.join(sessionDir, repoLabel);
      const startedAt = Date.now();
      const binding: PlannerParentBranchViewBinding = {
        repoRoot: handoff.normalizedRepoRoot,
        repoLabel,
        sourceBranch: handoff.branch,
        headCommitSha: handoff.headCommitSha,
        worktreeRoot,
        elapsedMs: 0,
        status: 'creating',
      };
      manifest.bindings.push(binding);
      await writeManifest(sessionDir, manifest);
      log.info('planner.parent-branch-view.create.started', {
        sessionId: plannerSessionId,
        parentTaskId: request.parentTaskId,
        repoLabel,
        repoRoot: handoff.normalizedRepoRoot,
        sourceBranch: handoff.branch,
        headCommitSha: handoff.headCommitSha,
        worktreeRoot,
      });
      const failure = { kind: 'worktree-add' as 'missing-source-branch' | 'missing-commit' | 'worktree-add' };
      try {
        await withOriginLock(handoff.normalizedRepoRoot, async () => {
          failure.kind = 'missing-source-branch';
          await verifyParentBranchViewSourceBranchExists({
            execFile,
            repoRoot: handoff.normalizedRepoRoot,
            repoLabel,
            sourceBranch: handoff.branch,
            parentTaskId: request.parentTaskId,
          });
          failure.kind = 'missing-commit';
          await runGit(execFile, ['-C', handoff.normalizedRepoRoot, 'cat-file', '-e', `${handoff.headCommitSha}^{commit}`]);
          failure.kind = 'worktree-add';
          await runGit(
            execFile,
            ['-C', handoff.normalizedRepoRoot, 'worktree', 'add', '--detach', worktreeRoot, handoff.headCommitSha],
            { GIT_LFS_SKIP_SMUDGE: '1' },
          );
        });
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        const elapsedMs = Date.now() - startedAt;
        log.warn('planner.parent-branch-view.create.failed', {
          sessionId: plannerSessionId,
          parentTaskId: request.parentTaskId,
          repoLabel,
          repoRoot: handoff.normalizedRepoRoot,
          sourceBranch: handoff.branch,
          headCommitSha: handoff.headCommitSha,
          worktreeRoot,
          elapsedMs,
          reason,
        });
        if (isGitTimeoutError(error)) {
          throw new Error(`Parent branch view failed: timed out while creating read-only worktree for ${repoLabel}.`);
        }
        if (failure.kind === 'missing-source-branch') {
          throw error;
        }
        if (failure.kind === 'missing-commit') {
          throw new Error(`Parent branch view failed: commit ${handoff.headCommitSha} from parent task ${request.parentTaskId} is missing in ${handoff.normalizedRepoRoot}.`);
        }
        throw new Error(`Parent branch view failed: could not create read-only worktree for ${repoLabel}.`);
      }
      binding.elapsedMs = Date.now() - startedAt;
      binding.status = 'created';
      await writeManifest(sessionDir, manifest);
      log.info('planner.parent-branch-view.create.completed', {
        sessionId: plannerSessionId,
        parentTaskId: request.parentTaskId,
        ...binding,
      });
    }
    const rewrittenFocused = rewriteFocusedRoots(focused, manifest.bindings);
    return {
      focused: rewrittenFocused,
      status: {
        mode: 'created',
        message: `Parent branch view created with ${manifest.bindings.length} worktree${manifest.bindings.length === 1 ? '' : 's'}.`,
        worktreeCount: manifest.bindings.length,
      },
      session: { plannerSessionId, parentTaskId: request.parentTaskId, sessionDir, manifest },
    };
  } catch (error: unknown) {
    await cleanupPlannerParentBranchViewSession({ plannerSessionId, parentTaskId: request.parentTaskId, sessionDir, manifest, execFile });
    throw error;
  }
}

export async function cleanupPlannerParentBranchViewSession(session: PlannerParentBranchViewSession & { execFile?: typeof execFileAsync }): Promise<void> {
  const execFile = session.execFile ?? execFileAsync;
  const startedAt = Date.now();
  const pruned = new Set<string>();
  const bindings = session.manifest.bindings;
  let cleanupFailed = false;
  const logFailure = (worktreeRoot: string, reason: string, repoRoot?: string): void => {
    cleanupFailed = true;
    log.warn('planner.parent-branch-view.cleanup.failed', {
      sessionId: session.plannerSessionId,
      parentTaskId: session.parentTaskId,
      ...(repoRoot ? { repoRoot } : {}),
      worktreeRoot,
      reason,
    });
  };
  for (const binding of bindings) {
    if (!isInsideRuntimeRoot(binding.worktreeRoot)) {
      logFailure(binding.worktreeRoot, 'worktree path is outside runtime root', binding.repoRoot);
      continue;
    }
    try {
      await withOriginLock(binding.repoRoot, async () => {
        try {
          await runGit(execFile, ['-C', binding.repoRoot, 'worktree', 'remove', '--force', binding.worktreeRoot]);
        } catch (error: unknown) {
          if (!isIdempotentWorktreeError(error)) {
            throw error;
          }
          log.info('planner.parent-branch-view.cleanup.idempotent', {
            sessionId: session.plannerSessionId,
            parentTaskId: session.parentTaskId,
            repoRoot: binding.repoRoot,
            worktreeRoot: binding.worktreeRoot,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        if (!pruned.has(binding.repoRoot)) {
          await runGit(execFile, ['-C', binding.repoRoot, 'worktree', 'prune']);
          pruned.add(binding.repoRoot);
        }
      });
    } catch (error: unknown) {
      logFailure(binding.worktreeRoot, error instanceof Error ? error.message : String(error), binding.repoRoot);
    }
  }
  if (!cleanupFailed && isInsideRuntimeRoot(session.sessionDir)) {
    try {
      await rm(session.sessionDir, { recursive: true, force: true });
    } catch (error: unknown) {
      logFailure(session.sessionDir, error instanceof Error ? error.message : String(error));
    }
  }
  log.info('planner.parent-branch-view.cleanup.completed', {
    sessionId: session.plannerSessionId,
    parentTaskId: session.parentTaskId,
    worktreeCount: bindings.length,
    repoRootsPrunedCount: pruned.size,
    elapsedMs: Date.now() - startedAt,
    cleanupFailed,
  });
}

export async function recoverPlannerParentBranchViewsOnStartup(execFile?: typeof execFileAsync): Promise<void> {
  const startedAt = Date.now();
  let recoveredSessionCount = 0;
  let removedDirectoryCount = 0;
  let preservedDirectoryCount = 0;
  const entries = await readdir(RUNTIME_ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sessionDir = path.join(RUNTIME_ROOT, entry.name);
    if (!isInsideRuntimeRoot(sessionDir)) {
      continue;
    }
    const manifest = await readManifest(sessionDir);
    if (manifest) {
      // cleanup iterates every binding regardless of 'creating' / 'created'
      // status, so a session that crashed mid-`worktree add` is still cleaned.
      await cleanupPlannerParentBranchViewSession({
        plannerSessionId: manifest.plannerSessionId,
        parentTaskId: manifest.parentTaskId,
        sessionDir,
        manifest,
        execFile,
      });
      recoveredSessionCount += 1;
    } else if (await containsGitWorktreeCheckout(sessionDir)) {
      // A manifestless directory holding a git worktree checkout means the
      // crash happened after `worktree add` but before the manifest write.
      // Deleting the folder directly would orphan git admin metadata in the
      // source repo, so preserve it for manual `git worktree` cleanup.
      preservedDirectoryCount += 1;
      log.warn('planner.parent-branch-view.recovery.preserved-unsafe-directory', {
        sessionDir,
        reason: 'manifestless directory contains a git worktree checkout; left for manual inspection',
      });
    } else {
      await rm(sessionDir, { recursive: true, force: true });
      removedDirectoryCount += 1;
    }
  }
  log.info('planner.parent-branch-view.recovery.completed', {
    recoveredSessionCount,
    removedDirectoryCount,
    preservedDirectoryCount,
    elapsedMs: Date.now() - startedAt,
  });
}

type NormalizedHandoff = ArchivedTaskBranchHandoff & {
  normalizedRepoRoot: string;
};

async function verifyParentBranchViewSourceBranchExists(args: {
  execFile: typeof execFileAsync;
  repoRoot: string;
  repoLabel: string;
  sourceBranch: string;
  parentTaskId: string;
}): Promise<void> {
  try {
    await runGit(args.execFile, ['-C', args.repoRoot, 'rev-parse', '--verify', `refs/heads/${args.sourceBranch}`]);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn('planner.parent-branch-view.source-branch-validation.failed', {
      parentTaskId: args.parentTaskId,
      repoRoot: args.repoRoot,
      repoLabel: args.repoLabel,
      sourceBranch: args.sourceBranch,
      reason,
    });
    throw new Error(`Parent branch view failed: source branch ${args.sourceBranch} no longer exists in ${args.repoLabel}. Restore the branch or choose another parent task.`);
  }
}

async function normalizeHandoffs(handoffs: ArchivedTaskBranchHandoff[]): Promise<NormalizedHandoff[]> {
  return Promise.all(handoffs.map(async (handoff) => {
    if (!handoff.repoRoot.trim() || !handoff.repoLabel.trim() || !handoff.branch.trim() || !handoff.headCommitSha.trim()) {
      throw new Error('Parent branch view failed: archived parent branch handoffs are invalid.');
    }
    return {
      ...handoff,
      normalizedRepoRoot: await normalizeRepoRoot(handoff.repoRoot),
    };
  }));
}

async function normalizeRepoRoot(input: string): Promise<string> {
  const resolved = path.resolve(input);
  return realpath(resolved).catch(() => resolved);
}

function findContainingHandoff(root: string, handoffs: NormalizedHandoff[]): NormalizedHandoff | undefined {
  return handoffs.find((handoff) => root === handoff.normalizedRepoRoot || root.startsWith(`${handoff.normalizedRepoRoot}${path.sep}`));
}

function collectFocusedRoots(focused: FocusedRepoResult): string[] {
  const roots = [
    focused.primaryRepoRoot,
    ...focused.visibleRepoRoots,
    ...focused.declaredRepoRoots,
    ...(focused.readonlyContextRoots?.map((root) => root.repoLocalPath ?? root.path) ?? []),
    focused.testTarget?.resolvedPath,
    focused.testTarget?.repoLocalPath,
    focused.selectedTestTarget?.repoLocalPath,
    ...(focused.supportTargets?.map((target) => target.repoLocalPath ?? target.path) ?? []),
    ...(focused.primaryFocusTargets?.flatMap((target) => [
      target.repoLocalPath,
      target.testTarget?.repoLocalPath,
      ...(target.supportTargets?.map((support) => support.repoLocalPath) ?? []),
    ]) ?? []),
  ];
  return roots.filter((root): root is string => typeof root === 'string' && root.length > 0);
}

function rewriteFocusedRoots(focused: FocusedRepoResult, bindings: PlannerParentBranchViewBinding[]): FocusedRepoResult {
  const cloned = structuredClone(focused);
  cloned.primaryRepoRoot = rewritePath(cloned.primaryRepoRoot, bindings);
  cloned.visibleRepoRoots = cloned.visibleRepoRoots.map((root) => rewritePath(root, bindings));
  cloned.declaredRepoRoots = cloned.declaredRepoRoots.map((root) => rewritePath(root, bindings));
  if (cloned.readonlyContextRoots) {
    cloned.readonlyContextRoots = cloned.readonlyContextRoots.map((root) => ({
      ...root,
      path: path.isAbsolute(root.path) ? rewritePath(root.path, bindings) : root.path,
      ...(root.repoLocalPath ? { repoLocalPath: rewritePath(root.repoLocalPath, bindings) } : {}),
    }));
  }
  if (cloned.testTarget) {
    cloned.testTarget = {
      ...cloned.testTarget,
      resolvedPath: rewritePath(cloned.testTarget.resolvedPath, bindings),
      ...(cloned.testTarget.repoLocalPath ? { repoLocalPath: rewritePath(cloned.testTarget.repoLocalPath, bindings) } : {}),
    };
  }
  if (cloned.selectedTestTarget?.repoLocalPath) {
    cloned.selectedTestTarget = { ...cloned.selectedTestTarget, repoLocalPath: rewritePath(cloned.selectedTestTarget.repoLocalPath, bindings) };
  }
  if (cloned.supportTargets) {
    cloned.supportTargets = cloned.supportTargets.map((target) => ({
      ...target,
      path: path.isAbsolute(target.path) ? rewritePath(target.path, bindings) : target.path,
      ...(target.repoLocalPath ? { repoLocalPath: rewritePath(target.repoLocalPath, bindings) } : {}),
    }));
  }
  if (cloned.primaryFocusTargets) {
    cloned.primaryFocusTargets = cloned.primaryFocusTargets.map((target) => ({
      ...target,
      ...(target.repoLocalPath ? { repoLocalPath: rewritePath(target.repoLocalPath, bindings) } : {}),
      ...(target.testTarget ? {
        testTarget: {
          ...target.testTarget,
          ...(target.testTarget.repoLocalPath ? { repoLocalPath: rewritePath(target.testTarget.repoLocalPath, bindings) } : {}),
        },
      } : {}),
      ...(target.supportTargets ? {
        supportTargets: target.supportTargets.map((support) => ({
          ...support,
          ...(support.repoLocalPath ? { repoLocalPath: rewritePath(support.repoLocalPath, bindings) } : {}),
        })),
      } : {}),
    }));
  }
  return cloned;
}

function rewritePath(input: string, bindings: PlannerParentBranchViewBinding[]): string {
  const resolved = realpathNearestAncestor(path.resolve(input));
  const binding = bindings.find((candidate) => (
    resolved === candidate.repoRoot || resolved.startsWith(`${candidate.repoRoot}${path.sep}`)
  ));
  if (!binding) {
    return input;
  }
  return path.join(binding.worktreeRoot, path.relative(binding.repoRoot, resolved));
}

// Resolves the realpath of the nearest existing ancestor so non-existent focus
// subpaths still match handoff repo roots normalized through realpath (e.g. the
// macOS /var -> /private/var symlink).
function realpathNearestAncestor(target: string): string {
  const suffix: string[] = [];
  let current = target;
  for (;;) {
    try {
      const real = realpathSync(current);
      return suffix.length > 0 ? path.join(real, ...suffix) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return target;
      }
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function uniqueSanitizedRepoLabel(input: string, sha: string, used: Set<string>): string {
  const base = input
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    || 'repo';
  let label = base;
  if (used.has(label)) {
    label = `${base}-${sha.slice(0, 8)}`;
  }
  used.add(label);
  return label;
}

async function runGit(execFile: typeof execFileAsync, args: string[], env?: Record<string, string>): Promise<void> {
  await execFile('git', args, {
    timeout: GIT_TIMEOUT_MS,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

// `git worktree remove` on a worktree that was already removed, never
// registered, or whose directory is gone is treated as cleanup success so
// recovery is idempotent across retries and crash windows.
function isIdempotentWorktreeError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('is not a working tree')
    || message.includes('is not a worktree')
    || message.includes('not a valid')
    || message.includes('not registered')
    || message.includes('no such file or directory');
}

// True when the session directory (or one of its repo-label children) holds a
// git worktree checkout, identified by a `.git` file or directory.
async function containsGitWorktreeCheckout(sessionDir: string): Promise<boolean> {
  const entries = await readdir(sessionDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === '.git') {
      return true;
    }
    if (entry.isDirectory()) {
      const childEntries = await readdir(path.join(sessionDir, entry.name), { withFileTypes: true }).catch(() => []);
      if (childEntries.some((child) => child.name === '.git')) {
        return true;
      }
    }
  }
  return false;
}

function isGitTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown; killed?: unknown; signal?: unknown; message?: unknown };
  return candidate.code === 'ETIMEDOUT'
    || candidate.killed === true
    || (candidate.signal === 'SIGTERM' && String(candidate.message ?? '').toLowerCase().includes('tim'));
}

async function writeManifest(sessionDir: string, manifest: PlannerParentBranchViewManifest): Promise<void> {
  await writeFile(path.join(sessionDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

async function readManifest(sessionDir: string): Promise<PlannerParentBranchViewManifest | null> {
  try {
    return JSON.parse(await readFile(path.join(sessionDir, 'manifest.json'), 'utf-8')) as PlannerParentBranchViewManifest;
  } catch {
    return null;
  }
}

function isInsideRuntimeRoot(target: string): boolean {
  const resolvedRoot = path.resolve(RUNTIME_ROOT);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget !== resolvedRoot && resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}
