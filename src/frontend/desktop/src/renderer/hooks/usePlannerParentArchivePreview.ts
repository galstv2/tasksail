import { useCallback, useState } from 'react';

import type {
  ArchivedTaskEntry,
  PlannerReadParentArchiveMarkdownResponse,
} from '../../shared/desktopContract';
import { createLogger } from '../log/logger';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { normalizeIpcThrownError } from '../services/ipcErrorHelpers';

const log = createLogger('src/renderer/hooks/usePlannerParentArchivePreview');

export function usePlannerParentArchivePreview(client: DesktopShellClient) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archive, setArchive] = useState<PlannerReadParentArchiveMarkdownResponse | null>(null);
  const [lastTask, setLastTask] = useState<ArchivedTaskEntry | null>(null);

  const load = useCallback(async (task: ArchivedTaskEntry): Promise<void> => {
    const snapshot = task.plannerFocusSnapshot;
    if (!snapshot) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    setLastTask(task);
    try {
      const result = await client.readParentArchiveMarkdown({
        parentTaskId: task.taskId,
        contextPackDir: snapshot.contextPackDir,
        contextPackId: snapshot.contextPackId,
      });
      if (!result.ok) {
        setError(result.error ?? 'Failed to load parent archive.');
        log.warn('planner.parent-archive-preview.load.failed', { taskId: task.taskId, reason: result.error });
        return;
      }
      if (result.response.action !== 'planner.readParentArchiveMarkdown') {
        setError('Unexpected parent archive response.');
        log.warn('planner.parent-archive-preview.load.failed', { taskId: task.taskId, reason: 'Unexpected response.' });
        return;
      }
      setArchive(result.response);
    } catch (err: unknown) {
      const reason = normalizeIpcThrownError(err, 'Failed to load parent archive.');
      setError(reason);
      log.warn('planner.parent-archive-preview.load.failed', { taskId: task.taskId, reason });
    } finally {
      setLoading(false);
    }
  }, [client]);

  return {
    open,
    loading,
    error,
    archive,
    openForTask: load,
    retry: () => { if (lastTask) void load(lastTask); },
    close: () => setOpen(false),
  };
}
