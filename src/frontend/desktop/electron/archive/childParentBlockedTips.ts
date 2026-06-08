import type {
  ArchivedTaskChildParentBlockedTip,
  ArchivedTaskEntry,
} from '../../src/shared/desktopContract';
import type {
  ChildTaskChainTaskRecord,
  ChildTaskChainsState,
} from '../../../../backend/platform/queue/childTaskChains.js';
import type { TaskRegistry, TaskRegistryEntry } from '../../../../backend/platform/queue/taskRegistry.js';
import {
  allRegistryEntries,
  bindingMatchesScope,
  type ActiveContextPackTaskScope,
} from '../contextPack/taskVisibility';

type BlockedChainState = ArchivedTaskChildParentBlockedTip['chainState'];

const BLOCKED_STATES = new Set<BlockedChainState>(['planned', 'pending', 'active', 'failed']);
const BLOCKED_MESSAGE = 'This chain already has a child task in progress or needing attention.';

function registryByTaskId(registry: TaskRegistry | null): Map<string, TaskRegistryEntry> {
  if (!registry) return new Map();
  return new Map(allRegistryEntries(registry).map((entry) => [entry.taskId, entry]));
}

function isBlockedState(task: ChildTaskChainTaskRecord | undefined): task is ChildTaskChainTaskRecord & { state: BlockedChainState } {
  return Boolean(task && BLOCKED_STATES.has(task.state as BlockedChainState));
}

function listingContainsChainAnchor(
  tasks: readonly ArchivedTaskEntry[],
  rootTaskId: string,
  parentTaskId: string | null,
): boolean {
  return tasks.some((task) => (
    task.taskId === rootTaskId ||
    task.rootTaskId === rootTaskId ||
    (parentTaskId !== null && task.taskId === parentTaskId)
  ));
}

export function buildChildParentBlockedTips(args: {
  state: ChildTaskChainsState;
  archiveTasks: readonly ArchivedTaskEntry[];
  taskRegistry: TaskRegistry | null;
  scope: ActiveContextPackTaskScope;
}): ArchivedTaskChildParentBlockedTip[] {
  const registry = registryByTaskId(args.taskRegistry);
  const tips: ArchivedTaskChildParentBlockedTip[] = [];

  for (const chain of Object.values(args.state.chains)) {
    if (!bindingMatchesScope(chain, args.scope)) continue;
    const tipTask = args.state.tasks[chain.currentTipTaskId];
    if (!isBlockedState(tipTask)) continue;
    if (!listingContainsChainAnchor(args.archiveTasks, chain.rootTaskId, tipTask.parentTaskId)) continue;

    const registryEntry = registry.get(tipTask.taskId);
    tips.push({
      rootTaskId: chain.rootTaskId,
      blockedParentTaskId: tipTask.parentTaskId,
      currentTipTaskId: tipTask.taskId,
      chainState: tipTask.state,
      boardState: registryEntry && registryEntry.state !== 'completed' ? registryEntry.state : null,
      title: registryEntry?.title ?? null,
      fileName: registryEntry?.fileName ?? null,
      message: BLOCKED_MESSAGE,
    });
  }

  return tips.sort((left, right) => (
    left.rootTaskId.localeCompare(right.rootTaskId) ||
    left.currentTipTaskId.localeCompare(right.currentTipTaskId)
  ));
}

export function hasChildParentBlockedTipCandidates(state: ChildTaskChainsState, scope: ActiveContextPackTaskScope): boolean {
  return Object.values(state.chains).some((chain) => {
    if (!bindingMatchesScope(chain, scope)) return false;
    return isBlockedState(state.tasks[chain.currentTipTaskId]);
  });
}
