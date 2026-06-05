// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockClient } from '../../test';

import { useReinforcementOverview } from './useReinforcementOverview';

const MOCK_OVERVIEW = {
  totalTasks: 5,
  totalReward: 12.5,
  unrewardedCount: 2,
  streakProgress: 2,
  streakThreshold: 10,
  lastSettlementId: 'S-1',
  agents: [
    {
      agentId: 'swe',
      role: 'Software Engineer',
      multiplier: 1.5,
      lifetimeReward: 7.5,
      unrewardedTaskCount: 2,
      unrewardedRewardTotal: 3.0,
    },
  ],
};

describe('useReinforcementOverview', () => {
  it('returns empty overview when no active context pack', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useReinforcementOverview(null, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.overview).not.toBeNull();
    expect(result.current.overview!.totalTasks).toBe(0);
    expect(result.current.overview!.agents).toEqual([]);
  });

  it('loads overview on mount', async () => {
    const client = createMockClient({
      readReinforcementOverview: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.readOverview',
          mode: 'read-only',
          message: '5 task(s), streak 2/10.',
          overview: MOCK_OVERVIEW,
        },
      }),
    });
    const { result } = renderHook(() => useReinforcementOverview('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.overview).toEqual(MOCK_OVERVIEW);
    expect(result.current.overview!.totalTasks).toBe(5);
    expect(result.current.overview!.totalReward).toBe(12.5);
    expect(result.current.overview!.unrewardedCount).toBe(2);
    expect(result.current.overview!.streakProgress).toBe(2);
    expect(result.current.overview!.lastSettlementId).toBe('S-1');
    expect(result.current.overview!.agents).toHaveLength(1);
    expect(result.current.overview!.agents[0].agentId).toBe('swe');
  });

  it('sets error on IPC failure', async () => {
    const client = createMockClient({
      readReinforcementOverview: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Failed',
      }),
    });
    const { result } = renderHook(() => useReinforcementOverview('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed');
  });

  it('agent rewards are sourced from global QMD not context-pack archive', async () => {
    const client = createMockClient({
      readReinforcementOverview: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.readOverview',
          mode: 'read-only',
          message: '5 task(s), streak 2/10.',
          overview: MOCK_OVERVIEW,
        },
      }),
    });
    const { result } = renderHook(() => useReinforcementOverview('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The hook passes the IPC response agents array through without transformation.
    // On the backend this data is read from AgentWorkSpace/qmd/global/reinforcement/agent-rewards/,
    // so the renderer must not re-source or reshape it.
    expect(result.current.overview!.agents).toEqual(MOCK_OVERVIEW.agents);
    expect(result.current.overview!.agents[0]).toStrictEqual({
      agentId: 'swe',
      role: 'Software Engineer',
      multiplier: 1.5,
      lifetimeReward: 7.5,
      unrewardedTaskCount: 2,
      unrewardedRewardTotal: 3.0,
    });
  });

  it('resets and reloads when activeContextPackDir changes', async () => {
    const readFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'reinforcement.readOverview',
          mode: 'read-only',
          message: '1 task(s), streak 1/10.',
          overview: { ...MOCK_OVERVIEW, totalTasks: 1 },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'reinforcement.readOverview',
          mode: 'read-only',
          message: '7 task(s), streak 3/10.',
          overview: { ...MOCK_OVERVIEW, totalTasks: 7 },
        },
      });
    const client = createMockClient({ readReinforcementOverview: readFn });
    let packDir: string | null = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useReinforcementOverview(packDir, client));

    await waitFor(() => expect(result.current.overview?.totalTasks).toBe(1));

    packDir = '/packs/pack-b';
    rerender();

    await waitFor(() => expect(result.current.overview?.totalTasks).toBe(7));
  });

  it('ignores stale responses from old pack after pack change', async () => {
    let resolveOld!: (v: unknown) => void;
    const oldPackPromise = new Promise((resolve) => { resolveOld = resolve; });
    const readFn = vi.fn()
      .mockReturnValueOnce(oldPackPromise)
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'reinforcement.readOverview',
          mode: 'read-only',
          message: '2 task(s).',
          overview: { ...MOCK_OVERVIEW, totalTasks: 2 },
        },
      });
    const client = createMockClient({ readReinforcementOverview: readFn });
    let packDir: string | null = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useReinforcementOverview(packDir, client));

    packDir = '/packs/pack-b';
    rerender();

    await waitFor(() => expect(result.current.overview?.totalTasks).toBe(2));

    resolveOld({
      ok: true,
      response: {
        action: 'reinforcement.readOverview',
        mode: 'read-only',
        message: '99 task(s).',
        overview: { ...MOCK_OVERVIEW, totalTasks: 99 },
      },
    });

    // Old pack A response must be ignored
    await waitFor(() => expect(result.current.overview?.totalTasks).toBe(2));
  });
});
