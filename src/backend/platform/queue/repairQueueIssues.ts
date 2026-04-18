/**
 * Structured issue types emitted by repairQueue.
 * Every consumer MUST switch on `.kind`, not match against rendered strings.
 */

export type QueueRepairIssueKind =
  | 'marker-without-pending'
  | 'marker-without-task-json'
  | 'marker-without-worktree'
  | 'pending-without-marker'
  | 'sentinel-without-completed-marker'
  | 'orphan-handoffs-dir'
  | 'orphan-task-json'
  | 'corrupt-task-json';

export interface QueueRepairIssue {
  kind: QueueRepairIssueKind;
  taskId: string;
  detail?: string;
}
