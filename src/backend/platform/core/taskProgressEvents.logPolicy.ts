import type { ProgressLevel } from './logger.js';
import type { TaskProgressEvent, TaskProgressEventType } from './taskProgressEvents.js';

export type ProgressLogDecision =
  | { kind: 'progress'; level: ProgressLevel }
  | { kind: 'debug' };

type ProgressLogPolicyInput = {
  level: ProgressLevel;
  event: TaskProgressEventType;
};

const DEBUG_ONLY_PROGRESS_EVENTS = new Set<TaskProgressEventType>([
  'agent.artifact_check.started',
  'agent.artifact_check.completed',
  'agent.policy_check.started',
  'agent.policy_check.completed',
  'guardrail.receipt.allowed',
]);

const DEBUG_MCP_CHECKED_STATUSES = new Set([
  'available',
  'not-applicable',
  'not-run',
]);

export function progressLogDecisionFor(
  event: TaskProgressEvent,
  progress: ProgressLogPolicyInput,
): ProgressLogDecision {
  if (DEBUG_ONLY_PROGRESS_EVENTS.has(event.type)) {
    return { kind: 'debug' };
  }

  if (event.type === 'mcp.checked' && DEBUG_MCP_CHECKED_STATUSES.has(event.input.status)) {
    return { kind: 'debug' };
  }

  return { kind: 'progress', level: progress.level };
}
