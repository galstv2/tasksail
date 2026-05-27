import type { Logger, ProgressLevel } from './logger.js';
import { RuntimeTerminalEvents } from './runtimeTerminalEvents.js';
import {
  formatTaskAgentDisplayName,
  normalizeTaskAgentLaunchOutcome,
  type TaskAgentLaunchOutcome,
  type TaskAgentLaunchPhase,
} from './taskTerminalEventContracts.js';

export type TaskProgressEventType =
  | 'queue.branch.created'
  | 'queue.active.activated'
  | 'queue.active.skipped'
  | 'agent.launch.started'
  | 'agent.launch.terminal'
  | 'pipeline.phase'
  | 'dalton_verification.launching'
  | 'closeout_remediation.launching'
  | 'activation.started'
  | 'activation.validating'
  | 'activation.materializing_worktrees'
  | 'activation.readonly_context.materialized'
  | 'activation.initializing_task'
  | 'activation.failed'
  | 'activation.skipped'
  | 'pipeline.started'
  | 'pipeline.completed'
  | 'pipeline.deferred'
  | 'agent.artifact_check.started'
  | 'agent.artifact_check.completed'
  | 'agent.artifact_check.failed'
  | 'agent.cleanup.started'
  | 'agent.cleanup.completed'
  | 'agent.cleanup.failed'
  | 'agent.policy_check.started'
  | 'agent.policy_check.completed'
  | 'agent.policy_check.failed'
  | 'agent.policy_remediation.started'
  | 'agent.policy_remediation.completed'
  | 'agent.policy_remediation.failed'
  | 'agent.confinement_retry.started'
  | 'agent.confinement_retry.completed'
  | 'agent.confinement_retry.failed'
  | 'pipeline.agent_order.selected'
  | 'pipeline.dalton_mode.selected'
  | 'test_capture.started'
  | 'test_capture.completed'
  | 'test_capture.skipped'
  | 'qa_remediation.started'
  | 'qa_remediation.cycle_started'
  | 'qa_remediation.cycle_completed'
  | 'qa_remediation.exhausted'
  | 'qa_remediation.completed'
  | 'retrospective.started'
  | 'retrospective.skipped'
  | 'retrospective.completed'
  | 'retrospective.failed'
  | 'pipeline.failed'
  | 'pipeline.agent_reasoning_effort.rejected_before_spawn'
  | 'pipeline.killed'
  | 'closeout.started'
  | 'closeout.snapshot_committing'
  | 'closeout.snapshot_committed'
  | 'closeout.branch_verification.started'
  | 'closeout.branch_verification.completed'
  | 'closeout.branch_verification.failed'
  | 'archive.terminal_events_snapshot_copied'
  | 'archive.terminal_events_snapshot_missing'
  | 'archive.terminal_events_snapshot_failed'
  | 'closeout.finalizing_worktrees'
  | 'closeout.child_chain_advancing'
  | 'closeout.child_chain_advanced'
  | 'kill.requested'
  | 'kill.cleanup.started'
  | 'kill.cleanup.completed'
  | 'kill.cleanup.failed'
  | 'failure.finalizing_worktrees'
  | 'failure.recovered_missing_pending'
  | 'mcp.checked'
  | 'mcp.degraded'
  | 'mcp.failed'
  | 'guardrail.receipt.allowed'
  | 'guardrail.receipt.artifact_incomplete'
  | 'guardrail.receipt.policy_blocked'
  | 'guardrail.receipt.denied'
  | 'guardrail.receipt.malformed'
  | 'archive.started'
  | 'archive.completed'
  | 'archive.failed'
  | 'queue.task.completed'
  | 'queue.task.failed'
  | 'queue.error_items.moved'
  | 'auto_merge.disabled'
  | 'auto_merge.applied'
  | 'auto_merge.skipped'
  | 'auto_merge.skipped_child_chain'
  | 'closeout.target_branch_update'
  | 'closeout.finalized'
  | 'closeout.stranded.resumed'
  | 'activation.blocked.dirty-repos'
  | 'activation.returned-open.branch-conflict'
  | 'child_chain_failure_branch.rollback_preflight_failed'
  | 'child_chain_failure_branch.rollback_completed'
  | 'child_chain_failure_branch.rollback_failed'
  | 'child_chain_failure_branch.branch_delete_skipped';

export type ChildChainFailureBranchProgressInput = {
  taskId?: string;
  repoRoot?: string;
  repoLabel?: string;
  branch?: string;
  baseCommitSha?: string;
  failedHeadSha?: string | null;
  worktreeRoot?: string;
  retainFailedWorktree?: boolean;
  status?: string;
  rolledBackBindings?: unknown;
  failedBinding?: unknown;
  error?: string | null;
  reason?: string;
};

export type ActivationTerminalInput = { reason: string };
export type ActivationMaterializingWorktreesInput = { repoCount: number };
export type AgentLifecycleProgressInput = {
  agentId: string;
  launchId: string;
  displayPhase: TaskAgentLaunchPhase;
};
export type PipelineTerminalInput = { reason: 'failed' | 'killed' };
export type ReasoningEffortRejectedBeforeSpawnProgressInput = {
  agentId: string;
  modelId: string;
  effort: string;
  reason: 'unsupported-by-cli' | 'capability-discovery-failed';
};
export type KillCleanupFailedInput = {
  cleanupAttemptCount: number;
  errorCode: string;
};
export type FailureRecoveredMissingPendingInput = { recovered: true };
export type McpLifecycleProgressInput = {
  agentId: string;
  status: 'available' | 'degraded' | 'failed' | 'not-applicable' | 'unavailable' | 'not-run';
  injectionEnabled: boolean;
  selectedServerCount: number;
  excludedServerCount: number;
};
export type GuardrailReceiptProgressInput = {
  agentId: string;
  launchId: string;
  displayPhase: TaskAgentLaunchPhase;
  terminationReason?: 'artifact-incomplete' | 'next-role-blocked' | 'workflow-policy-blocked' | 'policy-blocked' | 'denied' | 'failed';
};
export type DaltonModeSelectedProgressInput = {
  mode: 'simple' | 'complex';
  reason: 'parallel-ok-simple' | 'parallel-ok-complex' | 'remediation-forced-simple';
};
export type TargetBranchUpdateProgressInput = {
  repoLabel: string;
  targetRepoRoot: string;
  sourceBranch: string;
  targetBranch: string | null;
  status: 'applied' | 'disabled' | 'skipped';
  detail: string;
};

type NoInputLifecycleEvent =
  | 'activation.started'
  | 'activation.validating'
  | 'activation.initializing_task'
  | 'pipeline.started'
  | 'pipeline.completed'
  | 'pipeline.deferred'
  | 'pipeline.agent_order.selected'
  | 'test_capture.started'
  | 'test_capture.completed'
  | 'test_capture.skipped'
  | 'qa_remediation.started'
  | 'qa_remediation.completed'
  | 'retrospective.started'
  | 'retrospective.skipped'
  | 'retrospective.completed'
  | 'retrospective.failed'
  | 'closeout.started'
  | 'closeout.snapshot_committing'
  | 'closeout.snapshot_committed'
  | 'closeout.branch_verification.started'
  | 'closeout.branch_verification.completed'
  | 'closeout.branch_verification.failed'
  | 'archive.terminal_events_snapshot_copied'
  | 'archive.terminal_events_snapshot_missing'
  | 'archive.terminal_events_snapshot_failed'
  | 'closeout.finalizing_worktrees'
  | 'closeout.child_chain_advancing'
  | 'closeout.child_chain_advanced'
  | 'kill.cleanup.started'
  | 'kill.cleanup.completed'
  | 'failure.finalizing_worktrees';

type LifecycleTaskProgressEvent =
  | { type: NoInputLifecycleEvent; input?: never }
  | { type: 'agent.artifact_check.started'; input: AgentLifecycleProgressInput }
  | { type: 'agent.artifact_check.completed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.artifact_check.failed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.cleanup.started'; input: AgentLifecycleProgressInput }
  | { type: 'agent.cleanup.completed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.cleanup.failed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.policy_check.started'; input: AgentLifecycleProgressInput }
  | { type: 'agent.policy_check.completed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.policy_check.failed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.policy_remediation.started'; input: AgentLifecycleProgressInput }
  | { type: 'agent.policy_remediation.completed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.policy_remediation.failed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.confinement_retry.started'; input: AgentLifecycleProgressInput }
  | { type: 'agent.confinement_retry.completed'; input: AgentLifecycleProgressInput }
  | { type: 'agent.confinement_retry.failed'; input: AgentLifecycleProgressInput }
  | { type: 'activation.materializing_worktrees'; input: ActivationMaterializingWorktreesInput }
  | {
      type: 'activation.readonly_context.materialized';
      input: {
        repo: string;
        worktreeRoot: string;
        materializationStrategy: string;
      };
    }
  | { type: 'activation.failed'; input: ActivationTerminalInput }
  | { type: 'activation.skipped'; input: ActivationTerminalInput }
  | { type: 'pipeline.failed'; input: PipelineTerminalInput }
  | { type: 'pipeline.agent_reasoning_effort.rejected_before_spawn'; input: ReasoningEffortRejectedBeforeSpawnProgressInput }
  | { type: 'pipeline.killed'; input: PipelineTerminalInput }
  | { type: 'qa_remediation.cycle_started'; input: { cycle: number } }
  | { type: 'qa_remediation.cycle_completed'; input: { cycle: number } }
  | { type: 'qa_remediation.exhausted'; input: { cycle: number } }
  | { type: 'kill.requested'; input: { state: 'active' | 'activating'; requestedAt: string } }
  | { type: 'kill.cleanup.failed'; input: KillCleanupFailedInput }
  | { type: 'failure.recovered_missing_pending'; input: FailureRecoveredMissingPendingInput }
  | { type: 'pipeline.dalton_mode.selected'; input: DaltonModeSelectedProgressInput }
  | { type: 'mcp.checked'; input: McpLifecycleProgressInput }
  | { type: 'mcp.degraded'; input: McpLifecycleProgressInput }
  | { type: 'mcp.failed'; input: McpLifecycleProgressInput }
  | { type: 'guardrail.receipt.allowed'; input: GuardrailReceiptProgressInput }
  | { type: 'guardrail.receipt.artifact_incomplete'; input: GuardrailReceiptProgressInput }
  | { type: 'guardrail.receipt.policy_blocked'; input: GuardrailReceiptProgressInput }
  | { type: 'guardrail.receipt.denied'; input: GuardrailReceiptProgressInput }
  | { type: 'guardrail.receipt.malformed'; input: GuardrailReceiptProgressInput };

export type TaskProgressEvent =
  | {
      type: 'queue.branch.created';
      input: {
        repo: string;
        branch: string;
        worktreeRoot: string;
        materializationStrategy: string;
      };
    }
  | { type: 'queue.active.activated'; input: { repoCount: number; branches: readonly string[] } }
  | { type: 'queue.active.skipped'; input: { reason: string } }
  | {
      type: 'agent.launch.started';
      input: {
        agentId: string;
        providerId?: string | null;
        launchId: string;
        launchPhase?: string | null;
        displayPhase?: TaskAgentLaunchPhase;
        displayName?: string;
        childPid: number | null;
        modelId: string;
      };
    }
  | {
      type: 'agent.launch.terminal';
      input: {
        agentId: string;
        providerId?: string | null;
        launchId: string;
        launchPhase?: string | null;
        displayPhase?: TaskAgentLaunchPhase;
        displayName?: string;
        childPid: number | null;
        status?: 'success' | 'failure' | 'killed' | 'timeout';
        outcome?: TaskAgentLaunchOutcome;
        durationMs: number;
        exitCode: number | null;
      };
    }
  | { type: 'pipeline.phase'; input: { phase: string; priorPhase: string | null } }
  | { type: 'dalton_verification.launching' }
  | { type: 'closeout_remediation.launching'; input: { reason: string } }
  | { type: 'archive.started' }
  | { type: 'archive.completed' }
  | { type: 'archive.failed' }
  | { type: 'queue.task.completed' }
  | { type: 'queue.task.failed' }
  | { type: 'queue.error_items.moved'; input: { errorPath: string; reason: string } }
  | { type: 'auto_merge.disabled' }
  | { type: 'auto_merge.applied'; input: { repos: string } }
  | { type: 'auto_merge.skipped'; input: { detail: string } }
  | { type: 'auto_merge.skipped_child_chain' }
  | { type: 'closeout.target_branch_update'; input: TargetBranchUpdateProgressInput }
  | { type: 'closeout.finalized' }
  | { type: 'closeout.stranded.resumed'; input: { drove: readonly string[] } }
  | {
      type: 'activation.blocked.dirty-repos';
      input: { taskTitle: string; repoLabels: readonly string[]; repoRoots: readonly string[] };
    }
  | {
      type: 'activation.returned-open.branch-conflict';
      input: {
        conflictingTaskId: string;
        repoLabel: string;
        repoRoot: string;
        branch: string;
        openItemPath: string;
      };
    }
  | { type: 'child_chain_failure_branch.rollback_preflight_failed'; input: ChildChainFailureBranchProgressInput }
  | { type: 'child_chain_failure_branch.rollback_completed'; input: ChildChainFailureBranchProgressInput }
  | { type: 'child_chain_failure_branch.rollback_failed'; input: ChildChainFailureBranchProgressInput }
  | { type: 'child_chain_failure_branch.branch_delete_skipped'; input: ChildChainFailureBranchProgressInput }
  | LifecycleTaskProgressEvent;

export async function emitTaskProgressEvent(args: {
  logger: Logger;
  repoRoot: string;
  taskId: string;
  event: TaskProgressEvent;
}): Promise<void> {
  const terminal = RuntimeTerminalEvents.forTask(args.repoRoot, args.taskId);
  const progress = progressFor(args.event, args.taskId);
  args.logger.progress(progress as Parameters<Logger['progress']>[0]);
  await appendTerminalEvent(terminal, args.event);
}

function progressFor(event: TaskProgressEvent, taskId: string): {
  level: ProgressLevel;
  event: TaskProgressEventType;
  extra?: Record<string, unknown>;
  text: string;
} {
  switch (event.type) {
    case 'queue.branch.created':
      return {
        level: 'info',
        event: event.type,
        extra: {
          branch: event.input.branch,
          repo: event.input.repo,
          worktree_root: event.input.worktreeRoot,
          materialization_strategy: event.input.materializationStrategy,
        },
        text: `[pipeline] writable task branch worktree ${event.input.repo} on ${event.input.branch}`,
      };
    case 'activation.readonly_context.materialized':
      return {
        level: 'info',
        event: event.type,
        extra: {
          repo: event.input.repo,
          worktree_root: event.input.worktreeRoot,
          materialization_strategy: event.input.materializationStrategy,
        },
        text: `[queue] read-only support context materialized for ${event.input.repo}`,
      };
    case 'queue.active.activated':
      return {
        level: 'info',
        event: event.type,
        extra: { repo_count: event.input.repoCount, branches: event.input.branches },
        text: `[queue] activated ${taskId}  repos=${event.input.repoCount}`,
      };
    case 'queue.active.skipped':
      return {
        level: 'info',
        event: event.type,
        extra: { reason: event.input.reason },
        text: `[queue] activation skipped - ${event.input.reason}`,
      };
    case 'agent.launch.started':
      const startedDisplayPhase = event.input.displayPhase ?? 'initial';
      return {
        level: 'info',
        event: event.type,
        extra: {
          child_pid: event.input.childPid,
          launch_id: event.input.launchId,
          launch_phase: event.input.launchPhase ?? null,
          display_phase: startedDisplayPhase,
          model_id: event.input.modelId,
        },
        text: `[agent] started ${event.input.agentId}  pid=${event.input.childPid ?? 'unknown'}  model=${event.input.modelId}`,
      };
    case 'agent.launch.terminal':
      const terminalDisplayPhase = event.input.displayPhase ?? 'initial';
      const terminalOutcome = event.input.outcome ?? normalizeTaskAgentLaunchOutcome({
        processStatus: event.input.status,
        exitCode: event.input.exitCode,
      });
      const legacyStatus = event.input.status ?? (
        terminalOutcome === 'completed' ? 'success'
          : terminalOutcome === 'killed' ? 'killed'
            : terminalOutcome === 'timeout' ? 'timeout'
              : 'failure'
      );
      return {
        level: 'info',
        event: event.type,
        extra: {
          child_pid: event.input.childPid,
          status: legacyStatus,
          outcome: terminalOutcome,
          launch_id: event.input.launchId,
          launch_phase: event.input.launchPhase ?? null,
          display_phase: terminalDisplayPhase,
          duration_ms: event.input.durationMs,
          exit_code: event.input.exitCode,
        },
        text: `[agent] exited ${event.input.agentId}  ${legacyStatus}  in ${Math.round(event.input.durationMs / 1000)}s${legacyStatus === 'success' ? ' [ok]' : legacyStatus === 'failure' ? ' [fail]' : ''}`,
      };
    case 'pipeline.phase':
      return {
        level: 'info',
        event: event.type,
        extra: { phase: event.input.phase, prior_phase: event.input.priorPhase },
        text: `[pipeline] ${event.input.priorPhase ? `${event.input.priorPhase} -> ${event.input.phase}` : event.input.phase}`,
      };
    case 'pipeline.agent_reasoning_effort.rejected_before_spawn':
      return {
        level: 'error',
        event: event.type,
        extra: {
          agentId: event.input.agentId,
          modelId: event.input.modelId,
          effort: event.input.effort,
          reason: event.input.reason,
        },
        text: `[pipeline] reasoning effort rejected before spawn for ${event.input.agentId} model=${event.input.modelId} effort=${event.input.effort}`,
      };
    case 'dalton_verification.launching':
      return {
        level: 'info',
        event: event.type,
        text: '[pipeline] dalton verification launching',
      };
    case 'closeout_remediation.launching':
      return {
        level: 'info',
        event: event.type,
        extra: { reason: event.input.reason },
        text: `[pipeline] closeout remediation — ${event.input.reason}`,
      };
    case 'archive.started':
      return { level: 'info', event: event.type, text: '[pipeline] archiving task' };
    case 'archive.completed':
      return { level: 'info', event: event.type, text: '[pipeline] task archived [ok]' };
    case 'archive.failed':
      return { level: 'error', event: event.type, text: '[pipeline] task archival failed [fail]' };
    case 'pipeline.completed':
      return { level: 'info', event: event.type, text: '[pipeline] Pipeline completed [ok]' };
    case 'queue.task.completed':
      return { level: 'info', event: event.type, text: `[queue] completed ${taskId} [ok]` };
    case 'queue.task.failed':
      return { level: 'error', event: event.type, text: `[queue] failed ${taskId} [fail]` };
    case 'queue.error_items.moved':
      return {
        level: 'info',
        event: event.type,
        extra: { error_path: event.input.errorPath, reason: event.input.reason },
        text: `[queue] moved to error-items ${taskId} - ${event.input.reason}`,
      };
    case 'auto_merge.disabled':
      return { level: 'info', event: event.type, text: '[pipeline] auto-merge disabled' };
    case 'auto_merge.applied':
      return {
        level: 'info',
        event: event.type,
        extra: { repos: event.input.repos },
        text: `[pipeline] auto-merge applied ${event.input.repos}`,
      };
    case 'auto_merge.skipped':
      return {
        level: 'info',
        event: event.type,
        extra: { detail: event.input.detail },
        text: `[pipeline] auto-merge skipped - ${event.input.detail} [skip]`,
      };
    case 'auto_merge.skipped_child_chain':
      return {
        level: 'warn',
        event: event.type,
        text: '[pipeline] Auto-merge skipped for child task chain: chain branches are manually integrated by the operator. [skip]',
      };
    case 'closeout.target_branch_update':
      return {
        level: event.input.status === 'skipped' ? 'warn' : 'info',
        event: event.type,
        extra: {
          repo_label: event.input.repoLabel,
          target_repo_root: event.input.targetRepoRoot,
          source_branch: event.input.sourceBranch,
          target_branch: event.input.targetBranch,
          status: event.input.status,
          detail: event.input.detail,
        },
        text: event.input.status === 'applied'
          ? `[pipeline] staged task branch ${event.input.sourceBranch} on ${event.input.repoLabel}:${event.input.targetBranch ?? '(unknown)'} at ${event.input.targetRepoRoot} [ok]`
          : event.input.status === 'disabled'
            ? `[pipeline] auto-merge disabled by configuration for ${event.input.repoLabel}:${event.input.sourceBranch} at ${event.input.targetRepoRoot}; task branch ready for operator review [ok]`
            : `[pipeline] target branch not updated for ${event.input.repoLabel}:${event.input.sourceBranch} at ${event.input.targetRepoRoot} - ${event.input.detail} [skip]`,
      };
    case 'closeout.finalized':
      return { level: 'info', event: event.type, text: `[pipeline] completed ${taskId} [ok]` };
    case 'closeout.stranded.resumed':
      return {
        level: 'warn',
        event: event.type,
        extra: { drove: event.input.drove },
        text: `[pipeline] resumed stranded closeout for ${taskId}`,
      };
    case 'activation.blocked.dirty-repos':
      return {
        level: 'error',
        event: event.type,
        extra: {
          task_title: event.input.taskTitle,
          repo_labels: event.input.repoLabels,
          repo_roots: event.input.repoRoots,
        },
        text: `[queue] activation blocked for ${taskId} - dirty repos`,
      };
    case 'activation.returned-open.branch-conflict':
      return {
        level: 'info',
        event: event.type,
        extra: {
          conflicting_task_id: event.input.conflictingTaskId,
          repo_root: event.input.repoRoot,
          repo_label: event.input.repoLabel,
          branch: event.input.branch,
          open_item_path: event.input.openItemPath,
        },
        text: `[queue] returned to open - branch conflict ${taskId} blocked by ${event.input.conflictingTaskId} on ${event.input.branch}`,
      };
    case 'child_chain_failure_branch.branch_delete_skipped':
      return {
        level: 'warn',
        event: event.type,
        extra: childChainExtra(event.input),
        text: `[queue] preserved chain branch ${event.input.branch ?? '(unknown)'}`,
      };
    case 'child_chain_failure_branch.rollback_completed':
      return {
        level: 'info',
        event: event.type,
        extra: childChainExtra(event.input),
        text: `[queue] rolled back child-chain branch for ${taskId}`,
      };
    case 'child_chain_failure_branch.rollback_preflight_failed':
    case 'child_chain_failure_branch.rollback_failed':
      return {
        level: 'error',
        event: event.type,
        extra: childChainExtra(event.input),
        text: `[queue] child-chain branch rollback ${event.input.status ?? 'failed'} for ${taskId}`,
      };
    default:
      return progressForLifecycle(event.type, taskId, lifecycleExtra(event));
  }
}

async function appendTerminalEvent(
  terminal: RuntimeTerminalEvents,
  event: TaskProgressEvent,
): Promise<void> {
  switch (event.type) {
    case 'queue.branch.created':
      await terminal.branchCreated(event.input);
      return;
    case 'activation.readonly_context.materialized':
      await terminal.readonlyContextMaterialized(event.input);
      return;
    case 'queue.active.activated':
      await terminal.taskActivated();
      return;
    case 'queue.active.skipped':
      await terminal.activationSkipped(event.input);
      return;
    case 'agent.launch.started':
      await terminal.agentLaunchStarted(event.input);
      return;
    case 'agent.launch.terminal':
      await terminal.agentLaunchTerminal(event.input);
      return;
    case 'pipeline.phase':
      await terminal.pipelinePhase(event.input);
      return;
    case 'pipeline.agent_reasoning_effort.rejected_before_spawn':
      await terminal.reasoningEffortRejectedBeforeSpawn(event.input);
      return;
    case 'dalton_verification.launching':
      await terminal.daltonVerificationLaunching();
      return;
    case 'closeout_remediation.launching':
      await terminal.closeoutRemediationLaunching(event.input);
      return;
    case 'archive.started':
      await terminal.archiveStarted();
      return;
    case 'archive.completed':
      await terminal.archiveCompleted();
      return;
    case 'archive.failed':
      await terminal.archiveFailed();
      return;
    case 'pipeline.completed':
      await terminal.pipelineCompleted();
      return;
    case 'queue.task.completed':
      await terminal.taskCompleted();
      return;
    case 'queue.task.failed':
      await terminal.taskFailed();
      return;
    case 'queue.error_items.moved':
      await terminal.errorItemsMoved(event.input);
      return;
    case 'auto_merge.disabled':
      await terminal.autoMergeDisabled();
      return;
    case 'auto_merge.applied':
      await terminal.autoMergeApplied(event.input);
      return;
    case 'auto_merge.skipped':
      await terminal.autoMergeSkipped(event.input);
      return;
    case 'auto_merge.skipped_child_chain':
      await terminal.autoMergeSkippedForChildTaskChain();
      return;
    case 'closeout.target_branch_update':
      await terminal.targetBranchUpdate(event.input);
      return;
    case 'closeout.finalized':
      await terminal.closeoutFinalized();
      return;
    case 'closeout.stranded.resumed':
      await terminal.strandedCloseoutResumed(event.input);
      return;
    case 'activation.blocked.dirty-repos':
      await terminal.activationBlockedDirtyRepos(event.input);
      return;
    case 'activation.returned-open.branch-conflict':
      await terminal.activationReturnedToOpenBranchConflict(event.input);
      return;
    case 'child_chain_failure_branch.rollback_preflight_failed':
      await terminal.childChainFailureBranchRollbackPreflightFailed(childChainExtra(event.input));
      return;
    case 'child_chain_failure_branch.rollback_completed':
      await terminal.childChainFailureBranchRollbackCompleted(childChainExtra(event.input));
      return;
    case 'child_chain_failure_branch.rollback_failed':
      await terminal.childChainFailureBranchRollbackFailed(childChainExtra(event.input));
      return;
    case 'child_chain_failure_branch.branch_delete_skipped':
      await terminal.childChainFailureBranchDeleteSkipped(childChainExtra(event.input));
      return;
    default:
      await terminal.lifecycleEvent(lifecycleTerminalEvent(event.type, lifecycleExtra(event)));
      return;
  }
}

function progressForLifecycle(
  type: TaskProgressEventType,
  taskId: string,
  input?: Partial<Record<string, string | number | boolean>>,
): { level: ProgressLevel; event: TaskProgressEventType; extra?: Record<string, unknown>; text: string } {
  const meta = terminalMeta(type);
  const message = messageForLifecycle(type, input);
  return {
    level: meta.severity === 'error' ? 'error' : meta.severity === 'warning' ? 'warn' : 'info',
    event: type,
    ...(input ? { extra: input } : {}),
    text: `[${meta.role}] ${message.replace(/\.$/u, '')}${meta.visible ? '' : ` (${taskId})`}`,
  };
}

function lifecycleTerminalEvent(type: TaskProgressEventType, input?: Partial<Record<string, string | number | boolean>>): {
  eventId: string;
  source: string;
  role: 'queue' | 'pipeline' | 'system' | 'agent';
  severity: 'info' | 'success' | 'warning' | 'error';
  visible: boolean;
  message: string;
  actorName?: string;
  extra?: Record<string, unknown>;
} {
  const meta = terminalMeta(type);
  const message = messageForLifecycle(type, input);
  const actorName = isAgentLifecycleType(type) && isAgentLifecycleInput(input)
    ? agentLifecycleActorName(input)
    : undefined;
  return {
    eventId: eventIdForGeneric(type, input),
    source: meta.source,
    role: meta.role,
    severity: meta.severity,
    visible: meta.visible,
    message,
    ...(actorName ? { actorName } : {}),
    ...(input ? { extra: input } : {}),
  };
}

function terminalMeta(type: TaskProgressEventType): {
  source: string;
  role: 'queue' | 'pipeline' | 'system' | 'agent';
  severity: 'info' | 'success' | 'warning' | 'error';
  visible: boolean;
  message: string;
} {
  const hidden = new Set<TaskProgressEventType>([
    'activation.validating',
    'activation.initializing_task',
    'agent.artifact_check.started',
    'agent.artifact_check.completed',
    'agent.artifact_check.failed',
    'agent.policy_check.started',
    'agent.policy_check.completed',
    'pipeline.agent_order.selected',
    'retrospective.skipped',
    'closeout.snapshot_committing',
    'closeout.snapshot_committed',
    'closeout.branch_verification.started',
    'closeout.branch_verification.completed',
    'archive.terminal_events_snapshot_copied',
    'archive.terminal_events_snapshot_missing',
    'closeout.finalized',
    'auto_merge.disabled',
    'auto_merge.applied',
    'auto_merge.skipped',
    'mcp.checked',
    'guardrail.receipt.allowed',
  ]);
  const errors = new Set<TaskProgressEventType>([
    'activation.failed',
    'agent.cleanup.failed',
    'agent.policy_check.failed',
    'agent.policy_remediation.failed',
    'agent.confinement_retry.failed',
    'retrospective.failed',
    'pipeline.failed',
    'pipeline.agent_reasoning_effort.rejected_before_spawn',
    'closeout.branch_verification.failed',
    'archive.terminal_events_snapshot_failed',
    'kill.cleanup.failed',
    'queue.task.failed',
    'mcp.failed',
    'guardrail.receipt.artifact_incomplete',
    'guardrail.receipt.policy_blocked',
    'guardrail.receipt.denied',
    'guardrail.receipt.malformed',
  ]);
  const success = new Set<TaskProgressEventType>([
    'pipeline.completed',
    'agent.cleanup.completed',
    'agent.policy_remediation.completed',
    'agent.confinement_retry.completed',
    'test_capture.completed',
    'qa_remediation.completed',
    'retrospective.completed',
    'archive.terminal_events_snapshot_copied',
    'closeout.child_chain_advanced',
    'kill.cleanup.completed',
  ]);
  const warnings = new Set<TaskProgressEventType>([
    'agent.artifact_check.failed',
  ]);
  return {
    source: type.startsWith('guardrail.') ? 'runtime.guardrail'
      : type.startsWith('agent.') ? 'runtime.agent'
        : type.startsWith('activation.') || type.startsWith('queue.') || type.startsWith('kill.') || type.startsWith('failure.') ? 'runtime.queue'
          : type.startsWith('mcp.') ? 'runtime.mcp'
            : 'runtime.pipeline',
    role: type.startsWith('guardrail.') || type.startsWith('mcp.') ? 'system'
      : type.startsWith('agent.') ? 'agent'
        : type.startsWith('activation.') || type.startsWith('queue.') || type.startsWith('kill.') || type.startsWith('failure.') ? 'queue'
          : 'pipeline',
    severity: errors.has(type) ? 'error' : success.has(type) ? 'success' : warnings.has(type) || type.includes('skipped') || type.includes('degraded') ? 'warning' : 'info',
    visible: !hidden.has(type),
    message: messageFor(type),
  };
}

function isAgentLifecycleInput(input: Partial<Record<string, string | number | boolean>> | undefined): input is AgentLifecycleProgressInput {
  return typeof input?.agentId === 'string' &&
    typeof input.launchId === 'string' &&
    typeof input.displayPhase === 'string';
}

function isAgentLifecycleType(type: TaskProgressEventType): boolean {
  return type.startsWith('agent.');
}

function agentLifecycleActorName(input: AgentLifecycleProgressInput): string {
  return formatTaskAgentDisplayName({
    agentId: input.agentId,
    phase: input.displayPhase,
  });
}

function eventIdForGeneric(type: TaskProgressEventType, input?: Partial<Record<string, string | number | boolean>>): string {
  const suffix = typeof input?.agentId === 'string' && typeof input?.launchId === 'string' && typeof input?.displayPhase === 'string'
    ? `:${input.agentId}:${input.displayPhase}:${input.launchId}`
    : isQaRemediationCycleEvent(type) && typeof input?.cycle === 'number' ? `:${input.cycle}`
    : typeof input?.cleanupAttemptCount === 'number' ? `:${input.cleanupAttemptCount}`
    : typeof input?.attemptId === 'string' ? `:${input.attemptId}`
    : typeof input?.launchId === 'string' ? `:${input.launchId}`
      : typeof input?.phase === 'string' ? `:${input.phase}`
        : '';
  return `${type}${suffix}`;
}

function isQaRemediationCycleEvent(type: TaskProgressEventType): boolean {
  return type === 'qa_remediation.cycle_started' ||
    type === 'qa_remediation.cycle_completed' ||
    type === 'qa_remediation.exhausted';
}

function lifecycleExtra(event: TaskProgressEvent): Partial<Record<string, string | number | boolean>> | undefined {
  switch (event.type) {
    case 'agent.artifact_check.started':
    case 'agent.artifact_check.completed':
    case 'agent.artifact_check.failed':
    case 'agent.cleanup.started':
    case 'agent.cleanup.completed':
    case 'agent.cleanup.failed':
    case 'agent.policy_check.started':
    case 'agent.policy_check.completed':
    case 'agent.policy_check.failed':
    case 'agent.policy_remediation.started':
    case 'agent.policy_remediation.completed':
    case 'agent.policy_remediation.failed':
    case 'agent.confinement_retry.started':
    case 'agent.confinement_retry.completed':
    case 'agent.confinement_retry.failed':
      return {
        agentId: event.input.agentId,
        launchId: event.input.launchId,
        displayPhase: event.input.displayPhase,
      };
    case 'activation.materializing_worktrees':
      return { repoCount: event.input.repoCount };
    case 'activation.readonly_context.materialized':
      return {
        repo: event.input.repo,
        worktreeRoot: event.input.worktreeRoot,
        materializationStrategy: event.input.materializationStrategy,
      };
    case 'activation.failed':
    case 'activation.skipped':
    case 'pipeline.failed':
    case 'pipeline.agent_reasoning_effort.rejected_before_spawn':
    case 'pipeline.killed':
      return event.type === 'pipeline.agent_reasoning_effort.rejected_before_spawn'
        ? {
            agentId: event.input.agentId,
            modelId: event.input.modelId,
            effort: event.input.effort,
            reason: event.input.reason,
          }
        : { reason: event.input.reason };
    case 'qa_remediation.cycle_started':
    case 'qa_remediation.cycle_completed':
    case 'qa_remediation.exhausted':
      return { cycle: event.input.cycle };
    case 'kill.requested':
      return { state: event.input.state, requestedAt: event.input.requestedAt };
    case 'kill.cleanup.failed':
      return { cleanupAttemptCount: event.input.cleanupAttemptCount, errorCode: event.input.errorCode };
    case 'failure.recovered_missing_pending':
      return { recovered: event.input.recovered };
    case 'pipeline.dalton_mode.selected':
      return { mode: event.input.mode, reason: event.input.reason };
    case 'mcp.checked':
    case 'mcp.degraded':
    case 'mcp.failed':
      return {
        agentId: event.input.agentId,
        status: event.input.status,
        injectionEnabled: event.input.injectionEnabled,
        selectedServerCount: event.input.selectedServerCount,
        excludedServerCount: event.input.excludedServerCount,
      };
    case 'guardrail.receipt.allowed':
    case 'guardrail.receipt.artifact_incomplete':
    case 'guardrail.receipt.policy_blocked':
    case 'guardrail.receipt.denied':
    case 'guardrail.receipt.malformed':
      return {
        agentId: event.input.agentId,
        launchId: event.input.launchId,
        displayPhase: event.input.displayPhase,
        ...(event.input.terminationReason ? { terminationReason: event.input.terminationReason } : {}),
      };
    default:
      return undefined;
  }
}

function messageFor(type: TaskProgressEventType): string {
  return ({
    'activation.started': 'Activation started.',
    'activation.validating': 'Validating activation.',
    'activation.materializing_worktrees': 'Materializing task worktrees.',
    'activation.readonly_context.materialized': 'Read-only support context materialized.',
    'activation.initializing_task': 'Initializing task artifacts.',
    'activation.failed': 'Activation failed.',
    'activation.skipped': 'Activation skipped.',
    'pipeline.started': 'Pipeline started.',
    'pipeline.completed': 'Pipeline completed.',
    'pipeline.deferred': 'Pipeline start deferred.',
    'agent.artifact_check.started': 'Checking required agent artifacts.',
    'agent.artifact_check.completed': 'Agent artifact check completed.',
    'agent.artifact_check.failed': 'Agent artifacts incomplete.',
    'agent.cleanup.started': 'Agent cleanup started.',
    'agent.cleanup.completed': 'Agent cleanup completed.',
    'agent.cleanup.failed': 'Agent cleanup failed.',
    'agent.policy_check.started': 'Checking workflow policy.',
    'agent.policy_check.completed': 'Workflow policy check completed.',
    'agent.policy_check.failed': 'Workflow policy check failed.',
    'agent.policy_remediation.started': 'Policy remediation started.',
    'agent.policy_remediation.completed': 'Policy remediation completed.',
    'agent.policy_remediation.failed': 'Policy remediation failed.',
    'agent.confinement_retry.started': 'Confinement retry started.',
    'agent.confinement_retry.completed': 'Confinement retry completed.',
    'agent.confinement_retry.failed': 'Confinement retry failed.',
    'pipeline.agent_order.selected': 'Pipeline agent order selected.',
    'pipeline.dalton_mode.selected': 'Dalton mode selected.',
    'test_capture.started': 'Code capture started.',
    'test_capture.completed': 'Code capture completed.',
    'test_capture.skipped': 'Code capture skipped.',
    'qa_remediation.started': 'QA remediation started.',
    'qa_remediation.cycle_started': 'QA remediation cycle started.',
    'qa_remediation.cycle_completed': 'QA remediation cycle completed.',
    'qa_remediation.exhausted': 'QA remediation exhausted.',
    'qa_remediation.completed': 'QA remediation completed.',
    'retrospective.started': 'Retrospective started.',
    'retrospective.skipped': 'Retrospective skipped.',
    'retrospective.completed': 'Retrospective completed.',
    'retrospective.failed': 'Retrospective failed.',
    'pipeline.failed': 'Pipeline failed.',
    'pipeline.agent_reasoning_effort.rejected_before_spawn': 'Agent reasoning effort rejected before spawn.',
    'pipeline.killed': 'Pipeline stopped.',
    'closeout.started': 'Closeout started.',
    'closeout.snapshot_committing': 'Committing task snapshot.',
    'closeout.snapshot_committed': 'Task snapshot committed.',
    'closeout.branch_verification.started': 'Verifying task branches.',
    'closeout.branch_verification.completed': 'Task branch verification completed.',
    'closeout.branch_verification.failed': 'Task branch verification failed.',
    'archive.terminal_events_snapshot_copied': 'Archived terminal event snapshot.',
    'archive.terminal_events_snapshot_missing': 'Runtime terminal event snapshot missing.',
    'archive.terminal_events_snapshot_failed': 'Runtime terminal event snapshot failed.',
    'closeout.finalizing_worktrees': 'Finalizing task worktrees.',
    'closeout.child_chain_advancing': 'Advancing child task chain.',
    'closeout.child_chain_advanced': 'Child task chain advanced.',
    'closeout.target_branch_update': 'Target branch update recorded.',
    'kill.requested': 'Stop requested.',
    'kill.cleanup.started': 'Stop cleanup started.',
    'kill.cleanup.completed': 'Stop cleanup completed.',
    'kill.cleanup.failed': 'Stop cleanup failed.',
    'failure.finalizing_worktrees': 'Finalizing failed task worktrees.',
    'failure.recovered_missing_pending': 'Recovered missing pending item body.',
    'mcp.checked': 'MCP context checked.',
    'mcp.degraded': 'MCP context degraded.',
    'mcp.failed': 'MCP context failed.',
    'guardrail.receipt.allowed': 'Guardrail receipt allowed launch.',
    'guardrail.receipt.artifact_incomplete': 'Guardrail receipt reported incomplete artifacts.',
    'guardrail.receipt.policy_blocked': 'Guardrail receipt reported workflow policy block.',
    'guardrail.receipt.denied': 'Guardrail receipt denied launch.',
    'guardrail.receipt.malformed': 'Malformed guardrail receipt.',
  } as Partial<Record<TaskProgressEventType, string>>)[type] ?? `${type}.`;
}

function messageForLifecycle(
  type: TaskProgressEventType,
  input?: Partial<Record<string, string | number | boolean>>,
): string {
  if (type === 'qa_remediation.cycle_started' && typeof input?.cycle === 'number') {
    return `QA remediation cycle ${input.cycle} started.`;
  }
  if (type === 'qa_remediation.cycle_completed' && typeof input?.cycle === 'number') {
    return `QA remediation cycle ${input.cycle} completed.`;
  }
  if (type === 'qa_remediation.exhausted' && typeof input?.cycle === 'number') {
    return `QA remediation exhausted after ${input.cycle} cycle(s).`;
  }
  if (type === 'pipeline.dalton_mode.selected' && typeof input?.mode === 'string') {
    return `Dalton mode selected: ${input.mode}.`;
  }
  return messageFor(type);
}

export {
  agentLifecycleActorName,
  formatTaskAgentDisplayName,
  normalizeTaskAgentLaunchOutcome,
};

function childChainExtra(input: ChildChainFailureBranchProgressInput): Record<string, unknown> {
  return {
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input.repoRoot === undefined ? {} : { repoRoot: input.repoRoot }),
    ...(input.repoLabel === undefined ? {} : { repoLabel: input.repoLabel }),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.baseCommitSha === undefined ? {} : { baseCommitSha: input.baseCommitSha }),
    ...(input.failedHeadSha === undefined ? {} : { failedHeadSha: input.failedHeadSha }),
    ...(input.worktreeRoot === undefined ? {} : { worktreeRoot: input.worktreeRoot }),
    ...(input.retainFailedWorktree === undefined ? {} : { retainFailedWorktree: input.retainFailedWorktree }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.rolledBackBindings === undefined ? {} : { rolled_back_bindings: input.rolledBackBindings }),
    ...(input.failedBinding === undefined ? {} : { failed_binding: input.failedBinding }),
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
}
