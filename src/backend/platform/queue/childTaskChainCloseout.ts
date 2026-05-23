import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { extractMarkdownSection } from '../core/index.js';
import { SECTION_NAMES } from '../workflow-policy/contracts/sectionNames.js';
import { withDirLock } from './dirLock.js';
import {
  readChildTaskChains,
  writeChildTaskChains,
  type ChildTaskChainsState,
  type ChildTaskCompletedBranchHandoff,
} from './childTaskChains.js';
import { extractBranchChainBinding, parseBranchChainBinding, type TaskBranchChainBinding } from './markdown.js';

export type { ChildTaskCompletedBranchHandoff };

export interface PreparedChildTaskChainCloseout {
  schemaVersion: 1;
  source: 'fresh' | 'recovered';
  taskId: string;
  rootTaskId: string;
  parentTaskId: string;
  previousTaskId: string | null;
  depth: number;
  branchChain: TaskBranchChainBinding;
  archivePath: string | null;
  archiveArtifactDir: string | null;
  completedBranchHandoffs: ChildTaskCompletedBranchHandoff[];
  preparedAt: string;
}

export interface BranchHandoffForChildChainCloseout {
  repo_root: string;
  repo_label: string;
  branch: string;
  base_commit_sha: string;
  head_commit_sha: string;
  commits_ahead: number;
  status: 'ready-for-operator-review' | 'auto-merged-to-target';
  auto_merge?: {
    target_branch?: string | null;
  };
}

export async function prepareChildTaskChainCloseout(args: {
  repoRoot: string;
  taskId: string;
  content: string;
  now?: string;
}): Promise<PreparedChildTaskChainCloseout | null> {
  const lineage = parseTaskLineage(args.content);
  if (lineage.taskKind !== 'child-task') return null;

  const branchChainResult = extractBranchChainBinding(args.content);
  if (branchChainResult.kind === 'absent') return null;
  if (branchChainResult.kind === 'invalid') {
    throw new Error(`child-task-chain-closeout-branch-chain-invalid for task "${args.taskId}": ${branchChainResult.reason}`);
  }

  const branchChain = branchChainResult.binding;
  // Older platform-generated Branch Chain child tasks omitted the lineage Depth
  // line. The Branch Chain block and child-chain state still carry authoritative depth.
  if (
    branchChain.rootTaskId !== lineage.rootTaskId
    || branchChain.parentTaskId !== lineage.parentTaskId
    || (lineage.depth !== null && branchChain.depth !== lineage.depth)
  ) {
    throw new Error(`child-task-chain-closeout-lineage-mismatch for task "${args.taskId}": Branch Chain does not match Task Lineage`);
  }

  return withChildTaskChainsLock(args.repoRoot, 'prepareChildTaskChainCloseout', async () => {
    const state = await readChildTaskChains(args.repoRoot);
    const task = validateStateForPreparedCloseout(state, args.taskId, branchChain);
    if (task.state === 'failed') {
      throw new Error(`child-task-chain-closeout-invalid-state for task "${args.taskId}": failed`);
    }
    if (task.state === 'completed') {
      if (!task.archivePath || !task.completedBranchHandoffs || task.completedBranchHandoffs.length === 0) {
        throw new Error(`child-task-chain-closeout-invalid-state for task "${args.taskId}": completed state is incomplete`);
      }
      return {
        schemaVersion: 1,
        source: 'fresh',
        taskId: args.taskId,
        rootTaskId: task.rootTaskId,
        parentTaskId: task.parentTaskId!,
        previousTaskId: task.previousTaskId,
        depth: task.depth,
        branchChain,
        archivePath: task.archivePath,
        archiveArtifactDir: task.archiveArtifactDir,
        completedBranchHandoffs: task.completedBranchHandoffs,
        preparedAt: args.now ?? new Date().toISOString(),
      };
    }
    if (task.state !== 'planned' && task.state !== 'pending' && task.state !== 'active') {
      throw new Error(`child-task-chain-closeout-invalid-state for task "${args.taskId}": ${task.state}`);
    }
    return {
      schemaVersion: 1,
      source: 'fresh',
      taskId: args.taskId,
      rootTaskId: task.rootTaskId,
      parentTaskId: task.parentTaskId!,
      previousTaskId: task.previousTaskId,
      depth: task.depth,
      branchChain,
      archivePath: null,
      archiveArtifactDir: null,
      completedBranchHandoffs: [],
      preparedAt: args.now ?? new Date().toISOString(),
    };
  });
}

export function parseRecoveredChildTaskChainCloseout(value: unknown): PreparedChildTaskChainCloseout | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') {
    throw new Error('child-task-chain-closeout-sentinel-invalid');
  }
  const candidate = value as Record<string, unknown>;
  const branchChain = parseBranchChainBinding(candidate.branchChain);
  if (
    candidate.schemaVersion !== 1
    || (candidate.source !== 'fresh' && candidate.source !== 'recovered')
    || !isNonEmptyString(candidate.taskId)
    || !isNonEmptyString(candidate.rootTaskId)
    || !isNonEmptyString(candidate.parentTaskId)
    || !(candidate.previousTaskId === null || isNonEmptyString(candidate.previousTaskId))
    || !Number.isInteger(candidate.depth)
    || (candidate.depth as number) < 1
    || branchChain === null
    || !(candidate.archivePath === null || isNonEmptyString(candidate.archivePath))
    || !(candidate.archiveArtifactDir === null || isNonEmptyString(candidate.archiveArtifactDir))
    || !Array.isArray(candidate.completedBranchHandoffs)
    || candidate.completedBranchHandoffs.length === 0
    || !isNonEmptyString(candidate.preparedAt)
  ) {
    throw new Error('child-task-chain-closeout-sentinel-invalid');
  }
  if (
    candidate.rootTaskId !== branchChain.rootTaskId
    || candidate.parentTaskId !== branchChain.parentTaskId
    || candidate.previousTaskId !== branchChain.parentTaskId
    || candidate.depth !== branchChain.depth
  ) {
    throw new Error('child-task-chain-closeout-sentinel-invalid');
  }
  const completedBranchHandoffs = validateCompletedHandoffs(candidate.completedBranchHandoffs);
  validateCompletedHandoffsMatchBranchChain(candidate.taskId, branchChain, completedBranchHandoffs);
  return {
    schemaVersion: 1,
    source: 'recovered',
    taskId: candidate.taskId,
    rootTaskId: candidate.rootTaskId,
    parentTaskId: candidate.parentTaskId,
    previousTaskId: candidate.previousTaskId,
    depth: candidate.depth as number,
    branchChain,
    archivePath: candidate.archivePath,
    archiveArtifactDir: candidate.archiveArtifactDir,
    completedBranchHandoffs,
    preparedAt: candidate.preparedAt,
  };
}

export function attachCompletedBranchHandoffs(
  prepared: PreparedChildTaskChainCloseout,
  handoffs: readonly BranchHandoffForChildChainCloseout[],
): PreparedChildTaskChainCloseout {
  const completed = convertMatchingHandoffs(prepared, handoffs);
  return {
    ...prepared,
    completedBranchHandoffs: completed,
  };
}

export function withArchivePath(
  prepared: PreparedChildTaskChainCloseout,
  archivePath: string | null,
): PreparedChildTaskChainCloseout {
  return {
    ...prepared,
    archivePath,
    archiveArtifactDir: resolveArchiveArtifactDir(archivePath),
  };
}

export function resolveArchiveArtifactDir(archivePath: string | null): string | null {
  if (!archivePath || path.basename(archivePath) !== 'archive.md') return null;
  return path.dirname(archivePath);
}

export async function advanceCompletedChildTaskChain(
  repoRoot: string,
  prepared: PreparedChildTaskChainCloseout,
  options: { now?: string } = {},
): Promise<ChildTaskChainsState> {
  return withChildTaskChainsLock(repoRoot, 'advanceCompletedChildTaskChain', async () => {
    const state = await readChildTaskChains(repoRoot);
    const task = validateStateForPreparedCloseout(state, prepared.taskId, prepared.branchChain);
    const sameCompleted = task.state === 'completed'
      && task.archivePath === prepared.archivePath
      && task.archiveArtifactDir === prepared.archiveArtifactDir
      && JSON.stringify(task.completedBranchHandoffs) === JSON.stringify(prepared.completedBranchHandoffs);
    if (sameCompleted) return state;
    if (task.state === 'failed') {
      throw new Error(`child-task-chain-closeout-invalid-state for task "${prepared.taskId}": failed`);
    }
    if (prepared.completedBranchHandoffs.length === 0) {
      throw new Error(`child-task-chain-closeout-state-invalid for task "${prepared.taskId}": missing completedBranchHandoffs`);
    }
    const now = options.now ?? new Date().toISOString();
    const chain = state.chains[prepared.rootTaskId]!;
    const updated: ChildTaskChainsState = {
      ...state,
      updatedAt: now,
      chains: {
        ...state.chains,
        [prepared.rootTaskId]: {
          ...chain,
          currentTipTaskId: prepared.taskId,
          updatedAt: now,
        },
      },
      tasks: {
        ...state.tasks,
        [prepared.taskId]: {
          ...task,
          state: 'completed',
          archivePath: prepared.archivePath,
          archiveArtifactDir: prepared.archiveArtifactDir,
          completedBranchHandoffs: prepared.completedBranchHandoffs,
          completedAt: now,
          updatedAt: now,
        },
      },
    };
    await writeChildTaskChains(repoRoot, updated);
    return updated;
  });
}

function validateStateForPreparedCloseout(
  state: ChildTaskChainsState,
  taskId: string,
  branchChain: TaskBranchChainBinding,
): ChildTaskChainsState['tasks'][string] {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`child-task-chain-closeout-state-missing for task "${taskId}": task record missing`);
  const chain = state.chains[branchChain.rootTaskId];
  if (!chain) throw new Error(`child-task-chain-closeout-state-missing for task "${taskId}": chain record missing`);
  if (chain.currentTipTaskId !== taskId) {
    throw new Error(`child-task-chain-closeout-not-current-tip for task "${taskId}": ${chain.currentTipTaskId}`);
  }
  if (
    !chain.taskIds.includes(taskId)
    || task.branchChain === null
    || task.rootTaskId !== branchChain.rootTaskId
    || task.parentTaskId !== branchChain.parentTaskId
    || task.previousTaskId !== branchChain.parentTaskId
    || task.depth !== branchChain.depth
    || JSON.stringify(task.branchChain) !== JSON.stringify(branchChain)
  ) {
    throw new Error(`child-task-chain-closeout-state-invalid for task "${taskId}": state does not match Branch Chain`);
  }
  return task;
}

function convertMatchingHandoffs(
  prepared: PreparedChildTaskChainCloseout,
  handoffs: readonly BranchHandoffForChildChainCloseout[],
): ChildTaskCompletedBranchHandoff[] {
  const remaining = [...handoffs];
  const completed: ChildTaskCompletedBranchHandoff[] = [];
  for (const repo of prepared.branchChain.repos) {
    const matches = remaining
      .map((handoff, index) => ({ handoff, index }))
      .filter(({ handoff }) =>
        normalizeRepoRoot(handoff.repo_root) === normalizeRepoRoot(repo.repoRoot)
        && handoff.branch === repo.chainSourceBranch
      );
    if (matches.length !== 1) {
      throw new Error(`child-task-chain-closeout-branch-handoff-mismatch for task "${prepared.taskId}": expected one handoff for ${repo.repoRoot} ${repo.chainSourceBranch}`);
    }
    const [{ handoff, index }] = matches;
    if (!isValidBranchHandoff(handoff) || handoff.branch === repo.targetBranch) {
      throw new Error(`child-task-chain-closeout-branch-handoff-mismatch for task "${prepared.taskId}": invalid handoff`);
    }
    remaining.splice(index, 1);
    completed.push({
      repoRoot: handoff.repo_root,
      repoLabel: handoff.repo_label,
      chainSourceBranch: handoff.branch,
      baseCommitSha: handoff.base_commit_sha,
      headCommitSha: handoff.head_commit_sha,
      commitsAhead: handoff.commits_ahead,
      status: handoff.status,
      targetBranch: handoff.auto_merge?.target_branch ?? null,
    });
  }
  if (remaining.length > 0) {
    throw new Error(`child-task-chain-closeout-branch-handoff-mismatch for task "${prepared.taskId}": extra handoff`);
  }
  return completed;
}

function validateCompletedHandoffs(value: unknown[]): ChildTaskCompletedBranchHandoff[] {
  const handoffs = value as ChildTaskCompletedBranchHandoff[];
  if (handoffs.some((handoff) => (
    !isNonEmptyString(handoff.repoRoot)
    || !isNonEmptyString(handoff.repoLabel)
    || !isNonEmptyString(handoff.chainSourceBranch)
    || !isNonEmptyString(handoff.baseCommitSha)
    || !isNonEmptyString(handoff.headCommitSha)
    || !Number.isInteger(handoff.commitsAhead)
    || handoff.commitsAhead < 0
    || (handoff.status !== 'ready-for-operator-review' && handoff.status !== 'auto-merged-to-target')
    || !(handoff.targetBranch === null || isNonEmptyString(handoff.targetBranch))
  ))) {
    throw new Error('child-task-chain-closeout-sentinel-invalid');
  }
  return handoffs;
}

function validateCompletedHandoffsMatchBranchChain(
  taskId: string,
  branchChain: TaskBranchChainBinding,
  handoffs: readonly ChildTaskCompletedBranchHandoff[],
): void {
  const remaining = [...handoffs];
  for (const repo of branchChain.repos) {
    const matches = remaining
      .map((handoff, index) => ({ handoff, index }))
      .filter(({ handoff }) =>
        normalizeRepoRoot(handoff.repoRoot) === normalizeRepoRoot(repo.repoRoot)
        && handoff.chainSourceBranch === repo.chainSourceBranch
      );
    if (matches.length !== 1) {
      throw new Error(`child-task-chain-closeout-sentinel-invalid for task "${taskId}": branch handoff mismatch`);
    }
    const [{ handoff, index }] = matches;
    if (handoff.chainSourceBranch === repo.targetBranch) {
      throw new Error(`child-task-chain-closeout-sentinel-invalid for task "${taskId}": targetBranch recorded as source`);
    }
    remaining.splice(index, 1);
  }
  if (remaining.length > 0) {
    throw new Error(`child-task-chain-closeout-sentinel-invalid for task "${taskId}": extra branch handoff`);
  }
}

function isValidBranchHandoff(handoff: BranchHandoffForChildChainCloseout): boolean {
  return isNonEmptyString(handoff.repo_root)
    && isNonEmptyString(handoff.repo_label)
    && isNonEmptyString(handoff.branch)
    && isNonEmptyString(handoff.base_commit_sha)
    && isNonEmptyString(handoff.head_commit_sha)
    && Number.isInteger(handoff.commits_ahead)
    && handoff.commits_ahead >= 0
    && (handoff.status === 'ready-for-operator-review' || handoff.status === 'auto-merged-to-target');
}

function parseTaskLineage(content: string): {
  taskKind: string;
  parentTaskId: string;
  rootTaskId: string;
  depth: number | null;
} {
  const section = extractMarkdownSection(content, SECTION_NAMES.TASK_LINEAGE);
  return {
    taskKind: extractLabeledValue(section, 'Task Kind'),
    parentTaskId: extractLabeledValue(section, 'Parent Task ID'),
    rootTaskId: extractLabeledValue(section, 'Root Task ID'),
    depth: parseOptionalLineageDepth(section),
  };
}

function parseOptionalLineageDepth(section: string): number | null {
  const raw = extractLabeledValue(section, 'Depth');
  if (!raw) return null;
  const depth = Number(raw);
  return Number.isInteger(depth) && depth >= 0 ? depth : Number.NaN;
}

function extractLabeledValue(section: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = section.match(new RegExp(`^-\\s*${escaped}:\\s*(.*)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

async function withChildTaskChainsLock<T>(
  repoRoot: string,
  operationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const stateDir = path.join(repoRoot, '.platform-state');
  await mkdir(stateDir, { recursive: true });
  return withDirLock(path.join(stateDir, 'child-task-chains.lock'), operationName, fn);
}

export function normalizeRepoRoot(input: string): string {
  try {
    return existsSync(input) ? realpathSync(input) : path.resolve(input);
  } catch {
    return path.resolve(input);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
