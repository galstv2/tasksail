// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopShellClient } from '../services/desktopShellClient';
import { useActiveWorkGuard } from './useActiveWorkGuard';

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

function createMockClient(
  response?: unknown,
  startResponse?: unknown,
): {
  client: DesktopShellClient;
  checkActiveWorkGuard: ReturnType<typeof vi.fn>;
  startRealignment: ReturnType<typeof vi.fn>;
} {
  const checkActiveWorkGuard = vi.fn().mockResolvedValue(response ?? {
    ok: true,
    response: {
      action: 'reinforcement.checkActiveWorkGuard',
      allowed: true,
      message: 'No active work',
      activeTaskId: null,
    },
  });
  const startRealignment = vi.fn().mockResolvedValue(startResponse ?? {
    ok: true,
    response: {
      action: 'reinforcement.startRealignment',
      mode: 'started',
      message: 'Session started.',
      session: { realignmentId: 'RA-test', status: 'open' },
    },
  });
  const client = { checkActiveWorkGuard, startRealignment } as unknown as DesktopShellClient;
  return { client, checkActiveWorkGuard, startRealignment };
}

describe('useActiveWorkGuard', () => {
  beforeEach(() => {
    logEmit.mockClear();
  });

  it('returns allowed when no active context pack', async () => {
    const { client } = createMockClient();
    const { result } = renderHook(() => useActiveWorkGuard(false, client));

    await waitFor(() => {
      expect(result.current.guard.status).toBe('allowed');
    });
  });

  it('returns allowed when guard check passes', async () => {
    const { client } = createMockClient({
      ok: true,
      response: {
        action: 'reinforcement.checkActiveWorkGuard',
        allowed: true,
        message: 'All clear',
        activeTaskId: null,
      },
    });
    const { result } = renderHook(() => useActiveWorkGuard(true, client));

    await waitFor(() => {
      expect(result.current.guard.status).toBe('allowed');
    });
  });

  it('returns blocked when guard check fails with errorCode', async () => {
    const { client } = createMockClient({
      ok: false,
      error: 'Blocked message',
      errorCode: 'active_work_blocked',
    });
    const { result } = renderHook(() => useActiveWorkGuard(true, client));

    await waitFor(() => {
      expect(result.current.guard).toEqual({
        status: 'blocked',
        message: 'Blocked message',
        activeTaskId: null,
      });
    });
  });

  it('returns blocked when response says not allowed', async () => {
    const { client } = createMockClient({
      ok: true,
      response: {
        action: 'reinforcement.checkActiveWorkGuard',
        allowed: false,
        message: 'Blocked by task X',
        activeTaskId: 'X',
      },
    });
    const { result } = renderHook(() => useActiveWorkGuard(true, client));

    await waitFor(() => {
      expect(result.current.guard).toEqual({
        status: 'blocked',
        message: 'Blocked by task X',
        activeTaskId: 'X',
      });
    });
  });

  it('recheck re-runs the guard check', async () => {
    const { client, checkActiveWorkGuard } = createMockClient({
      ok: true,
      response: {
        action: 'reinforcement.checkActiveWorkGuard',
        allowed: true,
        message: 'All clear',
        activeTaskId: null,
      },
    });
    const { result } = renderHook(() => useActiveWorkGuard(true, client));

    await waitFor(() => {
      expect(result.current.guard.status).toBe('allowed');
    });

    checkActiveWorkGuard.mockResolvedValueOnce({
      ok: true,
      response: {
        action: 'reinforcement.checkActiveWorkGuard',
        allowed: false,
        message: 'Now blocked',
        activeTaskId: 'T-2',
      },
    });

    result.current.recheck();

    await waitFor(() => {
      expect(result.current.guard).toEqual({
        status: 'blocked',
        message: 'Now blocked',
        activeTaskId: 'T-2',
      });
    });

    expect(checkActiveWorkGuard).toHaveBeenCalledTimes(2);
  });

  it('startRealignment calls client and updates startState', async () => {
    const { client, startRealignment: startMock } = createMockClient(undefined, {
      ok: true,
      response: {
        action: 'reinforcement.startRealignment',
        mode: 'started',
        message: 'Session started.',
        session: { realignmentId: 'RA-new', status: 'open' },
      },
    });
    const { result } = renderHook(() => useActiveWorkGuard(true, client));

    await waitFor(() => {
      expect(result.current.guard.status).toBe('allowed');
    });

    expect(result.current.startState.status).toBe('idle');

    await waitFor(async () => {
      result.current.startRealignment('/ctx', 'T-1');
    });

    await waitFor(() => {
      expect(result.current.startState.status).toBe('started');
    });

    expect(startMock).toHaveBeenCalledWith({ contextPackDir: '/ctx', triggerTaskId: 'T-1' });
  });

  it('startRealignment sets error and rechecks guard on failure', async () => {
    const { client, checkActiveWorkGuard } = createMockClient(undefined, {
      ok: false,
      error: 'Active work blocked.',
      errorCode: 'active_work_blocked',
    });
    const { result } = renderHook(() => useActiveWorkGuard(true, client));

    await waitFor(() => {
      expect(result.current.guard.status).toBe('allowed');
    });

    await waitFor(async () => {
      result.current.startRealignment('/ctx', 'T-1');
    });

    await waitFor(() => {
      expect(result.current.startState).toEqual({ status: 'error', message: 'Active work blocked.' });
    });

    // Guard was rechecked after failure
    expect(checkActiveWorkGuard).toHaveBeenCalledTimes(2);
  });

  it('startRealignment logs and exits starting state when IPC rejects', async () => {
    const { client } = createMockClient();
    vi.mocked(client.startRealignment).mockRejectedValueOnce(new Error('Realignment bridge failed.'));
    const { result } = renderHook(() => useActiveWorkGuard(true, client));

    await waitFor(() => {
      expect(result.current.guard.status).toBe('allowed');
    });

    await waitFor(async () => {
      result.current.startRealignment('/ctx', 'T-1');
    });

    await waitFor(() => {
      expect(result.current.startState).toEqual({
        status: 'error',
        message: 'Realignment bridge failed.',
      });
      expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'realignment.start.failed',
        level: 'warn',
        extra: {
          contextPackDir: '/ctx',
          triggerTaskId: 'T-1',
          reason: 'Realignment bridge failed.',
        },
      }));
    });
  });
});
