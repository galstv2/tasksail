import { useCallback, useEffect, useState } from 'react';

import type { ReinforcementRealignmentSessionEntry } from '../../shared/desktopContract';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';

export type UseRealignmentSessionsResult = {
  sessions: ReinforcementRealignmentSessionEntry[];
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  analysisRun: RealignmentAnalysisRunState;
  onSelectSession: (sessionId: string | null) => void;
  runAnalysis: (contextPackDir: string, realignmentId: string) => Promise<void>;
  completeAnalysisRun: (message: string) => void;
  reload: () => Promise<void>;
};

export type RealignmentAnalysisRunState =
  | { status: 'idle' }
  | { status: 'starting'; realignmentId: string }
  | { status: 'running'; realignmentId: string; message: string }
  | { status: 'skipped'; realignmentId: string; message: string }
  | { status: 'error'; realignmentId: string; message: string }
  | { status: 'completed'; realignmentId: string; message: string };

export function useRealignmentSessions(
  hasActiveContextPack: boolean,
  client: DesktopShellClient = desktopShellClient,
): UseRealignmentSessionsResult {
  const [sessions, setSessions] = useState<ReinforcementRealignmentSessionEntry[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisRun, setAnalysisRun] = useState<RealignmentAnalysisRunState>({ status: 'idle' });

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

  const runAnalysis = useCallback(
    async (contextPackDir: string, realignmentId: string) => {
      setAnalysisRun({ status: 'starting', realignmentId });
      try {
        const result = await client.runRealignmentAnalysis({
          contextPackDir,
          realignmentId,
        });
        if (result.ok && result.response.action === 'reinforcement.runRealignmentAnalysis') {
          const { job } = result.response;
          if (job.status === 'started') {
            setAnalysisRun({
              status: 'running',
              realignmentId,
              message: result.response.message,
            });
            load().catch(() => {});
            return;
          }
          if (job.status === 'already-running') {
            setAnalysisRun({
              status: 'skipped',
              realignmentId,
              message: 'Realignment analysis is already running for this session.',
            });
            return;
          }
          setAnalysisRun({
            status: 'error',
            realignmentId,
            message: job.reason ?? result.response.message,
          });
        } else if (!result.ok) {
          setAnalysisRun({
            status: 'error',
            realignmentId,
            message: result.error,
          });
        }
      } catch (err: unknown) {
        setAnalysisRun({
          status: 'error',
          realignmentId,
          message: err instanceof Error ? err.message : 'Failed to run realignment analysis.',
        });
      }
    },
    [client, load],
  );

  const completeAnalysisRun = useCallback((message: string) => {
    setAnalysisRun((current) => {
      if (current.status !== 'running' && current.status !== 'starting') {
        return current;
      }
      return {
        status: 'completed',
        realignmentId: current.realignmentId,
        message,
      };
    });
  }, []);

  return {
    sessions,
    selectedSessionId,
    loading,
    error,
    analysisRun,
    onSelectSession,
    runAnalysis,
    completeAnalysisRun,
    reload: load,
  };
}
