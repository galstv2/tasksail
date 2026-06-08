import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import { createLogger } from '../../log/logger';
import type { DesktopShellClient } from '../../services/desktopShellClient';
import { desktopShellClient } from '../../services/desktopShellClient';

export type UseRealignmentSessionsResult = {
  sessions: ReinforcementRealignmentSessionEntry[];
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  analysisRun: RealignmentAnalysisRunState;
  onSelectSession: (sessionId: string | null) => void;
  runAnalysis: (contextPackDir: string, realignmentId: string) => Promise<void>;
  dismissRealignment: (contextPackDir: string, realignmentId: string) => Promise<void>;
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

const log = createLogger('src/renderer/hooks/useRealignmentSessions');

export function useRealignmentSessions(
  activeContextPackDir: string | null,
  client: DesktopShellClient = desktopShellClient,
): UseRealignmentSessionsResult {
  const [sessions, setSessions] = useState<ReinforcementRealignmentSessionEntry[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisRun, setAnalysisRun] = useState<RealignmentAnalysisRunState>({ status: 'idle' });
  const requestGenerationRef = useRef(0);
  // Pack-identity generation: bumped only on activeContextPackDir change, so a
  // mutation continuation (runAnalysis / dismissRealignment) can detect that the
  // modal switched packs while its IPC was in flight and skip the stale state write.
  const packGenerationRef = useRef(0);

  const load = useCallback(async () => {
    if (!activeContextPackDir) {
      setSessions([]);
      return;
    }
    const generation = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await client.listRealignmentSessions();
      if (generation !== requestGenerationRef.current) return;
      if (result.ok && result.response.action === 'reinforcement.listRealignmentSessions') {
        setSessions(result.response.sessions);
      } else if (!result.ok) {
        setError(result.error);
      }
    } catch (err: unknown) {
      if (generation !== requestGenerationRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load sessions.');
    } finally {
      if (generation === requestGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [activeContextPackDir, client]);

  // Reset and reload on pack change
  useEffect(() => {
    setSessions([]);
    setSelectedSessionId(null);
    setAnalysisRun({ status: 'idle' });
    setError(null);
    requestGenerationRef.current += 1;
    packGenerationRef.current += 1;
    load().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContextPackDir]);

  const onSelectSession = useCallback((sessionId: string | null) => {
    setSelectedSessionId(sessionId);
  }, []);

  const runAnalysis = useCallback(
    async (contextPackDir: string, realignmentId: string) => {
      const packGeneration = packGenerationRef.current;
      setAnalysisRun({ status: 'starting', realignmentId });
      try {
        const result = await client.runRealignmentAnalysis({
          contextPackDir,
          realignmentId,
        });
        // Ignore a stale continuation if the active pack changed mid-flight.
        if (packGeneration !== packGenerationRef.current) return;
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
        if (packGeneration !== packGenerationRef.current) return;
        setAnalysisRun({
          status: 'error',
          realignmentId,
          message: err instanceof Error ? err.message : 'Failed to run realignment analysis.',
        });
      }
    },
    [client, load],
  );

  const dismissRealignment = useCallback(
    async (contextPackDir: string, realignmentId: string) => {
      const packGeneration = packGenerationRef.current;
      try {
        const result = await client.dismissRealignment({ contextPackDir, realignmentId });
        // Ignore a stale continuation if the active pack changed mid-flight.
        if (packGeneration !== packGenerationRef.current) return;
        if (result.ok && result.response.action === 'reinforcement.dismissRealignment') {
          setSessions((current) => current.filter((session) => session.realignmentId !== realignmentId));
          setSelectedSessionId((current) => (current === realignmentId ? null : current));
          await load();
          return;
        }
        if (!result.ok) {
          log.warn('realignment.dismiss.failed', {
            contextPackDir,
            realignmentId,
            reason: result.error,
          });
          setAnalysisRun({
            status: 'error',
            realignmentId,
            message: result.error,
          });
        }
      } catch (err: unknown) {
        if (packGeneration !== packGenerationRef.current) return;
        const message = err instanceof Error ? err.message : 'Failed to dismiss realignment.';
        log.warn('realignment.dismiss.failed', {
          contextPackDir,
          realignmentId,
          reason: message,
        });
        setAnalysisRun({
          status: 'error',
          realignmentId,
          message,
        });
      }
    },
    [client, load],
  );

  useEffect(() => {
    if (!sessions.some((session) => session.status === 'running')) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [load, sessions]);

  useEffect(() => {
    if (analysisRun.status !== 'starting' && analysisRun.status !== 'running') {
      return;
    }
    const session = sessions.find((entry) => entry.realignmentId === analysisRun.realignmentId);
    if (!session) return;
    if (session.status === 'error') {
      setAnalysisRun({
        status: 'error',
        realignmentId: session.realignmentId,
        message: 'Realignment analysis failed. Review the task and retry.',
      });
    } else if (session.status === 'archived') {
      setAnalysisRun({
        status: 'completed',
        realignmentId: session.realignmentId,
        message: 'Realignment analysis archived.',
      });
    }
  }, [analysisRun, sessions]);

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
    dismissRealignment,
    completeAnalysisRun,
    reload: load,
  };
}
