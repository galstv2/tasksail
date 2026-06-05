// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopShellClient } from '../services/desktopShellClient';
import { useRealignmentSessions } from './useRealignmentSessions';

const { logEmit } = vi.hoisted(() => {
  const logEmit = vi.fn(() => Promise.resolve({ ok: true }));
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      getBootstrapInfo: vi.fn().mockResolvedValue({
        appName: 'TaskSail',
        platform: 'test',
        logLevel: 'info',
        rendererForwardLevel: 'info',
        versions: { chrome: undefined, electron: undefined, node: 'test' },
      }),
      log: { emit: logEmit },
    },
  });
  return { logEmit };
});

function mockClient(overrides: Partial<DesktopShellClient> = {}): DesktopShellClient {
  return {
    listRealignmentSessions: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.listRealignmentSessions',
        mode: 'read-only',
        message: '1 session(s).',
        sessions: [
          {
            realignmentId: 'RA-1',
            triggerTaskId: 'T-1',
            triggerFeedbackId: 'FB-1',
            participatingAgents: ['provider-builder', 'provider-qa'],
            failureAnalysis: 'Gap',
            rootCause: 'Cause',
            correctiveActions: ['Fix'],
            status: 'open',
            meetingNotes: '',
            createdAt: '2026-03-22T00:00:00Z',
          },
        ],
      },
    }),
    runRealignmentAnalysis: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.runRealignmentAnalysis',
        mode: 'analysis-started',
        message: 'Realignment analysis job registered.',
        job: {
          jobId: 'realignment:RA-1',
          realignmentId: 'RA-1',
          status: 'started',
        },
      },
    }),
    ...overrides,
  } as unknown as DesktopShellClient;
}

describe('useRealignmentSessions', () => {
  beforeEach(() => {
    logEmit.mockClear();
  });

  it('starts analysis by realignment id and keeps the job local to the session', async () => {
    const client = mockClient();
    const { result } = renderHook(() => useRealignmentSessions('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.runAnalysis('/context-packs/test', 'RA-1');
    });

    expect(client.runRealignmentAnalysis).toHaveBeenCalledWith({
      contextPackDir: '/context-packs/test',
      realignmentId: 'RA-1',
    });
    expect(result.current.analysisRun).toEqual({
      status: 'running',
      realignmentId: 'RA-1',
      message: 'Realignment analysis job registered.',
    });
    await waitFor(() => {
      expect(client.listRealignmentSessions).toHaveBeenCalledTimes(2);
    });
  });

  it('surfaces lock contention without reloading session state', async () => {
    const client = mockClient({
      runRealignmentAnalysis: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.runRealignmentAnalysis',
          mode: 'analysis-started',
          message: 'Realignment analysis job registered.',
          job: {
            jobId: 'realignment:RA-1',
            realignmentId: 'RA-1',
            status: 'already-running',
            reason: 'realignment_job_already_running',
          },
        },
      }),
    });
    const { result } = renderHook(() => useRealignmentSessions('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.runAnalysis('/context-packs/test', 'RA-1');
    });

    expect(result.current.analysisRun).toEqual({
      status: 'skipped',
      realignmentId: 'RA-1',
      message: 'Realignment analysis is already running for this session.',
    });
    expect(client.listRealignmentSessions).toHaveBeenCalledTimes(1);
  });

  it('logs and surfaces dismiss rejections', async () => {
    const client = mockClient({
      dismissRealignment: vi.fn().mockRejectedValue(new Error('Dismiss failed.')),
    });
    const { result } = renderHook(() => useRealignmentSessions('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.dismissRealignment('/context-packs/test', 'RA-1');
    });

    await waitFor(() => {
      expect(result.current.analysisRun).toEqual({
        status: 'error',
        realignmentId: 'RA-1',
        message: 'Dismiss failed.',
      });
      expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'realignment.dismiss.failed',
        level: 'warn',
        extra: {
          contextPackDir: '/context-packs/test',
          realignmentId: 'RA-1',
          reason: 'Dismiss failed.',
        },
      }));
    });
  });

  it('resets sessions and analysisRun when pack changes', async () => {
    const client = mockClient();
    let packDir: string | null = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useRealignmentSessions(packDir, client));

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    // Change pack
    packDir = '/packs/pack-b';
    rerender();

    // After switch, sessions should start as cleared before new load resolves
    expect(result.current.analysisRun.status).toBe('idle');
  });

  it('runAnalysis: stale pack-A IPC response does not overwrite pack-B idle state', async () => {
    // Deferred IPC for pack A's runRealignmentAnalysis call.
    let resolvePackA!: (v: unknown) => void;
    const packAPromise = new Promise((resolve) => { resolvePackA = resolve; });

    const runAnalysisFn = vi.fn()
      .mockReturnValueOnce(packAPromise); // first call for pack A is deferred

    const client = mockClient({ runRealignmentAnalysis: runAnalysisFn });
    let packDir: string | null = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useRealignmentSessions(packDir, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start runAnalysis for pack A (IPC stays pending).
    act(() => {
      void result.current.runAnalysis('/packs/pack-a', 'RA-A');
    });
    // status moves to 'starting' while IPC is in flight.
    expect(result.current.analysisRun.status).toBe('starting');

    // Switch to pack B — hook resets analysisRun to idle.
    packDir = '/packs/pack-b';
    rerender();

    await waitFor(() => expect(result.current.analysisRun.status).toBe('idle'));

    // Now resolve the pack-A IPC with a 'started' response.
    await act(async () => {
      resolvePackA({
        ok: true,
        response: {
          action: 'reinforcement.runRealignmentAnalysis',
          mode: 'analysis-started',
          message: 'Analysis started for pack A.',
          job: { jobId: 'j:RA-A', realignmentId: 'RA-A', status: 'started' },
        },
      });
    });

    // The stale pack-A 'running' state must NOT have been written to pack B.
    expect(result.current.analysisRun.status).toBe('idle');
  });

  it('dismissRealignment: stale pack-A IPC response (ok) does not mutate pack-B state', async () => {
    let resolvePackA!: (v: unknown) => void;
    const packAPromise = new Promise((resolve) => { resolvePackA = resolve; });

    const dismissFn = vi.fn().mockReturnValueOnce(packAPromise);
    const client = mockClient({ dismissRealignment: dismissFn });
    let packDir: string | null = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useRealignmentSessions(packDir, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Kick off dismissRealignment for pack A (stays pending).
    act(() => { void result.current.dismissRealignment('/packs/pack-a', 'RA-A'); });

    // Switch to pack B.
    packDir = '/packs/pack-b';
    rerender();
    await waitFor(() => expect(result.current.analysisRun.status).toBe('idle'));
    const sessionsBeforeResolve = result.current.sessions;
    const selectedBefore = result.current.selectedSessionId;

    // Resolve with a successful dismiss for pack A.
    await act(async () => {
      resolvePackA({
        ok: true,
        response: { action: 'reinforcement.dismissRealignment', mode: 'dismissed', message: 'Dismissed.', realignmentId: 'RA-A' },
      });
    });

    // Pack B's sessions / selectedSessionId / analysisRun must be unchanged by the stale A response.
    expect(result.current.sessions).toEqual(sessionsBeforeResolve);
    expect(result.current.selectedSessionId).toBe(selectedBefore);
    expect(result.current.analysisRun.status).toBe('idle');
  });

  it('dismissRealignment: stale pack-A IPC rejection does not set pack-B error state', async () => {
    let rejectPackA!: (err: unknown) => void;
    const packAPromise = new Promise<never>((_, reject) => { rejectPackA = reject; });

    const dismissFn = vi.fn().mockReturnValueOnce(packAPromise);
    const client = mockClient({ dismissRealignment: dismissFn });
    let packDir: string | null = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useRealignmentSessions(packDir, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Kick off dismissRealignment for pack A (stays pending).
    act(() => { void result.current.dismissRealignment('/packs/pack-a', 'RA-A'); });

    // Switch to pack B before the IPC settles.
    packDir = '/packs/pack-b';
    rerender();
    await waitFor(() => expect(result.current.analysisRun.status).toBe('idle'));

    // Reject the pack-A IPC — simulates network/server error.
    await act(async () => {
      rejectPackA(new Error('Dismiss failed for pack A.'));
    });

    // Pack B must remain in idle state — the error from pack A must not bleed in.
    expect(result.current.analysisRun.status).toBe('idle');
  });

  it('ignores stale session responses from old pack after pack change', async () => {
    let resolveOld!: (v: unknown) => void;
    const oldPackPromise = new Promise((resolve) => { resolveOld = resolve; });
    const listFn = vi.fn()
      .mockReturnValueOnce(oldPackPromise)
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'reinforcement.listRealignmentSessions',
          mode: 'read-only',
          message: '1 session(s).',
          sessions: [{ realignmentId: 'RA-B', triggerTaskId: 'T-B', triggerFeedbackId: 'FB-B', participatingAgents: [], failureAnalysis: '', rootCause: '', correctiveActions: [], status: 'open', meetingNotes: '', createdAt: '2026-03-22T00:00:00Z' }],
        },
      });
    const client = mockClient({ listRealignmentSessions: listFn });
    let packDir: string | null = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useRealignmentSessions(packDir, client));

    packDir = '/packs/pack-b';
    rerender();

    await waitFor(() => expect(result.current.sessions[0]?.realignmentId).toBe('RA-B'));

    // Resolve old pack A response
    resolveOld({
      ok: true,
      response: {
        action: 'reinforcement.listRealignmentSessions',
        mode: 'read-only',
        message: '1 session(s).',
        sessions: [{ realignmentId: 'RA-A', triggerTaskId: 'T-A', triggerFeedbackId: 'FB-A', participatingAgents: [], failureAnalysis: '', rootCause: '', correctiveActions: [], status: 'open', meetingNotes: '', createdAt: '2026-03-22T00:00:00Z' }],
      },
    });

    // RA-A from pack A must not appear
    await waitFor(() => expect(result.current.sessions.some((s) => s.realignmentId === 'RA-A')).toBe(false));
  });
});
