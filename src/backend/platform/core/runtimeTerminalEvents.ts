import path from 'node:path';
import { createLogger } from './logger.js';
import { ensureDir, readTextFile, writeTextFileAtomic } from './io.js';
import { withTaskTerminalEventsLock } from './taskTerminalEventsLock.js';

export type RuntimeTerminalEventRole = 'queue' | 'pipeline';
export type RuntimeTerminalEventSeverity = 'info' | 'success' | 'warning' | 'error';

const log = createLogger('platform/core/runtimeTerminalEvents');

interface RuntimeTerminalEventInput {
  repoRoot: string;
  taskId: string;
  eventId: string;
  source: string;
  role: RuntimeTerminalEventRole;
  severity: RuntimeTerminalEventSeverity;
  message: string;
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
    message: input.message,
    createdAt: new Date().toISOString(),
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
      message: `Created worktree for ${input.repo} on branch ${input.branch}.`,
      extra: {
        repo: input.repo,
        branch: input.branch,
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
      message: 'Archiving task.',
    });
  }

  archiveCompleted(): Promise<void> {
    return this.append({
      eventId: 'archive.completed',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'success',
      message: 'Task archived.',
    });
  }

  archiveFailed(): Promise<void> {
    return this.append({
      eventId: 'archive.failed',
      source: 'runtime.pipeline',
      role: 'pipeline',
      severity: 'error',
      message: 'Task archival failed.',
    });
  }

  taskActivated(): Promise<void> {
    return this.append({
      eventId: 'queue.task.activated',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'info',
      message: 'Moved pending item to active.',
    });
  }

  taskCompleted(): Promise<void> {
    return this.append({
      eventId: 'queue.task.completed',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'success',
      message: 'Moved pending item to completed.',
    });
  }

  taskFailed(): Promise<void> {
    return this.append({
      eventId: 'queue.task.failed',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
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
      message: `Unable to activate ${input.taskTitle} due to uncommitted changes in target ${repoNoun} ${input.repoLabels.join(', ')}, please resolve and try again.`,
      extra: {
        repoLabels: input.repoLabels,
        repoRoots: input.repoRoots,
        reason: 'uncommitted-changes',
      },
    });
  }

  autoMergeDisabled(): Promise<void> {
    return this.append({
      eventId: 'auto_merge.disabled',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'info',
      message: 'Auto-merge disabled.',
    });
  }

  autoMergeApplied(input: { repos: string }): Promise<void> {
    return this.append({
      eventId: 'auto_merge.applied',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'success',
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
      message: `Auto-merge skipped: ${input.detail}.`,
      extra: { detail: input.detail },
    });
  }

  closeoutFinalized(): Promise<void> {
    return this.append({
      eventId: 'closeout.finalized',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'success',
      message: 'Closeout finalized.',
    });
  }

  errorItemsMoved(input: { errorPath: string; reason: string }): Promise<void> {
    return this.append({
      eventId: 'queue.error_items.moved',
      source: 'runtime.queue',
      role: 'queue',
      severity: 'error',
      message: `Moved to error-items: ${input.reason}.`,
      extra: { error_path: input.errorPath, reason: input.reason },
    });
  }

  strandedCloseoutResumed(input: { drove: readonly string[] }): Promise<void> {
    return this.append({
      eventId: 'closeout.stranded.resumed',
      source: 'runtime.closeout',
      role: 'pipeline',
      severity: 'warning',
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
      message: 'Closeout remediation launching.',
      extra: { reason: input.reason },
    });
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
