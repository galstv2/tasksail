import path from 'node:path';

export const PLANNER_HISTORY_FILENAME = 'planner-conversation-history.json';

export function resolvePlannerHistoryPath(repoRoot: string): string {
  return path.normalize(path.resolve(
    path.join(repoRoot, '.platform-state', PLANNER_HISTORY_FILENAME),
  ));
}

