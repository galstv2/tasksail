import { join } from 'node:path';

import type {
  AgentTerminalSession,
  ArtifactReference,
  GuardrailSummary,
  LifecycleState,
  OperatorStatus,
  TaskLifecycleFeed,
  TaskRecoveryState,
} from '../../src/shared/desktopContract';
import { REPO_ROOT } from '../paths';
import { pathExists, type ReadOnlyRepoFs } from '../utils';
import { buildTaskHealthRollup, getLatestTimestamp, selectSessionsForActiveTask } from './roleSessions';
import {
  countMarkdownFiles,
  extractHeading,
  extractMetadataValue,
  toRepoRelativePath,
} from './shared';

export async function buildTaskLifecycleFeed(args: {
  fsAdapter: ReadOnlyRepoFs;
  activeTaskId: string | null;
  activeTaskTitle: string | null;
  professionalTask: string | null;
  currentState: LifecycleState;
  agentTerminalSessions: AgentTerminalSession[];
  guardrailSummary: GuardrailSummary;
  recoveryState: TaskRecoveryState | null;
  /** Per-task handoffs directory. Defaults to the legacy singleton when not supplied. */
  handoffsDir?: string;
}): Promise<TaskLifecycleFeed | null> {
  const {
    fsAdapter,
    activeTaskId,
    activeTaskTitle,
    professionalTask,
    currentState,
    agentTerminalSessions,
    guardrailSummary,
    recoveryState,
  } = args;

  if (!activeTaskId && !activeTaskTitle && agentTerminalSessions.length === 0) {
    return null;
  }

  const scopedSessions = selectSessionsForActiveTask(
    activeTaskId,
    agentTerminalSessions,
  );
  // Derive the parallel-ok path from the per-task handoffs directory when available.
  const effectiveHandoffsDir = args.handoffsDir ?? join(REPO_ROOT, 'AgentWorkSpace', 'handoffs');
  const parallelOkPath = join(effectiveHandoffsDir, 'parallel-ok.md');
  let parallelOkContent: string | null = null;
  try { parallelOkContent = await fsAdapter.readFile(parallelOkPath, 'utf-8'); } catch {}
  // Strip HTML comments before checking — the template itself contains "Complex"
  // in a comment that would otherwise false-positive. Mirror the backend's
  // parallelOkHasActiveApproval logic: requires "complex", rejects if "simple" present.
  const strippedParallelOk = parallelOkContent?.replace(/<!--[\s\S]*?-->/g, '') ?? '';
  const parallelizationEnabled =
    scopedSessions.some((session) => session.instanceId !== null) ||
    (/\bcomplex\b/i.test(strippedParallelOk) && !/\bsimple\b/i.test(strippedParallelOk));
  const startedAt = scopedSessions
    .map((session) => session.lastUpdatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(0) ?? null;
  const lastUpdatedAt = getLatestTimestamp(...scopedSessions.map((session) => session.lastUpdatedAt));
  const taskHealth = buildTaskHealthRollup(scopedSessions);

  return {
    taskId: activeTaskId,
    taskTitle: activeTaskTitle,
    taskKind: extractMetadataValue(professionalTask, 'Task Kind') || null,
    workflowStage: currentState,
    activePath: null,
    parallelizationEnabled,
    startedAt,
    lastUpdatedAt,
    // Source artifact is per-task and derived from the effective handoffs directory.
    sourceArtifact: toRepoRelativePath(join(effectiveHandoffsDir, 'professional-task.md')),
    taskHealth,
    guardrailSummary,
    recoveryState:
      recoveryState && (activeTaskId === null || !recoveryState.taskId || recoveryState.taskId === activeTaskId)
        ? recoveryState
        : null,
  };
}

export function inferLifecycleState(args: {
  dropboxCount: number;
  pendingCount: number;
  hasCurrentTaskContext: boolean;
}): LifecycleState {
  if (args.pendingCount > 0) {
    return 'active';
  }

  if (args.dropboxCount > 0) {
    return 'queued';
  }

  return 'idle';
}

/**
 * activeTasks array is populated from active markers in .active-items/;
 * activeTaskId is derived as activeTasks[0]?.taskId ?? null (F39 back-compat scalar).
 */
export function inferOperatorStatus(args: {
  activeTaskIds: string[];
  agentTerminalSessions: AgentTerminalSession[];
}): OperatorStatus {
  const { activeTaskIds, agentTerminalSessions } = args;

  // Build activeTasks array from active markers
  const activeTasks: Array<{ taskId: string; phase: string; startedAt: string }> =
    activeTaskIds.map((taskId) => {
      // Phase is derived from the first running session for this task, or 'unknown'
      const session = agentTerminalSessions.find((s) => s.taskId === taskId);
      const phase = session?.launchState === 'started' ? 'running'
        : session?.terminalState === 'running' ? 'running'
        : session?.terminalState === 'completed' ? 'completed'
        : session?.terminalState === 'failed' ? 'failed'
        : 'unknown';
      const startedAt = session?.lastUpdatedAt ?? new Date().toISOString();
      return { taskId, phase, startedAt };
    });

  // F39: back-compat activeTaskId scalar
  const activeTaskId = activeTasks[0]?.taskId ?? null;

  return { activeTasks, activeTaskId };
}

export async function buildArtifactReference(
  label: string,
  path: string,
  kind: 'file' | 'directory',
  fsAdapter: ReadOnlyRepoFs,
): Promise<ArtifactReference> {
  const repoPath = toRepoRelativePath(path);
  const exists = await pathExists(path, fsAdapter);

  if (!exists) {
    return {
      label,
      path: repoPath,
      kind,
      status: 'missing',
      detail: 'Not present in the repo yet.',
    };
  }

  if (kind === 'directory') {
    const count = await countMarkdownFiles(path, fsAdapter);
    return {
      label,
      path: repoPath,
      kind,
      status: count > 0 ? 'present' : 'empty',
      detail: count > 0 ? `${count} markdown artifact(s) available.` : 'No markdown artifacts present yet.',
    };
  }

  const content = await fsAdapter.readFile(path, 'utf-8');
  const heading = extractHeading(content);
  const taskTitle = extractMetadataValue(content, 'Task Title');

  return {
    label,
    path: repoPath,
    kind,
    status: content.trim() ? 'present' : 'empty',
    detail: taskTitle || heading || 'Artifact template is present but does not yet contain task details.',
  };
}
