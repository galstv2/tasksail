import { join } from 'node:path';

import { getProviderFrontendDescriptor } from '../../../../backend/platform/cli-provider/index.js';
import { loadTaskRegistry } from '../../../../backend/platform/queue/taskRegistry.js';
import type {
  AgentTerminalSession,
  GuardrailObservation,
  ObservabilitySnapshotResponse,
  PendingQueueItem,
  TaskLifecycleFeed,
  WorkflowLifecycleEntry,
} from '../../src/shared/desktopContract';
import {
  filterActiveTaskIdsForScope,
  getCurrentActiveContextPackTaskScope,
  isCurrentActiveContextPackTaskScopeInitialized,
  readVisibleTaskMarkdownItems,
  resolveActiveContextPackTaskScope,
  type ContextPackLister,
} from '../main.contextPackTaskVisibility';
import { readTaskRecoveryState } from '../main.recoveryState';
import { REPO_ROOT } from '../paths';
import { repoFs, type ReadOnlyRepoFs } from '../utils';
import { buildAgentLabelLookup } from './agentLabels';
import {
  buildGuardrailSummary,
  mergeGuardrailStateIntoSessions,
  readGuardrailObservations,
} from './guardrails';
import {
  buildArtifactReference,
  buildTaskLifecycleFeed,
  inferLifecycleState,
  inferOperatorStatus,
} from './lifecycle';
import { readActiveTaskIds, readPendingQueueItems, readUnscopedPendingQueueItems } from './queueSnapshot';
import { readRoleAgentTerminalSessions } from './roleSessions';
import {
  DROPBOX_DIR,
  ERROR_ITEMS_DIR,
  PENDING_DIR,
  countMarkdownFiles,
  extractMetadataValue,
  readMarkdownFileIfPresent,
} from './shared';

export async function readObservabilitySnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
  runtimeTaskIdsOverride?: string[],
  listContextPacks?: ContextPackLister,
): Promise<ObservabilitySnapshotResponse> {
  const scope = listContextPacks
    ? await resolveActiveContextPackTaskScope(listContextPacks)
    : getCurrentActiveContextPackTaskScope();
  const scopedRead = Boolean(listContextPacks) || isCurrentActiveContextPackTaskScopeInitialized();
  if (scopedRead && !scope) {
    return {
      action: 'observability.readSnapshot',
      mode: 'read-only',
      message:
        'Repo observability reflects queue and artifact truth only. The desktop shell does not author workflow-policy artifacts.',
      queueDepth: 0,
      pendingReviewCount: 0,
      activeTaskId: null,
      activeTaskTitle: null,
      currentState: 'idle',
      operatorStatus: inferOperatorStatus({
        activeTaskIds: [],
        agentTerminalSessions: [],
      }),
      pendingQueueItems: [],
      activeTasks: [],
      activeTask: null,
      agentTerminalSessions: [],
      guardrailSummary: buildGuardrailSummary([]),
      guardrails: [],
      recoveryState: null,
      lifecycle: [
        {
          state: 'queued',
          observed: false,
          detail: 'No queued markdown tasks observed in AgentWorkSpace/dropbox/.',
        },
        {
          state: 'active',
          observed: false,
          detail: 'No active AgentWorkSpace/pendingitems/ artifact is currently visible.',
        },
      ],
      artifactReferences: [],
      policyBoundary:
        'Repo artifacts remain authoritative. Desktop recovery controls may mutate queue claims and pending items, but they never author handoff summaries directly.',
    };
  }

  const providerDescriptor = getProviderFrontendDescriptor(REPO_ROOT);
  const rosterAgentIds = providerDescriptor.roster.map((entry) => entry.agentId);
  const agentLabelLookup = buildAgentLabelLookup(providerDescriptor.roster);

  async function readRuntimeReceipts(runtimeTaskIds: string[]): Promise<{
    agentTerminalSessions: AgentTerminalSession[];
    guardrails: GuardrailObservation[];
    guardrailsByTaskId: Map<string, GuardrailObservation[]>;
  }> {
    const perTaskResults = await Promise.all(runtimeTaskIds.map(async (runtimeTaskId) => {
      const roleSessionsDir = join(
        REPO_ROOT,
        '.platform-state',
        'runtime',
        'tasks',
        runtimeTaskId,
        'role-sessions',
      );
      const guardrailReceiptsDir = join(
        REPO_ROOT,
        '.platform-state',
        'runtime',
        'tasks',
        runtimeTaskId,
        'guardrails',
      );
      const [sessions, guardrailObservations] = await Promise.all([
        readRoleAgentTerminalSessions(fsAdapter, roleSessionsDir, agentLabelLookup, runtimeTaskId),
        readGuardrailObservations(fsAdapter, guardrailReceiptsDir, rosterAgentIds, agentLabelLookup),
      ]);
      const sessionsById = new Set(sessions.map((session) => session.sessionId));
      const latestSessionByAgent = new Map<string, AgentTerminalSession>();
      for (const session of sessions) {
        const current = latestSessionByAgent.get(session.agentId);
        if (!current || (session.lastUpdatedAt ?? '') > (current.lastUpdatedAt ?? '')) {
          latestSessionByAgent.set(session.agentId, session);
        }
      }
      const normalizedGuardrails = guardrailObservations.map((observation) => {
        if (observation.sessionId && sessionsById.has(observation.sessionId)) {
          return observation;
        }
        const latestSession = latestSessionByAgent.get(observation.agentId);
        return latestSession
          ? { ...observation, sessionId: latestSession.sessionId }
          : observation;
      });
      return {
        taskId: runtimeTaskId,
        agentTerminalSessions: mergeGuardrailStateIntoSessions(sessions, normalizedGuardrails),
        guardrails: normalizedGuardrails,
      };
    }));

    const guardrailsByTaskId = new Map<string, GuardrailObservation[]>();
    for (const result of perTaskResults) {
      guardrailsByTaskId.set(result.taskId, result.guardrails);
    }

    return {
      agentTerminalSessions: perTaskResults.flatMap((result) => result.agentTerminalSessions),
      guardrails: perTaskResults.flatMap((result) => result.guardrails),
      guardrailsByTaskId,
    };
  }

  const [
    rawActiveTaskIds,
    recoveryState,
  ] =
    await Promise.all([
      readActiveTaskIds(fsAdapter),
      readTaskRecoveryState(fsAdapter),
    ]);
  let dropboxCount: number;
  let pendingCount: number;
  let errorItemsCount: number;
  let activeTaskIds: string[];
  let pendingQueueItems: PendingQueueItem[];
  let runtimeTaskIds: string[];

  if (scope) {
    const registry = await loadTaskRegistry(REPO_ROOT);
    const [dropboxItems, pendingItems, errorItems] = await Promise.all([
      readVisibleTaskMarkdownItems(DROPBOX_DIR, scope, fsAdapter),
      readVisibleTaskMarkdownItems(PENDING_DIR, scope, fsAdapter),
      readVisibleTaskMarkdownItems(ERROR_ITEMS_DIR, scope, fsAdapter),
    ]);
    activeTaskIds = await filterActiveTaskIdsForScope(rawActiveTaskIds, {
      registry,
      scope,
      pendingDir: PENDING_DIR,
      fsAdapter,
    });
    dropboxCount = dropboxItems.length;
    pendingCount = pendingItems.length;
    errorItemsCount = errorItems.length;

    const visibleTaskIdSet = new Set(pendingItems.flatMap((item) => item.taskId ? [item.taskId] : []));
    runtimeTaskIds = [...new Set((runtimeTaskIdsOverride ?? activeTaskIds).filter((taskId) => (
      activeTaskIds.includes(taskId) || visibleTaskIdSet.has(taskId)
    )))];
    pendingQueueItems = await readPendingQueueItems(pendingItems, new Set(activeTaskIds));
  } else {
    activeTaskIds = rawActiveTaskIds;
    [dropboxCount, pendingCount, errorItemsCount] = await Promise.all([
      countMarkdownFiles(DROPBOX_DIR, fsAdapter),
      countMarkdownFiles(PENDING_DIR, fsAdapter),
      countMarkdownFiles(ERROR_ITEMS_DIR, fsAdapter),
    ]);
    runtimeTaskIds = runtimeTaskIdsOverride ?? activeTaskIds;
    pendingQueueItems = await readUnscopedPendingQueueItems(fsAdapter, new Set(activeTaskIds));
  }
  const { agentTerminalSessions, guardrails, guardrailsByTaskId } = await readRuntimeReceipts(runtimeTaskIds);
  const guardrailSummary = buildGuardrailSummary(guardrails);

  const activeTaskId = activeTaskIds[0] ?? null;
  const tasksDir = join(REPO_ROOT, 'AgentWorkSpace', 'tasks');

  const operatorStatus = inferOperatorStatus({
    activeTaskIds,
    agentTerminalSessions,
  });

  let professionalTask: string | null = null;
  let activeTaskTitle: string | null = null;
  if (activeTaskId) {
    const firstTaskHandoffsDir = join(tasksDir, activeTaskId, 'handoffs');
    professionalTask = await readMarkdownFileIfPresent(
      join(firstTaskHandoffsDir, 'professional-task.md'),
      fsAdapter,
    );
    activeTaskTitle = extractMetadataValue(professionalTask, 'Task Title');
  }

  const currentState = inferLifecycleState({
    dropboxCount,
    pendingCount,
    hasCurrentTaskContext: Boolean(activeTaskId || activeTaskTitle),
  });

  const lifecycle: WorkflowLifecycleEntry[] = [
    {
      state: 'queued',
      observed: dropboxCount > 0,
      detail:
        dropboxCount > 0 ? `${dropboxCount} markdown task(s) currently waiting in AgentWorkSpace/dropbox/.` : 'No queued markdown tasks observed in AgentWorkSpace/dropbox/.',
    },
    {
      state: 'active',
      observed: pendingCount > 0 || Boolean(activeTaskId),
      detail:
        pendingCount > 0 || activeTaskId
          ? `Active workflow context is visible in AgentWorkSpace/pendingitems/ or .active-items markers for ${activeTaskId || 'the current task'}.`
          : 'No active AgentWorkSpace/pendingitems/ artifact is currently visible.',
    },
  ];

  const artifactReferences: Array<Awaited<ReturnType<typeof buildArtifactReference>> & { taskId: string | null }> = [];
  const activeTasks: TaskLifecycleFeed[] = [];

  for (const tid of activeTaskIds) {
    const taskHandoffsDir = join(tasksDir, tid, 'handoffs');
    const taskImplStepsDir = join(tasksDir, tid, 'ImplementationSteps');

    const taskProfessionalTask = tid === activeTaskId
      ? professionalTask
      : await readMarkdownFileIfPresent(join(taskHandoffsDir, 'professional-task.md'), fsAdapter);
    const taskTitle = extractMetadataValue(taskProfessionalTask, 'Task Title');

    const [ptRef, retroRef, implRef] = await Promise.all([
      buildArtifactReference('Professional task handoff', join(taskHandoffsDir, 'professional-task.md'), 'file', fsAdapter),
      buildArtifactReference('Retrospective handoff', join(taskHandoffsDir, 'retrospective-input.md'), 'file', fsAdapter),
      buildArtifactReference('Implementation steps', taskImplStepsDir, 'directory', fsAdapter),
    ]);
    artifactReferences.push(
      { ...ptRef, taskId: tid },
      { ...retroRef, taskId: tid },
      { ...implRef, taskId: tid },
    );

    const taskGuardrails = guardrailsByTaskId.get(tid);
    const taskGuardrailSummary = taskGuardrails !== undefined
      ? buildGuardrailSummary(taskGuardrails)
      : guardrailSummary;
    const feed = await buildTaskLifecycleFeed({
      fsAdapter,
      activeTaskId: tid,
      activeTaskTitle: taskTitle,
      professionalTask: taskProfessionalTask,
      currentState,
      agentTerminalSessions,
      guardrailSummary: taskGuardrailSummary,
      recoveryState,
      handoffsDir: taskHandoffsDir,
    });
    if (feed) {
      activeTasks.push(feed);
    }
  }

  const activeTask = activeTasks[0] ?? null;

  return {
    action: 'observability.readSnapshot',
    mode: 'read-only',
    message:
      'Repo observability reflects queue and artifact truth only. The desktop shell does not author workflow-policy artifacts.',
    queueDepth: dropboxCount,
    pendingReviewCount: pendingCount,
    activeTaskId,
    activeTaskTitle,
    currentState,
    operatorStatus,
    pendingQueueItems,
    errorItemsCount: errorItemsCount > 0 ? errorItemsCount : undefined,
    activeTasks,
    activeTask,
    agentTerminalSessions,
    guardrailSummary,
    guardrails,
    recoveryState,
    lifecycle,
    artifactReferences,
    policyBoundary:
      'Repo artifacts remain authoritative. Desktop recovery controls may mutate queue claims and pending items, but they never author handoff summaries directly.',
  };
}
