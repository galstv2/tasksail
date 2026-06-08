import { readChildTaskChains } from '../../../../backend/platform/queue/childTaskChains.js';
import { getTaskBranchChainRepoSourceKind } from '../../../../backend/platform/queue/markdown.js';
import { REPO_ROOT } from '../paths';
import type {
  DesktopInvokeResult,
  TaskBoardChildChainBranchInventory,
  TaskBoardChildChainBranchInventoryRow,
  TaskBoardReadChildChainBranchInventoryRequest,
  TaskBoardReadChildChainBranchInventoryResponse,
} from '../../src/shared/desktopContract';

type Payload = TaskBoardReadChildChainBranchInventoryRequest['payload'];

const NOT_CHAIN_TASK_MESSAGE = 'This completed task is not recorded as part of a child-task chain.';
const INVALID_STATE_MESSAGE = 'Child-task chain state is unavailable or inconsistent.';
const LOADED_MESSAGE = 'Loaded child chain branch inventory.';

// NUL separator keeps repoRoot and branch independent so distinct pairs cannot
// collide into one dedup key (e.g. "a","b/c" vs "a/b","c").
const KEY_SEPARATOR = String.fromCharCode(0);

function buildResponse(
  mode: TaskBoardReadChildChainBranchInventoryResponse['mode'],
  message: string,
  inventory?: TaskBoardChildChainBranchInventory,
): DesktopInvokeResult {
  const response: TaskBoardReadChildChainBranchInventoryResponse = {
    action: 'taskBoard.readChildChainBranchInventory',
    mode,
    message,
    ...(inventory !== undefined ? { inventory } : {}),
  };
  return { ok: true, response };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeKey(repoRoot: string, chainSourceBranch: string): string {
  return [repoRoot.trim(), chainSourceBranch.trim()].join(KEY_SEPARATOR);
}

// Point-in-time, read-only inventory of every repo/branch recorded across a
// completed task's child-task chain. Never inspects live git and never mutates state.
export async function readChildTaskChainBranchInventoryAction(
  payload: Payload,
): Promise<DesktopInvokeResult> {
  if (!isNonEmpty(payload?.taskId)) {
    return buildResponse('invalid-state', INVALID_STATE_MESSAGE);
  }
  const taskId = payload.taskId;
  const expectedRootTaskId = payload.expectedRootTaskId === undefined ? null : payload.expectedRootTaskId;

  let state;
  try {
    state = await readChildTaskChains(REPO_ROOT);
  } catch {
    return buildResponse('invalid-state', INVALID_STATE_MESSAGE);
  }

  const selectedTask = state.tasks[taskId];
  if (!selectedTask) {
    if (expectedRootTaskId !== null) {
      return buildResponse('invalid-state', INVALID_STATE_MESSAGE);
    }
    return buildResponse('not-chain-task', NOT_CHAIN_TASK_MESSAGE);
  }

  if (expectedRootTaskId !== null && selectedTask.rootTaskId !== expectedRootTaskId) {
    return buildResponse('invalid-state', INVALID_STATE_MESSAGE);
  }

  const chain = state.chains[selectedTask.rootTaskId];
  if (!chain) {
    return buildResponse('invalid-state', INVALID_STATE_MESSAGE);
  }

  const rowsByKey = new Map<string, TaskBoardChildChainBranchInventoryRow>();
  for (const memberTaskId of chain.taskIds) {
    const task = state.tasks[memberTaskId];
    if (!task) continue;

    for (const repo of task.branchChain?.repos ?? []) {
      if (!isNonEmpty(repo.repoRoot) || !isNonEmpty(repo.chainSourceBranch)) continue;
      const key = normalizeKey(repo.repoRoot, repo.chainSourceBranch);
      const existing = rowsByKey.get(key);
      if (!existing) {
        rowsByKey.set(key, {
          repoRoot: repo.repoRoot,
          repoLabel: repo.repoLabel,
          chainSourceBranch: repo.chainSourceBranch,
          sourceKind: getTaskBranchChainRepoSourceKind(repo),
          introducedAtTaskId: task.taskId,
          introducedAtDepth: task.depth,
          targetBranch: repo.targetBranch,
        });
        continue;
      }
      // First introducing task wins identity; later tasks only fill gaps.
      if (existing.repoLabel.trim().length === 0 && isNonEmpty(repo.repoLabel)) {
        existing.repoLabel = repo.repoLabel;
      }
      if (existing.targetBranch === null && repo.targetBranch !== null) {
        existing.targetBranch = repo.targetBranch;
      }
    }

    for (const handoff of task.completedBranchHandoffs ?? []) {
      if (!isNonEmpty(handoff.repoRoot) || !isNonEmpty(handoff.chainSourceBranch)) continue;
      const key = normalizeKey(handoff.repoRoot, handoff.chainSourceBranch);
      const existing = rowsByKey.get(key);
      if (!existing) {
        rowsByKey.set(key, {
          repoRoot: handoff.repoRoot,
          repoLabel: handoff.repoLabel,
          chainSourceBranch: handoff.chainSourceBranch,
          sourceKind: 'legacy-root',
          introducedAtTaskId: task.taskId,
          introducedAtDepth: task.depth,
          targetBranch: handoff.targetBranch,
        });
        continue;
      }
      if (existing.targetBranch === null && handoff.targetBranch !== null) {
        existing.targetBranch = handoff.targetBranch;
      }
    }
  }

  const rows = Array.from(rowsByKey.values()).sort((a, b) => {
    const byLabel = a.repoLabel.toLowerCase().localeCompare(b.repoLabel.toLowerCase());
    if (byLabel !== 0) return byLabel;
    const byRoot = a.repoRoot.toLowerCase().localeCompare(b.repoRoot.toLowerCase());
    if (byRoot !== 0) return byRoot;
    return a.chainSourceBranch.toLowerCase().localeCompare(b.chainSourceBranch.toLowerCase());
  });

  const inventory: TaskBoardChildChainBranchInventory = {
    schemaVersion: 1,
    rootTaskId: chain.rootTaskId,
    selectedTaskId: taskId,
    currentTipTaskId: chain.currentTipTaskId,
    taskCount: chain.taskIds.length,
    rows,
    generatedAt: new Date().toISOString(),
  };
  return buildResponse('loaded', LOADED_MESSAGE, inventory);
}
