import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopShellClient } from '../services/desktopShellClient';
import { useRealignmentSessions } from './useRealignmentSessions';

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
  it('starts analysis by realignment id and keeps the job local to the session', async () => {
    const client = mockClient();
    const { result } = renderHook(() => useRealignmentSessions(true, client));

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
    const { result } = renderHook(() => useRealignmentSessions(true, client));

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
});
