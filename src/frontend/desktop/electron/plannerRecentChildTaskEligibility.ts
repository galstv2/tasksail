import { basename } from 'node:path';

import { readChildTaskChains, type ChildTaskChainsState, type ChildTaskChainTaskState } from '../../../backend/platform/queue/childTaskChains.js';
import type { PlannerConversationRecord } from '../../../backend/platform/planner-history/types.js';

export type RecentChildTaskFilterReason =
  | 'not-child-task'
  | 'current-completed-tip'
  | 'legacy-child-without-chain-state'
  | 'missing-chain-record'
  | 'not-current-chain-tip'
  | 'chain-tip-state-not-completed'
  | 'child-chain-state-invalid';

export type RecentChildTaskEligibility = {
  visible: boolean;
  reason: RecentChildTaskFilterReason;
  taskId: string;
  rootTaskId: string | null;
  currentTipTaskId: string | null;
  currentTipState: ChildTaskChainTaskState | null;
};

export type RecentChildTaskFilterResult = {
  visibleRecords: PlannerConversationRecord[];
  hiddenChildTaskCount: number;
  countsByReason: Partial<Record<RecentChildTaskFilterReason, number>>;
  chainStateInvalid: boolean;
};

type StateOrInvalid = ChildTaskChainsState | 'invalid';

export function derivePlannerHistoryTaskId(record: PlannerConversationRecord): string {
  return basename(record.finalizedDestinationPath, '.md');
}

// Surfaced when replaying a recent that originated as a child task is blocked by the
// retained eligibility gate. Replays create a standalone standard copy, so the wording
// stays replay-neutral rather than referencing child-chain continuation.
export function childTaskHydrateMessage(eligibility: RecentChildTaskEligibility): string {
  return eligibility.reason === 'child-chain-state-invalid'
    ? "This recent can't be replayed right now because its task data is being updated. Try again in a moment."
    : "This recent can't be replayed right now because its underlying task has changed. Refresh the recent list and try again.";
}

function makeEligibility(
  visible: boolean,
  reason: RecentChildTaskFilterReason,
  taskId: string,
  rootTaskId: string | null = null,
  currentTipTaskId: string | null = null,
  currentTipState: ChildTaskChainTaskState | null = null,
): RecentChildTaskEligibility {
  return { visible, reason, taskId, rootTaskId, currentTipTaskId, currentTipState };
}

export function classifyPlannerHistoryRecord(
  record: PlannerConversationRecord,
  stateOrInvalid: StateOrInvalid,
): RecentChildTaskEligibility {
  const taskId = derivePlannerHistoryTaskId(record);
  if (record.sidecarSnapshot.lineage.taskKind !== 'child-task') {
    return makeEligibility(true, 'not-child-task', taskId);
  }
  if (stateOrInvalid === 'invalid') {
    return makeEligibility(false, 'child-chain-state-invalid', taskId);
  }

  const task = stateOrInvalid.tasks[taskId];
  if (!task) {
    return makeEligibility(false, 'legacy-child-without-chain-state', taskId);
  }
  const chain = stateOrInvalid.chains[task.rootTaskId];
  if (!chain) {
    return makeEligibility(false, 'missing-chain-record', taskId, task.rootTaskId);
  }
  const currentTipState = stateOrInvalid.tasks[chain.currentTipTaskId]?.state ?? null;
  if (chain.currentTipTaskId !== taskId) {
    return makeEligibility(false, 'not-current-chain-tip', taskId, task.rootTaskId, chain.currentTipTaskId, currentTipState);
  }
  if (task.state !== 'completed') {
    return makeEligibility(false, 'chain-tip-state-not-completed', taskId, task.rootTaskId, chain.currentTipTaskId, task.state);
  }
  return makeEligibility(true, 'current-completed-tip', taskId, task.rootTaskId, chain.currentTipTaskId, task.state);
}

export async function filterPlannerHistoryRecordsForRecents(
  records: PlannerConversationRecord[],
  repoRoot: string,
): Promise<RecentChildTaskFilterResult> {
  let stateOrInvalid: StateOrInvalid;
  try {
    stateOrInvalid = await readChildTaskChains(repoRoot);
  } catch {
    stateOrInvalid = 'invalid';
  }

  const visibleRecords: PlannerConversationRecord[] = [];
  const countsByReason: Partial<Record<RecentChildTaskFilterReason, number>> = {};
  let hiddenChildTaskCount = 0;
  let chainStateInvalid = false;
  for (const record of records) {
    const eligibility = classifyPlannerHistoryRecord(record, stateOrInvalid);
    countsByReason[eligibility.reason] = (countsByReason[eligibility.reason] ?? 0) + 1;
    if (eligibility.visible) {
      visibleRecords.push(record);
    } else {
      hiddenChildTaskCount += 1;
      if (eligibility.reason === 'child-chain-state-invalid') {
        chainStateInvalid = true;
      }
    }
  }
  return {
    visibleRecords,
    hiddenChildTaskCount,
    countsByReason,
    chainStateInvalid,
  };
}

export async function assertPlannerHistoryRecordHydratable(
  record: PlannerConversationRecord,
  repoRoot: string,
): Promise<RecentChildTaskEligibility> {
  if (record.sidecarSnapshot.lineage.taskKind !== 'child-task') {
    return makeEligibility(true, 'not-child-task', derivePlannerHistoryTaskId(record));
  }
  let stateOrInvalid: StateOrInvalid;
  try {
    stateOrInvalid = await readChildTaskChains(repoRoot);
  } catch {
    stateOrInvalid = 'invalid';
  }
  return classifyPlannerHistoryRecord(record, stateOrInvalid);
}
