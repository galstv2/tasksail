import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { canonicalRoot, createLogger } from '../../../../backend/platform/core/index.js';
import { resolveSelectedMaterializationRoots } from '../../../../backend/platform/context-pack/taskWorktreeSelection.js';
import type {
  ChildTaskChainsState,
  ChildTaskCompletedBranchHandoff,
} from '../../../../backend/platform/queue/childTaskChains.js';
import type {
  TaskBranchChainBinding,
  TaskBranchChainRepo,
  TaskContextPackBinding,
} from '../../../../backend/platform/queue/markdown.js';
import type { PlannerStagingContextPackBinding } from '../../../../backend/platform/planner-history/types.js';
import type { ArchivedTaskBranchHandoff } from '../../src/shared/desktopContract';

const defaultExecFile = promisify(execFileCb);
const log = createLogger('electron/main.childTaskChainDivergence');

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

type ParentHandoffSource = {
  repoRoot: string;
  repoLabel: string;
  branch: string;
  headCommitSha: string;
  targetBranch: string | null;
};

type HistoricalHandoffSource = ChildTaskCompletedBranchHandoff & {
  sourceTaskId: string;
};

type PrimaryRoot = {
  repoId: string;
  gitRoot: string;
};

export type ResolvedAdjustedChildBranchChainRepo = TaskBranchChainRepo;

export async function buildAdjustedChildBranchChainRepos(args: {
  repoRoot: string;
  rootTaskId: string;
  parentTaskId: string;
  childExecutionScope: PlannerStagingContextPackBinding;
  parentBranchHandoffs: readonly ArchivedTaskBranchHandoff[];
  childChainState: ChildTaskChainsState;
  previousBranchChain: TaskBranchChainBinding | null;
  execFileAsync?: ExecFileAsync;
}): Promise<ResolvedAdjustedChildBranchChainRepo[]> {
  const primaryRoots = await resolveAdjustedPrimaryRoots(args);
  if (primaryRoots.length === 0) {
    throw new Error('child-task-chain-adjusted-scope-no-primary-roots');
  }

  const parentSources = buildImmediateParentSourceIndex(args);
  const { historicalSources, historicalBranchChainRoots } = buildHistoricalIndexes(args);
  const introducedChainSourceBranch = resolveIntroducedChainSourceBranch({
    rootTaskId: args.rootTaskId,
    parentTaskId: args.parentTaskId,
    childChainState: args.childChainState,
    previousBranchChain: args.previousBranchChain,
    parentSources,
  });
  const selectedRootKeys = new Set(primaryRoots.map((root) => canonicalRoot(root.gitRoot)));
  let continuedImmediateRepoCount = 0;
  let continuedHistoricalRepoCount = 0;
  let introducedRepoCount = 0;

  const repos: ResolvedAdjustedChildBranchChainRepo[] = [];
  for (const root of primaryRoots) {
    const rootKey = canonicalRoot(root.gitRoot);
    const parentSource = parentSources.get(rootKey);
    if (parentSource) {
      repos.push(buildParentRepo({
        parentSource,
        previousBranchChain: args.previousBranchChain,
      }));
      continuedImmediateRepoCount += 1;
      continue;
    }

    const historicalSource = historicalSources.get(rootKey);
    if (historicalSource && historicalSource.sourceTaskId !== args.parentTaskId) {
      repos.push({
        repoRoot: historicalSource.repoRoot,
        repoLabel: historicalSource.repoLabel,
        chainSourceBranch: historicalSource.chainSourceBranch,
        parentSourceBranch: historicalSource.chainSourceBranch,
        parentBranchHead: historicalSource.headCommitSha,
        targetBranch: historicalSource.targetBranch,
        sourceKind: 'chain-history-handoff',
      });
      continuedHistoricalRepoCount += 1;
      continue;
    }

    if (historicalBranchChainRoots.has(rootKey)) {
      throw new Error(`child-task-chain-history-handoff-missing: ${root.gitRoot}`);
    }

    repos.push(await buildIntroducedRepo({
      root,
      chainSourceBranch: introducedChainSourceBranch,
      execFileAsync: args.execFileAsync ?? defaultExecFile,
    }));
    introducedRepoCount += 1;
  }

  let historicalHandoffRepoCount = 0;
  let omittedHistoricalRepoCount = 0;
  for (const [rootKey, source] of historicalSources) {
    if (source.sourceTaskId === args.parentTaskId) continue;
    historicalHandoffRepoCount += 1;
    if (!selectedRootKeys.has(rootKey)) omittedHistoricalRepoCount += 1;
  }

  log.info('child_task_chain.adjusted_scope_projection.resolved', {
    parentTaskId: args.parentTaskId,
    rootTaskId: args.rootTaskId,
    depth: resolveProjectionDepth(args),
    parentHandoffRepoCount: parentSources.size,
    historicalHandoffRepoCount,
    adjustedPrimaryRepoCount: primaryRoots.length,
    continuedImmediateRepoCount,
    continuedHistoricalRepoCount,
    introducedRepoCount,
    omittedHistoricalRepoCount,
  });

  return repos;
}

async function resolveAdjustedPrimaryRoots(args: {
  repoRoot: string;
  rootTaskId: string;
  childExecutionScope: PlannerStagingContextPackBinding;
}): Promise<PrimaryRoot[]> {
  let selectedRoots;
  try {
    selectedRoots = await resolveSelectedMaterializationRoots({
      repoRoot: args.repoRoot,
      contextPackDir: args.childExecutionScope.contextPackDir,
      binding: toTaskContextPackBinding(args.childExecutionScope),
      taskId: args.rootTaskId,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('no selected repo roots were resolved')) {
      throw new Error('child-task-chain-adjusted-scope-no-primary-roots');
    }
    throw error;
  }

  const primaryRoots: PrimaryRoot[] = [];
  const seen = new Set<string>();
  for (const root of selectedRoots) {
    if (root.role !== 'primary') continue;
    const rootKey = canonicalRoot(root.gitRoot);
    if (seen.has(rootKey)) continue;
    seen.add(rootKey);
    primaryRoots.push({
      repoId: root.repoId,
      gitRoot: root.gitRoot,
    });
  }
  return primaryRoots;
}

function toTaskContextPackBinding(binding: PlannerStagingContextPackBinding): TaskContextPackBinding {
  return {
    contextPackDir: binding.contextPackDir,
    contextPackId: binding.contextPackId,
    scopeMode: binding.scopeMode,
    selectedRepoIds: binding.selectedRepoIds,
    selectedFocusIds: binding.selectedFocusIds,
    ...(binding.repositoryTypes ? { repositoryTypes: binding.repositoryTypes } : {}),
    deepFocusEnabled: binding.deepFocusEnabled,
    ...(binding.primaryRepoId ? { primaryRepoId: binding.primaryRepoId } : {}),
    ...(binding.primaryFocusId ? { primaryFocusId: binding.primaryFocusId } : {}),
    ...(binding.deepFocusPrimaryRepoId ? { deepFocusPrimaryRepoId: binding.deepFocusPrimaryRepoId } : {}),
    ...(binding.deepFocusPrimaryFocusId ? { deepFocusPrimaryFocusId: binding.deepFocusPrimaryFocusId } : {}),
    ...(binding.selectedFocusPath ? { selectedFocusPath: binding.selectedFocusPath } : {}),
    ...(binding.selectedFocusTargetKind ? { selectedFocusTargetKind: binding.selectedFocusTargetKind } : {}),
    selectedFocusTargets: binding.selectedFocusTargets,
    selectedTestTarget: binding.selectedTestTarget,
    selectedSupportTargets: binding.selectedSupportTargets,
  };
}

function buildImmediateParentSourceIndex(args: {
  parentTaskId: string;
  parentBranchHandoffs: readonly ArchivedTaskBranchHandoff[];
  childChainState: ChildTaskChainsState;
}): Map<string, ParentHandoffSource> {
  const sources = new Map<string, ParentHandoffSource>();
  for (const handoff of args.parentBranchHandoffs) {
    sources.set(canonicalRoot(handoff.repoRoot), {
      repoRoot: handoff.repoRoot,
      repoLabel: handoff.repoLabel,
      branch: handoff.branch,
      headCommitSha: handoff.headCommitSha,
      targetBranch: handoff.autoMerge?.targetBranch ?? null,
    });
  }

  for (const handoff of args.childChainState.tasks[args.parentTaskId]?.completedBranchHandoffs ?? []) {
    const rootKey = canonicalRoot(handoff.repoRoot);
    if (!sources.has(rootKey)) {
      continue;
    }
    sources.set(rootKey, {
      repoRoot: handoff.repoRoot,
      repoLabel: handoff.repoLabel,
      branch: handoff.chainSourceBranch,
      headCommitSha: handoff.headCommitSha,
      targetBranch: handoff.targetBranch,
    });
  }
  return sources;
}

function resolveIntroducedChainSourceBranch(args: {
  rootTaskId: string;
  parentTaskId: string;
  childChainState: ChildTaskChainsState;
  previousBranchChain: TaskBranchChainBinding | null;
  parentSources: ReadonlyMap<string, ParentHandoffSource>;
}): string {
  const chain = args.childChainState.chains[args.rootTaskId];
  if (chain) {
    const parentIndex = chain.taskIds.indexOf(args.parentTaskId);
    const taskIds = chain.taskIds.slice(0, parentIndex >= 0 ? parentIndex + 1 : undefined);
    for (const taskId of taskIds) {
      const task = args.childChainState.tasks[taskId];
      const branchChainBranch = firstNonEmpty(task?.branchChain?.repos.map((repo) => repo.chainSourceBranch) ?? []);
      if (branchChainBranch) return branchChainBranch;
      const handoffBranch = firstNonEmpty(task?.completedBranchHandoffs?.map((handoff) => handoff.chainSourceBranch) ?? []);
      if (handoffBranch) return handoffBranch;
    }
  }

  const previousBranch = firstNonEmpty(args.previousBranchChain?.repos.map((repo) => repo.chainSourceBranch) ?? []);
  if (previousBranch) return previousBranch;

  const parentBranch = firstNonEmpty([...args.parentSources.values()].map((source) => source.branch));
  return parentBranch ?? `task/${args.rootTaskId}`;
}

function firstNonEmpty(values: readonly string[]): string | null {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function buildHistoricalIndexes(args: {
  rootTaskId: string;
  parentTaskId: string;
  childChainState: ChildTaskChainsState;
}): {
  historicalSources: Map<string, HistoricalHandoffSource>;
  historicalBranchChainRoots: Set<string>;
} {
  const historicalSources = new Map<string, HistoricalHandoffSource>();
  const historicalBranchChainRoots = new Set<string>();
  if (!args.childChainState.tasks[args.parentTaskId] && args.rootTaskId === args.parentTaskId) {
    return { historicalSources, historicalBranchChainRoots };
  }

  const chain = args.childChainState.chains[args.rootTaskId];
  if (!chain) {
    return { historicalSources, historicalBranchChainRoots };
  }

  const parentIndex = chain.taskIds.indexOf(args.parentTaskId);
  const taskIds = chain.taskIds.slice(0, parentIndex >= 0 ? parentIndex + 1 : undefined);
  for (const taskId of taskIds) {
    const task = args.childChainState.tasks[taskId];
    if (!task) continue;

    for (const repo of task.branchChain?.repos ?? []) {
      historicalBranchChainRoots.add(canonicalRoot(repo.repoRoot));
    }
    for (const handoff of task.completedBranchHandoffs ?? []) {
      historicalSources.set(canonicalRoot(handoff.repoRoot), {
        ...handoff,
        sourceTaskId: taskId,
      });
    }
  }

  return { historicalSources, historicalBranchChainRoots };
}

function buildParentRepo(args: {
  parentSource: ParentHandoffSource;
  previousBranchChain: TaskBranchChainBinding | null;
}): ResolvedAdjustedChildBranchChainRepo {
  const previousRepo = args.previousBranchChain?.repos.find(
    (repo) => canonicalRoot(repo.repoRoot) === canonicalRoot(args.parentSource.repoRoot),
  );
  if (args.previousBranchChain && !previousRepo) {
    throw new Error(`child-task-chain-creation-blocked: parent branch chain is missing repo ${args.parentSource.repoRoot}.`);
  }
  return {
    repoRoot: args.parentSource.repoRoot,
    repoLabel: args.parentSource.repoLabel,
    chainSourceBranch: previousRepo?.chainSourceBranch ?? args.parentSource.branch,
    parentSourceBranch: args.parentSource.branch,
    parentBranchHead: args.parentSource.headCommitSha,
    targetBranch: previousRepo?.targetBranch ?? args.parentSource.targetBranch,
  };
}

async function buildIntroducedRepo(args: {
  root: PrimaryRoot;
  chainSourceBranch: string;
  execFileAsync: ExecFileAsync;
}): Promise<ResolvedAdjustedChildBranchChainRepo> {
  const [headSha, currentBranch] = await Promise.all([
    execGitLine(args.root.gitRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], args.execFileAsync),
    execGitLine(args.root.gitRoot, ['symbolic-ref', '--short', 'HEAD'], args.execFileAsync),
  ]);
  if (!headSha) {
    throw new Error(`child-task-chain-divergent-repo-base-unresolved: ${args.root.gitRoot}`);
  }
  return {
    repoRoot: args.root.gitRoot,
    repoLabel: args.root.repoId,
    chainSourceBranch: args.chainSourceBranch,
    // Detached HEAD is valid for base capture; record the source as the literal 'HEAD'.
    parentSourceBranch: currentBranch ?? 'HEAD',
    parentBranchHead: headSha,
    targetBranch: null,
    sourceKind: 'introduced-by-child',
  };
}

async function execGitLine(
  root: string,
  gitArgs: readonly string[],
  execFileAsync: ExecFileAsync,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', gitArgs, { cwd: root });
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

function resolveProjectionDepth(args: {
  parentTaskId: string;
  childChainState: ChildTaskChainsState;
}): number {
  return (args.childChainState.tasks[args.parentTaskId]?.depth ?? 0) + 1;
}
