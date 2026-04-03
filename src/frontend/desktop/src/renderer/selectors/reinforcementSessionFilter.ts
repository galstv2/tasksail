import type { ReinforcementRealignmentSessionEntry, ReinforcementTaskEntry } from '../../shared/desktopContract';

/**
 * Filter repo-global sessions to only those triggered by tasks in the
 * provided task list (typically the active context pack's archived tasks).
 */
export function filterSessionsForTasks(
  sessions: ReinforcementRealignmentSessionEntry[],
  tasks: ReinforcementTaskEntry[],
): ReinforcementRealignmentSessionEntry[] {
  const taskIds = new Set(tasks.map((t) => t.taskId));
  return sessions.filter((s) => taskIds.has(s.triggerTaskId));
}

/**
 * Find the selected session within a scoped list, returning null if the
 * selected session is not in scope.
 */
export function selectScopedSession(
  filteredSessions: ReinforcementRealignmentSessionEntry[],
  selectedSessionId: string | null,
): ReinforcementRealignmentSessionEntry | null {
  if (!selectedSessionId) return null;
  return filteredSessions.find((s) => s.realignmentId === selectedSessionId) ?? null;
}
