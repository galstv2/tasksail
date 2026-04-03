import { useCallback, useEffect, useState } from 'react';

import type { ReinforcementRealignmentSessionEntry } from '../../shared/desktopContract';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';

export type UseRealignmentSessionsResult = {
  sessions: ReinforcementRealignmentSessionEntry[];
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  onSelectSession: (sessionId: string | null) => void;
  reload: () => void;
};

export function useRealignmentSessions(
  hasActiveContextPack: boolean,
  client: DesktopShellClient = desktopShellClient,
): UseRealignmentSessionsResult {
  const [sessions, setSessions] = useState<ReinforcementRealignmentSessionEntry[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasActiveContextPack) {
      setSessions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await client.listRealignmentSessions();
      if (result.ok && result.response.action === 'reinforcement.listRealignmentSessions') {
        setSessions(result.response.sessions);
      } else if (!result.ok) {
        setError(result.error);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions.');
    } finally {
      setLoading(false);
    }
  }, [hasActiveContextPack, client]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const onSelectSession = useCallback((sessionId: string | null) => {
    setSelectedSessionId(sessionId);
  }, []);

  return { sessions, selectedSessionId, loading, error, onSelectSession, reload: load };
}
