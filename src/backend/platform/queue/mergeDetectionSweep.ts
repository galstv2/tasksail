/**
 * Retired compatibility shim for the former completed-branch merge-detection
 * sweep.
 *
 * Completed task branches are now operator handoffs recorded in QMD. TaskSail
 * must not automatically delete them after they are merged into a target
 * branch. Keep this module so older imports remain harmless, but do not scan
 * completed sidecars or mutate source repositories.
 */

export interface BindingHandledStatus {
  originalRoot: string;
  branch: string;
  handled: boolean;
  via?: 'merged-into-head' | 'branch-deleted';
}

export interface SweepResult {
  scanned: number;
  bindingsMarked: number;
  tasksFullyMerged: number;
  tasksCleanedUp: number;
}

function emptySweepResult(): SweepResult {
  return { scanned: 0, bindingsMarked: 0, tasksFullyMerged: 0, tasksCleanedUp: 0 };
}

export async function probeBindingHandled(
  _binding?: unknown,
): Promise<BindingHandledStatus> {
  return { originalRoot: '', branch: '', handled: false };
}

export async function runMergeDetectionSweep(_repoRoot?: string): Promise<SweepResult> {
  return emptySweepResult();
}
