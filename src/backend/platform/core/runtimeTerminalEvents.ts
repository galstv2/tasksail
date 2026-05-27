import path from 'node:path';
import { createLogger } from './logger.js';
import { ensureDir, readTextFile, writeTextFileAtomic } from './io.js';
import { withTaskTerminalEventsLock } from './taskTerminalEventsLock.js';
import {
  formatTaskAgentDisplayName,
  formatTaskAgentLaunchMessage,
  normalizeTaskAgentLaunchOutcome,
  type TaskAgentLaunchOutcome,
  type TaskAgentLaunchPhase,
} from './taskTerminalEventContracts.js';

export type RuntimeTerminalEventRole = 'queue' | 'pipeline' | 'system' | 'agent';
export type RuntimeTerminalEventSeverity = 'info' | 'success' | 'warning' | 'error';

const log = createLogger('platform/core/runtimeTerminalEvents');

interface RuntimeTerminalEventInput {
  repoRoot: string;
  taskId: string;
  eventId: string;
  source: string;
  role: RuntimeTerminalEventRole;
  severity: RuntimeTerminalEventSeverity;
  visible: boolean;
  message: string;
  actorName?: string;
  extra?: Record<string, unknown>;
}

function runtimeTerminalEventsPath(repoRoot: string, taskId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'tasks',
    taskId,
    'terminal-events.json',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function appendRuntimeTerminalEvent(
  input: RuntimeTerminalEventInput,
): Promise<void> {
  const eventPath = runtimeTerminalEventsPath(input.repoRoot, input.taskId);
  const event = {
    eventId: input.eventId,
    source: input.source,
    role: input.role,
    severity: input.severity,
    visible: input.visible,
    message: input.message,
    createdAt: new Date().toISOString(),
    ...(input.actorName ? { actorName: input.actorName } : {}),
    ...(input.extra ? { extra: input.extra } : {}),
  };

  await ensureDir(path.dirname(eventPath));
  await withTaskTerminalEventsLock(input.repoRoot, input.taskId, async () => {
    const raw = await readTextFile(eventPath);
    let events: unknown[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (isRecord(parsed) && Array.isArray(parsed.events)) {
          events = parsed.events;
        }
      } catch {
        events = [];
      }
    }

    const eventIds = new Set(
      events
        .filter((item) => isRecord(item) && typeof item.eventId === 'string')
        .map((item) => (item as { eventId: string }).eventId),
    );
    if (!eventIds.has(event.eventId)) {
      events.push(event);
    }

    await writeTextFileAtomic(eventPath, JSON.stringify({ events }, null, 2) + '\n');
  });
}

export class RuntimeTerminalEvents {
  private constructor(
    private readonly repoRoot: string,
    private readonly taskId: string,
  ) {}

  static forTask(repoRoot: string, taskId: string): RuntimeTerminalEvents {
    return new RuntimeTerminalEvents(repoRoot, taskId);
  }

  branchCreated(input: {
    repo: string;
    branch: string;
    worktreeRoot: string;
    materializationStrategy: string;
  }): Promise<void> {
    return this.append({
      eventId: `queue.branch.created:${input.repo}:${input.branch}:${input.worktreeRoot}`,
      source: 'runtime.branch',
      role: 'pipeline',
      severity: 'info',
      visible: true,
      message: `Created writable task branch worktree for ${input.repo} on branch ${input.branch}.`,
      extra: {
        repo: input.repo,
        branch: input.branch,
        worktreeRoot: input.worktreeRoot,
        materializationStrategy: input.materializationStrategy,
      },
    });
  }

  readonlyContextMaterialized(input: {
    repo: string;
    worktreeRoot: string;
    materializationStrategy: string;
  }): Promise<void> {
    return this.append({
      eventId: `activation.readonly_context.materialized:${input.repo}:${input.worktreeRoot}`,
      source: 'runtime.queue',
      role: 'queue',
      severity: 'info',
      visible: true,
      message: `Read-only support context materialized for ${input.repo}; no target branch was created.`,
      extra: {
        repo: input.repo,
        worktreeRoot: input.worktreeRoot,
        materializationStrategy: input.materializationStrategy,
      },
    });
  }

  archiveStarted(): Promise<void> {
    return this.append({
      eventId: 'archive.started',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'info',
      visible: true,
      message: 'Archiving task.',
    });
  }

  archiveCompleted(): Promise<void> {
    return this.append({
      eventId: 'archive.completed',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'success',
      visible: true,
      message: 'Task archived.',
    });
  }

  archiveFailed(): Promise<void> {
    return this.append({
      eventId: 'archive.failed',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'error',
      visible: true,
      message: 'Task archival failed.',
    });
  }

  taskActivated(): Promise<void> {
    return this.append({
      eventId: 'queue.task.activated',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'info',
      visible: true,
      message: 'Moved pending item to active.',
    });
  }

  agentLaunchStarted(input: {
    agentId: string;
    launchId: string;
    launchPhase?: string | null;
    displayPhase?: TaskAgentLaunchPhase;
    displayName?: string;
    childPid: number | null;
    modelId: string;
  }): Promise<void> {
    const displayPhase = input.displayPhase ?? 'initial';
    const displayName = input.displayName ?? formatTaskAgentDisplayName({ agentId: input.agentId, phase: displayPhase });
    return this.append({
      eventId: `agent.launch.started:${input.agentId}:${displayPhase}:${input.launchId}`,
      source: 'runtime.agent',
      role: 'agent',
      severity: 'info',
      visible: true,
      message: formatTaskAgentLaunchMessage({
        displayName,
        outcome: 'running',
      }),
      extra: {
        agentId: input.agentId,
        launchId: input.launchId,
        launchPhase: input.launchPhase ?? null,
        displayPhase,
        childPid: input.childPid,
        modelId: input.modelId,
      },
    });
  }

  agentLaunchTerminal(input: {
    agentId: string;
    launchId: string;
    launchPhase?: string | null;
    displayPhase?: TaskAgentLaunchPhase;
    displayName?: string;
    childPid: number | null;
    status?: 'success' | 'failure' | 'killed' | 'timeout';
    outcome?: TaskAgentLaunchOutcome;
    durationMs: number;
    exitCode: number | null;
  }): Promise<void> {
    const displayPhase = input.displayPhase ?? 'initial';
    const displayName = input.displayName ?? formatTaskAgentDisplayName({ agentId: input.agentId, phase: displayPhase });
    const outcome = input.outcome ?? normalizeTaskAgentLaunchOutcome({
      processStatus: input.status,
      exitCode: input.exitCode,
    });
    return this.append({
      eventId: `agent.launch.terminal:${input.agentId}:${displayPhase}:${input.launchId}`,
      source: 'runtime.agent',
      role: 'agent',
      severity: outcome === 'completed' ? 'success' : 'error',
      visible: true,
      message: formatTaskAgentLaunchMessage({
        displayName,
        outcome,
      }),
      extra: {
        agentId: input.agentId,
        launchId: input.launchId,
        launchPhase: input.launchPhase ?? null,
        displayPhase,
        childPid: input.childPid,
        outcome,
        durationMs: input.durationMs,
        exitCode: input.exitCode,
      },
    });
  }

  taskCompleted(): Promise<void> {
    return this.append({
      eventId: 'queue.task.completed',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'success',
      visible: true,
      message: 'Moved pending item to completed.',
    });
  }

  pipelineCompleted(): Promise<void> {
    return this.append({
      eventId: 'pipeline.completed',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'success',
      visible: true,
      message: 'Pipeline completed.',
    });
  }

  taskFailed(): Promise<void> {
    return this.append({
      eventId: 'queue.task.failed',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
      visible: true,
      message: 'Moved pending item to failed.',
    });
  }

  activationBlockedDirtyRepos(input: {
    taskTitle: string;
    repoLabels: readonly string[];
    repoRoots: readonly string[];
  }): Promise<void> {
    const repoNoun = input.repoLabels.length === 1 ? 'repo' : 'repos';
    return this.append({
      eventId: 'activation.blocked.dirty-repos',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
      visible: true,
      message: `Unable to activate ${input.taskTitle} due to uncommitted changes in target ${repoNoun} ${input.repoLabels.join(', ')}, please resolve and try again.`,
      extra: {
        repoLabels: input.repoLabels,
        repoRoots: input.repoRoots,
        reason: 'uncommitted-changes',
      },
    });
  }

  activationReturnedToOpenBranchConflict(input: {
    conflictingTaskId: string;
    repoLabel: string;
    repoRoot: string;
    branch: string;
    openItemPath: string;
  }): Promise<void> {
    return this.append({
      eventId: `activation.returned-open.branch-conflict:${input.branch}:${input.conflictingTaskId}`,
      source: 'runtime.queue',
      role: 'queue',
      severity: 'warning',
      visible: true,
      message: `Returned to open because active task ${input.conflictingTaskId} already owns branch ${input.branch} for repo ${input.repoLabel}.`,
      extra: {
        conflictingTaskId: input.conflictingTaskId,
        repoLabel: input.repoLabel,
        repoRoot: input.repoRoot,
        branch: input.branch,
        openItemPath: input.openItemPath,
      },
    });
  }

  activationSkipped(input: { reason: string }): Promise<void> {
    return this.append({
      eventId: `queue.active.skipped:${input.reason}`,
      source: 'runtime.queue',
      role: 'queue',
      severity: 'warning',
      visible: true,
      message: `Activation skipped: ${input.reason}.`,
      extra: { reason: input.reason },
    });
  }

  pipelinePhase(input: {
    phase: string;
    priorPhase: string | null;
  }): Promise<void> {
    const formatPipelinePhaseDisplayLabel = (phase: string): string => (
      phase.startsWith('test-capture') ? phase.replace(/^test-capture/u, 'code-capture') : phase
    );
    const phaseLabel = formatPipelinePhaseDisplayLabel(input.phase);
    const priorPhaseLabel = input.priorPhase ? formatPipelinePhaseDisplayLabel(input.priorPhase) : null;
    const isTestCaptureTransition = input.phase.startsWith('test-capture') ||
      Boolean(input.priorPhase?.startsWith('test-capture'));
    const transition = input.priorPhase
      ? { id: `${input.priorPhase}->${input.phase}`, label: `${priorPhaseLabel} -> ${phaseLabel}` }
      : { id: input.phase, label: phaseLabel };
    const displayMessage = `Pipeline phase: ${transition.label}.`;
    return this.append({
      eventId: `pipeline.phase:${transition.id}`,
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'info',
      visible: !isTestCaptureTransition,
      message: displayMessage,
      extra: {
        phase: input.phase,
        priorPhase: input.priorPhase,
      },
    });
  }

  reasoningEffortRejectedBeforeSpawn(input: {
    agentId: string;
    modelId: string;
    effort: string;
    reason: 'unsupported-by-cli' | 'capability-discovery-failed';
  }): Promise<void> {
    return this.append({
      eventId: `pipeline.agent_reasoning_effort.rejected_before_spawn:${this.taskId}:${input.agentId}:${input.effort}`,
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'error',
      visible: true,
      message: `Agent ${input.agentId} cannot launch model ${input.modelId} with reasoning effort ${input.effort}. Update Agent Configuration to None or a Copilot-advertised effort before relaunching the task.`,
      extra: {
        agentId: input.agentId,
        modelId: input.modelId,
        effort: input.effort,
        reason: input.reason,
      },
    });
  }

  daltonVerificationLaunching(): Promise<void> {
    return this.append({
      eventId: 'dalton_verification.launching',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'info',
      visible: true,
      message: `${formatTaskAgentDisplayName({ agentId: 'dalton', phase: 'initial' })} verification launching.`,
    });
  }

  autoMergeDisabled(): Promise<void> {
    return this.append({
      eventId: 'auto_merge.disabled',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'info',
      visible: false,
      message: 'Auto-merge disabled.',
    });
  }

  autoMergeApplied(input: { repos: string }): Promise<void> {
    return this.append({
      eventId: 'auto_merge.applied',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'success',
      visible: false,
      message: `Auto-merge applied ${input.repos}.`,
      extra: { repos: input.repos },
    });
  }

  autoMergeSkipped(input: { detail: string }): Promise<void> {
    return this.append({
      eventId: 'auto_merge.skipped',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'warning',
      visible: false,
      message: `Auto-merge skipped: ${input.detail}.`,
      extra: { detail: input.detail },
    });
  }

  targetBranchUpdate(input: {
    repoLabel: string;
    targetRepoRoot: string;
    sourceBranch: string;
    targetBranch: string | null;
    status: 'applied' | 'disabled' | 'skipped';
    detail: string;
  }): Promise<void> {
    const target = input.targetBranch ?? '(unknown target branch)';
    const applied = input.status === 'applied';
    const message = applied
      ? `Code changes from task branch ${input.sourceBranch} were successfully staged on target branch ${target} in target repo ${input.repoLabel} at ${input.targetRepoRoot}.`
      : input.status === 'disabled'
        ? `Auto-merge is disabled for target repo ${input.repoLabel} at ${input.targetRepoRoot}. Task branch ${input.sourceBranch} is ready for operator review.`
        : `Target branch was not updated for ${input.repoLabel} at ${input.targetRepoRoot}: ${input.detail} Task branch ${input.sourceBranch} is ready for operator review.`;
    return this.append({
      eventId: `closeout.target_branch_update:${input.repoLabel}:${input.sourceBranch}:${input.status}:${target}`,
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: applied ? 'success' : input.status === 'disabled' ? 'info' : 'warning',
      visible: true,
      message,
      extra: {
        repoLabel: input.repoLabel,
        targetRepoRoot: input.targetRepoRoot,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        status: input.status,
        detail: input.detail,
      },
    });
  }

  autoMergeSkippedForChildTaskChain(): Promise<void> {
    return this.append({
      eventId: 'auto_merge.skipped_child_chain',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'warning',
      visible: true,
      message: 'Auto-merge skipped for child task chain: chain branches are manually integrated by the operator.',
    });
  }

  closeoutFinalized(): Promise<void> {
    return this.append({
      eventId: 'closeout.finalized',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'success',
      visible: false,
      message: 'Closeout finalized.',
    });
  }

  errorItemsMoved(input: { errorPath: string; reason: string }): Promise<void> {
    return this.append({
      eventId: 'queue.error_items.moved',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
      visible: true,
      message: `Moved to error-items: ${input.reason}.`,
      extra: { error_path: input.errorPath, reason: input.reason },
    });
  }

  childChainFailureBranchRollbackPreflightFailed(extra: Record<string, unknown>): Promise<void> {
    return this.append({
      eventId: 'child_chain_failure_branch.rollback_preflight_failed',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
      visible: true,
      message: 'Child-chain branch rollback preflight failed.',
      extra,
    });
  }

  childChainFailureBranchRollbackCompleted(extra: Record<string, unknown>): Promise<void> {
    return this.append({
      eventId: 'child_chain_failure_branch.rollback_completed',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'info',
      visible: true,
      message: 'Child-chain branch rollback completed.',
      extra,
    });
  }

  childChainFailureBranchRollbackFailed(extra: Record<string, unknown>): Promise<void> {
    return this.append({
      eventId: 'child_chain_failure_branch.rollback_failed',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
      visible: true,
      message: 'Child-chain branch rollback failed.',
      extra,
    });
  }

  childChainFailureBranchDeleteSkipped(extra: Record<string, unknown>): Promise<void> {
    return this.append({
      eventId: 'child_chain_failure_branch.branch_delete_skipped',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'warning',
      visible: true,
      message: 'Skipped deleting chain-owned branch.',
      extra,
    });
  }

  strandedCloseoutResumed(input: { drove: readonly string[] }): Promise<void> {
    return this.append({
      eventId: 'closeout.stranded.resumed',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'warning',
      visible: true,
      message: 'Resumed stranded closeout.',
      extra: { drove: input.drove },
    });
  }

  closeoutRemediationLaunching(input: { reason: string }): Promise<void> {
    return this.append({
      eventId: 'closeout_remediation.launching',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'warning',
      visible: true,
      message: 'Closeout remediation launching.',
      extra: { reason: input.reason },
    });
  }

  lifecycleEvent(input: Omit<RuntimeTerminalEventInput, 'repoRoot' | 'taskId'>): Promise<void> {
    return this.append(input);
  }

  private async append(input: Omit<RuntimeTerminalEventInput, 'repoRoot' | 'taskId'>): Promise<void> {
    try {
      await appendRuntimeTerminalEvent({
        repoRoot: this.repoRoot,
        taskId: this.taskId,
        ...input,
      });
    } catch (err) {
      log.warn('runtime_terminal_event.write.failed', {
        taskId: this.taskId,
        eventId: input.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
