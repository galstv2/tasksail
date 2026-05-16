import { join } from 'node:path';

import type { AgentTerminalSession, TaskHealthRollup } from '../../src/shared/desktopContract';
import { stringOrNull, type ReadOnlyRepoFs } from '../utils';
import { getAgentLabel, type AgentLabelProfile } from './agentLabels';
import { deriveSessionHealth, mapLaunchState, mapSessionSeverity, mapTerminalState } from './sessionHealth';
import {
  type JsonObject,
  asJsonObject,
  numberOrNull,
  readDirIfPresent,
  readJsonObjectIfPresent,
  splitOutputLines,
  stringArrayOrEmpty,
} from './shared';

export function getLatestTimestamp(...values: Array<string | null | undefined>): string | null {
  const candidates = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort().at(-1) ?? null;
}

export function parseSessionEntry(
  payload: JsonObject | null,
  fallbackAgentId: string,
  agentLabelLookup: Map<string, AgentLabelProfile>,
  taskIdFromRuntimeDir: string | null = null,
  parseError?: string | null,
): AgentTerminalSession {
  const agentId = stringOrNull(payload?.agent_id) ?? fallbackAgentId;
  const launchPayload = asJsonObject(payload?.launch);
  const terminalPayload = asJsonObject(payload?.terminal);
  const monitorPayload = asJsonObject(payload?.monitor);
  const launchState = mapLaunchState(stringOrNull(launchPayload?.status));
  const terminalState = mapTerminalState(stringOrNull(terminalPayload?.status), launchState);
  const launchPid = numberOrNull(launchPayload?.pid);
  const startedAt = stringOrNull(launchPayload?.started_at);
  const monitorStartedAt = stringOrNull(monitorPayload?.started_at);
  const monitorUpdatedAt = stringOrNull(monitorPayload?.updated_at);
  const monitorPid = numberOrNull(monitorPayload?.pid);
  const lastUpdatedAt = getLatestTimestamp(
    stringOrNull(terminalPayload?.completed_at),
    startedAt,
  );
  const health = deriveSessionHealth({
    launchPid,
    terminalState,
    lastUpdatedAt,
    launchStartedAt: startedAt,
    monitorUpdatedAt,
    monitorStartedAt,
    monitorPid,
  });
  const latestOutputLines = stringArrayOrEmpty(payload?.latest_output_lines);
  const launchPhase = stringOrNull(payload?.launch_phase);
  const launchId = stringOrNull(payload?.launch_id);
  const sessionId = launchId
    ? `role:${agentId}:${launchId}`
    : startedAt
      ? `role:${agentId}:${startedAt}`
      : `role:${agentId}`;

  return {
    taskId: stringOrNull(payload?.task_id) ?? taskIdFromRuntimeDir,
    agentId,
    agentLabel: launchPhase
      ? `${getAgentLabel(agentId, null, agentLabelLookup)} — ${launchPhase}`
      : getAgentLabel(agentId, null, agentLabelLookup),
    sessionId,
    instanceId: null,
    launchPid,
    liveness: health.liveness,
    stuckState: health.stuckState,
    stuckReason: health.stuckReason,
    sliceId: null,
    slicePath: null,
    launchState,
    terminalState,
    lastUpdatedAt,
    latestOutputLines:
      latestOutputLines.length > 0
        ? latestOutputLines
        : splitOutputLines(parseError ? `Receipt parse error: ${parseError}` : null),
    stdoutLogPath: null,
    stderrLogPath: null,
    severity: mapSessionSeverity(launchState, terminalState, health.stuckState, parseError ?? null),
  };
}

export async function readRoleAgentTerminalSessions(
  fsAdapter: ReadOnlyRepoFs,
  roleRuntimeSessionsDir: string,
  agentLabelLookup: Map<string, AgentLabelProfile>,
  taskIdFromRuntimeDir: string | null = null,
): Promise<AgentTerminalSession[]> {
  const receiptFiles = (await readDirIfPresent(roleRuntimeSessionsDir, fsAdapter))
    .filter((name) => name.endsWith('.json'));
  const sessions: AgentTerminalSession[] = [];

  for (const receiptFile of receiptFiles) {
    const receiptPath = join(roleRuntimeSessionsDir, receiptFile);
    const { payload, parseError } = await readJsonObjectIfPresent(receiptPath, fsAdapter);
    const fallbackAgentId = receiptFile.replace(/\.json$/u, '');

    sessions.push(parseSessionEntry(payload, fallbackAgentId, agentLabelLookup, taskIdFromRuntimeDir, parseError));
  }

  return sessions;
}

export function buildTaskHealthRollup(agentTerminalSessions: AgentTerminalSession[]): TaskHealthRollup {
  const observedSessionCount = agentTerminalSessions.length;
  const runningCount = agentTerminalSessions.filter((session) => session.terminalState === 'running').length;
  const completedCount = agentTerminalSessions.filter((session) => session.terminalState === 'completed').length;
  const failedCount = agentTerminalSessions.filter((session) => session.terminalState === 'failed').length;
  const suspectedStuckCount = agentTerminalSessions.filter((session) => session.stuckState === 'suspected-stuck').length;
  const orphanedCount = agentTerminalSessions.filter((session) => session.stuckState === 'orphaned').length;
  const aliveCount = agentTerminalSessions.filter((session) => session.liveness === 'alive').length;
  const missingPidCount = agentTerminalSessions.filter((session) => session.liveness === 'not-found').length;
  const unknownPidCount = agentTerminalSessions.filter((session) => session.liveness === 'unknown').length;

  let status: TaskHealthRollup['status'] = 'healthy';
  let summary = `${runningCount} running, ${completedCount} completed, no liveness alerts.`;

  if (observedSessionCount === 0) {
    status = 'idle';
    summary = 'No runtime sessions observed yet.';
  } else if (orphanedCount > 0 || failedCount > 0) {
    status = 'critical';
    summary = `${orphanedCount} orphaned and ${failedCount} failed session(s) need operator review.`;
  } else if (suspectedStuckCount > 0) {
    status = 'attention';
    summary = `${suspectedStuckCount} session(s) may be stuck while ${runningCount} runtime session(s) remain active.`;
  }

  return {
    status,
    summary,
    observedSessionCount,
    runningCount,
    completedCount,
    failedCount,
    suspectedStuckCount,
    orphanedCount,
    aliveCount,
    missingPidCount,
    unknownPidCount,
  };
}

export function selectSessionsForActiveTask(
  activeTaskId: string | null,
  agentTerminalSessions: AgentTerminalSession[],
): AgentTerminalSession[] {
  if (!activeTaskId) {
    return agentTerminalSessions;
  }

  const directMatches = agentTerminalSessions.filter(
    (session) => session.taskId === activeTaskId,
  );
  if (directMatches.length > 0) {
    return directMatches;
  }

  return agentTerminalSessions.filter((session) => session.taskId === null);
}
